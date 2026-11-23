import crypto from 'crypto';
import path from 'path';
import { type Request, type Response, type NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';
import { type DropboxService } from '../services/dropbox.service.js';
import { type DocumentRepository } from '../repositories/document.repository.js';
import {
  type UpdateDocumentMetadataDTO,
  type LinkDropboxFileDTO,
  type CreateFolderDTO,
  type UpdateFolderDTO,
} from '../dtos/document.dto.js';
import { type DocumentFormat } from '../types/search.types.js';

const VALID_FORMATS: readonly DocumentFormat[] = ['pdf', 'docx', 'xlsx', 'doc', 'xls'];
const DEFAULT_CONTENT_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const isDocumentFormat = (ext: string): ext is DocumentFormat =>
  (VALID_FORMATS as readonly string[]).includes(ext);

const normalizeDropboxPath = (folderPath: string, fileNameOrCustomPath: string): string => {
  const trimmed = fileNameOrCustomPath.trim();
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  const cleanFolder = folderPath.replace(/\/+$/, '');
  return `${cleanFolder}/${trimmed}`;
};

export class DocumentController {
  private static readonly FOLDERS_SYNC_TTL_MS = 3 * 60 * 1000; // 3 minutos
  private readonly dropboxService: DropboxService;
  private readonly documentRepository: DocumentRepository;
  private lastFoldersSyncAt = 0;

  constructor(dropboxService: DropboxService, documentRepository: DocumentRepository) {
    this.dropboxService = dropboxService;
    this.documentRepository = documentRepository;
  }

  private getParamId(req: Request): string {
    const rawId = req.params.id;
    if (typeof rawId === 'string') return rawId;
    if (Array.isArray(rawId) && rawId.length > 0) return rawId[0];
    throw new AppError('Identificador de documento no proporcionado', 400);
  }

  private resolveFormatFromName(
    fileNameOrPath: string,
    explicitFormat?: DocumentFormat
  ): DocumentFormat {
    if (explicitFormat) {
      return explicitFormat;
    }
    const ext = path.extname(fileNameOrPath).replace('.', '').toLowerCase();
    if (!isDocumentFormat(ext)) {
      throw new AppError('Formato de archivo no soportado (use pdf, docx, doc, xlsx o xls)', 400);
    }
    return ext;
  }

  private async prepareAndUploadFile(
    file: Express.Multer.File,
    folderPath: string,
    explicitFormat?: DocumentFormat,
    customRutaCompleta?: string,
    excludeDocId?: string
  ) {
    const formato = this.resolveFormatFromName(file.originalname, explicitFormat);
    const hashContenido = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const targetPath = customRutaCompleta
      ? normalizeDropboxPath(folderPath, customRutaCompleta)
      : normalizeDropboxPath(folderPath, file.originalname);

    const existingByPath = await this.documentRepository.findByRutaCompleta(targetPath);
    if (existingByPath && existingByPath.id !== excludeDocId) {
      throw new AppError('Ya existe otro documento registrado en esta ruta de Dropbox', 409);
    }

    const uploaded = await this.dropboxService.uploadFile(targetPath, file.buffer);
    return { formato, hashContenido, uploaded };
  }

  /**
   * Resuelve automáticamente desde Dropbox (`files/get_metadata`) el `dropboxFileId`,
   * `rutaCompleta` canónica, `formato`, `hashContenido` y `fechaModificacionDropbox`
   * a partir únicamente de la ruta o nombre del archivo en la carpeta seleccionada.
   */
  private async resolveExistingDropboxFile(
    folderPath: string,
    rutaCompleta: string,
    explicitFormat?: DocumentFormat
  ) {
    const normalizedPath = normalizeDropboxPath(folderPath, rutaCompleta);
    const metadata = await this.dropboxService.getFileMetadataByPath(normalizedPath);
    const formato = this.resolveFormatFromName(metadata.name, explicitFormat);
    const hashContenido = metadata.contentHash ?? DEFAULT_CONTENT_HASH;

    return {
      dropboxFileId: metadata.id,
      rutaCompleta: metadata.pathDisplay,
      formato,
      hashContenido,
      fechaModificacionDropbox: metadata.serverModified,
    };
  }

  /**
   * Lista las carpetas institucionales sincronizando toda la jerarquía de subcarpetas
   * de Dropbox (/BASE_DOCUMENTAL). Soporta `?parentId=<uuid>` y `?refresh=true`.
   */
  public getFolders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parentId =
        typeof req.query.parentId === 'string' && req.query.parentId.trim() !== ''
          ? req.query.parentId.trim()
          : undefined;
      const forceRefresh = req.query.refresh === 'true';

      let folders = await this.documentRepository.findFolders(parentId);
      const cacheExpired =
        Date.now() - this.lastFoldersSyncAt > DocumentController.FOLDERS_SYNC_TTL_MS;
      const needsInitialSync = !parentId && folders.length <= 1;

      if (forceRefresh || cacheExpired || needsInitialSync) {
        try {
          const remoteFolders = await this.dropboxService.listFolders(undefined, true);
          if (remoteFolders.length > 0) {
            folders = await this.documentRepository.syncSubfoldersFromDropbox(
              env.DROPBOX_FOLDER_PATH,
              remoteFolders,
              parentId
            );
            this.lastFoldersSyncAt = Date.now();
          }
        } catch (syncError) {
          console.warn(
            'No se pudieron sincronizar subcarpetas desde Dropbox, usando caché BD:',
            syncError
          );
        }
      }

      res.status(200).json({
        success: true,
        count: folders.length,
        data: folders,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Lista los archivos reales en Dropbox dentro de una carpeta registrada en BD
   * (y sus subcarpetas directas), indicando con `yaVinculado` si ya tienen un registro en `documentos`.
   * Soporta `?recursive=true` para listar también archivos dentro de subcarpetas anidadas.
   */
  public getFolderDropboxFiles = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const folderId = this.getParamId(req);
      const recursive = req.query.recursive === 'true';

      const folder = await this.documentRepository.findFolderById(folderId);
      if (!folder) {
        throw new AppError('Carpeta no encontrada', 404);
      }

      const [files, subcarpetas] = await Promise.all([
        this.dropboxService.listFilesInFolder(folder.rutaCompleta, recursive),
        this.documentRepository.findFolders(folder.id),
      ]);

      const linkedIds = await this.documentRepository.findLinkedDropboxFileIds(
        files.map((file) => file.id)
      );

      const data = files.map((file) => ({
        ...file,
        yaVinculado: linkedIds.has(file.id),
      }));

      res.status(200).json({
        success: true,
        folder: {
          id: folder.id,
          carpetaPadreId: folder.carpetaPadreId,
          nombre: folder.nombre,
          rutaCompleta: folder.rutaCompleta,
        },
        subcarpetas,
        count: data.length,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Obtiene el detalle de una carpeta por ID junto con sus subcarpetas directas y conteos.
   */
  public getFolderById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const folderId = this.getParamId(req);
      const folder = await this.documentRepository.findFolderById(folderId);
      if (!folder) {
        throw new AppError('Carpeta no encontrada', 404);
      }

      const subcarpetas = await this.documentRepository.findFolders(folder.id);

      res.status(200).json({
        success: true,
        data: {
          id: folder.id,
          carpetaPadreId: folder.carpetaPadreId,
          dropboxId: folder.dropboxId,
          nombre: folder.nombre,
          rutaCompleta: folder.rutaCompleta,
          createdAt: folder.createdAt,
          totalSubcarpetas: folder._count.subcarpetas,
          totalDocumentos: folder._count.documentos,
          subcarpetas,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Crea una nueva carpeta en Dropbox (`files/create_folder_v2`) y la registra en PostgreSQL con auditoría.
   */
  public createFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = req.body as CreateFolderDTO;
      const userId = req.user?.userId;
      if (!userId) throw new AppError('No autenticado', 401);

      const parentFolder = data.carpetaPadreId
        ? await this.documentRepository.findFolderById(data.carpetaPadreId)
        : await this.documentRepository.findFolderByPath(env.DROPBOX_FOLDER_PATH);

      if (data.carpetaPadreId && !parentFolder) {
        throw new AppError('Carpeta padre no encontrada', 404);
      }

      const baseParentPath = (parentFolder?.rutaCompleta ?? env.DROPBOX_FOLDER_PATH).replace(
        /\/+$/,
        ''
      );
      const targetPath = `${baseParentPath}/${data.nombre}`;

      const existing = await this.documentRepository.findFolderByPath(targetPath);
      if (existing) {
        throw new AppError('Ya existe una carpeta registrada en esa ruta', 409);
      }

      const dropboxFolder = await this.dropboxService.createFolder(targetPath);
      const created = await this.documentRepository.createFolderWithAudit(
        {
          carpetaPadreId: parentFolder?.id ?? null,
          dropboxId: dropboxFolder.id,
          nombre: dropboxFolder.name,
          rutaCompleta: dropboxFolder.pathDisplay,
        },
        userId
      );
      this.lastFoldersSyncAt = Date.now();

      res.status(201).json({
        success: true,
        message: 'Carpeta creada en Dropbox y registrada exitosamente',
        data: created,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Renombra o mueve una carpeta en Dropbox (`files/move_v2`) y actualiza su ruta
   * (y las rutas de sus subcarpetas y documentos hijos) en PostgreSQL.
   */
  public updateFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = this.getParamId(req);
      const data = req.body as UpdateFolderDTO;
      const userId = req.user?.userId;
      if (!userId) throw new AppError('No autenticado', 401);

      const previous = await this.documentRepository.findFolderById(id);
      if (!previous) {
        throw new AppError('Carpeta no encontrada', 404);
      }

      const rootPath = env.DROPBOX_FOLDER_PATH.replace(/\/+$/, '').toLowerCase();
      if (previous.rutaCompleta.replace(/\/+$/, '').toLowerCase() === rootPath) {
        throw new AppError('No se puede renombrar ni mover la carpeta raíz institucional', 400);
      }

      let parentFolder = previous.carpetaPadreId
        ? await this.documentRepository.findFolderById(previous.carpetaPadreId)
        : await this.documentRepository.findFolderByPath(env.DROPBOX_FOLDER_PATH);

      if (data.carpetaPadreId && data.carpetaPadreId !== previous.carpetaPadreId) {
        if (data.carpetaPadreId === id) {
          throw new AppError('Una carpeta no puede ser su propia carpeta padre', 400);
        }
        const targetParent = await this.documentRepository.findFolderById(data.carpetaPadreId);
        if (!targetParent) {
          throw new AppError('Carpeta padre destino no encontrada', 404);
        }
        if (
          targetParent.rutaCompleta
            .toLowerCase()
            .startsWith(`${previous.rutaCompleta.replace(/\/+$/, '').toLowerCase()}/`)
        ) {
          throw new AppError(
            'No se puede mover una carpeta dentro de una de sus propias subcarpetas',
            400
          );
        }
        parentFolder = targetParent;
      }

      let newNombre = data.nombre ?? previous.nombre;
      const parentPath = (parentFolder?.rutaCompleta ?? env.DROPBOX_FOLDER_PATH).replace(
        /\/+$/,
        ''
      );
      let newRutaCompleta = `${parentPath}/${newNombre}`;

      if (newRutaCompleta.toLowerCase() !== previous.rutaCompleta.toLowerCase()) {
        const conflict = await this.documentRepository.findFolderByPath(newRutaCompleta);
        if (conflict && conflict.id !== id) {
          throw new AppError('Ya existe otra carpeta registrada en la ruta destino', 409);
        }

        const moved = await this.dropboxService.moveFolder(previous.rutaCompleta, newRutaCompleta);
        newNombre = moved.name;
        newRutaCompleta = moved.pathDisplay;
      }

      const updated = await this.documentRepository.updateFolderWithAudit(
        id,
        {
          nombre: newNombre,
          carpetaPadreId: parentFolder?.id ?? previous.carpetaPadreId,
          oldRutaCompleta: previous.rutaCompleta,
          newRutaCompleta,
        },
        previous as unknown as Record<string, unknown>,
        userId
      );
      this.lastFoldersSyncAt = Date.now();

      res.status(200).json({
        success: true,
        message: 'Carpeta actualizada en Dropbox y base de datos correctamente',
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Elimina físicamente una carpeta en Dropbox (`files/delete_v2`) y en PostgreSQL con auditoría.
   */
  public deleteFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = this.getParamId(req);
      const userId = req.user?.userId;
      if (!userId) throw new AppError('No autenticado', 401);

      const folder = await this.documentRepository.findFolderById(id);
      if (!folder) {
        throw new AppError('Carpeta no encontrada', 404);
      }

      const rootPath = env.DROPBOX_FOLDER_PATH.replace(/\/+$/, '').toLowerCase();
      if (folder.rutaCompleta.replace(/\/+$/, '').toLowerCase() === rootPath) {
        throw new AppError('No se puede eliminar la carpeta raíz institucional', 400);
      }

      await this.dropboxService.deleteFolder(folder.rutaCompleta || folder.dropboxId);
      await this.documentRepository.deleteFolderWithAudit(
        id,
        folder.rutaCompleta,
        folder as unknown as Record<string, unknown>,
        userId
      );
      this.lastFoldersSyncAt = Date.now();

      res.status(200).json({
        success: true,
        message: 'Carpeta eliminada de Dropbox y de la base de datos correctamente',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * CU03: Previsualizar metadatos y vigencia del documento
   */
  public getPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = this.getParamId(req);
      const doc = await this.documentRepository.findById(id);

      if (!doc) {
        throw new AppError('Documento no encontrado o no disponible', 404);
      }

      res.status(200).json({
        success: true,
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * CU04: Descargar documento original (Redirección / Enlace seguro de Dropbox)
   * Registra automáticamente en LOGS_USER (RF-14)
   */
  public downloadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = this.getParamId(req);
      const doc = await this.documentRepository.findById(id);

      if (!doc) {
        throw new AppError('Documento no encontrado', 404);
      }

      const downloadUrl = await this.dropboxService.getTemporaryDownloadLink(doc.dropboxFileId);

      // Auditoría no bloqueante en LOGS_USER
      const auditUserId = req.user?.userId ?? null;
      setImmediate(async () => {
        try {
          await this.documentRepository.recordDownloadAudit(id, auditUserId, {
            nombre: doc.nombre,
            codigoDocumental: doc.codigoDocumental,
            rutaCompleta: doc.rutaCompleta,
          });
        } catch (auditErr) {
          console.error('Error registrando auditoría de descarga:', auditErr);
        }
      });

      res.status(200).json({
        success: true,
        data: {
          downloadUrl,
          nombre: doc.nombre,
          formato: doc.formato,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * CU07: Modificar / actualizar metadatos y reemplazar archivo en Dropbox
   * eliminando la versión anterior si cambia el archivo o su ruta.
   */
  public updateMetadata = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = this.getParamId(req);
      const data = req.body as UpdateDocumentMetadataDTO;
      const userId = req.user?.userId;

      if (!userId) throw new AppError('No autenticado', 401);

      const previous = await this.documentRepository.findById(id);
      if (!previous) throw new AppError('Documento no encontrado', 404);

      let targetFolder = previous.carpeta;
      if (data.carpetaId && data.carpetaId !== previous.carpetaId) {
        const foundFolder = await this.documentRepository.findFolderById(data.carpetaId);
        if (!foundFolder) {
          throw new AppError('Carpeta destino no encontrada', 404);
        }
        targetFolder = foundFolder;
      }

      let nextDropboxFileId = data.dropboxFileId;
      let nextRutaCompleta = data.rutaCompleta;
      let nextFormato = data.formato;
      let nextHashContenido = data.hashContenido;
      let nextFechaModificacion: Date | undefined;
      let fileUpdated = false;
      let oldDropboxPathToDelete: string | null = null;

      if (req.file) {
        const { formato, hashContenido, uploaded } = await this.prepareAndUploadFile(
          req.file,
          targetFolder.rutaCompleta,
          data.formato,
          data.rutaCompleta,
          id
        );
        nextFormato = formato;
        nextHashContenido = hashContenido;
        nextDropboxFileId = uploaded.id;
        nextRutaCompleta = uploaded.pathDisplay;
        nextFechaModificacion = uploaded.serverModified;
        fileUpdated = true;

        // Si el nuevo archivo se subió a otra ruta o tiene un ID diferente en Dropbox,
        // eliminamos la versión anterior para no consumir almacenamiento duplicado.
        const isDifferentPath =
          uploaded.pathDisplay.toLowerCase() !== previous.rutaCompleta.toLowerCase();
        const isDifferentId = uploaded.id !== previous.dropboxFileId;

        if (isDifferentPath && isDifferentId) {
          oldDropboxPathToDelete = previous.rutaCompleta || previous.dropboxFileId;
        }
      } else if (data.rutaCompleta && !data.dropboxFileId) {
        const candidatePath = normalizeDropboxPath(targetFolder.rutaCompleta, data.rutaCompleta);
        if (candidatePath.toLowerCase() !== previous.rutaCompleta.toLowerCase()) {
          const resolved = await this.resolveExistingDropboxFile(
            targetFolder.rutaCompleta,
            data.rutaCompleta,
            data.formato
          );
          nextDropboxFileId = resolved.dropboxFileId;
          nextRutaCompleta = resolved.rutaCompleta;
          nextFormato = resolved.formato;
          nextHashContenido = data.hashContenido ?? resolved.hashContenido;
          nextFechaModificacion = resolved.fechaModificacionDropbox;
          fileUpdated = true;

          if (resolved.dropboxFileId !== previous.dropboxFileId) {
            oldDropboxPathToDelete = previous.rutaCompleta || previous.dropboxFileId;
          }
        }
      } else if (
        (data.dropboxFileId && data.dropboxFileId !== previous.dropboxFileId) ||
        (data.rutaCompleta && data.rutaCompleta.toLowerCase() !== previous.rutaCompleta.toLowerCase())
      ) {
        fileUpdated = true;
        oldDropboxPathToDelete = previous.dropboxFileId;
      }

      if (nextDropboxFileId && nextDropboxFileId !== previous.dropboxFileId) {
        const existingDoc = await this.documentRepository.findByDropboxFileId(nextDropboxFileId);
        if (existingDoc && existingDoc.id !== id) {
          throw new AppError(
            'El archivo de Dropbox seleccionado ya está vinculado a otro documento',
            409
          );
        }
      }

      if (oldDropboxPathToDelete) {
        await this.dropboxService.deleteFile(oldDropboxPathToDelete);
      }

      const updated = await this.documentRepository.updateMetadataWithAudit(
        id,
        {
          carpetaId: data.carpetaId,
          codigoDocumental: data.codigoDocumental,
          nombre: data.nombre,
          descripcion: data.descripcion,
          tipo: data.tipo,
          anio: data.anio,
          formato: nextFormato,
          dropboxFileId: nextDropboxFileId,
          rutaCompleta: nextRutaCompleta,
          hashContenido: nextHashContenido,
          fechaModificacionDropbox: nextFechaModificacion,
        },
        previous as unknown as Record<string, unknown>,
        userId,
        fileUpdated
      );

      res.status(200).json({
        success: true,
        message: 'Metadatos actualizados correctamente',
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * CU08: Crear / asociar / vincular archivo en Dropbox con sus metadatos.
   * Si no se adjunta archivo (`req.file`) ni `dropboxFileId`, resuelve automáticamente
   * los metadatos reales en Dropbox a partir de `rutaCompleta`.
   */
  public linkDropboxFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = req.body as LinkDropboxFileDTO;
      const userId = req.user?.userId;

      if (!userId) throw new AppError('No autenticado', 401);

      const folder = await this.documentRepository.findFolderById(data.carpetaId);
      if (!folder) {
        throw new AppError('Carpeta destino no encontrada', 404);
      }

      let dropboxFileId = data.dropboxFileId;
      let rutaCompleta = data.rutaCompleta;
      let formato = data.formato;
      let hashContenido = data.hashContenido;
      let fechaModificacionDropbox = new Date();

      if (req.file) {
        const {
          formato: uploadedFormat,
          hashContenido: uploadedHash,
          uploaded,
        } = await this.prepareAndUploadFile(
          req.file,
          folder.rutaCompleta,
          data.formato,
          data.rutaCompleta
        );
        formato = uploadedFormat;
        hashContenido = uploadedHash;
        dropboxFileId = uploaded.id;
        rutaCompleta = uploaded.pathDisplay;
        fechaModificacionDropbox = uploaded.serverModified;
      } else if (rutaCompleta && !dropboxFileId) {
        const resolved = await this.resolveExistingDropboxFile(
          folder.rutaCompleta,
          rutaCompleta,
          data.formato
        );
        dropboxFileId = resolved.dropboxFileId;
        rutaCompleta = resolved.rutaCompleta;
        formato = resolved.formato;
        hashContenido =
          data.hashContenido && data.hashContenido !== DEFAULT_CONTENT_HASH
            ? data.hashContenido
            : resolved.hashContenido;
        fechaModificacionDropbox = resolved.fechaModificacionDropbox;
      } else if (dropboxFileId && rutaCompleta) {
        rutaCompleta = normalizeDropboxPath(folder.rutaCompleta, rutaCompleta);
        formato = this.resolveFormatFromName(rutaCompleta, data.formato);
      } else {
        throw new AppError(
          'Debe adjuntar un archivo o proporcionar la ruta completa del archivo en Dropbox',
          400
        );
      }

      const existingById = await this.documentRepository.findByDropboxFileId(dropboxFileId);
      if (existingById) {
        throw new AppError(
          'Ya existe un documento vinculado con ese archivo de Dropbox. Usa Editar para actualizarlo.',
          409
        );
      }

      const newDoc = await this.documentRepository.createWithAudit(
        {
          carpetaId: data.carpetaId,
          codigoDocumental: data.codigoDocumental,
          dropboxFileId,
          nombre: data.nombre,
          descripcion: data.descripcion,
          formato,
          tipo: data.tipo,
          anio: data.anio,
          rutaCompleta,
          hashContenido,
          fechaModificacionDropbox,
        },
        userId
      );

      res.status(201).json({
        success: true,
        message: 'Documento creado y vinculado en Dropbox exitosamente',
        data: newDoc,
      });
    } catch (error) {
      next(error);
    }
  };
}

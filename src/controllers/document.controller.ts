import { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/appError.js';
import { type DropboxService } from '../services/dropbox.service.js';
import {
  type UpdateDocumentMetadataDTO,
  type LinkDropboxFileDTO,
} from '../dtos/document.dto.js';

export class DocumentController {
  private readonly dropboxService: DropboxService;

  constructor(dropboxService: DropboxService) {
    this.dropboxService = dropboxService;
  }

  private getParamId(req: Request): string {
    const rawId = req.params.id;
    if (typeof rawId === 'string') return rawId;
    if (Array.isArray(rawId) && rawId.length > 0) return rawId[0];
    throw new AppError('Identificador de documento no proporcionado', 400);
  }

  /**
   * CU03: Previsualizar metadatos y vigencia del documento
   */
  public getPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = this.getParamId(req);
      const doc = await prisma.documento.findUnique({
        where: { id },
        include: { carpeta: true, documentosLectura: true },
      });

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
      const doc = await prisma.documento.findUnique({ where: { id } });

      if (!doc) {
        throw new AppError('Documento no encontrado', 404);
      }

      // Obtener enlace seguro temporal de descarga desde Dropbox (solo lectura)
      const downloadUrl = await this.dropboxService.getTemporaryDownloadLink(doc.dropboxFileId);

      // Auditoría no bloqueante en LOGS_USER
      setImmediate(async () => {
        try {
          await prisma.logUser.create({
            data: {
              userId: req.user?.userId ?? null,
              documentoId: id,
              accion: 'DESCARGA',
              entidad: 'DOCUMENTOS',
              contenidoNuevo: {
                nombre: doc.nombre,
                codigoDocumental: doc.codigoDocumental,
                rutaCompleta: doc.rutaCompleta,
              },
            },
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
   * CU07: Modificar / actualizar metadatos de documentos
   */
  public updateMetadata = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = this.getParamId(req);
      const data = req.body as UpdateDocumentMetadataDTO;
      const userId = req.user?.userId;

      if (!userId) throw new AppError('No autenticado', 401);

      const previous = await prisma.documento.findUnique({ where: { id } });
      if (!previous) throw new AppError('Documento no encontrado', 404);

      const updated = await prisma.documento.update({
        where: { id },
        data: {
          codigoDocumental: data.codigoDocumental,
          nombre: data.nombre,
          descripcion: data.descripcion,
          tipo: data.tipo,
          anio: data.anio,
        },
      });

      // Trazabilidad de cambios en LOGS_USER
      await prisma.logUser.create({
        data: {
          documentoId: id,
          userId,
          accion: 'CRUD_DOC',
          entidad: 'METADATOS',
          contenidoAnterior: previous as any,
          contenidoNuevo: updated as any,
        },
      });

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
   * CU08: Cargar / asociar / vincular archivo en Dropbox
   */
  public linkDropboxFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = req.body as LinkDropboxFileDTO;
      const userId = req.user?.userId;

      if (!userId) throw new AppError('No autenticado', 401);

      // Crear registro de documento
      const newDoc = await prisma.documento.create({
        data: {
          carpetaId: data.carpetaId,
          codigoDocumental: data.codigoDocumental,
          dropboxFileId: data.dropboxFileId,
          nombre: data.nombre,
          descripcion: data.descripcion,
          formato: data.formato,
          tipo: data.tipo,
          anio: data.anio,
          rutaCompleta: data.rutaCompleta,
          hashContenido: data.hashContenido,
          fechaModificacionDropbox: new Date(),
        },
      });

      // Crear registro inicial en documento_lectura
      await prisma.documentoLectura.create({
        data: {
          documentoId: newDoc.id,
          estadoExtraccion: 'RECONOCIDO',
          hashContenido: data.hashContenido,
        },
      });

      // Registrar auditoría en LOGS_USER
      await prisma.logUser.create({
        data: {
          documentoId: newDoc.id,
          userId,
          accion: 'CRUD_DOC',
          entidad: 'DOCUMENTOS',
          contenidoNuevo: newDoc as any,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Archivo de Dropbox vinculado exitosamente',
        data: newDoc,
      });
    } catch (error) {
      next(error);
    }
  };
}

import { type Prisma, type PrismaClient } from '@prisma/client';
import { type UpdateDocumentMetadataDTO } from '../dtos/document.dto.js';
import { type DropboxFolderMetadata } from '../services/dropbox.service.js';

export interface CreateDocumentPersistenceInput {
  carpetaId: string;
  codigoDocumental: string;
  dropboxFileId: string;
  nombre: string;
  descripcion?: string;
  formato: string;
  tipo?: string;
  anio?: number;
  rutaCompleta: string;
  hashContenido: string;
  fechaModificacionDropbox?: Date;
}

export interface UpdateDocumentPersistenceInput {
  carpetaId?: string;
  codigoDocumental?: string;
  nombre?: string;
  descripcion?: string;
  tipo?: string;
  anio?: number;
  formato?: string;
  dropboxFileId?: string;
  rutaCompleta?: string;
  hashContenido?: string;
  fechaModificacionDropbox?: Date;
}

const toJsonSnapshot = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export class DocumentRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  public async findById(id: string) {
    return this.prisma.documento.findUnique({
      where: { id },
      include: {
        carpeta: true,
        documentosLectura: true,
      },
    });
  }

  public async findByDropboxFileId(dropboxFileId: string) {
    return this.prisma.documento.findUnique({
      where: { dropboxFileId },
    });
  }

  public async findLinkedDropboxFileIds(dropboxFileIds: string[]): Promise<Set<string>> {
    if (dropboxFileIds.length === 0) {
      return new Set();
    }
    const existing = await this.prisma.documento.findMany({
      where: {
        dropboxFileId: {
          in: dropboxFileIds,
        },
      },
      select: {
        dropboxFileId: true,
      },
    });
    return new Set(existing.map((doc) => doc.dropboxFileId));
  }

  public async findByRutaCompleta(rutaCompleta: string) {
    return this.prisma.documento.findFirst({
      where: {
        rutaCompleta: {
          equals: rutaCompleta,
          mode: 'insensitive',
        },
      },
    });
  }

  public async findFolderById(id: string) {
    return this.prisma.carpeta.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            subcarpetas: true,
            documentos: true,
          },
        },
      },
    });
  }

  public async findFolderByPath(rutaCompleta: string) {
    const cleanPath = rutaCompleta.replace(/\/+$/, '');
    return this.prisma.carpeta.findFirst({
      where: {
        rutaCompleta: {
          equals: cleanPath,
          mode: 'insensitive',
        },
      },
    });
  }

  public async createFolderWithAudit(
    data: {
      carpetaPadreId: string | null;
      dropboxId: string;
      nombre: string;
      rutaCompleta: string;
    },
    userId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.carpeta.create({
        data: {
          carpetaPadreId: data.carpetaPadreId,
          dropboxId: data.dropboxId,
          nombre: data.nombre,
          rutaCompleta: data.rutaCompleta.replace(/\/+$/, ''),
        },
      });

      await tx.logUser.create({
        data: {
          userId,
          accion: 'CRUD_DOC',
          entidad: 'CARPETAS',
          contenidoNuevo: toJsonSnapshot(created),
        },
      });

      return created;
    });
  }

  public async updateFolderWithAudit(
    id: string,
    data: {
      nombre: string;
      carpetaPadreId: string | null;
      oldRutaCompleta: string;
      newRutaCompleta: string;
    },
    previous: Record<string, unknown>,
    userId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cleanOldPath = data.oldRutaCompleta.replace(/\/+$/, '');
      const cleanNewPath = data.newRutaCompleta.replace(/\/+$/, '');

      const updated = await tx.carpeta.update({
        where: { id },
        data: {
          nombre: data.nombre,
          carpetaPadreId: data.carpetaPadreId,
          rutaCompleta: cleanNewPath,
        },
      });

      if (cleanOldPath.toLowerCase() !== cleanNewPath.toLowerCase()) {
        const oldPrefix = `${cleanOldPath}/`;

        const descendantFolders = await tx.carpeta.findMany({
          where: {
            rutaCompleta: {
              startsWith: oldPrefix,
              mode: 'insensitive',
            },
          },
          select: { id: true, rutaCompleta: true },
        });

        for (const sub of descendantFolders) {
          const suffix = sub.rutaCompleta.slice(cleanOldPath.length);
          await tx.carpeta.update({
            where: { id: sub.id },
            data: { rutaCompleta: `${cleanNewPath}${suffix}` },
          });
        }

        const descendantDocs = await tx.documento.findMany({
          where: {
            rutaCompleta: {
              startsWith: oldPrefix,
              mode: 'insensitive',
            },
          },
          select: { id: true, rutaCompleta: true },
        });

        for (const doc of descendantDocs) {
          const suffix = doc.rutaCompleta.slice(cleanOldPath.length);
          await tx.documento.update({
            where: { id: doc.id },
            data: { rutaCompleta: `${cleanNewPath}${suffix}` },
          });
        }
      }

      await tx.logUser.create({
        data: {
          userId,
          accion: 'CRUD_DOC',
          entidad: 'CARPETAS',
          contenidoAnterior: toJsonSnapshot(previous),
          contenidoNuevo: toJsonSnapshot(updated),
        },
      });

      return updated;
    });
  }

  public async deleteFolderWithAudit(
    id: string,
    rutaCompleta: string,
    previous: Record<string, unknown>,
    userId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cleanPath = rutaCompleta.replace(/\/+$/, '');
      const prefix = `${cleanPath}/`;

      // Eliminar documentos dentro de la carpeta o sus subcarpetas antes de borrar la carpeta (onDelete: Restrict)
      await tx.documento.deleteMany({
        where: {
          OR: [
            { carpetaId: id },
            {
              rutaCompleta: {
                startsWith: prefix,
                mode: 'insensitive',
              },
            },
          ],
        },
      });

      await tx.carpeta.delete({
        where: { id },
      });

      await tx.logUser.create({
        data: {
          userId,
          accion: 'CRUD_DOC',
          entidad: 'CARPETAS',
          contenidoAnterior: toJsonSnapshot(previous),
          contenidoNuevo: toJsonSnapshot({
            eliminado: true,
            dropboxDeleted: true,
            rutaEliminada: cleanPath,
          }),
        },
      });
    });
  }

  public async findFolders(parentId?: string) {
    const rows = await this.prisma.carpeta.findMany({
      where: parentId ? { carpetaPadreId: parentId } : undefined,
      include: {
        _count: {
          select: {            subcarpetas: true,
            documentos: true,
          },
        },
      },
      orderBy: { rutaCompleta: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      carpetaPadreId: row.carpetaPadreId,
      dropboxId: row.dropboxId,
      nombre: row.nombre,
      rutaCompleta: row.rutaCompleta,
      createdAt: row.createdAt,
      totalSubcarpetas: row._count.subcarpetas,
      totalDocumentos: row._count.documentos,
    }));
  }

  public async syncSubfoldersFromDropbox(
    rootFolderPath: string,
    dropboxFolders: DropboxFolderMetadata[],
    parentIdFilter?: string
  ) {
    const normalizedRoot = (
      rootFolderPath.startsWith('/') ? rootFolderPath : `/${rootFolderPath}`
    ).replace(/\/+$/, '');

    const rootFolder = await this.prisma.carpeta.findFirst({
      where: {
        rutaCompleta: {
          equals: normalizedRoot,
          mode: 'insensitive',
        },
      },
    });

    const existingFolders = await this.prisma.carpeta.findMany({
      select: { id: true, dropboxId: true, nombre: true, rutaCompleta: true, carpetaPadreId: true },
    });

    const pathToId = new Map<string, string>();
    const byDropboxId = new Map<
      string,
      { id: string; nombre: string; rutaCompleta: string; carpetaPadreId: string | null }
    >();
    for (const existing of existingFolders) {
      const cleanExistingPath = existing.rutaCompleta.replace(/\/+$/, '');
      pathToId.set(cleanExistingPath.toLowerCase(), existing.id);
      byDropboxId.set(existing.dropboxId, {
        id: existing.id,
        nombre: existing.nombre,
        rutaCompleta: cleanExistingPath,
        carpetaPadreId: existing.carpetaPadreId,
      });
    }
    if (rootFolder) {
      pathToId.set(normalizedRoot.toLowerCase(), rootFolder.id);
    }

    const sortedFolders = [...dropboxFolders].sort((a, b) => {
      const depthA = a.pathDisplay.split('/').length;
      const depthB = b.pathDisplay.split('/').length;
      return depthA !== depthB ? depthA - depthB : a.pathDisplay.localeCompare(b.pathDisplay);
    });

    for (const folder of sortedFolders) {
      const cleanPath = folder.pathDisplay.replace(/\/+$/, '');
      if (cleanPath.toLowerCase() === normalizedRoot.toLowerCase()) {
        continue;
      }

      const lastSlash = cleanPath.lastIndexOf('/');
      const parentPath =
        lastSlash > 0 ? cleanPath.slice(0, lastSlash).toLowerCase() : normalizedRoot.toLowerCase();
      const carpetaPadreId = pathToId.get(parentPath) ?? rootFolder?.id ?? null;

      const current = byDropboxId.get(folder.id);
      if (
        current &&
        current.nombre === folder.name &&
        current.rutaCompleta === cleanPath &&
        current.carpetaPadreId === carpetaPadreId
      ) {
        pathToId.set(cleanPath.toLowerCase(), current.id);
        continue;
      }

      const saved = await this.prisma.carpeta.upsert({
        where: { dropboxId: folder.id },
        update: {
          nombre: folder.name,
          rutaCompleta: cleanPath,
          carpetaPadreId,
        },
        create: {
          dropboxId: folder.id,
          nombre: folder.name,
          rutaCompleta: cleanPath,
          carpetaPadreId,
        },
      });

      pathToId.set(cleanPath.toLowerCase(), saved.id);
    }

    return this.findFolders(parentIdFilter);
  }

  public async createWithAudit(data: CreateDocumentPersistenceInput, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const newDoc = await tx.documento.create({
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
          fechaModificacionDropbox: data.fechaModificacionDropbox ?? new Date(),
        },
      });

      await tx.documentoLectura.create({
        data: {
          documentoId: newDoc.id,
          estadoExtraccion: 'RECONOCIDO',
          hashContenido: data.hashContenido,
        },
      });

      const fullDoc = await tx.documento.findUniqueOrThrow({
        where: { id: newDoc.id },
        include: {
          carpeta: true,
          documentosLectura: true,
        },
      });

      await tx.logUser.create({
        data: {
          documentoId: newDoc.id,
          userId,
          accion: 'CRUD_DOC',
          entidad: 'DOCUMENTOS',
          contenidoNuevo: toJsonSnapshot(fullDoc),
        },
      });

      return fullDoc;
    });
  }

  public async updateMetadataWithAudit(
    id: string,
    data: UpdateDocumentPersistenceInput,
    previous: Record<string, unknown>,
    userId: string,
    fileUpdated: boolean
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (fileUpdated && data.hashContenido) {
        const existingReading = await tx.documentoLectura.findFirst({
          where: { documentoId: id },
        });

        if (existingReading) {
          await tx.documentoLectura.updateMany({
            where: { documentoId: id },
            data: {
              estadoExtraccion: 'RECONOCIDO',
              hashContenido: data.hashContenido,
              fechaCambio: new Date(),
            },
          });
        } else {
          await tx.documentoLectura.create({
            data: {
              documentoId: id,
              estadoExtraccion: 'RECONOCIDO',
              hashContenido: data.hashContenido,
            },
          });
        }
      }

      const updated = await tx.documento.update({
        where: { id },
        data: {
          carpetaId: data.carpetaId,
          codigoDocumental: data.codigoDocumental,
          nombre: data.nombre,
          descripcion: data.descripcion,
          tipo: data.tipo,
          anio: data.anio,
          formato: data.formato,
          dropboxFileId: data.dropboxFileId,
          rutaCompleta: data.rutaCompleta,
          hashContenido: data.hashContenido,
          fechaModificacionDropbox: data.fechaModificacionDropbox,
        },
        include: {
          carpeta: true,
          documentosLectura: true,
        },
      });

      await tx.logUser.create({
        data: {
          documentoId: id,
          userId,
          accion: 'CRUD_DOC',
          entidad: 'METADATOS',
          contenidoAnterior: toJsonSnapshot(previous),
          contenidoNuevo: toJsonSnapshot(updated),
        },
      });

      return updated;
    });
  }

  public async recordDownloadAudit(
    documentoId: string,
    userId: string | null,
    snapshot: { nombre: string; codigoDocumental: string | null; rutaCompleta: string }
  ) {
    return this.prisma.logUser.create({
      data: {
        userId,
        documentoId,
        accion: 'DESCARGA',
        entidad: 'DOCUMENTOS',
        contenidoNuevo: toJsonSnapshot(snapshot),
      },
    });
  }

  public async updateMetadata(id: string, data: UpdateDocumentMetadataDTO) {
    return this.prisma.documento.update({
      where: { id },
      data: {
        codigoDocumental: data.codigoDocumental,
        nombre: data.nombre,
        descripcion: data.descripcion,
        tipo: data.tipo,
        anio: data.anio,
      },
    });
  }

  public async count() {
    return this.prisma.documento.count();
  }
}

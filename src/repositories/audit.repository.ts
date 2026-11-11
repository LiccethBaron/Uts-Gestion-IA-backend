import { type PrismaClient } from '@prisma/client';

export interface CreateLogUserDTO {
  userId?: string | null;
  documentoId?: string | null;
  accion: 'BUSQUEDA' | 'DESCARGA' | 'CRUD_DOC' | 'LOGIN';
  entidad: 'DOCUMENTOS' | 'SESION' | 'METADATOS';
  contenidoAnterior?: any;
  contenidoNuevo?: any;
}

export class AuditRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  public async logEvent(data: CreateLogUserDTO) {
    return this.prisma.logUser.create({
      data: {
        userId: data.userId ?? null,
        documentoId: data.documentoId ?? null,
        accion: data.accion,
        entidad: data.entidad,
        contenidoAnterior: data.contenidoAnterior ?? undefined,
        contenidoNuevo: data.contenidoNuevo ?? undefined,
      },
    });
  }

  public async countLogs() {
    return this.prisma.logUser.count();
  }
}


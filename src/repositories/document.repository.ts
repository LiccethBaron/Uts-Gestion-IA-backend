import { type PrismaClient } from '@prisma/client';
import { type UpdateDocumentMetadataDTO } from '../dtos/document.dto.js';

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


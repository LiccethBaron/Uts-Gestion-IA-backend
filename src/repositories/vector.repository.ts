import { type PrismaClient } from '@prisma/client';
import { type SearchQueryDTO } from '../dtos/search.dto.js';

export interface RawDocumentVectorRow {
  id: string;
  codigo: string | null;
  nombre: string;
  descripcion: string | null;
  formato: string;
  anio: number | null;
  rutaCompleta: string;
  carpetaMadre: string;
  scoreSimilitud: number;
}

export class VectorRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Ejecuta búsqueda vectorial sobre documento_vector con pgvector utilizando distancia coseno (<=>)
   * y filtros facetados estructurados (RF-02)
   */
  public async searchSimilarDocuments(
    queryVector: number[],
    params: SearchQueryDTO
  ): Promise<RawDocumentVectorRow[]> {
    const { tipo, formato, anio, limit, offset } = params;
    const vectorString = `[${queryVector.join(',')}]`;

    return this.prisma.$queryRaw<RawDocumentVectorRow[]>`
      SELECT 
        d.id,
        d.codigo_documental AS "codigo",
        d.nombre,
        d.descripcion,
        d.formato,
        d.anio,
        d.ruta_completa AS "rutaCompleta",
        c.nombre AS "carpetaMadre",
        (1 - (dv.embedding <=> ${vectorString}::vector)) AS "scoreSimilitud"
      FROM documentos d
      INNER JOIN carpetas c ON d.carpeta_id = c.id
      INNER JOIN documento_vector dv ON dv.documento_id = d.id
      WHERE (${tipo ?? null}::text IS NULL OR d.tipo = ${tipo ?? null})
        AND (${formato ?? null}::text IS NULL OR d.formato = ${formato ?? null})
        AND (${anio ?? null}::int IS NULL OR d.anio = ${anio ?? null})
      ORDER BY "scoreSimilitud" DESC
      LIMIT ${limit} OFFSET ${offset};
    `;
  }
}

import { type VectorRepository } from '../repositories/vector.repository.js';
import { type AIService } from './ai.service.js';
import { type SearchQueryDTO } from '../dtos/search.dto.js';
import { type DocumentSearchResult } from '../types/search.types.js';
import { env } from '../config/env.js';

export class SearchService {
  private readonly vectorRepo: VectorRepository;
  private readonly aiService: AIService;

  constructor(vectorRepo: VectorRepository, aiService: AIService) {
    this.vectorRepo = vectorRepo;
    this.aiService = aiService;
  }

  public async searchDocuments(params: SearchQueryDTO): Promise<DocumentSearchResult[]> {
    const { q } = params;

    // 1. Obtener embedding de la consulta en lenguaje natural (RF-02)
    const queryVector = await this.aiService.generateEmbedding(q);

    // 2. Consulta de similitud vectorial + filtros usando pgvector (HNSW) en repositorio
    const rawResults = await this.vectorRepo.searchSimilarDocuments(queryVector, params);

    // 3. Justificación semántica sin alucinaciones para los resultados top (RF-05, Regla IA-02)
    return Promise.all(
      rawResults.map(async (doc) => {
        const score = typeof doc.scoreSimilitud === 'number' ? doc.scoreSimilitud : parseFloat(String(doc.scoreSimilitud));
        const formattedScore = parseFloat(score.toFixed(4));

        // Política Cero Alucinación: Solo generar justificación si cumple el umbral
        let justificacion: string | undefined;
        if (formattedScore >= env.SIMILARITY_THRESHOLD) {
          justificacion = await this.aiService.buildJustification(q, doc.nombre, doc.descripcion);
        }

        return {
          id: doc.id,
          codigo: doc.codigo || 'SIN CÓDIGO',
          nombre: doc.nombre,
          descripcion: doc.descripcion || '',
          formato: doc.formato as DocumentSearchResult['formato'],
          anio: doc.anio || 0,
          rutaCompleta: doc.rutaCompleta,
          carpetaMadre: doc.carpetaMadre,
          scoreSimilitud: formattedScore,
          justificacion,
        };
      })
    );
  }
}

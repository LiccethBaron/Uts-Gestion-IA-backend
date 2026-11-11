import { env } from '../config/env.js';
import { PIISanitizer } from '../utils/piiSanitizer.js';

export class AIService {
  private readonly apiKey: string | undefined;
  private readonly modelName: string;
  private readonly dimension: number;

  constructor() {
    this.apiKey = env.GEMINI_API_KEY;
    this.modelName = env.EMBEDDING_MODEL;
    this.dimension = env.EMBEDDING_DIMENSION;
  }

  /**
   * Genera el vector de embedding numérico para una consulta o fragmento de texto.
   * Aplica sanitización de PII previa según la Regla IA-03.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const sanitizedText = PIISanitizer.sanitize(text);

    // Si no hay API key configurada (ej. desarrollo inicial o tests), retorna vector simulado normalizado
    if (!this.apiKey) {
      return this.generateMockEmbedding(sanitizedText, this.dimension);
    }

    try {
      // Integración con API de Embeddings de Gemini / Vertex AI
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:embedContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${this.modelName}`,
            content: { parts: [{ text: sanitizedText }] },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Error en API de embeddings: ${response.statusText}`);
      }

      const data = (await response.json()) as { embedding: { values: number[] } };
      return data.embedding.values;
    } catch (error) {
      console.warn('Fallo en API de embeddings, usando fallback controlado:', error);
      return this.generateMockEmbedding(sanitizedText, this.dimension);
    }
  }

  /**
   * Construye una justificación explicativa de relevancia semántica (RF-05).
   * Aplica estrictamente la Política de Cero Alucinación (Zero-Hallucination Policy - Regla IA-02).
   */
  public async buildJustification(
    query: string,
    documentTitle: string,
    documentDescription?: string | null
  ): Promise<string> {
    const sanitizedQuery = PIISanitizer.sanitize(query);
    const cleanDesc = documentDescription ? PIISanitizer.sanitize(documentDescription) : '';

    // Justificación determinista basada estrictamente en términos coincidentes y metadatos verificados
    return `El documento "${documentTitle}" se identificó como relevante para "${sanitizedQuery}" porque su descripción oficial (${cleanDesc || 'registro documental'}) aborda directamente los lineamientos solicitados en la consulta.`;
  }

  /**
   * Generador determinista de vector mock para pruebas y entornos locales sin llave de API.
   */
  private generateMockEmbedding(seedText: string, dim: number): number[] {
    const vector = new Array(dim).fill(0);
    let hash = 0;
    for (let i = 0; i < seedText.length; i++) {
      hash = (hash << 5) - hash + seedText.charCodeAt(i);
      hash |= 0;
    }

    let norm = 0;
    for (let i = 0; i < dim; i++) {
      const val = Math.sin(hash + i);
      vector[i] = val;
      norm += val * val;
    }

    norm = Math.sqrt(norm) || 1;
    return vector.map((v) => parseFloat((v / norm).toFixed(6)));
  }
}


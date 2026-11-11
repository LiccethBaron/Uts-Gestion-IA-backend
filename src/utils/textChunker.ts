/**
 * Divisor de texto en fragmentos (chunks)
 * Cumple con la Regla IA-04 (RF-06, RF-09):
 * Ventanas de 512 a 1000 tokens con overlap de 100 tokens.
 */
export interface ChunkOptions {
  chunkSizeWords?: number; // Aproximación estándar de tokens a palabras (~0.75 tokens/palabra)
  overlapWords?: number;
}

export class TextChunker {
  private static readonly DEFAULT_CHUNK_SIZE = 600; // ~800 tokens
  private static readonly DEFAULT_OVERLAP = 80;    // ~100 tokens

  public static split(text: string, options?: ChunkOptions): string[] {
    const chunkSize = options?.chunkSizeWords ?? this.DEFAULT_CHUNK_SIZE;
    const overlap = options?.overlapWords ?? this.DEFAULT_OVERLAP;

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= chunkSize) {
      return [words.join(' ')];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + chunkSize, words.length);
      const chunk = words.slice(start, end).join(' ');
      chunks.push(chunk);

      if (end === words.length) break;
      start += chunkSize - overlap;
    }

    return chunks;
  }
}


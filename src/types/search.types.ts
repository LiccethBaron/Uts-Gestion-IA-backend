export type DocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'doc' | 'xls';

export interface DocumentSearchResult {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string;
  formato: DocumentFormat;
  anio: number;
  rutaCompleta: string;
  carpetaMadre: string;
  scoreSimilitud: number;
  justificacion?: string;
}

export interface SearchResponse<T> {
  success: boolean;
  count: number;
  data: T[];
}


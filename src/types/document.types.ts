import { type DocumentFormat } from './search.types.js';

export interface DocumentoLecturaItem {
  id: string;
  documentoId: string;
  estadoExtraccion: 'RECONOCIDO' | 'DESCONOCIDO' | 'REINDEXAR';
  hashContenido: string;
  fechaCambio: Date;
  fechaCreacion: Date;
}

export interface DocumentDetail {
  id: string;
  carpetaId: string;
  codigoDocumental?: string | null;
  dropboxFileId: string;
  nombre: string;
  descripcion?: string | null;
  formato: DocumentFormat;
  tipo?: string | null;
  anio?: number | null;
  rutaCompleta: string;
  hashContenido: string;
  fechaModificacionDropbox: Date;
  createdAt: Date;
  updatedAt: Date;
  documentosLectura?: DocumentoLecturaItem[];
}

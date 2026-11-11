import { z } from 'zod';

export const UpdateDocumentMetadataSchema = z.object({
  codigoDocumental: z.string().trim().optional(),
  nombre: z.string().trim().min(3).optional(),
  descripcion: z.string().trim().optional(),
  tipo: z.string().trim().optional(),
  anio: z.coerce.number().int().min(1980).max(2100).optional(),
});

export type UpdateDocumentMetadataDTO = z.infer<typeof UpdateDocumentMetadataSchema>;

/**
 * Esquema para CU08: Cargar / asociar archivo en Dropbox
 */
export const LinkDropboxFileSchema = z.object({
  carpetaId: z.string().uuid('ID de carpeta inválido'),
  codigoDocumental: z.string().trim().min(1, 'El código documental es obligatorio'),
  dropboxFileId: z.string().min(3, 'El ID de archivo de Dropbox es obligatorio'),
  nombre: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres'),
  descripcion: z.string().trim().optional(),
  formato: z.enum(['pdf', 'docx', 'xlsx', 'doc', 'xls']),
  tipo: z.string().trim().optional(),
  anio: z.coerce.number().int().min(1980).max(2100).optional(),
  rutaCompleta: z.string().min(1, 'La ruta completa es obligatoria'),
  hashContenido: z.string().default('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
});

export type LinkDropboxFileDTO = z.infer<typeof LinkDropboxFileSchema>;

/**
 * Esquema para CU09: Consultar historial de auditoría y cambios
 */
export const AuditLogQuerySchema = z.object({
  accion: z.enum(['BUSQUEDA', 'DESCARGA', 'CRUD_DOC', 'LOGIN']).optional(),
  entidad: z.enum(['DOCUMENTOS', 'SESION', 'METADATOS']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AuditLogQueryDTO = z.infer<typeof AuditLogQuerySchema>;

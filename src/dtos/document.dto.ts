import { z } from 'zod';

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalTrimmedString = (minLength: number, message: string) =>
  z.preprocess(emptyToUndefined, z.string().trim().min(minLength, message).optional());

const optionalFormatEnum = z.preprocess(
  emptyToUndefined,
  z.enum(['pdf', 'docx', 'xlsx', 'doc', 'xls']).optional()
);

const optionalYearSchema = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1980).max(2100).optional()
);

/**
 * Esquema para CU07: Modificar / actualizar metadatos y vínculo de archivo en Dropbox
 */
export const UpdateDocumentMetadataSchema = z.object({
  carpetaId: z.preprocess(
    emptyToUndefined,
    z.string().uuid('ID de carpeta inválido').optional()
  ),
  codigoDocumental: optionalTrimmedString(1, 'El código documental no puede estar vacío'),
  nombre: optionalTrimmedString(3, 'El nombre debe tener al menos 3 caracteres'),
  descripcion: z.string().trim().optional(),
  tipo: z.string().trim().optional(),
  anio: optionalYearSchema,
  formato: optionalFormatEnum,
  dropboxFileId: optionalTrimmedString(3, 'El ID de archivo de Dropbox es inválido'),
  rutaCompleta: optionalTrimmedString(1, 'La ruta completa no puede estar vacía'),
  hashContenido: optionalTrimmedString(1, 'El hash de contenido no puede estar vacío'),
});

export type UpdateDocumentMetadataDTO = z.infer<typeof UpdateDocumentMetadataSchema>;

/**
 * Esquema para CU08: Crear / asociar documento con sus metadatos y archivo en Dropbox
 */
export const LinkDropboxFileSchema = z.object({
  carpetaId: z.string().uuid('ID de carpeta inválido'),
  codigoDocumental: z.string().trim().min(1, 'El código documental es obligatorio'),
  dropboxFileId: optionalTrimmedString(3, 'El ID de archivo de Dropbox es obligatorio'),
  nombre: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres'),
  descripcion: z.string().trim().optional(),
  formato: optionalFormatEnum,
  tipo: z.string().trim().optional(),
  anio: optionalYearSchema,
  rutaCompleta: optionalTrimmedString(1, 'La ruta completa es obligatoria'),
  hashContenido: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .default('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  ),
});

export type LinkDropboxFileDTO = z.infer<typeof LinkDropboxFileSchema>;

/**
 * Esquemas para Gestión Administrativa de Carpetas en Dropbox y BD
 */
export const CreateFolderSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre de la carpeta es obligatorio')
    .max(255, 'El nombre de la carpeta no puede superar 255 caracteres')
    .refine((val) => !val.includes('/'), 'El nombre de la carpeta no debe contener "/"'),
  carpetaPadreId: z.preprocess(
    emptyToUndefined,
    z.string().uuid('ID de carpeta padre inválido').optional()
  ),
});

export type CreateFolderDTO = z.infer<typeof CreateFolderSchema>;

export const UpdateFolderSchema = z.object({
  nombre: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .min(1, 'El nombre de la carpeta no puede estar vacío')
      .max(255, 'El nombre de la carpeta no puede superar 255 caracteres')
      .refine((val) => !val.includes('/'), 'El nombre de la carpeta no debe contener "/"')
      .optional()
  ),
  carpetaPadreId: z.preprocess(
    emptyToUndefined,
    z.string().uuid('ID de carpeta padre inválido').optional()
  ),
});

export type UpdateFolderDTO = z.infer<typeof UpdateFolderSchema>;

/**
 * Esquema para CU09: Consultar historial de auditoría y cambios
 */
export const AuditLogQuerySchema = z.object({
  accion: z.enum(['BUSQUEDA', 'DESCARGA', 'CRUD_DOC', 'LOGIN']).optional(),
  entidad: z.enum(['DOCUMENTOS', 'SESION', 'METADATOS', 'CARPETAS']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AuditLogQueryDTO = z.infer<typeof AuditLogQuerySchema>;

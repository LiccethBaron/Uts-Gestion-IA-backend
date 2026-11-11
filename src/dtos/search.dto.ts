import { z } from 'zod';

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'La consulta debe tener al menos 2 caracteres'),
  tipo: z.string().optional(),
  formato: z.enum(['pdf', 'docx', 'xlsx', 'doc', 'xls']).optional(),
  anio: z.coerce.number().int().min(1980).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SearchQueryDTO = z.infer<typeof SearchQuerySchema>;


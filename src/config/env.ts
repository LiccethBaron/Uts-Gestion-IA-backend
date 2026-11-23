import { z } from 'zod';

try {
  process.loadEnvFile();
} catch {
  // Permite continuar si el archivo .env no existe (ej. variables inyectadas en despliegue)
}

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().default('postgresql://uts_app_user:pass@localhost:5432/uts_documental'),
  JWT_SECRET: z.string().default('dev_jwt_secret_change_me_in_prod'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CRON_SECRET: z.string().default('uts_pg_cron_internal_secret_key_2026'),
  DROPBOX_CLIENT_ID: z.string().optional(),
  DROPBOX_CLIENT_SECRET: z.string().optional(),
  DROPBOX_REFRESH_TOKEN: z.string().optional(),
  DROPBOX_ACCESS_TOKEN: z.string().optional(),
  DROPBOX_FOLDER_PATH: z.string().default('/BASE_DOCUMENTAL'),
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('text-embedding-004'),
  EMBEDDING_DIMENSION: z.coerce.number().default(768),
  SIMILARITY_THRESHOLD: z.coerce.number().default(0.60),
});

export const env = EnvSchema.parse(process.env);

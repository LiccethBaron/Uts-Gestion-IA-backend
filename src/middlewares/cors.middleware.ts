import cors, { type CorsOptions } from 'cors';
import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';

const getAllowedOrigins = (): string[] =>
  env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsOptions: CorsOptions = {
  origin: (requestOrigin, callback) => {
    // Permite clientes sin cabecera Origin (Postman, Thunder Client, pg_cron, webhooks de Dropbox)
    if (!requestOrigin) {
      callback(null, true);
      return;
    }

    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.includes('*') || allowedOrigins.includes(requestOrigin)) {
      callback(null, true);
      return;
    }

    callback(new AppError(`Origen no permitido por la política CORS: ${requestOrigin}`, 403));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-key', 'x-dropbox-signature'],
  credentials: true,
  optionsSuccessStatus: 204,
};

/**
 * Middleware CORS que restringe las peticiones cruzadas a los orígenes autorizados en CORS_ORIGIN.
 */
export const corsMiddleware = cors(corsOptions);

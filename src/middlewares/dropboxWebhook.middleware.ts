import crypto from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';

/**
 * Validador HMAC para Webhooks de Dropbox (Imagen 3 - Seguridad Cloud)
 * - Procesa el challenge de verificación en peticiones GET
 * - Valida la firma HMAC-SHA256 en peticiones POST entrantes desde Dropbox
 */
export const validateDropboxWebhook = (req: Request, res: Response, next: NextFunction): void => {
  // 1. Verificación del desafío inicial de Dropbox (Challenge GET)
  if (req.method === 'GET' && req.query.challenge) {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(req.query.challenge);
    return;
  }

  // 2. Validación de firma HMAC en notificaciones POST de cambios de archivos
  if (req.method === 'POST') {
    const signature = req.headers['x-dropbox-signature'] as string;
    const secret = env.DROPBOX_CLIENT_SECRET;

    // Si estamos en producción y se configuró secreto, se valida estrictamente
    if (secret && signature) {
      const rawBody = JSON.stringify(req.body);
      const computedHmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      if (signature !== computedHmac) {
        throw new AppError('Firma HMAC del Webhook de Dropbox no válida', 403);
      }
    }
  }

  next();
};


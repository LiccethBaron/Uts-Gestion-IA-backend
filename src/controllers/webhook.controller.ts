import { type Request, type Response, type NextFunction } from 'express';
import { type SyncService } from '../services/sync.service.js';

/**
 * Controlador de Webhooks de Dropbox (Imagen 3)
 */
export class WebhookController {
  private readonly syncService: SyncService;

  constructor(syncService: SyncService) {
    this.syncService = syncService;
  }

  /**
   * Manejador de notificaciones de cambios en Dropbox
   */
  public handleDropboxWebhook = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Responder de inmediato con 200 OK para cumplir con el SLA de Dropbox Webhooks
      res.status(200).send('OK');

      // 2. Disparar sincronización asíncrona de fondo
      setImmediate(async () => {
        try {
          console.log('[DROPBOX WEBHOOK] Notificación de cambios recibida. Ejecutando sincronización...');
          await this.syncService.executeSync();
        } catch (syncError) {
          console.error('[DROPBOX WEBHOOK] Error en sincronización por webhook:', syncError);
        }
      });
    } catch (error) {
      next(error);
    }
  };
}

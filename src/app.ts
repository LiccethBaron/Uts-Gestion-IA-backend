import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { VectorRepository } from './repositories/vector.repository.js';
import { AIService } from './services/ai.service.js';
import { SearchService } from './services/search.service.js';
import { DropboxService } from './services/dropbox.service.js';
import { ParserService } from './services/parser.service.js';
import { SyncService } from './services/sync.service.js';

import { SearchController } from './controllers/search.controller.js';
import { DocumentController } from './controllers/document.controller.js';
import { AuthController } from './controllers/auth.controller.js';
import { AdminController } from './controllers/admin.controller.js';
import { WebhookController } from './controllers/webhook.controller.js';

import { validateRequest } from './middlewares/validator.middleware.js';
import { errorHandler } from './middlewares/errorHandler.middleware.js';
import { authenticateJWT } from './middlewares/auth.middleware.js';
import { requireRole } from './middlewares/rbac.middleware.js';
import { auditQuery } from './middlewares/audit.middleware.js';
import { publicApiRateLimiter, authRateLimiter } from './middlewares/rateLimit.middleware.js';
import { validateDropboxWebhook } from './middlewares/dropboxWebhook.middleware.js';

import { SearchQuerySchema } from './dtos/search.dto.js';
import { LoginSchema, CreateUserSchema } from './dtos/auth.dto.js';
import {
  UpdateDocumentMetadataSchema,
  LinkDropboxFileSchema,
  AuditLogQuerySchema,
} from './dtos/document.dto.js';

export const createApp = () => {
  const app = express();

  // 1. Capa de Seguridad de Cabeceras (Helmet) y CORS (Imagen 3)
  app.use(
    helmet({
      contentSecurityPolicy: false, // Compatible con APIs REST
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(cors());
  app.use(express.json());

  // 2. Inyección de Dependencias
  const vectorRepo = new VectorRepository(prisma);
  const aiService = new AIService();
  const dropboxService = new DropboxService();
  const parserService = new ParserService();
  const searchService = new SearchService(vectorRepo, aiService);
  const syncService = new SyncService(prisma, dropboxService, parserService, aiService);

  // 3. Controladores
  const searchController = new SearchController(searchService);
  const documentController = new DocumentController(dropboxService);
  const authController = new AuthController();
  const adminController = new AdminController(syncService);
  const webhookController = new WebhookController(syncService);

  // 4. Verificación de Salud
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // --- MÓDULO 1: BÚSQUEDA Y RECUPERACIÓN DOCUMENTAL (Público - Imágenes 1 y 5) ---
  // CU01 & CU02: Búsqueda Semántica por Lenguaje Natural y Filtros por Metadatos
  app.get(
    '/api/search',
    publicApiRateLimiter,
    validateRequest(SearchQuerySchema, 'query'),
    auditQuery('BUSQUEDA'),
    searchController.execute
  );

  // CU03: Previsualizar detalle del documento, metadatos y vigencia
  app.get(
    '/api/documents/preview/:id',
    publicApiRateLimiter,
    documentController.getPreview
  );

  // CU04: Descargar documento original (Redirección / Enlace de descarga temporal seguro)
  app.get(
    '/api/documents/:id/download',
    publicApiRateLimiter,
    documentController.downloadDocument
  );

  // --- WEBHOOKS: NOTIFICACIONES AUTOMÁTICAS DE DROPBOX (Imagen 3) ---
  app.all(
    '/api/webhooks/dropbox',
    validateDropboxWebhook,
    webhookController.handleDropboxWebhook
  );

  // --- TAREAS EN SEGUNDO PLANO (pg_cron - Imágenes 2, 4 y 5) ---
  // CU10 & CU11: Sincronización e Ingesta de pg_cron
  app.post('/api/cron/sync', async (req, res, next) => {
    try {
      const authKey = req.headers['x-cron-key'];
      if (authKey !== env.CRON_SECRET) {
        res.status(401).json({ success: false, error: 'No autorizado para ejecutar tarea cron' });
        return;
      }
      const result = await syncService.executeSync();
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  // --- MÓDULO 2: ADMINISTRACIÓN Y GESTIÓN DE IA (Imágenes 2 y 5) ---
  // CU05: Iniciar sesión como administrador
  app.post(
    '/api/auth/login',
    authRateLimiter,
    validateRequest(LoginSchema, 'body'),
    authController.login
  );

  // CU06: Gestionar / Crear cuentas de administradores
  app.post(
    '/api/admin/users',
    authenticateJWT,
    requireRole('ADMINISTRADOR'),
    validateRequest(CreateUserSchema, 'body'),
    authController.createSubadmin
  );

  // CU07: Registrar / Modificar metadatos de documentos
  app.patch(
    '/api/documents/:id/metadata',
    authenticateJWT,
    requireRole('ADMINISTRADOR', 'SUBADMINISTRADOR'),
    validateRequest(UpdateDocumentMetadataSchema, 'body'),
    documentController.updateMetadata
  );

  // CU08: Cargar / asociar / vincular archivo en Dropbox
  app.post(
    '/api/documents/link-dropbox',
    authenticateJWT,
    requireRole('ADMINISTRADOR', 'SUBADMINISTRADOR'),
    validateRequest(LinkDropboxFileSchema, 'body'),
    documentController.linkDropboxFile
  );

  // CU09: Consultar historial de auditoría y cambios (LOGS_USER)
  app.get(
    '/api/admin/audit-logs',
    authenticateJWT,
    requireRole('ADMINISTRADOR', 'SUBADMINISTRADOR'),
    validateRequest(AuditLogQuerySchema, 'query'),
    adminController.getAuditLogs
  );

  // Métricas de uso y estado del índice
  app.get(
    '/api/admin/metrics',
    authenticateJWT,
    requireRole('ADMINISTRADOR', 'SUBADMINISTRADOR'),
    adminController.getMetrics
  );

  // Disparo manual de sincronización
  app.post(
    '/api/admin/sync',
    authenticateJWT,
    requireRole('ADMINISTRADOR'),
    adminController.triggerSync
  );

  // Middleware global de errores
  app.use(errorHandler);

  return app;
};

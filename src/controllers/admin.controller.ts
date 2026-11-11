import { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { type SyncService } from '../services/sync.service.js';
import { type AuditLogQueryDTO } from '../dtos/document.dto.js';

export class AdminController {
  private readonly syncService: SyncService;

  constructor(syncService: SyncService) {
    this.syncService = syncService;
  }

  /**
   * Obtiene métricas generales del sistema
   */
  public getMetrics = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [totalDocs, totalCarpetas, totalLogs, totalVectores] = await Promise.all([
        prisma.documento.count(),
        prisma.carpeta.count(),
        prisma.logUser.count(),
        prisma.documentoVector.count(),
      ]);

      res.status(200).json({
        success: true,
        data: {
          totalDocumentos: totalDocs,
          totalCarpetas,
          totalLogsRegistrados: totalLogs,
          totalFragmentosVectorizados: totalVectores,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * CU09: Consultar historial de auditoría y cambios (LOGS_USER)
   */
  public getAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { accion, entidad, limit, offset } = req.query as unknown as AuditLogQueryDTO;

      const [logs, total] = await Promise.all([
        prisma.logUser.findMany({
          where: {
            accion: accion || undefined,
            entidad: entidad || undefined,
          },
          orderBy: { fechaCreacion: 'desc' },
          take: limit,
          skip: offset,
          include: {
            usuario: {
              select: { id: true, nombreCompleto: true, email: true },
            },
            documento: {
              select: { id: true, nombre: true, codigoDocumental: true },
            },
          },
        }),
        prisma.logUser.count({
          where: {
            accion: accion || undefined,
            entidad: entidad || undefined,
          },
        }),
      ]);

      res.status(200).json({
        success: true,
        total,
        count: logs.length,
        data: logs,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * CU10 & CU11: Disparar sincronización manual con Dropbox y actualización de pgvector
   */
  public triggerSync = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.syncService.executeSync();

      res.status(200).json({
        success: true,
        message: 'Sincronización ejecutada exitosamente',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

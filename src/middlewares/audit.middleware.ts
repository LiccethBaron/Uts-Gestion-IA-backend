import { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { PIISanitizer } from '../utils/piiSanitizer.js';

/**
 * Middleware para auditoría asíncrona de consultas y descargas (RF-14)
 * Registra en la tabla oficial `LOGS_USER`.
 */
export const auditQuery = (accion: 'BUSQUEDA' | 'DESCARGA') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);

    res.json = (body: any) => {
      // Disparar persistencia asíncrona no bloqueante
      setImmediate(async () => {
        try {
          const rawQuery = (req.query.q as string) || '';
          const sanitizedQuery = PIISanitizer.sanitize(rawQuery);
          const userId = req.user?.userId ?? null;
          const totalResultados = Array.isArray(body?.data) ? body.data.length : (body?.count ?? 0);

          await prisma.logUser.create({
            data: {
              userId,
              accion,
              entidad: 'DOCUMENTOS',
              contenidoNuevo: {
                terminoBusqueda: sanitizedQuery || null,
                resultadosObtenidos: totalResultados,
              },
            },
          });
        } catch (auditError) {
          console.error('Error registrando auditoría en logs_user:', auditError);
        }
      });

      return originalJson(body);
    };

    next();
  };
};

import { type Request, type Response, type NextFunction } from 'express';
import { type AuthUserPayload } from '../types/auth.types.js';
import { AppError } from '../utils/appError.js';

// Extensión de la interfaz Request de Express
declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export const authenticateJWT = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Acceso denegado: Token de autorización ausente o inválido', 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    // NOTA: En producción se decodifica y verifica con jsonwebtoken usando env.JWT_SECRET
    // Simulación de decodificación controlada para entornos de desarrollo / pruebas
    if (!token) {
      throw new AppError('Token de autenticación no suministrado', 401);
    }

    // Payload de ejemplo mapeado al usuario autenticado
    req.user = {
      userId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
      email: 'admin@correo.uts.edu.co',
      rol: 'ADMINISTRADOR',
    };

    next();
  } catch (error) {
    next(new AppError('Sesión caducada o token inválido', 401));
  }
};


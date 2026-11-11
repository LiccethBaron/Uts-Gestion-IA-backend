import { type Request, type Response, type NextFunction } from 'express';
import { type UserRole } from '../types/auth.types.js';
import { AppError } from '../utils/appError.js';

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError('Usuario no autenticado', 401);
    }

    if (!allowedRoles.includes(req.user.rol)) {
      throw new AppError('No tienes los permisos necesarios para realizar esta acción', 403);
    }

    next();
  };
};


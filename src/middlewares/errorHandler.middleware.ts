import { type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../utils/appError.js';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  console.error('Unhandled Internal Error:', err);

  res.status(500).json({
    success: false,
    error: 'Error interno del servidor. Por favor intenta más tarde.',
  });
};


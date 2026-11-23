import path from 'path';
import multer from 'multer';
import { type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../utils/appError.js';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls']);

const storage = multer.memoryStorage();

const uploader = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(
        new AppError(
          'Formato de archivo no permitido. Solo se admiten .pdf, .docx, .doc, .xlsx y .xls',
          400
        )
      );
      return;
    }
    cb(null, true);
  },
});

const singleFileMiddleware = uploader.single('file');

/**
 * Middleware para procesar un archivo opcional en campo `file` (multipart/form-data)
 * manteniendo compatibilidad transparente con peticiones JSON.
 */
export const uploadDocumentFile = (req: Request, res: Response, next: NextFunction): void => {
  singleFileMiddleware(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof AppError) {
      next(err);
      return;
    }

    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'El archivo supera el tamaño máximo permitido de 25 MB'
          : `Error al procesar el archivo adjunto: ${err.message}`;
      next(new AppError(message, 400));
      return;
    }

    next(new AppError('No fue posible procesar el archivo enviado', 400));
  });
};

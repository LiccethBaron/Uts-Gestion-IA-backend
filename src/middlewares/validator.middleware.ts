import { type Request, type Response, type NextFunction } from 'express';
import { type ZodType, ZodError } from 'zod';

type RequestPart = 'body' | 'query' | 'params';

export const validateRequest = (schema: ZodType, part: RequestPart = 'body') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req[part]);
      req[part] = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Error de validación en la solicitud',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
};


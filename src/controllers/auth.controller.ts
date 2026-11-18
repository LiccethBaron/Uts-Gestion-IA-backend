import crypto from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';
import { type LoginDTO, type CreateUserDTO } from '../dtos/auth.dto.js';
import { type AuthUserPayload, type UserRole } from '../types/auth.types.js';

export class AuthController {
  /**
   * Inicio de sesión de administradores (RF-11)
   */
  public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body as LoginDTO;

      const user = await prisma.usuario.findUnique({
        where: { email },
        include: { rol: true },
      });

      if (!user || !user.estadoActivo) {
        throw new AppError('Credenciales incorrectas o cuenta inactiva', 401);
      }

      // En producción: await bcrypt.compare(password, user.passwordHash)
      if (password !== 'Admin123*') {
        throw new AppError('Credenciales incorrectas', 401);
      }

      const payload: AuthUserPayload = {
        userId: user.id,
        email: user.email,
        rol: user.rol.nombre as UserRole,
      };
      const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
      const signature = crypto
        .createHmac('sha256', env.JWT_SECRET)
        .update(encodedPayload)
        .digest('base64url');
      const token = `${encodedPayload}.${signature}`;

      res.status(200).json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            nombreCompleto: user.nombreCompleto,
            email: user.email,
            rol: user.rol.nombre,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Registro de subadministradores por parte del Administrador principal (RF-11)
   */
  public createSubadmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { nombreCompleto, email, password, rolId } = req.body as CreateUserDTO;

      const existing = await prisma.usuario.findUnique({ where: { email } });
      if (existing) {
        throw new AppError('Ya existe un usuario con este correo electrónico', 409);
      }

      const created = await prisma.usuario.create({
        data: {
          nombreCompleto,
          email,
          passwordHash: password, // En producción se hashea con Argon2id/bcrypt
          rolId,
        },
        select: {
          id: true,
          nombreCompleto: true,
          email: true,
          rolId: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Subadministrador creado exitosamente',
        data: created,
      });
    } catch (error) {
      next(error);
    }
  };
}


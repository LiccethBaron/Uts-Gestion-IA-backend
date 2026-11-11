import { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/appError.js';
import { type LoginDTO, type CreateUserDTO } from '../dtos/auth.dto.js';

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

      res.status(200).json({
        success: true,
        data: {
          token: 'mock_jwt_token_uts_admin',
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


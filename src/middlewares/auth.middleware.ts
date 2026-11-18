import crypto from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { type AuthUserPayload, type UserRole } from '../types/auth.types.js';
import { AppError } from '../utils/appError.js';

const ADMIN_DEFAULT_ID = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const ADMIN_DEFAULT_EMAIL = 'admin@correo.uts.edu.co';
const MOCK_DEV_TOKEN = 'mock_jwt_token_uts_admin';
const VALID_ROLES: readonly UserRole[] = ['ADMINISTRADOR', 'SUBADMINISTRADOR'];

// Extensión de la interfaz Request de Express
declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

const isValidRole = (role: unknown): role is UserRole =>
  typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role);

const parseSignedToken = (token: string): AuthUserPayload => {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new AppError('Sesión caducada o token inválido', 401);
  }

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    throw new AppError('Sesión caducada o token inválido', 401);
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf-8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf-8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new AppError('Sesión caducada o token inválido', 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
  } catch {
    throw new AppError('Sesión caducada o token inválido', 401);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as AuthUserPayload).userId !== 'string' ||
    typeof (parsed as AuthUserPayload).email !== 'string' ||
    !isValidRole((parsed as AuthUserPayload).rol)
  ) {
    throw new AppError('Sesión caducada o token inválido', 401);
  }

  return {
    userId: (parsed as AuthUserPayload).userId,
    email: (parsed as AuthUserPayload).email,
    rol: (parsed as AuthUserPayload).rol,
  };
};

/**
 * Resuelve el usuario real en PostgreSQL para garantizar integridad referencial
 * en logs_user cuando existe conexión a la base de datos.
 */
const resolveAuthenticatedUser = async (
  candidate: AuthUserPayload | null
): Promise<AuthUserPayload> => {
  try {
    let dbUser = candidate?.userId
      ? await prisma.usuario.findUnique({
          where: { id: candidate.userId },
          include: { rol: true },
        })
      : null;

    if (!dbUser) {
      const lookupEmail = candidate?.email ?? ADMIN_DEFAULT_EMAIL;
      dbUser = await prisma.usuario.findUnique({
        where: { email: lookupEmail },
        include: { rol: true },
      });
    }

    if (!dbUser && !candidate) {
      dbUser = await prisma.usuario.findFirst({
        where: {
          estadoActivo: true,
          rol: { nombre: 'ADMINISTRADOR' },
        },
        include: { rol: true },
      });
    }

    if (dbUser) {
      if (!dbUser.estadoActivo) {
        throw new AppError('Cuenta de usuario inactiva', 401);
      }
      if (!isValidRole(dbUser.rol.nombre)) {
        throw new AppError('Rol de usuario no reconocido', 403);
      }

      return {
        userId: dbUser.id,
        email: dbUser.email,
        rol: dbUser.rol.nombre,
      };
    }

    if (candidate) {
      throw new AppError('Usuario autenticado no encontrado', 401);
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Fallback controlado si la base de datos aún no está disponible
  }

  return (
    candidate ?? {
      userId: ADMIN_DEFAULT_ID,
      email: ADMIN_DEFAULT_EMAIL,
      rol: 'ADMINISTRADOR',
    }
  );
};

export const authenticateJWT = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new AppError('Acceso denegado: Token de autorización ausente o inválido', 401));
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    next(new AppError('Token de autenticación no suministrado', 401));
    return;
  }

  try {
    const isMockDevToken = token === MOCK_DEV_TOKEN && env.NODE_ENV !== 'production';
    const tokenPayload = isMockDevToken ? null : parseSignedToken(token);

    req.user = await resolveAuthenticatedUser(tokenPayload);
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError('Sesión caducada o token inválido', 401));
  }
};


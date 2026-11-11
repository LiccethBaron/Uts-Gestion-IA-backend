export type UserRole = 'ADMINISTRADOR' | 'SUBADMINISTRADOR';

export interface AuthUserPayload {
  userId: string;
  email: string;
  rol: UserRole;
}


import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Debe ser un correo electrónico institucional válido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
});

export type LoginDTO = z.infer<typeof LoginSchema>;

export const CreateUserSchema = z.object({
  nombreCompleto: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
  email: z.string().email('Correo no válido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  rolId: z.number().int().positive(),
});

export type CreateUserDTO = z.infer<typeof CreateUserSchema>;


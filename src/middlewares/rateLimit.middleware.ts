import rateLimit from 'express-rate-limit';

/**
 * Limitador de tasa para peticiones públicas de búsqueda y visualización
 * (Protección contra ataques DoS y scraping masivo)
 */
export const publicApiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200, // Límite de 200 peticiones por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Has excedido el límite de consultas permitidas. Por favor intenta más tarde.',
  },
});

/**
 * Limitador estricto para intentos de autenticación administrativa
 * (Prevención de ataques de fuerza bruta)
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // Máximo 10 intentos fallidos
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiados intentos de inicio de sesión. Por motivos de seguridad, tu acceso temporal ha sido bloqueado.',
  },
});


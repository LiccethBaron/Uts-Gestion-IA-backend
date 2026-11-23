import helmet from 'helmet';

/**
 * Middleware de cabeceras de seguridad HTTP (Defensa en Profundidad - AGENTS.md §4.2).
 * Configura Content-Security-Policy (CSP), Strict-Transport-Security (HSTS) y X-Frame-Options.
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny',
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

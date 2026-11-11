import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();
const PORT = env.PORT || 3000;

// En producción levantamos el listener HTTP estándar de Node
if (env.NODE_ENV === 'production') {
  app.listen(PORT, () => {
    console.log(`[UTS-BACKEND] Servidor en ejecución en http://localhost:${PORT}`);
  });
}

// Requerido por vite-plugin-node para recarga en caliente (HMR) en desarrollo
export const viteNodeApp = app;

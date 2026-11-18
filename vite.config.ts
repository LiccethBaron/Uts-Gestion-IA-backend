import { defineConfig } from 'vite';
import { VitePluginNode } from 'vite-plugin-node';

export default defineConfig({
    server: {
        // Puerto donde Vite levantará tu Express en modo desarrollo
        port: 4000,
    },
    plugins: [
        ...VitePluginNode({
            adapter: 'express', // Framework utilizado
            appPath: './src/server.ts', // Punto de entrada del servidor
            exportName: 'viteNodeApp', // Nombre de la variable exportada en server.ts
            tsCompiler: 'vite', // Compilador por defecto de Vite
            outputFormat: 'esm', // Asegura formato ESM en el build
        }),
    ],
});

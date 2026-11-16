import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Duas páginas: a janela principal e o overlay do jogo
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        overlay: resolve(import.meta.dirname, 'overlay.html')
      }
    }
  }
});

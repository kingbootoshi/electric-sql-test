import { defineConfig } from 'electron-vite';
import path from 'path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['better-sqlite3']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: path.join(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: path.join(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: path.join(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
});

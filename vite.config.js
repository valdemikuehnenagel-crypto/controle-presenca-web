import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {

                index: resolve('index.html'),
                dashboard: resolve('dashboard.html'),
            }
        }
    }
});
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The board is served from / by the local server (npm start). Set BASE_PATH to host the page under a sub-path.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5199, host: '127.0.0.1' },
});

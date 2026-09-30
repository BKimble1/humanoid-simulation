/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5174 },
  preview: { host: '127.0.0.1', port: 4174 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
});

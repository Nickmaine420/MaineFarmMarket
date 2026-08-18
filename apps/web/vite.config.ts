import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@mfm/shared': path.resolve(__dirname, '../../packages/shared/src'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              "firebase-core": ["firebase/app"],
              "firebase-auth": ["firebase/auth"],
              "firebase-firestore": ["firebase/firestore"],
              "firebase-functions": ["firebase/functions"],
              "firebase-storage": ["firebase/storage"],
              "native-auth": ["@capacitor/core", "@capacitor-firebase/authentication"],
              react: ["react", "react-dom"],
            },
          },
        },
      },
});

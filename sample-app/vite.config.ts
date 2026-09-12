import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Deliberately not 5173/5174 — those are common Vite/dev-server defaults and can
    // collide with other projects' containers/dev servers on a shared machine.
    port: 5679,
    strictPort: true,
  },
});

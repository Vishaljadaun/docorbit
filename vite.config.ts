import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this repository under /docorbit/; other hosts use /.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? '/docorbit/' : '/',
  build: { target: 'es2022' },
});

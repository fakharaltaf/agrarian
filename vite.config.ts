import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the game from /agrarian/ (build and preview); local dev stays at the root.
export default defineConfig(({ command, isPreview }) => ({ base: command === 'build' || isPreview ? '/agrarian/' : '/', plugins: [react()] }));

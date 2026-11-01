import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the game from /agrarian/; local dev stays at the root.
export default defineConfig(({ command }) => ({ base: command === 'build' ? '/agrarian/' : '/', plugins: [react()] }));

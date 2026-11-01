import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { boot } from './stores/game';
import { unlockAudio } from './app/audio';
import './app/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void boot();
addEventListener('pointerdown', unlockAudio); // browsers only allow sound after a user gesture
addEventListener('keydown', unlockAudio);

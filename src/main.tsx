import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTheme } from './ui/palette';

// Paint the right colours before the first frame.
try {
  const saved = localStorage.getItem('gof.theme') ?? new URLSearchParams(location.search).get('theme');
  applyTheme(saved === 'dark' || (saved !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
} catch {
  applyTheme('light');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

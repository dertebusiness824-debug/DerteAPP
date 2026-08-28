import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el contenedor #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// El service worker sirve el catálogo ya visto cuando el conductor entra en un
// aparcamiento sin cobertura; `autoUpdate` recarga en cuanto hay versión nueva.
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

/**
 * Muster web client — entry point
 *
 * Initialises i18n, then renders the React app into #root.
 */


import React from 'react';
import ReactDOM from 'react-dom/client';
import { initI18n, getStoredLocale } from '@muster/i18n';
import App from './App.js';
import './styles/global.css';
import { Buffer } from 'buffer';
(window as any).Buffer = Buffer;

async function bootstrap(): Promise<void> {
  // Initialise internationalisation before rendering any UI. Honour the
  // user's persisted locale; English remains the default + fallback.
  await initI18n(getStoredLocale());

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Root element #root not found in index.html');

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap().catch((err: unknown) => {
  console.error('[Muster] Failed to bootstrap application:', err);
});

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);

/* The service worker caches only the app shell/static JS and CSS.
 * User documents, social videos and AI requests are never cached.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', {
      scope: import.meta.env.BASE_URL,
    }).catch(() => {
      // Installability remains optional; all web tools work without the worker.
    });
  });
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { registerServiceWorker } from './client/pwa';
import { PwaInstall } from './components/PwaInstall';

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="sfeed-glass-sample" aria-hidden="true" />
    <App />
    <PwaInstall />
  </React.StrictMode>
);

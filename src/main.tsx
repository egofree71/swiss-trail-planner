import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'ol/ol.css';
import './styles.css';
import App from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("L'élément racine #root est introuvable.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

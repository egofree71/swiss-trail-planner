/**
 * Business context: mounts the single React application shell and its language
 * provider into the static Vite entry page. The module fails fast when the
 * expected root element is missing because no map or recovery UI can be shown.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'ol/ol.css';
import './styles.css';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The #root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LangContext, initialLang, makeT } from './i18n';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

// outermost net: whatever breaks in the app shell, the traveller gets the "data unavailable" page and not a white screen
const lang = initialLang();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangContext.Provider value={{ lang, t: makeT(lang) }}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </LangContext.Provider>
  </StrictMode>,
);

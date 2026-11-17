import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './style.css';
import { PreferencesProvider } from './Preferences';

createRoot(document.getElementById('root')!).render(
  <PreferencesProvider>
    <App />
  </PreferencesProvider>,
);

import * as React from 'react';
import * as ReactDOM from 'react-dom';
// Self-hosted fonts — the weights index.css and Tailwind use. Replaces a
// Google Fonts @import that made a third-party request on every page load.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';
import './components/ui/surface.css';
import App from './App';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root'),
);

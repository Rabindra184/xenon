import * as React from 'react';
import { BrowserRouter } from 'react-router-dom';
import './App.css';
import Header from './components/header/header';
import { AppRoutes } from './routes';

import { ToastProvider } from './components/ui/toast';

import Sidebar from './components/sidebar/sidebar';
import { ApiKeyGate } from './components/ApiKeyGate';
import CommandPalette from './components/command-palette/command-palette';
import { isThemeV2 } from './lib/theme-flag';

function App() {
  return (
    <ApiKeyGate>
      <ToastProvider>
        <BrowserRouter basename="/xenon">
          <div className="app-layout">
            <Header />
            <div className="app-main-container">
              <Sidebar />
              <main className="app-content">
                <AppRoutes />
              </main>
            </div>
            {isThemeV2() && <CommandPalette />}
          </div>
        </BrowserRouter>
      </ToastProvider>
    </ApiKeyGate>
  );
}

export default App;

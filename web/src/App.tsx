import * as React from 'react';
import { BrowserRouter } from 'react-router-dom';
import Header from './components/header/header';
import { AppRoutes } from './routes';

import { ToastProvider } from './components/ui/toast';

import Sidebar from './components/sidebar/sidebar';
import { ApiKeyGate } from './components/ApiKeyGate';
import CommandPalette from './components/command-palette/command-palette';

function App() {
  return (
    <ApiKeyGate>
      <ToastProvider>
        <BrowserRouter basename="/xenon">
          <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)]">
            <Sidebar />
            <Header />
            <main className="pl-14 pt-14 h-screen overflow-y-auto">
              <AppRoutes />
            </main>
            <CommandPalette />
          </div>
        </BrowserRouter>
      </ToastProvider>
    </ApiKeyGate>
  );
}

export default App;

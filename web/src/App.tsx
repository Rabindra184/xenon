import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import './App.css';
import Header from './components/header/header';
import { AppRoutes } from './routes';

import { ToastProvider } from './components/ui/toast';

function App() {
  return (
    <ToastProvider>
      <BrowserRouter basename="/xenon">
        <div className="app-container">
          <Header />
          <AppRoutes />
        </div>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;

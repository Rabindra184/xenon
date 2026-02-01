import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import './App.css';
import Header from './components/header/header';
import { AppRoutes } from './routes';

function App() {
  return (
    <BrowserRouter basename="/xenon">
      <div className="app-container">
        <Header />
        <AppRoutes />
      </div>
    </BrowserRouter>
  );
}

export default App;

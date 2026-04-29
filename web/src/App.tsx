import * as React from 'react';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/header/header';
import { AppRoutes } from './routes';
import { ToastProvider } from './components/ui/toast';
import Sidebar from './components/sidebar/sidebar';
import CommandPalette from './components/command-palette/command-palette';
import { AuthProvider } from './auth/auth-context';
import { RouteGuard } from './auth/route-guard';

const LoginPage = lazy(() => import('./pages/login'));
const ApiKeyGate = lazy(() =>
  import('./components/ApiKeyGate').then((m) => ({ default: m.ApiKeyGate })),
);

function Shell() {
  return (
    <ToastProvider>
      <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)]">
        <Sidebar />
        <Header />
        <main className="pl-14 pt-14 h-screen overflow-y-auto">
          <AppRoutes />
        </main>
        <CommandPalette />
      </div>
    </ToastProvider>
  );
}

function App() {
  return (
    <BrowserRouter basename="/xenon">
      <AuthProvider>
        <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/api-key-gate"
              element={
                <ApiKeyGate>
                  <Navigate to="/overview" replace />
                </ApiKeyGate>
              }
            />
            <Route
              path="*"
              element={
                <RouteGuard>
                  <Shell />
                </RouteGuard>
              }
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

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
import { DocumentTitle } from './lib/document-title';

const LoginPage = lazy(() => import('./pages/login'));
const ForgotPasswordPage = lazy(() => import('./pages/forgot-password'));
const ResetPasswordPage = lazy(() => import('./pages/reset-password'));
const ConsentPage = lazy(() => import('./components/oauth/ConsentPage'));

function Shell() {
  return (
    <ToastProvider>
      <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)]">
        <Sidebar />
        <Header />
        <main className="pl-[var(--sidebar-width)] pt-14 h-screen overflow-y-auto">
          <AppRoutes />
        </main>
        <CommandPalette />
      </div>
    </ToastProvider>
  );
}

/**
 * The top-level pages: the sign-in pages, an agent's consent page, and the
 * dashboard (Shell). Exported so a spec can render them in a MemoryRouter.
 */
export function TopLevelRoutes() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Links issued before 1.20.7 carried the token in the path. */}
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        {/* Through 2.18 a page here traded an API token for the dashboard
            cookie. Tokens no longer open the dashboard; old links sign in. */}
        <Route path="/api-key-gate" element={<Navigate to="/login" replace />} />
        {/* An agent's sign-in, opened by authorize: a page of its own, not
            the dashboard's shell. A signed-out visitor signs in and comes
            back here (RouteGuard's `next`). */}
        <Route
          path="/oauth/consent/:requestId"
          element={
            <RouteGuard>
              <ConsentPage />
            </RouteGuard>
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
  );
}

function App() {
  return (
    <BrowserRouter basename="/xenon">
      <DocumentTitle />
      <AuthProvider>
        <TopLevelRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

// Lazy load components for optimal performance
const DeviceExplorer = lazy(() => import('../components/device-explorer/device-explorer'));
const SessionDashboard = lazy(() => import('../components/session-dashboard/session-dashboard'));
const Apps = lazy(() => import('../components/apps/apps'));
const WebhookSettings = lazy(() =>
  import('../components/webhook-settings/webhook-settings').then(m => ({ default: m.WebhookSettings }))
);
const Settings = lazy(() =>
  import('../components/settings/settings').then(m => ({ default: m.Settings }))
);
const AISettings = lazy(() =>
  import('../components/settings/ai-settings').then(m => ({ default: m.AISettings }))
);
const MaintenanceSettings = lazy(() =>
  import('../components/settings/maintenance-settings').then(m => ({ default: m.MaintenanceSettings }))
);

const LoadingFallback = () => (
  <div className="settings-loading" style={{ height: 'calc(100vh - 72px)' }}>
    <RefreshCw className="animate-spin" size={32} />
    <span>Hydrating View...</span>
  </div>
);

/**
 * Application routes configuration
 */
export const AppRoutes: React.FC = () => {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/devices" replace />} />

          <Route
            path="/devices"
            element={
              <div className="app-body-container devices-view">
                <DeviceExplorer />
              </div>
            }
          />

          <Route
            path="/devices/:udid/control/:tab?"
            element={
              <div className="app-body-container devices-view">
                <DeviceExplorer />
              </div>
            }
          />

          <Route
            path="/apps"
            element={
              <div className="app-body-container apps-view">
                <Apps />
              </div>
            }
          />

          <Route
            path="/builds"
            element={
              <div className="app-body-container sessions-view">
                <SessionDashboard />
              </div>
            }
          />

          <Route
            path="/notifications"
            element={
              <div
                className="app-body-container settings-view"
                style={{
                  height: 'calc(100vh - 72px)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <WebhookSettings />
              </div>
            }
          />

          <Route
            path="/settings"
            element={
              <div className="app-body-container settings-view">
                <Settings />
              </div>
            }
          />

          <Route
            path="/ai-settings"
            element={
              <div className="app-body-container settings-view">
                <AISettings />
              </div>
            }
          />

          <Route
            path="/maintenance"
            element={
              <div className="app-body-container settings-view">
                <MaintenanceSettings />
              </div>
            }
          />

          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

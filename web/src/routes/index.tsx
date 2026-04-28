import * as React from 'react';
import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

// Lazy load components for optimal performance
const Overview = lazy(() => import('../components/overview/overview'));
const DeviceExplorer = lazy(() => import('../components/device-explorer/device-explorer'));
const BuildsPage = lazy(() => import('../components/builds/builds-page'));
const SessionDetailPage = lazy(() => import('../components/session-detail/session-detail-page'));
const RunbookPage = lazy(() => import('../components/runbooks/runbook-page'));
const Apps = lazy(() => import('../components/apps/apps'));
const WebhookSettings = lazy(() =>
  import('../components/webhook-settings/webhook-settings').then((m) => ({
    default: m.WebhookSettings,
  })),
);
const Settings = lazy(() =>
  import('../components/settings/settings').then((m) => ({ default: m.Settings })),
);
const AISettings = lazy(() =>
  import('../components/settings/ai-settings').then((m) => ({ default: m.AISettings })),
);
const MaintenanceSettings = lazy(() =>
  import('../components/settings/maintenance-settings').then((m) => ({
    default: m.MaintenanceSettings,
  })),
);
const ApiKeys = lazy(() =>
  import('../components/settings/api-keys').then((m) => ({ default: m.ApiKeys })),
);
const Teams = lazy(() =>
  import('../components/settings/teams').then((m) => ({ default: m.Teams })),
);
const SelectorHealthPage = lazy(
  () => import('../components/selector-health/selector-health-page'),
);
const SelectorDetailPage = lazy(
  () => import('../components/selector-health/selector-detail-page'),
);
const DeviceMosaicView = lazy(() => import('../components/mosaic/DeviceMosaicView'));

const LoadingFallback = () => (
  <div className="flex items-center justify-center gap-2 h-full text-xs text-[var(--text-dim)]">
    <RefreshCw className="animate-spin" size={14} />
    <span>Hydrating view…</span>
  </div>
);

/**
 * Application routes configuration. The shell (App.tsx) wraps every route in
 * <main className="pl-14 pt-14 h-screen overflow-y-auto">, so each page
 * component owns its own internal layout — no per-route wrapper divs needed.
 */
export const AppRoutes: React.FC = () => (
  <ErrorBoundary>
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/devices" element={<DeviceExplorer />} />
        <Route path="/devices/:udid/control/:tab?" element={<DeviceExplorer />} />
        <Route path="/apps" element={<Apps />} />
        <Route path="/builds" element={<BuildsPage />} />
        <Route path="/builds/:buildId" element={<BuildsPage />} />
        <Route path="/builds/:buildId/sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="/notifications" element={<WebhookSettings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/ai-settings" element={<AISettings />} />
        <Route path="/maintenance" element={<MaintenanceSettings />} />
        <Route path="/api-keys" element={<ApiKeys />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/selector-health" element={<SelectorHealthPage />} />
        <Route path="/selector-health/detail" element={<SelectorDetailPage />} />
        <Route path="/devices/live" element={<DeviceMosaicView />} />
        <Route path="/runbooks/:category" element={<RunbookPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Suspense>
  </ErrorBoundary>
);

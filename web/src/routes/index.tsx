import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import DeviceExplorer from '../components/device-explorer/device-explorer';
import SessionDashboard from '../components/session-dashboard/session-dashboard';
import Apps from '../components/apps/apps';
import { WebhookSettings } from '../components/webhook-settings/webhook-settings';
import { Settings } from '../components/settings/settings';
import { AISettings } from '../components/settings/ai-settings';

/**
 * Application routes configuration
 * Add new routes here as the application grows
 */
export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Default redirect to devices */}
      <Route path="/" element={<Navigate to="/devices" replace />} />

      {/* Devices page */}
      <Route
        path="/devices"
        element={
          <div className="app-body-container devices-view">
            <DeviceExplorer />
          </div>
        }
      />

      {/* App Repository page */}
      <Route
        path="/apps"
        element={
          <div className="app-body-container apps-view">
            <Apps />
          </div>
        }
      />

      {/* Builds/Sessions page */}
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

      {/* Future routes can be added here:
       * - /apps - App management
       * - /stats - Statistics dashboard
       * - /settings - Application settings
       * - /builds/:id - Individual build details
       * - /devices/:id - Individual device details
       */}

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

      {/* Catch-all redirect for unknown routes */}
      <Route path="*" element={<Navigate to="/devices" replace />} />
    </Routes>
  );
};

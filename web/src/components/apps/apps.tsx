import React, { useState, useEffect, useCallback } from 'react';
import {
  Upload,
  Trash2,
  Smartphone,
  Apple,
  Search,
  Download,
  Copy,
  Check,
  Zap,
  SortAsc,
  SortDesc,
  Terminal,
  RefreshCw,
  Rocket,
  X,
  Package,
} from 'lucide-react';
import XenonApiService from '../../api-service';
import { formatDateTime } from '../../utils/time';
import { useToast } from '../ui/toast';
import './apps.css';
import { IDevice } from '../../interfaces/IDevice';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { PageHeader } from '../ui/page-header';
import { Select } from '../ui/select';

const Apps: React.FC = () => {
  const { toast, removeToast } = useToast();
  const [apps, setApps] = useState<any[]>([]);
  const [devices, setDevices] = useState<IDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState({
    android: true,
    ios: true,
  });
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [deployingAppId, setDeployingAppId] = useState<string | null>(null);
  const [selectedUDID, setSelectedUDID] = useState<string>('');

  const fetchApps = useCallback(async () => {
    setLoading(true);
    try {
      const data = await XenonApiService.getApps();
      setApps(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch apps', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const data = await XenonApiService.getDevices();
      setDevices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch devices', err);
    }
  }, []);

  useEffect(() => {
    fetchApps();
    fetchDevices();
    const interval = setInterval(fetchDevices, 10000);
    return () => clearInterval(interval);
  }, [fetchApps, fetchDevices]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadLoading(true);
    try {
      await XenonApiService.uploadApp(file);
      await fetchApps();
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploadLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Permanently remove artifact "${name}"?`)) return;
    try {
      await XenonApiService.deleteApp(id);
      setApps((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(`${type}-${text}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleInstall = async (appId: string, udid: string) => {
    const toastId = toast(`Deploying app to ${udid}...`, 'loading', 0);
    try {
      const res = await XenonApiService.installRepositoryApp(udid, appId);
      if (res.success) {
        toast('App deployed successfully', 'success');
        setDeployingAppId(null);
        setSelectedUDID('');
      } else {
        toast(`Deployment failed: ${res.error}`, 'error');
      }
    } catch (err: any) {
      toast(`Execution Error: ${err.message}`, 'error');
    } finally {
      removeToast(toastId);
    }
  };

  const filteredApps = apps
    .filter((app) => {
      const matchesSearch =
        app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (app.packageName && app.packageName.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesPlatform =
        (platformFilter.android && app.platform === 'android') ||
        (platformFilter.ios && app.platform === 'ios');
      return matchesSearch && matchesPlatform;
    })
    .sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
  };

  const formatDate = (dateString: string) => formatDateTime(dateString);

  const togglePlatform = (platform: 'android' | 'ios') => {
    setPlatformFilter((prev) => ({
      ...prev,
      [platform]: !prev[platform],
    }));
  };

  const isWDA = (name: string) => {
    const n = name.toLowerCase();
    return n.includes('wda-signed') || n.includes('wda-resign') || n.includes('webdriveragent');
  };

  return (
    <div className="apps-container device-explorer-container">
      {/* Mission Control Scanline Overlay */}
      <div
        className="scanline"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.05,
          zIndex: 1001,
        }}
      ></div>
      <PageHeader
        icon={Package}
        title="Apps"
        subtitle="Signed builds available for installation across your device fleet."
      />
      <div className="device-explorer-header-container">
        <div className="device-explorer-header-left-container">
          <div className="device-explorer-header-entry">
            <div className="device-explorer-header-value">
              <button
                className={`device-explorer-header__platform-btn ${
                  platformFilter.android && 'selected'
                }`}
                onClick={() => togglePlatform('android')}
              >
                <Smartphone size={18} color="currentColor" /> Android
              </button>
              <button
                className={`device-explorer-header__platform-btn ${
                  platformFilter.ios && 'selected'
                }`}
                onClick={() => togglePlatform('ios')}
              >
                <Apple size={18} color="currentColor" /> iOS
              </button>
            </div>
          </div>

          <div className="device-explorer-header-entry">
            <div className="device-explorer-header-value">
              <div className="device-explorer-search-wrapper">
                <Search size={16} color="#94a3b8" className="device-explorer-search-icon" />
                <input
                  type="text"
                  className="device-explorer-header-text-filter"
                  placeholder="Filter by bundle or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="device-explorer-header-filter-count">
            <Badge variant="secondary">
              <span className="font-bold">{filteredApps.length}</span> of{' '}
              <span className="font-bold">{apps.length}</span>{' '}
              {apps.length === 1 ? 'artifact' : 'artifacts'}
            </Badge>
          </div>
        </div>

        <div className="device-explorer-header-right-container">
          <button
            className="icon-btn-secondary sort-btn"
            onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            title={sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
          >
            {sortOrder === 'desc' ? <SortDesc size={18} /> : <SortAsc size={18} />}
          </button>

          <Button size="sm" variant="default" onClick={() => fetchApps()} disabled={loading}>
            <RefreshCw size={14} className={`mr-1 ${loading && 'animate-spin'}`} />
            Refresh
          </Button>

          <label className="upload-trigger">
            <input
              type="file"
              accept=".apk,.ipa"
              onChange={handleUpload}
              style={{ display: 'none' }}
            />
            <Button size="sm" variant="default" className="upload-button">
              <Upload size={14} className="mr-1" />
              Upload App
            </Button>
          </label>
        </div>
      </div>

      <main className="apps-registry-content">
        {loading && apps.length === 0 ? (
          <div className="empty-data-vignette">
            <div className="processing-loader" />
            <p className="text-muted text-xs font-bold tracking-widest">SYNCING REGISTRY...</p>
          </div>
        ) : (
          <>
            {filteredApps.length > 0 && (
              <div className="registry-table-header">
                <div>Artifact Bundle</div>
                <div>Version</div>
                <div>Size</div>
                <div>Registry Date</div>
                <div style={{ textAlign: 'right' }}>Management</div>
              </div>
            )}

            <div className="registry-list">
              {filteredApps.map((app) => {
                const availableDevices = devices.filter(
                  (d) => d.platform === app.platform && !d.busy && !d.offline,
                );

                return (
                  <div key={app.id} className={`artifact-row ${app.platform}`}>
                    <div className="col-app-info">
                      <div className="app-platform-badge">
                        {app.platform === 'android' ? (
                          <Smartphone size={18} />
                        ) : (
                          <Apple size={18} />
                        )}
                      </div>
                      <div className="app-text-block">
                        <div className="app-display-name" title={app.name}>
                          {app.name}
                          {isWDA(app.name) && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-[10px] h-4 py-0 border-primary text-primary"
                            >
                              WDA
                            </Badge>
                          )}
                        </div>
                        <div className="app-package-id">
                          <code>{app.packageName || 'internal.bundle'}</code>
                          {/*
                            Only offered when there is something to copy.
                            `internal.bundle` is a placeholder for a null
                            packageName, not a value: the control used to copy
                            `''` and stay on the copy icon forever, because it
                            stored `pkg-` while the check compared against
                            `pkg-null`. Silently putting an empty string on the
                            clipboard is worse than not offering the button.
                          */}
                          {app.packageName && (
                            <div
                              className="copy-hint"
                              title={`Copy ${app.packageName}`}
                              onClick={() => handleCopy(app.packageName, 'pkg')}
                            >
                              {copiedId === `pkg-${app.packageName}` ? (
                                <Check size={10} className="text-primary" />
                              ) : (
                                <Copy size={10} />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="col-version">{app.version || 'v1.0.0'}</div>
                    <div className="col-size">{formatSize(app.size)}</div>
                    <div className="col-timestamp">{formatDate(app.createdAt)}</div>

                    <div className="col-actions">
                      <button
                        className={`instant-deploy-trigger ${
                          deployingAppId === app.id && 'active'
                        }`}
                        onClick={() => {
                          if (deployingAppId === app.id) {
                            setDeployingAppId(null);
                            setSelectedUDID('');
                          } else {
                            setDeployingAppId(app.id);
                          }
                        }}
                      >
                        {deployingAppId === app.id ? (
                          <>
                            <X size={12} /> CANCEL
                          </>
                        ) : (
                          <>
                            <Zap size={12} /> DEPLOY
                          </>
                        )}
                      </button>

                      {deployingAppId === app.id && (
                        <div className="deployment-flyout">
                          {availableDevices.length > 0 ? (
                            <div className="deploy-actions-group">
                              <Select
                                selectSize="sm"
                                className="min-w-[280px]"
                                autoFocus
                                value={selectedUDID}
                                onChange={(e) => setSelectedUDID(e.target.value)}
                              >
                                <option value="">SELECT TARGET...</option>
                                {availableDevices.map((d) => (
                                  <option key={d.udid} value={d.udid}>
                                    {d.name.toUpperCase()} ({d.udid})
                                  </option>
                                ))}
                              </Select>
                              <button
                                className="confirm-deploy-btn"
                                disabled={!selectedUDID}
                                onClick={() => handleInstall(app.id, selectedUDID)}
                                title="Confirm Deployment"
                              >
                                <Rocket size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="target-device-select empty">NO TARGETS</div>
                          )}
                        </div>
                      )}

                      <button
                        className="utility-icon-btn"
                        onClick={() => window.open(`/xenon/api/apps/${app.id}/download`, '_blank')}
                      >
                        <Download size={14} />
                      </button>
                      <button
                        className="utility-icon-btn danger"
                        onClick={() => handleDelete(app.id, app.name)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/*
              A filter that matches nothing is not an empty registry. Both used
              to render "No apps yet — upload your first app", which told
              someone with a full registry that they had never uploaded
              anything, and offered the one action that could not help.
            */}
            {filteredApps.length === 0 && apps.length > 0 && !loading && (
              <div className="empty-registry-technical">
                <div className="empty-icon-container">
                  <Terminal size={48} className="text-primary opacity-40" />
                </div>
                <h2 className="empty-title brand-font">No matching artifacts</h2>
                <p className="empty-description">
                  {apps.length} {apps.length === 1 ? 'artifact is' : 'artifacts are'} registered,
                  but none match the current filter.
                </p>
                <div className="empty-actions">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      setSearchTerm('');
                      setPlatformFilter({ android: true, ios: true });
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              </div>
            )}

            {apps.length === 0 && !loading && (
              <div className="empty-registry-technical">
                <div className="empty-icon-container">
                  <Terminal size={48} className="text-primary opacity-40 animate-pulse" />
                </div>
                <h2 className="empty-title brand-font">No apps yet</h2>
                <p className="empty-description">
                  Upload <code className="text-primary">.apk</code> or{' '}
                  <code className="text-primary">.ipa</code> artifacts to enable versioned installs
                  across your device fleet.
                </p>
                <div className="empty-actions">
                  <label className="upload-trigger-massive">
                    <input
                      type="file"
                      accept=".apk,.ipa"
                      onChange={handleUpload}
                      style={{ display: 'none' }}
                    />
                    <div className="massive-upload-content">
                      <Rocket size={24} className="mb-2" />
                      <span>Upload your first app</span>
                    </div>
                  </label>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {uploadLoading && (
        <div className="upload-overlay-technical">
          <div className="upload-card-technical">
            <div className="processing-loader" />
            <h2 className="brand-font" style={{ fontSize: '20px', marginBottom: '8px' }}>
              Artifact Ingestion
            </h2>
            <p className="text-muted text-xs">VERIFYING CHECKSUM & DEPLOYING TO REGISTRY...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Apps;

import React, { useState, useRef, useEffect } from 'react';
import prettyMilliseconds from 'pretty-ms';
import {
  Search,
  Smartphone,
  ChevronRight,
  LayoutGrid,
  CheckCircle2,
  XCircle,
  Activity,
  ArrowLeft,
  Clock,
  Brain,
  ChevronDown,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSocket } from '../../hooks/useSocket';
import ReactMarkdown from 'react-markdown';
import XenonApiService from '../../api-service';
import { ISession } from '../../interfaces/ISession';
import { IBuild } from '../../interfaces/IBuild';
import { ISessionLog } from '../../interfaces/ISessionLog';
import { ILog } from '../../interfaces/ILog';
import { IProfiling } from '../../interfaces/IProfiling';
import Spinner from '../../widgets/spinner/spinner';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import ProfilingView from './ProfilingView';
import ScreenshotsView from './ScreenshotsView';
import TraceWaterfall from './TraceWaterfall';
import './session-dashboard.css';

const REFRESH_INTERVAL_MS = 3000; // Senior Polish: 3s for "Live" feel

const safeFormatDuration = (ms: number | undefined | null) => {
  if (ms === null || ms === undefined || isNaN(ms) || !isFinite(ms)) return '0ms';
  try {
    return prettyMilliseconds(Math.max(0, ms));
  } catch (e) {
    return `${Math.round(Math.max(0, ms))}ms`;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const parseJson = (value?: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
};

const getDuration = (session: ISession) => {
  try {
    const start = new Date(session.startTime).getTime();
    const end = session.endTime ? new Date(session.endTime).getTime() : Date.now();
    const duration = end - start;
    return isNaN(duration) || !isFinite(duration) ? 0 : Math.max(0, duration);
  } catch (e) {
    return 0;
  }
};

// --- Sub-components ---

const CustomSelect = ({
  value,
  onChange,
  options,
  icon,
}: {
  value: string;
  onChange: (val: string) => void;
  options: { label: string; value: string }[];
  icon?: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className="custom-select-container" ref={containerRef}>
      <div className="compact-select-trigger" onClick={() => setIsOpen(!isOpen)}>
        {icon}
        <span className="trigger-text">{selectedOption?.label}</span>
        <ChevronDown size={12} className={`chevron-icon ${isOpen ? 'open' : ''}`} />
      </div>

      {isOpen && (
        <div className="custom-select-dropdown">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`custom-select-option ${opt.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const BuildCard = React.memo(
  ({
    build,
    isActive,
    onClick,
  }: {
    build: IBuild;
    isActive: boolean;
    onClick: (id: string) => void;
  }) => {
    return (
      <button
        className={`session-card-mini build-card ${isActive ? 'active' : ''}`}
        onClick={() => onClick(build.id)}
      >
        <div className="mini-header">
          <span className="name-text">{build.name || 'Unnamed Build'}</span>
          <span className="mini-timestamp">{formatDate(build.createdAt)}</span>
        </div>
        <div className="build-stats-row">
          {build.passedCount > 0 && (
            <Badge variant="secondary" className="stat-pill passed text-neon-green">
              {build.passedCount} PASSED
            </Badge>
          )}
          {build.failedCount > 0 && (
            <Badge variant="secondary" className="stat-pill failed text-neon-red">
              {build.failedCount} FAILED
            </Badge>
          )}
          {build.runningCount > 0 && (
            <Badge variant="secondary" className="stat-pill unmarked text-neon-amber">
              {build.runningCount} RUNNING
            </Badge>
          )}
        </div>
        <div className="build-id-footer text-neon-dim">{build.id.slice(0, 8)}...</div>
      </button>
    );
  },
);

const SessionTableRow = React.memo(
  ({ session, onSelect }: { session: ISession; onSelect: (id: string) => void }) => {
    const duration = getDuration(session);
    return (
      <tr className={`session-table-row ${session.status}`} onClick={() => onSelect(session.id)}>
        <td>
          <div className="cell-id">
            <span className="id-text">#{session.id?.slice(0, 8) || 'unknown'}</span>
            {session.name && <span className="name-text">{session.name}</span>}
            {session.tags && (
              <div className="session-tags-pills">
                {parseJson(session.tags)?.map((tag: string) => (
                  <span key={tag} className="tag-pill-mini">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </td>
        <td>
          <div className="cell-platform text-neon-purple">
            <Smartphone
              size={14}
              color={session.device_platform?.toLowerCase() === 'ios' ? '#8b5cf6' : '#a78bfa'}
            />
            <span style={{ marginLeft: '6px' }}>{session.device_name || 'Unknown Device'}</span>
          </div>
        </td>
        <td>
          <span
            className={`status-text ${['success', 'passed'].includes(session.status)
                ? 'text-neon-green'
                : session.status === 'failed'
                  ? 'text-neon-red'
                  : 'text-neon-amber'
              }`}
            style={{ fontWeight: 700, fontSize: '10px' }}
          >
            {session.status?.toUpperCase() || 'UNKNOWN'}
          </span>
        </td>
        <td className="text-neon-dim">{formatDate(session.startTime)}</td>
        <td className="text-neon-dim">{safeFormatDuration(duration)}</td>
        <td className="cell-actions">
          <ChevronRight size={16} />
        </td>
      </tr>
    );
  },
);

const SessionDashboard: React.FC = () => {
  const [builds, setBuilds] = React.useState<IBuild[]>([]);
  const [sessions, setSessions] = React.useState<ISession[]>([]);
  const [selectedSessionLogs, setSelectedSessionLogs] = useState<ISessionLog[]>([]);
  const { on: onSocketEvent } = useSocket();
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [selectedBuildId, setSelectedBuildId] = React.useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null);

  const isInitialLoad = React.useRef<boolean>(true);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const [logs, setLogs] = React.useState<ISessionLog[]>([]);
  const [deviceLogs, setDeviceLogs] = React.useState<ILog[]>([]);
  const [debugLogs, setDebugLogs] = React.useState<ILog[]>([]);
  const [profilingData, setProfilingData] = React.useState<IProfiling[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = React.useState<boolean>(false);
  const [selectedLogTab, setSelectedLogTab] = React.useState<
    'command' | 'trace' | 'screenshots' | 'device' | 'debug' | 'profiling'
  >('command');
  const [showScreenshots, setShowScreenshots] = React.useState<boolean>(true);
  const [showErrorsOnly, setShowErrorsOnly] = React.useState<boolean>(false);
  const [buildSearch, setBuildSearch] = React.useState('');
  const [buildTimeFilter, setBuildTimeFilter] = React.useState<'all' | '24h' | '7d' | '30d'>('all');
  const [buildStatusFilter, setBuildStatusFilter] = React.useState<{
    success: boolean;
    failed: boolean;
    running: boolean;
  }>({
    success: true,
    failed: true,
    running: true,
  });
  const [selectedCapTab, setSelectedCapTab] = React.useState<'desired' | 'session'>('desired');
  const [sessionSearch, setSessionSearch] = React.useState('');
  const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(true);

  const selectedBuild = React.useMemo(
    () => builds.find((b: IBuild) => b.id === selectedBuildId),
    [builds, selectedBuildId],
  );
  const selectedSession = React.useMemo(
    () => sessions.find((s: ISession) => s.id === selectedSessionId),
    [sessions, selectedSessionId],
  );

  const fetchBuilds = React.useCallback(async () => {
    try {
      const buildsData = await XenonApiService.getBuilds();
      setBuilds(buildsData);
      if (isInitialLoad.current && buildsData.length > 0) {
        setSelectedBuildId(buildsData[0].id);
        isInitialLoad.current = false;
      }
    } catch (error) {
      console.error('Failed to fetch builds', error);
    }
  }, []);

  const fetchSessions = React.useCallback(async () => {
    if (selectedBuildId) {
      try {
        const sessionsData = await XenonApiService.getSessions({
          buildId: selectedBuildId,
          query: sessionSearch,
        });
        setSessions(sessionsData);
      } catch (error) {
        console.error('Failed to fetch sessions', error);
      }
    }
  }, [selectedBuildId, sessionSearch]);

  const fetchSessionDetails = React.useCallback(async (sessionId: string) => {
    try {
      const sessionData = await XenonApiService.getSession(sessionId);
      setSessions((prevSessions: ISession[]) =>
        prevSessions.map((s: ISession) => (s.id === sessionId ? sessionData : s)),
      );
    } catch (error) {
      console.error('Failed to fetch session details', error);
    }
  }, []);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      await fetchBuilds();
      await fetchSessions();
    } catch (error) {
      console.error('Failed to fetch dashboard data', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchBuilds, fetchSessions]);

  const fetchLogs = async (sessionId: string) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoadingLogs(true);
    try {
      const [commandLogs, deviceLogsData, debugLogsData, profiling] = await Promise.all([
        XenonApiService.getSessionLogs(sessionId),
        XenonApiService.getDeviceLogs(sessionId),
        XenonApiService.getDebugLogs(sessionId),
        XenonApiService.getProfilingData(sessionId),
      ]);
      if (!controller.signal.aborted) {
        setLogs(commandLogs);
        setDeviceLogs(deviceLogsData);
        setDebugLogs(debugLogsData);
        setProfilingData(profiling);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Failed to fetch logs', error);
    } finally {
      if (!controller.signal.aborted) setIsLoadingLogs(false);
    }
  };

  React.useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  React.useEffect(() => {
    if (selectedSessionId) fetchLogs(selectedSessionId);
  }, [selectedSessionId, selectedSession?.status]);

  // WebSocket Event Listeners for "Next-Level" Live feel
  React.useEffect(() => {
    if (!onSocketEvent) return;

    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSocketEvent('session_started', (data: ISession) => {
        setSessions((prev: ISession[]) => {
          // Prevent duplicates if fetchData also ran
          if (prev.some((s: ISession) => s.id === data.id)) return prev;
          return [data, ...prev];
        });
      }),
    );

    unsubs.push(
      onSocketEvent('session_stopped', (data: { id: string; status: string }) => {
        setSessions((prev: ISession[]) =>
          prev.map((s: ISession) =>
            s.id === data.id ? { ...s, status: data.status, endTime: new Date().toISOString() } : s,
          ),
        );
      }),
    );

    unsubs.push(
      onSocketEvent('session_command', (data: ISessionLog) => {
        // Only append if it's the currently selected session
        if (selectedSessionId === data.session_id) {
          setLogs((prev: ISessionLog[]) => {
            if (prev.some((l: ISessionLog) => l.id === data.id)) return prev;
            return [data, ...prev];
          });
        }
      }),
    );

    // Device events for grid awareness
    unsubs.push(onSocketEvent('device_added', () => fetchData()));
    unsubs.push(onSocketEvent('device_removed', () => fetchData()));

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [onSocketEvent, selectedSessionId, fetchData]);

  const filteredBuilds = builds.filter((b: IBuild) => {
    // 1. Text Search
    const matchesSearch =
      b.name?.toLowerCase().includes(buildSearch.toLowerCase()) ||
      b.id.toLowerCase().includes(buildSearch.toLowerCase());
    if (!matchesSearch) return false;

    // 2. Time Filter
    if (buildTimeFilter !== 'all') {
      const buildDate = new Date(b.createdAt).getTime();
      const now = Date.now();
      const msMap = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
      };
      if (now - buildDate > msMap[buildTimeFilter as keyof typeof msMap]) return false;
    }

    // 3. Status Filter
    const hasFailures = b.failedCount > 0;
    const isRunning = b.runningCount > 0;
    const isSuccess = !hasFailures && !isRunning && b.passedCount > 0;

    if (!buildStatusFilter.success && isSuccess) return false;
    if (!buildStatusFilter.failed && hasFailures) return false;
    if (!buildStatusFilter.running && isRunning) return false;

    return true;
  });

  const getSessionDetails = (session: ISession) => {
    const caps = parseJson(session.session_capabilities);
    const desiredCaps = parseJson(session.desired_capabilities);
    const appName = caps?.app ? caps.app.split('/').pop() : caps?.browserName || '—';
    return { appName, caps, desiredCaps };
  };

  const renderSessionTable = () => (
    <div className="build-details-container animate-fade-in">
      <div className="build-header-hero">
        <div className="hero-content">
          <Badge variant="outline" className="build-id-badge">
            BUILD #{selectedBuild?.id.slice(0, 8)}
          </Badge>
          <h1 className="build-title-big">{selectedBuild?.name || 'Unnamed Build'}</h1>
          <div className="build-summary-row">
            <div className="summary-item">
              <CheckCircle2 size={16} color="#10b981" />
              <span>{selectedBuild?.passedCount} Passed</span>
            </div>
            <div className="summary-item">
              <XCircle size={16} color="#ef4444" />
              <span>{selectedBuild?.failedCount} Failed</span>
            </div>
            <div className="summary-item">
              <Activity size={16} color="#f59e0b" />
              <span>{selectedBuild?.runningCount} Running</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sessions-table-wrapper">
        <div className="sessions-table-actions">
          <div className="search-container session-search">
            <Search size={14} className="search-icon" />
            <Input
              placeholder="Search sessions by ID, name, or device..."
              value={sessionSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSessionSearch(e.target.value)}
              className="compact-search"
            />
          </div>
          <div className="table-stats">{sessions.length} sessions found</div>
        </div>
        <table className="sessions-table">
          <thead>
            <tr>
              <th>Session / Name</th>
              <th>Device</th>
              <th>Status</th>
              <th>Start Time</th>
              <th>Duration</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s: ISession) => (
              <SessionTableRow key={s.id} session={s} onSelect={setSelectedSessionId} />
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty">
                  No sessions found for this build.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderSessionDetails = () => {
    if (!selectedSession) return null;
    const { caps, desiredCaps } = getSessionDetails(selectedSession);
    const isCompleted = !!selectedSession.endTime;
    const hasRecording = isCompleted && selectedSession.video_recording;
    const hasLive = !isCompleted && selectedSession.has_live_video;

    return (
      <div className="session-detail-view animate-fade-in">
        {/* Breadcrumb */}
        <div className="detail-breadcrumb">
          <button className="back-btn" onClick={() => setSelectedSessionId(null)}>
            <ArrowLeft size={14} />
            Builds
          </button>
          <span className="crumb-separator">›</span>
          <span>{selectedBuild?.name || 'Build'}</span>
          <span className="crumb-separator">›</span>
          <span>Sessions</span>
          <span className="crumb-separator">›</span>
          <span className="crumb-current">{selectedSession.id?.slice(0, 16) || 'unknown'}...</span>
        </div>

        {/* Metadata Bar */}
        <div className="session-metadata-bar">
          <div className="metadata-item">
            <span className="metadata-label">Device</span>
            <span className="metadata-value">{selectedSession.device_name}</span>
          </div>
          {selectedSession.node_id && (
            <div className="metadata-item">
              <span className="metadata-label">Node ID</span>
              <span className="metadata-value mono">{selectedSession.node_id}</span>
            </div>
          )}
          {selectedSession.trace_id && (
            <div className="metadata-item">
              <span className="metadata-label">Trace ID</span>
              <span className="metadata-value mono">{selectedSession.trace_id}</span>
            </div>
          )}
          <div className="metadata-item">
            <span className="metadata-label">Platform</span>
            <span className="metadata-value">{selectedSession.device_platform}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Status</span>
            <Badge
              variant={
                ['success', 'passed'].includes(selectedSession.status)
                  ? 'success'
                  : selectedSession.status === 'failed'
                    ? 'error'
                    : 'warning'
              }
            >
              {selectedSession.status?.toUpperCase() || 'UNKNOWN'}
            </Badge>
            {selectedSession.status === 'failed' && selectedSession.failure_category && (
              <Badge variant="secondary" className="category-badge">
                {selectedSession.failure_category.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Start Time</span>
            <span className="metadata-value">{formatDate(selectedSession.startTime)}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">OS Version</span>
            <span className="metadata-value">{selectedSession.device_version}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Duration</span>
            <span className="metadata-value">
              {safeFormatDuration(getDuration(selectedSession))}
            </span>
          </div>
          {selectedSession.tags && (
            <div className="metadata-item full-width">
              <span className="metadata-label">Tags</span>
              <div className="session-detail-tags">
                {parseJson(selectedSession.tags)?.map((tag: string) => (
                  <Badge key={tag} variant="secondary" className="session-tag-badge">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* AI Root-Cause Analysis (High-Intent Accordion) */}
        {selectedSession.ai_analysis && (
          <div
            className={`ai-analysis-hero animate-fade-in ${!isAnalysisExpanded ? 'collapsed' : ''}`}
          >
            <div
              className="ai-header clickable"
              onClick={() => setIsAnalysisExpanded(!isAnalysisExpanded)}
              role="button"
              aria-expanded={isAnalysisExpanded}
            >
              <div className="ai-title-group">
                <div className="ai-title">
                  <Brain size={22} className="ai-icon" />
                  <h2>AI Root-Cause Diagnosis</h2>
                </div>
                <Badge variant="outline" className="ai-smart-badge">
                  <Activity size={10} />
                  Smart Analysis
                </Badge>
              </div>

              <div className="ai-header-actions">
                <div className="chevron-wrapper">
                  <ChevronRight
                    size={20}
                    strokeWidth={2.5}
                    className={`chevron-icon ${isAnalysisExpanded ? 'rotated' : ''}`}
                  />
                </div>
              </div>
            </div>

            <div
              className={`ai-collapsible-content ${isAnalysisExpanded ? 'expanded' : 'collapsed'}`}
            >
              <div className="ai-content">
                <ReactMarkdown>{selectedSession.ai_analysis}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Two-Panel Layout */}
        <div className="session-detail-main">
          {/* Left Panel: Tabs & Logs */}
          <div className="session-detail-left">
            <div className="tabs-nav">
              {(['command', 'trace', 'screenshots', 'device', 'debug', 'profiling'] as const).map(
                (tab) => {
                  if (
                    tab === 'profiling' &&
                    !['android', 'ios'].includes(
                      selectedSession.device_platform?.toLowerCase() || '',
                    )
                  )
                    return null;
                  return (
                    <button
                      key={tab}
                      className={`tab-btn ${selectedLogTab === tab ? 'active' : ''}`}
                      onClick={() => setSelectedLogTab(tab)}
                    >
                      {tab === 'command'
                        ? 'Text Logs'
                        : tab === 'screenshots'
                          ? 'Evidence'
                          : tab === 'device'
                            ? 'Device Logs'
                            : tab === 'debug'
                              ? 'Debug Logs'
                              : tab === 'trace'
                                ? 'Performance Trace'
                                : 'System Profiling'}
                    </button>
                  );
                },
              )}

              {selectedLogTab === 'command' && (
                <div className="log-filters">
                  <label className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={showScreenshots}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShowScreenshots(e.target.checked)}
                    />
                    <span>Show Screenshots</span>
                  </label>
                  <label className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={showErrorsOnly}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShowErrorsOnly(e.target.checked)}
                    />
                    <span>Show Errors Only</span>
                  </label>
                </div>
              )}
            </div>
            <div className="logs-viewport">
              {isLoadingLogs ? (
                <Spinner />
              ) : (
                <div className="logs-container">
                  {selectedLogTab === 'trace' ? (
                    <TraceWaterfall
                      logs={logs}
                      onCommandClick={(logId: string) => {
                        setSelectedLogTab('command');
                        // Optional: Smooth scroll to logId if needed
                        setTimeout(() => {
                          const el = document.getElementById(logId);
                          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          el?.classList.add('highlight-flash');
                          setTimeout(() => el?.classList.remove('highlight-flash'), 2000);
                        }, 100);
                      }}
                    />
                  ) : selectedLogTab === 'command' ? (
                    logs
                      .filter((l) => {
                        if (showErrorsOnly && l.is_success) return false;
                        return true;
                      })
                      .map((l: ISessionLog) => {
                        const displayBody =
                          (l.body || '').length > 1000
                            ? l.body?.substring(0, 1000) + '... [TRUNCATED]'
                            : l.body;
                        const displayResp =
                          (l.response || '').length > 1000
                            ? l.response?.substring(0, 1000) + '... [TRUNCATED]'
                            : l.response;
                        return (
                          <div
                            key={l.id}
                            className={`log-line-complex ${!l.is_success ? 'error' : ''}`}
                          >
                            <div className="log-line-header">
                              <span className="log-time">[{formatDate(l.createdAt)}]</span>
                              <span className={`log-method ${l.method}`}>{l.method}</span>
                              <span className="log-title">{l.title}</span>
                              {l.duration !== null && l.duration !== undefined && (
                                <span className="log-duration">
                                  {safeFormatDuration(l.duration)}
                                </span>
                              )}
                              {l.is_healed && (
                                <Badge
                                  variant="outline"
                                  className="healed-badge animate-pulse-subtle"
                                >
                                  <Brain size={12} className="mr-1" />
                                  [HEALED]
                                </Badge>
                              )}
                              {l.span_id && (
                                <div className="log-otel-link" title={`Span ID: ${l.span_id}`}>
                                  <Activity size={10} />
                                </div>
                              )}
                            </div>
                            {l.is_healed && (
                              <div className="healing-intelligence-card">
                                <div className="intelligence-grid">
                                  <div className="intel-item">
                                    <span className="intel-label">FAILED LOCATOR</span>
                                    <code className="intel-value">{l.original_selector}</code>
                                  </div>
                                  <div className="intel-item">
                                    <span className="intel-label">AUTO-RECOVERY</span>
                                    <code className="intel-value">{l.healed_selector}</code>
                                  </div>
                                  <div className="intel-item">
                                    <span className="intel-label">CONFIDENCE</span>
                                    <span className="intel-value">
                                      {(l.healing_confidence! * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}
                            {showScreenshots && l.screenshot && (
                              <div className="log-screenshot">
                                <img
                                  src={XenonApiService.getAssetUrl(l.screenshot)}
                                  alt="Screenshot"
                                  className="log-screenshot-img"
                                  onClick={() =>
                                    window.open(XenonApiService.getAssetUrl(l.screenshot), '_blank')
                                  }
                                />
                                <span className="screenshot-label">Click to enlarge</span>
                              </div>
                            )}
                            {displayBody && <div className="log-body">{displayBody}</div>}
                            {displayResp && <div className="log-response">{displayResp}</div>}
                          </div>
                        );
                      })
                  ) : selectedLogTab === 'screenshots' ? (
                    <ScreenshotsView logs={logs} />
                  ) : selectedLogTab === 'profiling' ? (
                    <ProfilingView data={profilingData} session={selectedSession} />
                  ) : (
                    (selectedLogTab === 'device' ? deviceLogs : debugLogs).slice(-500).map((l: ILog) => (
                      <div key={l.id} className="log-line-complex">
                        <div className="log-line-header">
                          <span className="log-time">[{formatDate(l.timestamp)}]</span>
                          <span className="log-title">{l.message}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Video + Capabilities */}
          <div className="session-detail-right">
            <div className="video-panel">
              <div className="video-player-container">
                {hasLive ? (
                  <img
                    src={XenonApiService.getSessionLiveVideoUrl(selectedSession.id)}
                    alt="Live"
                    className="video-content"
                  />
                ) : hasRecording ? (
                  <video
                    controls
                    src={XenonApiService.getAssetUrl(selectedSession.video_recording)}
                    className="video-content"
                  />
                ) : (
                  <div className="video-placeholder">No video available</div>
                )}
              </div>
            </div>

            <div className="capabilities-panel">
              {/* Capabilities Tab Navigation */}
              <div className="capabilities-tabs">
                <button
                  className={`cap-tab-btn ${selectedCapTab === 'desired' ? 'active' : ''}`}
                  onClick={() => setSelectedCapTab('desired')}
                >
                  Desired Capabilities
                </button>
                <button
                  className={`cap-tab-btn ${selectedCapTab === 'session' ? 'active' : ''}`}
                  onClick={() => setSelectedCapTab('session')}
                >
                  Session Capabilities
                </button>
              </div>

              {/* Capabilities Table */}
              <div className="capabilities-content">
                <table className="capabilities-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCapTab === 'desired' ? (
                      desiredCaps && typeof desiredCaps === 'object' ? (
                        Object.entries(desiredCaps).map(([key, value]) => (
                          <tr key={key}>
                            <td>{key}</td>
                            <td>
                              {typeof value === 'object'
                                ? JSON.stringify(value).slice(0, 80)
                                : String(value)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={2} className="table-empty">
                            No desired capabilities available
                          </td>
                        </tr>
                      )
                    ) : caps && typeof caps === 'object' ? (
                      Object.entries(caps).map(([key, value]) => (
                        <tr key={key}>
                          <td>{key}</td>
                          <td>
                            {typeof value === 'object'
                              ? JSON.stringify(value).slice(0, 80)
                              : String(value)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="table-empty">
                          No session capabilities available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="session-dashboard-root">
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
      <div className="dashboard-layout">
        <aside className="dashboard-sidebar">
          <div className="sidebar-header">
            <div className="search-container">
              <Search size={14} className="search-icon" />
              <Input
                placeholder="Find builds..."
                value={buildSearch}
                onChange={(e) => setBuildSearch(e.target.value)}
                className="compact-search"
              />
            </div>

            <div className="advanced-filters">
              <div className="filter-row">
                <div className="select-container">
                  <CustomSelect
                    icon={<Clock size={12} className="select-icon" />}
                    value={buildTimeFilter}
                    onChange={(val) => setBuildTimeFilter(val as 'all' | '24h' | '7d' | '30d')}
                    options={[
                      { label: 'All Time', value: 'all' },
                      { label: 'Last 24h', value: '24h' },
                      { label: 'Last 7 Days', value: '7d' },
                      { label: 'Last 30 Days', value: '30d' },
                    ]}
                  />
                </div>
              </div>

              <div className="status-toggles">
                <button
                  className={`status-toggle ${buildStatusFilter.success ? 'active' : ''}`}
                  onClick={() => setBuildStatusFilter((p) => ({ ...p, success: !p.success }))}
                  title="Show Passed"
                >
                  <CheckCircle2
                    size={14}
                    color={buildStatusFilter.success ? '#10b981' : '#64748b'}
                  />
                </button>
                <button
                  className={`status-toggle ${buildStatusFilter.failed ? 'active' : ''}`}
                  onClick={() => setBuildStatusFilter((p) => ({ ...p, failed: !p.failed }))}
                  title="Show Failed"
                >
                  <XCircle size={14} color={buildStatusFilter.failed ? '#ef4444' : '#64748b'} />
                </button>
                <button
                  className={`status-toggle ${buildStatusFilter.running ? 'active' : ''}`}
                  onClick={() => setBuildStatusFilter((p) => ({ ...p, running: !p.running }))}
                  title="Show Running"
                >
                  <Activity size={14} color={buildStatusFilter.running ? '#f59e0b' : '#64748b'} />
                </button>
                <div className="filter-count-label">{filteredBuilds.length} shown</div>
              </div>
            </div>
          </div>

          <div className="sidebar-scrollable">
            {isLoading && builds.length === 0 ? (
              <div className="sidebar-loading">
                <Spinner />
              </div>
            ) : filteredBuilds.length === 0 ? (
              <div className="sidebar-empty">No builds found</div>
            ) : (
              filteredBuilds.map((b: IBuild) => (
                <BuildCard
                  key={b.id}
                  build={b}
                  isActive={selectedBuildId === b.id}
                  onClick={(id) => {
                    setSelectedBuildId(id);
                    setSelectedSessionId(null);
                  }}
                />
              ))
            )}
          </div>
        </aside>

        <main className="dashboard-main">
          {!selectedBuildId ? (
            <div className="empty-state">
              <LayoutGrid size={48} />
              <h3>Select a Build</h3>
              <p>Choose a build from the sidebar to view its test results and sessions.</p>
            </div>
          ) : selectedSessionId ? (
            renderSessionDetails()
          ) : (
            renderSessionTable()
          )}
        </main>
      </div>
    </div>
  );
};

export default SessionDashboard;

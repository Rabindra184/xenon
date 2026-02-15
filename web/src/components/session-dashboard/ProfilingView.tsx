import React from 'react';
import { IProfiling } from '../../interfaces/IProfiling';
import {
  Cpu,
  HardDrive,
  Download,
  Activity,
  CheckCircle,
  Clock,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import { ISession } from '../../interfaces/ISession';
import XenonApiService from '../../api-service';
import Spinner from '../../widgets/spinner/spinner';

interface ProfilingViewProps {
  data: IProfiling[];
  session?: ISession;
}

const ProfilingView: React.FC<ProfilingViewProps> = ({ data, session }) => {
  // Calculation utilities
  const calculateAvgCpu = () => {
    if (data.length === 0) return '0.0';
    const total = data.reduce((acc, curr) => acc + parseFloat(curr.cpu || '0'), 0);
    return (total / data.length).toFixed(1);
  };

  const calculatePeakCpu = () => {
    if (data.length === 0) return '0.0';
    const peak = Math.max(...data.map((d) => parseFloat(d.cpu || '0')));
    return peak.toFixed(1);
  };

  const calculateMaxMemory = () => {
    if (data.length === 0) return '0.0';
    const maxKb = Math.max(...data.map((curr) => parseFloat(curr.memory || '0')));
    return (maxKb / 1024).toFixed(1);
  };

  const calculateAvgMemory = () => {
    if (data.length === 0) return '0.0';
    const total = data.reduce((acc, curr) => acc + parseFloat(curr.memory || '0'), 0);
    return (total / data.length / 1024).toFixed(1);
  };

  // Loading state
  if (!session) {
    return (
      <div className="profiling-empty">
        <Spinner />
        <p>Loading session data...</p>
      </div>
    );
  }

  const isIOS = session.device_platform?.toLowerCase() === 'ios';
  const isAndroid = session.device_platform?.toLowerCase() === 'android';
  const hasTrace = !!session.performance_trace;
  const isRunning = session.status === 'running';

  // iOS with trace available - success state
  if (isIOS && hasTrace) {
    return (
      <div className="profiling-empty">
        <CheckCircle size={48} className="success-icon" />
        <h3>Performance Trace Available</h3>
        <div className="profiling-diagnostic-badge">Platform: iOS • Xcode Instruments</div>
        <p>
          The performance trace was successfully captured during this session. Download the .zip
          file to analyze it in Xcode Instruments.
        </p>
        <button
          className="download-trace-btn"
          onClick={() => {
            if (session.performance_trace) {
              window.open(XenonApiService.getAssetUrl(session.performance_trace), '_blank');
            }
          }}
        >
          <Download size={18} />
          Download Performance Trace (.zip)
        </button>
        <p className="hint-text">
          Open with Xcode Instruments for detailed CPU, Memory, and Time Profiler analysis.
        </p>
      </div>
    );
  }

  // No profiling data available
  if (data.length === 0) {
    const Icon = isRunning ? Clock : AlertCircle;
    return (
      <div className="profiling-empty">
        <Icon size={48} className={isRunning ? 'progress-icon' : 'empty-icon'} />
        <h3>{isRunning ? 'Profiling In Progress' : 'No Profiling Data'}</h3>
        <div className="profiling-diagnostic-badge">Platform: {session.device_platform}</div>
        <p>
          {isIOS
            ? isRunning
              ? 'Performance trace is being recorded. It will be available for download once the session ends.'
              : 'No performance trace was captured. This may happen if the session ended unexpectedly or the device was a simulator.'
            : isAndroid
              ? isRunning
                ? 'Profiling data is being collected. CPU & Memory charts will appear once the session ends.'
                : 'No profiling data was captured. Ensure the app was launched and appPackage capability was provided.'
              : 'Profiling is only available for Android and iOS real device sessions.'}
        </p>
        {isAndroid && isRunning && (
          <p className="hint-text">
            Check back after the test completes to see CPU & Memory charts.
          </p>
        )}
      </div>
    );
  }

  // Android profiling data view
  return (
    <div className="profiling-view animate-fade-in">
      <div className="profiling-stats-grid">
        <div className="profiling-stat-card">
          <div className="stat-icon cpu">
            <Cpu size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Avg CPU Usage</span>
            <span className="stat-value">{calculateAvgCpu()}%</span>
          </div>
        </div>
        <div className="profiling-stat-card">
          <div className="stat-icon peak">
            <TrendingUp size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Peak CPU</span>
            <span className="stat-value">{calculatePeakCpu()}%</span>
          </div>
        </div>
        <div className="profiling-stat-card">
          <div className="stat-icon memory">
            <HardDrive size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Avg Memory</span>
            <span className="stat-value">{calculateAvgMemory()} MB</span>
          </div>
        </div>
        <div className="profiling-stat-card">
          <div className="stat-icon memory">
            <Activity size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Peak Memory</span>
            <span className="stat-value">{calculateMaxMemory()} MB</span>
          </div>
        </div>
      </div>

      <div className="profiling-chart-container">
        <h4 className="chart-title">
          CPU & Memory Timeline
          <span className="chart-subtitle">({data.length} samples)</span>
        </h4>
        <div className="svg-chart-wrapper">
          <svg viewBox="0 0 800 200" className="profiling-svg">
            {/* CPU Line */}
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={data
                .map((d, i) => {
                  const x = data.length > 1 ? (i / (data.length - 1)) * 800 : 400;
                  const y = 200 - (parseFloat(d.cpu || '0') / 100) * 180;
                  return `${x},${y}`;
                })
                .join(' ')}
            />
            {/* Memory Line (Targeting 1024 MB max) */}
            <polyline
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={data
                .map((d, i) => {
                  const x = data.length > 1 ? (i / (data.length - 1)) * 800 : 400;
                  const mb = parseFloat(d.memory || '0') / 1024;
                  const y = 200 - (mb / 1024) * 180;
                  return `${x},${y}`;
                })
                .join(' ')}
            />
          </svg>
          <div className="chart-legend">
            <div className="legend-item">
              <span className="legend-dot cpu" />
              <span>CPU (%)</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot memory" />
              <span>Memory (MB)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profiling-table-wrapper">
        <table className="profiling-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>CPU %</th>
              <th>Memory MB</th>
              <th>System CPU</th>
            </tr>
          </thead>
          <tbody>
            {data
              .slice()
              .reverse()
              .map((entry) => (
                <tr key={entry.id}>
                  <td className="time-cell">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                  <td>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar cpu"
                        style={{ width: `${Math.min(parseFloat(entry.cpu || '0'), 100)}%` }}
                      />
                      <span className="progress-text">{entry.cpu}%</span>
                    </div>
                  </td>
                  <td>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar memory"
                        style={{
                          width: `${Math.min(
                            (parseFloat(entry.memory || '0') / (1024 * 1024)) * 100,
                            100,
                          )}%`,
                        }}
                      />
                      <span className="progress-text">
                        {(parseFloat(entry.memory || '0') / 1024).toFixed(1)} MB
                      </span>
                    </div>
                  </td>
                  <td className="details-cell">
                    {entry.total_cpu_used ? `${entry.total_cpu_used}%` : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProfilingView;

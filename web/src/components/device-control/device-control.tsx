import React, { useRef, useState, useEffect, useCallback } from 'react';
import { IDevice } from '../../interfaces/IDevice';
import XenonApiService from '../../api-service';
import {
  Home,
  Lock,
  Unlock,
  Upload,
  Clipboard,
  Camera,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  RotateCw,
  Move,
  Package,
  Loader2,
  Trash2,
  Wifi,
  Download,
  Search,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import './device-control.css';
import { Terminal } from '../terminal/terminal';

interface DeviceControlProps {
  device: IDevice;
  onClose: () => void;
}

type TabType = 'actions' | 'screenshot' | 'logs' | 'terminal';

export default function DeviceControl({ device, onClose }: DeviceControlProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
  const [activeTab, setActiveTab] = useState<TabType>('actions');
  const [textInput, setTextInput] = useState('');
  const [clipboardContent, setClipboardContent] = useState('');
  const [uninstallBundleId, setUninstallBundleId] = useState('');
  const [isPortrait, setIsPortrait] = useState(true);
  const [screenshots, setScreenshots] = useState<
    { id: string; base64: string; timestamp: number }[]
  >([]);
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamStarting, setStreamStarting] = useState(false);
  const [streamRetryCount, setStreamRetryCount] = useState(0);
  const [currentDevice, setCurrentDevice] = useState(device);
  const [installedApps, setInstalledApps] = useState<string[]>([]);
  const [fetchingApps, setFetchingApps] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [deviceLogs, setDeviceLogs] = useState<string[]>([]); // Switch to array for buffer management
  const [isFollowing, setIsFollowing] = useState(true);
  const [logFilter, setLogFilter] = useState('');

  // Principal Reliability: Keyboard Input Buffer
  // This prevents high-frequency keystrokes from overwhelming the iOS WDA session.
  const inputBuffer = useRef<string>('');
  const inputTimer = useRef<NodeJS.Timeout | null>(null);
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);

  // Log Polling for real-time logs
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeTab === 'logs') {
      const fetchLogs = async () => {
        try {
          const response = await XenonApiService.getLogs(currentDevice.udid);
          if (response && response.logs) {
            // High-performance log cleaning: Remove JSON formatting and ANSI/Unicode escapes
            const cleanLines = response.logs
              .replace(/\\u[0-9a-fA-F]{4}/g, (match: string) => JSON.parse(`"${match}"`))
              .replace(
                // eslint-disable-next-line no-control-regex
                /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
                '',
              )
              .split('\n')
              .filter((l: string) => l.trim().length > 0);

            setDeviceLogs((prev) => {
              // Create a unique set of lines to avoid duplicates during polling overlap
              // (Simple approach: take new lines that aren't in the tail of the buffer)
              const tail = prev.slice(-20);
              const trulyNew = cleanLines.filter((l: string) => !tail.includes(l));
              const combined = [...prev, ...trulyNew];
              return combined.slice(-1000); // 1000 line ring buffer for performance
            });
          }
        } catch (err) {
          console.error('Failed to fetch logs:', err);
        }
      };

      fetchLogs();
      interval = setInterval(fetchLogs, 2000); // Tighter 2s loop
    }

    return () => clearInterval(interval);
  }, [activeTab, currentDevice.udid]);

  const renderLogLines = () => {
    if (deviceLogs.length === 0) {
      return (
        <div className="log-line log-debug">
          <span className="log-content">Establishing technical link... Waiting for heartbeat.</span>
        </div>
      );
    }

    const filtered = deviceLogs.filter(
      (line) => !logFilter || line.toLowerCase().includes(logFilter.toLowerCase()),
    );

    return filtered.map((line, i) => {
      let typeClass = 'log-debug';
      const cleanLine = line.toLowerCase();
      if (cleanLine.includes('error') || cleanLine.includes('fail')) typeClass = 'log-error';
      else if (cleanLine.includes('warning') || cleanLine.includes('warn')) typeClass = 'log-warn';
      else if (cleanLine.includes('notice') || cleanLine.includes('info')) typeClass = 'log-notice';

      return (
        <div key={`${i}-${line.substring(0, 10)}`} className={`log-line ${typeClass}`}>
          <span className="log-index">{i + 1}</span>
          <span className="log-content">{line}</span>
        </div>
      );
    });
  };

  // Auto-scroll logs
  useEffect(() => {
    if (activeTab === 'logs' && isFollowing && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [deviceLogs, activeTab, isFollowing]);

  // Auto-start stream on mount
  useEffect(() => {
    const startAutoStream = async () => {
      try {
        setStreamStarting(true);
        // Principal Insight: Proactively warm up the stream for ALL platforms
        // This ensures the custom MJPEG endpoint is serving before <img> attempts load
        await XenonApiService.startStream(currentDevice.udid);

        // Refresh device info to get detected screen size and updated ports
        const devices = await XenonApiService.getDevices();
        const updated = (devices as any[]).find((d) => d.udid === currentDevice.udid);
        if (updated) {
          setCurrentDevice(updated);
        }
      } catch (err) {
        console.error('Auto-start stream failed:', err);
      } finally {
        setStreamStarting(false);
      }
    };
    startAutoStream();
    return () => {
      // Principal cleanup: Stop the stream when user leaves Control view
      XenonApiService.stopStream(currentDevice.udid).catch(() => {});
    };
  }, [device.udid]); // Only run once for this udid

  const loadInstalledApps = useCallback(async () => {
    try {
      setFetchingApps(true);
      const apps = await XenonApiService.listApps(currentDevice.udid);
      if (Array.isArray(apps)) setInstalledApps(apps);
    } catch (err) {
      console.error('Failed to load apps:', err);
    } finally {
      setFetchingApps(false);
    }
  }, [currentDevice.udid]);

  useEffect(() => {
    if (activeTab === 'actions') {
      loadInstalledApps();
    }
  }, [activeTab, loadInstalledApps]);

  // Use values from device or defaults
  const dw = parseInt(currentDevice.screenWidth || '1080', 10);
  const dh = parseInt(currentDevice.screenHeight || '1920', 10);

  // Normalized device dimensions (W always < H for ratio calculation)
  const deviceWidth = Math.min(dw, dh);
  const deviceHeight = Math.max(dw, dh);
  const deviceScreenRatio = deviceWidth / deviceHeight;

  // Calculate canvas dimensions based on screen size and orientation
  const updateCanvasDimensions = useCallback(() => {
    const isHorizontalLayout = !isPortrait;
    const availableHeight = isHorizontalLayout
      ? window.innerHeight * 0.55
      : window.innerHeight * 0.7;
    const availableWidth = isHorizontalLayout ? window.innerWidth * 0.8 : window.innerWidth * 0.45;

    const targetRatio = isPortrait ? deviceScreenRatio : 1 / deviceScreenRatio;

    let height, width;
    if (isPortrait) {
      height = availableHeight;
      width = height * targetRatio;
      if (width > availableWidth) {
        width = availableWidth;
        height = width / targetRatio;
      }
    } else {
      // Landscape View: width > height
      width = availableWidth;
      height = width / targetRatio; // width is 960, height is 542 (correct landscape rectangle)
      if (height > availableHeight) {
        height = availableHeight;
        width = height * targetRatio;
      }
    }
    setCanvasDimensions({ width, height });
  }, [deviceScreenRatio, isPortrait]);

  useEffect(() => {
    updateCanvasDimensions();
    window.addEventListener('resize', updateCanvasDimensions);
    return () => window.removeEventListener('resize', updateCanvasDimensions);
  }, [updateCanvasDimensions]);

  // Keyboard events with Tier-1 Buffering
  useEffect(() => {
    const flushBuffer = async () => {
      if (inputBuffer.current.length > 0) {
        const textToType = inputBuffer.current;
        inputBuffer.current = '';
        try {
          await XenonApiService.typeText(currentDevice.udid, textToType);
        } catch (err) {
          console.error('Keyboard buffering flush failed:', err);
        }
      }
    };

    const handleKeyDown = (event: React.KeyboardEvent | KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          (activeElement as HTMLElement).isContentEditable);

      if (isInputFocused) return;

      // Only respond to keys if the user is actively interacting with the device
      // (This prevents accidental typing while browsing the UI)
      if (!isCanvasFocused && activeTab !== 'terminal') return;

      const key = (event as KeyboardEvent).key;

      // 1. Special Keys (Enter, Backspace, etc) - Send Immediately
      if (key === 'Enter') {
        if (inputTimer.current) clearTimeout(inputTimer.current);
        flushBuffer();
        XenonApiService.pressKey(
          currentDevice.udid,
          currentDevice.platform === 'android' ? 66 : 'enter',
        );
      } else if (key === 'Backspace') {
        if (inputTimer.current) clearTimeout(inputTimer.current);
        flushBuffer();
        XenonApiService.pressKey(
          currentDevice.udid,
          currentDevice.platform === 'android' ? 67 : 'backspace',
        );
      }
      // 2. Printable Characters - Buffer them
      else if (key.length === 1) {
        inputBuffer.current += key;
        if (inputTimer.current) clearTimeout(inputTimer.current);
        inputTimer.current = setTimeout(() => {
          flushBuffer();
        }, 50); // 50ms buffer is imperceptible but reduces requests by ~5x for fast typists
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (inputTimer.current) clearTimeout(inputTimer.current);
    };
  }, [currentDevice.udid, currentDevice.platform, isCanvasFocused, activeTab]);

  // Get stream URL
  const getStreamUrl = () => {
    const ts = Date.now(); // Cache busting
    const retryPrefix = streamRetryCount > 0 ? `r=${streamRetryCount}&` : '';
    if (currentDevice.session_id) {
      return `/xenon/api/session/${currentDevice.session_id}/live_video?${retryPrefix}t=${ts}`;
    }
    return `/xenon/api/control/${currentDevice.udid}/stream?${retryPrefix}t=${ts}`;
  };

  // Interaction handlers
  const handleMouseDown = useRef<{ x: number; y: number; time: number } | null>(null);

  const getCursorCoordinates = (
    event: React.MouseEvent<HTMLDivElement>,
  ): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const onMouseDownHandler = (event: React.MouseEvent<HTMLDivElement>) => {
    const coords = getCursorCoordinates(event);
    handleMouseDown.current = { x: coords.x, y: coords.y, time: Date.now() };
  };

  const onMouseUpHandler = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!handleMouseDown.current) return;

    const startCoords = handleMouseDown.current;
    const endCoords = getCursorCoordinates(event);
    const timeDiff = Date.now() - startCoords.time;

    let startX, startY, endX, endY;

    if (isPortrait) {
      startX = (startCoords.x / canvasDimensions.width) * deviceWidth;
      startY = (startCoords.y / canvasDimensions.height) * deviceHeight;
      endX = (endCoords.x / canvasDimensions.width) * deviceWidth;
      endY = (endCoords.y / canvasDimensions.height) * deviceHeight;
    } else {
      // Landscape calculations
      // Image is rotated 90deg internally by CSS or WDA
      startX = (startCoords.x / canvasDimensions.width) * deviceHeight;
      startY = (startCoords.y / canvasDimensions.height) * deviceWidth;
      endX = (endCoords.x / canvasDimensions.width) * deviceHeight;
      endY = (endCoords.y / canvasDimensions.height) * deviceWidth;
    }

    const distanceX = Math.abs(endX - startX);
    const distanceY = Math.abs(endY - startY);

    try {
      if (timeDiff < 500 && distanceX < 10 && distanceY < 10) {
        await XenonApiService.tap(currentDevice.udid, Math.round(startX), Math.round(startY));
      } else if (timeDiff >= 500 && distanceX < 10 && distanceY < 10) {
        await XenonApiService.touchAndHold(
          currentDevice.udid,
          Math.round(startX),
          Math.round(startY),
          timeDiff,
        );
      } else {
        await XenonApiService.swipe(
          currentDevice.udid,
          Math.round(startX),
          Math.round(startY),
          Math.round(endX),
          Math.round(endY),
        );
      }
    } catch (error) {
      console.error('Action failed:', error);
    }

    handleMouseDown.current = null;
  };

  const pressHome = () =>
    XenonApiService.pressKey(currentDevice.udid, currentDevice.platform === 'android' ? 3 : 'home');
  const pressLock = () => XenonApiService.lock(currentDevice.udid);
  const pressUnlock = () => XenonApiService.unlock(currentDevice.udid);

  const sendText = async () => {
    if (textInput.trim()) {
      await XenonApiService.typeText(currentDevice.udid, textInput);
      setTextInput('');
    }
  };

  const fetchClipboard = async () => {
    try {
      setClipboardContent('Fetching...');
      const result = await XenonApiService.getClipboard(currentDevice.udid);
      if (result && result.content !== undefined) {
        setClipboardContent(result.content || '(Clipboard is empty)');
      } else {
        setClipboardContent('No content received');
      }
    } catch (error) {
      setClipboardContent('Error: Check Appium Settings app');
    }
  };

  const takeScreenshot = async () => {
    setLoading(true);
    try {
      const result = await XenonApiService.getScreenshot(currentDevice.udid);
      if (result?.screenshot) {
        const newScreenshot = {
          id: uuidv4(),
          base64: result.screenshot,
          timestamp: Date.now(),
        };
        setScreenshots((prev) => [newScreenshot, ...prev]);
        setSelectedScreenshotIndex(0);
      }
    } catch (error) {
      console.error('Failed to take screenshot:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteScreenshot = (id: string) => {
    setScreenshots((prev) => {
      const newScreenshots = prev.filter((s) => s.id !== id);
      if (newScreenshots.length === 0) {
        setSelectedScreenshotIndex(null);
      } else if (
        selectedScreenshotIndex !== null &&
        selectedScreenshotIndex >= newScreenshots.length
      ) {
        setSelectedScreenshotIndex(0);
      }
      return newScreenshots;
    });
  };

  const clearAllScreenshots = () => {
    if (window.confirm('Clear all captured evidence?')) {
      setScreenshots([]);
      setSelectedScreenshotIndex(null);
    }
  };

  const downloadScreenshot = (base64: string) => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${base64}`;
    link.download = `screenshot-${currentDevice.udid}-${Date.now()}.png`;
    link.click();
  };

  const quickSwipe = async (direction: 'left' | 'right' | 'up' | 'down') => {
    const centerW = deviceWidth / 2;
    const centerH = deviceHeight / 2;
    const offsetW = deviceWidth * 0.4;
    const offsetH = deviceHeight * 0.4;

    let sX, sY, eX, eY;

    switch (direction) {
      case 'left':
        sX = centerW + offsetW;
        sY = centerH;
        eX = centerW - offsetW;
        eY = centerH;
        break;
      case 'right':
        sX = centerW - offsetW;
        sY = centerH;
        eX = centerW + offsetW;
        eY = centerH;
        break;
      case 'up':
        sX = centerW;
        sY = centerH + offsetH;
        eX = centerW;
        eY = centerH - offsetH;
        break;
      case 'down':
        sX = centerW;
        sY = centerH - offsetH;
        eX = centerW;
        eY = centerH + offsetH;
        break;
    }

    try {
      await XenonApiService.swipe(
        currentDevice.udid,
        Math.round(sX),
        Math.round(sY),
        Math.round(eX),
        Math.round(eY),
      );
    } catch (err) {
      console.error(`Quick swipe ${direction} failed:`, err);
    }
  };

  const handleUninstall = async () => {
    if (uninstallBundleId.trim()) {
      try {
        setFetchingApps(true);
        await XenonApiService.uninstallApp(currentDevice.udid, uninstallBundleId);
        setUninstallBundleId('');
        alert(`Request sent for ${uninstallBundleId}`);
        // Reload list after short delay
        setTimeout(loadInstalledApps, 3000);
      } catch (err) {
        alert('Uninstall failed. Check logs.');
      } finally {
        setFetchingApps(false);
      }
    }
  };

  const handleInstall = async () => {
    if (!uploadFile) return;
    try {
      setInstalling(true);
      const result = await XenonApiService.uploadAndInstallApp(currentDevice.udid, uploadFile);
      if (result.success) {
        alert(result.message || 'App installed successfully');
        setUploadFile(null);
        // Reload list
        setTimeout(loadInstalledApps, 5000);
      } else {
        alert('Installation failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Installation failed: ' + err.message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="device-control-view">
      <header className="control-view-top-bar">
        <button className="back-to-devices-btn" onClick={onClose}>
          <ChevronLeft size={18} /> DEVICES
        </button>
        <div className="device-info-mini">
          <span className={`device-pill platform-pill ${currentDevice.platform}`}>
            {currentDevice.platform === 'ios' ? 'Apple' : 'Android'}
          </span>
          <span className="device-pill version-pill">v{currentDevice.sdk}</span>
          {currentDevice.reservedUntil && Date.now() < currentDevice.reservedUntil && (
            <span
              className="device-pill reserved-pill"
              title={`Reserved by ${currentDevice.reservedBy}${
                currentDevice.reservationReason ? `: ${currentDevice.reservationReason}` : ''
              }`}
            >
              RESERVED BY {currentDevice.reservedBy?.toUpperCase() || 'ANONYMOUS'}
            </span>
          )}
          <h2 className="device-name-text">{currentDevice.name}</h2>
          <span className="code-font" style={{ opacity: 0.5 }}>
            {currentDevice.udid}
          </span>
        </div>
      </header>

      <div className={`control-view-main ${!isPortrait ? 'is-landscape' : ''}`}>
        <div className="device-preview-column">
          <div className="device-screen-wrapper">
            <div
              ref={canvasRef}
              className={`device-stream-canvas ${!isPortrait ? 'landscape' : ''} ${
                isCanvasFocused ? 'focused' : ''
              }`}
              style={{
                width: canvasDimensions.width,
                height: canvasDimensions.height,
                background: '#000',
              }}
              tabIndex={0}
              onFocus={() => setIsCanvasFocused(true)}
              onBlur={() => setIsCanvasFocused(false)}
              onMouseDown={onMouseDownHandler}
              onMouseUp={onMouseUpHandler}
            >
              {streamStarting && (
                <div
                  className="device-stream-placeholder"
                  style={{ position: 'absolute', zIndex: 10 }}
                >
                  <RotateCw size={40} className="animate-spin" color="var(--primary)" />
                  <p style={{ marginTop: 16 }}>ESTABLISHING TRACE...</p>
                </div>
              )}
              <img
                src={getStreamUrl()}
                alt="Device Stream"
                className="device-stream-image"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
                onError={() => {
                  console.warn('Stream failed to load, retrying...');
                  // Intelligent Retry: increment state to force re-render
                  setTimeout(() => setStreamRetryCount((prev) => prev + 1), 2000);
                }}
              />
            </div>
          </div>

          <aside className="device-footer-actions">
            <button
              className={`footer-action-btn ${isPortrait ? 'active' : ''}`}
              onClick={() => setIsPortrait(true)}
            >
              <RotateCw size={14} style={{ transform: isPortrait ? 'none' : 'rotate(-90deg)' }} />{' '}
              PORTRAIT
            </button>
            <button
              className={`footer-action-btn ${!isPortrait ? 'active' : ''}`}
              onClick={() => setIsPortrait(false)}
            >
              <RotateCw size={14} style={{ transform: 'rotate(90deg)' }} /> LANDSCAPE
            </button>
            <div className="footer-divider" />
            <button className="footer-action-btn" onClick={pressHome}>
              <Home size={20} /> HOME
            </button>
            <button className="footer-action-btn" onClick={pressLock} title="Lock Device">
              <Lock size={20} />
            </button>
            <button className="footer-action-btn" onClick={pressUnlock} title="Unlock Device">
              <Unlock size={20} />
            </button>
          </aside>
        </div>

        <div className="device-interactions-column">
          <div className="interaction-tabs">
            <button
              className={`tab-btn ${activeTab === 'actions' ? 'active' : ''}`}
              onClick={() => setActiveTab('actions')}
            >
              ACTIONS
            </button>
            <button
              className={`tab-btn ${activeTab === 'screenshot' ? 'active' : ''}`}
              onClick={() => setActiveTab('screenshot')}
            >
              SCREENSHOT
            </button>
            <button
              className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              DEBUG LOGS
            </button>
            <button
              className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
              onClick={() => setActiveTab('terminal')}
            >
              <TerminalIcon size={14} style={{ marginRight: 6 }} /> SHELL
            </button>
          </div>

          <div
            className={`interactions-scroll-area ${
              activeTab === 'terminal' ? 'terminal-mode' : ''
            }`}
          >
            <div className="tab-content">
              {activeTab === 'actions' && (
                <div className="actions-grid">
                  <div className="action-card">
                    <h4 className="action-card-title">
                      <Move size={18} color="var(--primary)" /> Directional Gestures
                    </h4>
                    <div className="gestures-grid-container">
                      <div className="gestures-dpad">
                        <div />
                        <button className="dpad-btn" onClick={() => quickSwipe('up')}>
                          <ChevronUp size={24} />
                        </button>
                        <div />
                        <button className="dpad-btn" onClick={() => quickSwipe('left')}>
                          <ChevronLeft size={24} />
                        </button>
                        <div className="dpad-center" />
                        <button className="dpad-btn" onClick={() => quickSwipe('right')}>
                          <ChevronRight size={24} />
                        </button>
                        <div />
                        <button className="dpad-btn" onClick={() => quickSwipe('down')}>
                          <ChevronDown size={24} />
                        </button>
                        <div />
                      </div>
                      <p className="compact-label" style={{ opacity: 0.5 }}>
                        Directional Glide
                      </p>
                    </div>
                  </div>

                  <div className="action-card">
                    <h4 className="action-card-title">
                      <FileText size={18} color="var(--primary)" /> Smart Input
                    </h4>
                    <input
                      type="text"
                      className="type-input-field compact"
                      placeholder="Relay keystrokes..."
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendText()}
                    />
                  </div>

                  <div className="action-card full-width">
                    <h4 className="action-card-title">
                      <Package size={18} color="var(--primary)" /> App Management
                    </h4>
                    <div className="app-mgmt-content">
                      <div className="install-section">
                        <p className="compact-label">Install Package (.apk, .ipa, .app)</p>
                        <div className="upload-box-row">
                          <label className="file-upload-launcher">
                            <Upload size={14} />
                            <span>{uploadFile ? uploadFile.name : 'Select File'}</span>
                            <input
                              type="file"
                              accept=".apk,.ipa,.app"
                              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                              hidden
                            />
                          </label>
                          <button
                            className="btn-premium btn-sm"
                            disabled={!uploadFile || installing}
                            onClick={handleInstall}
                          >
                            {installing ? (
                              <Loader2 className="animate-spin" size={14} />
                            ) : (
                              'INSTALL'
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="divider-v" />

                      <div className="uninstall-section">
                        <p className="compact-label">Quick Uninstall</p>
                        <div className="uninstall-controls-row">
                          <div className="select-wrapper">
                            <select
                              className="app-select-dropdown compact"
                              value={uninstallBundleId}
                              onChange={(e) => setUninstallBundleId(e.target.value)}
                              disabled={fetchingApps}
                            >
                              <option value="">
                                {fetchingApps ? 'Loading apps...' : '-- Select App to Remove --'}
                              </option>
                              {installedApps.map((app) => (
                                <option key={app} value={app}>
                                  {app}
                                </option>
                              ))}
                            </select>
                            {fetchingApps && (
                              <Loader2 className="animate-spin select-loader" size={12} />
                            )}
                          </div>
                          <button
                            className="btn-destructive btn-sm"
                            onClick={handleUninstall}
                            disabled={!uninstallBundleId || fetchingApps}
                          >
                            <Trash2 size={14} /> UNINSTALL
                          </button>
                        </div>
                        <div className="manual-input-box">
                          <p className="hint-text">Or enter manually:</p>
                          <input
                            type="text"
                            className="type-input-field tiny"
                            placeholder="com.example.app"
                            value={uninstallBundleId}
                            onChange={(e) => setUninstallBundleId(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="action-card full-width">
                    <h4 className="action-card-title">
                      <Clipboard size={18} color="var(--primary)" /> Clipboard
                    </h4>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <button
                        className="btn-premium btn-sm"
                        style={{ width: '140px', flexShrink: 0 }}
                        onClick={fetchClipboard}
                      >
                        FETCH VALUE
                      </button>
                      <div className="clipboard-display compact" style={{ marginTop: 0, flex: 1 }}>
                        {clipboardContent}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'screenshot' && (
                <div className="action-card screenshot-card">
                  <header className="action-card-header">
                    <div className="title-group">
                      <h4 className="action-card-title">
                        <Camera size={20} color="var(--primary)" /> Captured Evidence
                      </h4>
                      <p className="hint-text">Relay screenshots from device to host.</p>
                    </div>
                    {screenshots.length > 0 && (
                      <button className="btn-text-only" onClick={clearAllScreenshots}>
                        CLEAR ALL
                      </button>
                    )}
                  </header>

                  <div className="screenshot-workspace">
                    {/* Gallery Sidebar */}
                    <div className="screenshot-gallery-sidebar">
                      <button
                        className="btn-premium take-screenshot-btn"
                        onClick={takeScreenshot}
                        disabled={loading}
                      >
                        {loading ? (
                          <Loader2 className="animate-spin" size={16} />
                        ) : (
                          <Camera size={16} />
                        )}
                        <span>{loading ? 'CAPTURING...' : 'NEW CAPTURE'}</span>
                      </button>

                      <div className="screenshot-thumbnails-list">
                        {screenshots.length === 0 && !loading && (
                          <div className="empty-gallery-state">
                            <p>No captures yet</p>
                          </div>
                        )}
                        {screenshots.map((s, idx) => (
                          <div
                            key={s.id}
                            className={`screenshot-thumb-item ${
                              selectedScreenshotIndex === idx ? 'active' : ''
                            }`}
                            onClick={() => setSelectedScreenshotIndex(idx)}
                          >
                            <img src={`data:image/png;base64,${s.base64}`} alt="Thumb" />
                            <span className="thumb-time">
                              {new Date(s.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                            <button
                              className="thumb-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteScreenshot(s.id);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Main Preview Area */}
                    <div className="screenshot-main-preview">
                      {selectedScreenshotIndex !== null && screenshots[selectedScreenshotIndex] ? (
                        <div className="preview-container">
                          <div className="preview-image-wrapper">
                            <img
                              src={`data:image/png;base64,${screenshots[selectedScreenshotIndex].base64}`}
                              alt="Selected Evidence"
                            />
                          </div>
                          <footer className="preview-footer">
                            <div className="preview-meta">
                              <span className="meta-label">ID:</span>
                              <span className="meta-value">
                                {screenshots[selectedScreenshotIndex].id.substring(0, 8)}
                              </span>
                              <span className="meta-divider">|</span>
                              <span className="meta-value">
                                {new Date(
                                  screenshots[selectedScreenshotIndex].timestamp,
                                ).toLocaleString()}
                              </span>
                            </div>
                            <div className="preview-actions">
                              <button
                                className="btn-premium btn-sm"
                                onClick={() =>
                                  downloadScreenshot(screenshots[selectedScreenshotIndex].base64)
                                }
                              >
                                DOWNLOAD PNG
                              </button>
                              <button
                                className="btn-destructive btn-sm"
                                onClick={() =>
                                  deleteScreenshot(screenshots[selectedScreenshotIndex].id)
                                }
                              >
                                <Trash2 size={14} /> DELETE
                              </button>
                            </div>
                          </footer>
                        </div>
                      ) : (
                        <div className="preview-empty-placeholder">
                          <Camera size={48} style={{ opacity: 0.1, marginBottom: 16 }} />
                          <p>Capture a screenshot to begin analysis</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'logs' && (
                <div className="action-card screenshot-card" style={{ padding: 0 }}>
                  <div className="log-toolbar">
                    <div className="log-filter-group">
                      <div className="log-stat-pill">LIVE</div>
                      <div className="log-stat-pill" style={{ opacity: 0.6 }}>
                        {deviceLogs.length} LINES
                      </div>
                      <div className="log-search-box">
                        <Search size={14} className="search-icon-inline" />
                        <input
                          type="text"
                          className="type-input-field tiny"
                          placeholder="Filter trace..."
                          value={logFilter}
                          onChange={(e) => setLogFilter(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="log-actions-group">
                      <button
                        className={`btn-secondary btn-sm ${isFollowing ? 'active' : ''}`}
                        onClick={() => setIsFollowing(!isFollowing)}
                        title={isFollowing ? 'Freeze Logs' : 'Follow Logs'}
                      >
                        <Wifi size={14} className={isFollowing ? 'animate-pulse' : ''} />
                        {isFollowing ? 'FREEZE' : 'FOLLOW'}
                      </button>
                      <button
                        className="btn-premium btn-sm"
                        onClick={() => {
                          const blob = new Blob([deviceLogs.join('\n')], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `logs-${currentDevice.udid}-${Date.now()}.txt`;
                          link.click();
                          URL.revokeObjectURL(url);
                        }}
                        disabled={deviceLogs.length === 0}
                      >
                        <Download size={14} />
                        EXPORT
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => setDeviceLogs([])}
                        title="Clear Logs"
                      >
                        <Trash2 size={14} />
                        CLEAR
                      </button>
                    </div>
                  </div>

                  <div className="log-display-area" ref={logContainerRef} style={{ flex: 1 }}>
                    {renderLogLines()}
                  </div>
                </div>
              )}

              {activeTab === 'terminal' && (
                <div className="action-card full-height">
                  <Terminal
                    platform={
                      (currentDevice.platform || '').toLowerCase() as 'android' | 'ios' | 'tvos'
                    }
                    prompt={`${
                      (currentDevice.platform || '').toLowerCase() === 'ios' ? 'ios' : 'adb'
                    } $`}
                    welcomeMessage={`Connected to ${currentDevice.name} (${currentDevice.udid}).\nInternal Shell Environment.`}
                    onCommand={async (cmd) => {
                      const res = await XenonApiService.executeShell(currentDevice.udid, cmd);
                      if (res.error) throw new Error(res.error);
                      return res.output;
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

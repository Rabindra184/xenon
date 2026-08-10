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
  RectangleVertical,
  RectangleHorizontal,
  Move,
  Package,
  Loader2,
  Trash2,
  Terminal as TerminalIcon,
  Zap,
  ScrollText,
  Sparkles,
  Copy,
  Check,
  Square,
  Volume1,
  Volume2,
  AlertTriangle,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { formatDateTime } from '../../utils/time';
import { useToast } from '../ui/toast';
import { Select } from '../ui/select';
import './device-control.css';
import { Terminal } from '../terminal/terminal';
import OmniInspector from '../omni-inspector/OmniInspector';
import { BugReportButton } from '../bug-report/BugReportButton';
import { ANDROID_KEYCODE, IOS_BUTTON } from './keycodes';
import LogcatView from './logcat/LogcatView';

interface DeviceControlProps {
  device: IDevice;
  onClose: () => void;
}

type TabType = 'actions' | 'screenshot' | 'logs' | 'terminal' | 'omni';

import { useNavigate, useParams } from 'react-router-dom';

export default function DeviceControl({ device, onClose }: DeviceControlProps) {
  const { toast, removeToast } = useToast();
  const navigate = useNavigate();
  const { tab } = useParams();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
  // Reported by OmniInspector. In inspect mode a click on the canvas selects an
  // element, so the host must NOT also send it to the device as a tap.
  const [omniMode, setOmniMode] = useState<'inspect' | 'interact'>('inspect');
  // Forces a re-render once the canvas element exists, so the overlay portal
  // has a target on the first paint of the Omni tab rather than the second.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>((tab as TabType) || 'actions');
  // Only the Omni tab inspects; every other tab keeps the device interactive.
  const inspecting = activeTab === 'omni' && omniMode === 'inspect';
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
  const [streamLoaded, setStreamLoaded] = useState(false);
  const [streamFailed, setStreamFailed] = useState(false);
  const MAX_STREAM_RETRIES = 10; // ~20s at the 2s retry cadence
  const [udidCopied, setUdidCopied] = useState(false);

  const copyUdid = () => {
    navigator.clipboard.writeText(currentDevice.udid).catch(() => { });
    setUdidCopied(true);
    setTimeout(() => setUdidCopied(false), 1500);
  };

  // Principal Reliability: Keyboard Input Buffer
  // This prevents high-frequency keystrokes from overwhelming the iOS WDA session.
  const inputBuffer = useRef<string>('');
  const inputTimer = useRef<NodeJS.Timeout | null>(null);
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);

  // Synchronize Tab switch with URL
  useEffect(() => {
    if (activeTab && (!tab || tab !== activeTab)) {
      navigate(`/devices/${device.udid}/control/${activeTab}`, { replace: true });
    }
  }, [activeTab, tab, device.udid, navigate]);

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
      XenonApiService.stopStream(currentDevice.udid).catch(() => { });
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

    // Horizontal budget the LANDSCAPE canvas must fit inside so it can't overflow
    // its column and get clipped by .control-view-main { overflow: hidden }. In the
    // row layout the width is shared by: sidebar rail (56, fixed w-14 overlay that
    // main.pl-14 reserves) + main/row padding (24*2 = 48) + column gap (32) +
    // interactions column (min-width 450) + .device-screen-wrapper chrome around the
    // canvas (padding 12*2 + border 1*2 = 26). 8px is slack so the canvas never lands
    // exactly on the edge. Global box-sizing is border-box, so canvasDimensions.width
    // IS the rendered box width and the tap/swipe math stays correct. Only applied
    // above the 900px stacking breakpoint (CSS @media max-width:900) — below it the
    // columns stack, the full width is available, and this reservation would wrongly
    // shrink (or, at small widths, negate) the canvas.
    const LANDSCAPE_ROW_RESERVED = 56 + 48 + 32 + 450 + 26 + 8; // 620
    const STACK_BREAKPOINT = 900;
    const isRowLayout = window.innerWidth > STACK_BREAKPOINT;

    let availableWidth;
    if (isHorizontalLayout) {
      availableWidth = isRowLayout
        ? Math.min(window.innerWidth * 0.8, window.innerWidth - LANDSCAPE_ROW_RESERVED)
        : window.innerWidth * 0.8;
    } else {
      availableWidth = window.innerWidth * 0.45;
    }

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

  const [streamTimestamp, setStreamTimestamp] = useState(Date.now());

  // Get stream URL
  const getStreamUrl = () => {
    const retryPrefix = streamRetryCount > 0 ? `r=${streamRetryCount}&` : '';

    // Principal Insight: Internal Virtual Sessions
    // Manual control sessions use ids like "manual_UDID". These are NOT in the database
    // and should use the dedicated /control endpoint.
    if (currentDevice.session_id && !String(currentDevice.session_id).startsWith('manual_')) {
      return `/xenon/api/session/${currentDevice.session_id}/live_video?${retryPrefix}t=${streamTimestamp}`;
    }
    return `/xenon/api/control/${currentDevice.udid}/stream?${retryPrefix}t=${streamTimestamp}`;
  };

  // Update timestamp on retry
  useEffect(() => {
    if (streamRetryCount > 0) {
      setStreamTimestamp(Date.now());
    }
  }, [streamRetryCount]);

  // Watchdog: catches the never-fires-onLoad case (e.g. a hung connection that
  // neither loads nor errors) so the UI doesn't wait forever.
  useEffect(() => {
    if (streamLoaded || streamFailed) return;
    const t = setTimeout(() => setStreamFailed(true), 30000);
    return () => clearTimeout(t);
  }, [streamLoaded, streamFailed, streamRetryCount]);

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

    // Use the canvas's actual rendered size, not the canvasDimensions state value.
    // CSS (e.g. `.control-view-main.omni-mode .device-stream-canvas { max-width: 100% }`)
    // can clamp the rendered box smaller than the state, and the tap/swipe math must
    // divide by whatever size the pointer coordinates were actually captured against.
    const rect = canvasRef.current?.getBoundingClientRect();
    const renderedWidth = rect?.width || canvasDimensions.width;
    const renderedHeight = rect?.height || canvasDimensions.height;

    let startX, startY, endX, endY;

    if (isPortrait) {
      startX = (startCoords.x / renderedWidth) * deviceWidth;
      startY = (startCoords.y / renderedHeight) * deviceHeight;
      endX = (endCoords.x / renderedWidth) * deviceWidth;
      endY = (endCoords.y / renderedHeight) * deviceHeight;
    } else {
      // Landscape calculations
      // Image is rotated 90deg internally by CSS or WDA
      startX = (startCoords.x / renderedWidth) * deviceHeight;
      startY = (startCoords.y / renderedHeight) * deviceWidth;
      endX = (endCoords.x / renderedWidth) * deviceHeight;
      endY = (endCoords.y / renderedHeight) * deviceWidth;
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
    XenonApiService.pressKey(
      currentDevice.udid,
      currentDevice.platform === 'android' ? ANDROID_KEYCODE.HOME : IOS_BUTTON.HOME,
    );
  const pressBack = () =>
    XenonApiService.pressKey(currentDevice.udid, ANDROID_KEYCODE.BACK);
  const pressAppSwitcher = () =>
    XenonApiService.pressKey(currentDevice.udid, ANDROID_KEYCODE.APP_SWITCH);
  const pressVolumeUp = () =>
    XenonApiService.pressKey(
      currentDevice.udid,
      currentDevice.platform === 'android' ? ANDROID_KEYCODE.VOLUME_UP : IOS_BUTTON.VOLUME_UP,
    );
  const pressVolumeDown = () =>
    XenonApiService.pressKey(
      currentDevice.udid,
      currentDevice.platform === 'android' ? ANDROID_KEYCODE.VOLUME_DOWN : IOS_BUTTON.VOLUME_DOWN,
    );
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
    setScreenshots([]);
    setSelectedScreenshotIndex(null);
    toast('Cleared all captured evidence.', 'success');
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
      const toastId = toast(`Uninstalling ${uninstallBundleId}...`, 'loading', 0);
      try {
        setFetchingApps(true);
        await XenonApiService.uninstallApp(currentDevice.udid, uninstallBundleId);
        setUninstallBundleId('');
        toast(`Request sent for ${uninstallBundleId}`, 'success');
        // Reload list after short delay
        setTimeout(loadInstalledApps, 3000);
      } catch (err) {
        toast('Uninstall failed. Check logs.', 'error');
      } finally {
        setFetchingApps(false);
        removeToast(toastId);
      }
    }
  };

  const handleInstall = async () => {
    if (!uploadFile) return;
    let toastId: string | undefined;
    try {
      setInstalling(true);
      toastId = toast(`Installing app to ${currentDevice.udid}...`, 'loading', 0);
      const result = await XenonApiService.uploadAndInstallApp(currentDevice.udid, uploadFile);
      if (result.success) {
        toast(result.message || 'App installed successfully', 'success');
        setUploadFile(null);
        // Reload list
        setTimeout(loadInstalledApps, 5000);
      } else {
        toast('Installation failed: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (err: any) {
      toast('Installation failed: ' + err.message, 'error');
    } finally {
      if (toastId) removeToast(toastId);
      setInstalling(false);
    }
  };

  return (
    <div className="device-control-view">
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
              title={`Reserved by ${currentDevice.reservedBy}${currentDevice.reservationReason ? `: ${currentDevice.reservationReason}` : ''
                }`}
            >
              RESERVED BY {currentDevice.reservedBy?.toUpperCase() || 'ANONYMOUS'}
            </span>
          )}
          <h2 className="device-name-text">{currentDevice.name}</h2>
          <span className="udid-chip" title={currentDevice.udid}>
            <span className="udid-chip__value">{currentDevice.udid}</span>
            <button
              type="button"
              className="udid-chip__copy"
              onClick={copyUdid}
              aria-label="Copy UDID"
              title={udidCopied ? 'Copied!' : 'Copy UDID'}
            >
              {udidCopied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </span>
        </div>
      </header>

      <div
        className={`control-view-main ${!isPortrait ? 'is-landscape' : ''} ${activeTab === 'omni' ? 'omni-mode' : ''}`}
      >
        <div className="device-preview-column">
          <div className="device-screen-wrapper">
            <div
              // Callback ref, not just canvasRef: a ref object's `.current`
              // assignment does not re-render, so the Omni overlay portal would
              // have had a null target on the paint where the tab opens and
              // would only appear after some unrelated state change.
              ref={(el) => {
                (canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                setCanvasEl(el);
              }}
              className={`device-stream-canvas ${!isPortrait ? 'landscape' : ''} ${isCanvasFocused ? 'focused' : ''
                } ${inspecting ? 'is-inspecting' : ''}`}
              style={{
                width: canvasDimensions.width,
                height: canvasDimensions.height,
                background: '#000',
              }}
              tabIndex={0}
              onFocus={() => setIsCanvasFocused(true)}
              onBlur={() => setIsCanvasFocused(false)}
              onMouseDown={inspecting ? undefined : onMouseDownHandler}
              onMouseUp={inspecting ? undefined : onMouseUpHandler}
            >
              {streamFailed ? (
                <div
                  className="device-stream-placeholder"
                  style={{ position: 'absolute', zIndex: 10 }}
                >
                  <AlertTriangle size={40} color="var(--red, #f87171)" />
                  <p style={{ marginTop: 16 }}>Stream unavailable</p>
                  <button
                    className="btn-premium btn-sm"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      setStreamFailed(false);
                      setStreamRetryCount(0);
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                (streamStarting || !streamLoaded) && (
                  <div
                    className="device-stream-placeholder"
                    style={{ position: 'absolute', zIndex: 10 }}
                  >
                    <RotateCw size={40} className="animate-spin" color="var(--green)" />
                    <p style={{ marginTop: 16 }}>
                      {streamStarting ? 'ESTABLISHING TRACE...' : 'Waiting for stream…'}
                    </p>
                  </div>
                )
              )}
              {!streamFailed && (
                <img
                  src={getStreamUrl()}
                  alt="Device Stream"
                  className="device-stream-image"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                  onLoad={() => setStreamLoaded(true)}
                  onError={() => {
                    console.warn('Stream failed to load, retrying...');
                    setStreamLoaded(false);
                    if (streamRetryCount >= MAX_STREAM_RETRIES) {
                      setStreamFailed(true);
                      return;
                    }
                    setTimeout(() => setStreamRetryCount((prev) => prev + 1), 2000);
                  }}
                />
              )}
            </div>
          </div>

          {/* Orientation-aware: a vertical strip beside a PORTRAIT device (which
              leaves width unused at its sides and no height below it), a
              horizontal bar under a LANDSCAPE one (the reverse). Icons only —
              the labelled version's max-content width was what pinned the
              preview column wide and squeezed the log pane. Every button
              therefore carries both `title` (pointer) and `aria-label`
              (assistive tech); an icon-only control with neither is
              unidentifiable. */}
          <aside
            className="device-footer-actions"
            role="toolbar"
            aria-label="Device controls"
            aria-orientation={isPortrait ? 'vertical' : 'horizontal'}
          >
            <button
              className={`footer-action-btn ${isPortrait ? 'active' : ''}`}
              onClick={() => setIsPortrait(true)}
              title="Portrait"
              aria-label="Portrait orientation"
              aria-pressed={isPortrait}
            >
              <RectangleVertical size={18} />
            </button>
            <button
              className={`footer-action-btn ${!isPortrait ? 'active' : ''}`}
              onClick={() => setIsPortrait(false)}
              title="Landscape"
              aria-label="Landscape orientation"
              aria-pressed={!isPortrait}
            >
              <RectangleHorizontal size={18} />
            </button>
            <div className="footer-divider" />
            <button
              className="footer-action-btn"
              onClick={pressHome}
              title="Home"
              aria-label="Home"
            >
              <Home size={18} />
            </button>
            {currentDevice.platform === 'android' && (
              <>
                <button
                  className="footer-action-btn"
                  onClick={pressBack}
                  title="Back"
                  aria-label="Back"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="footer-action-btn"
                  onClick={pressAppSwitcher}
                  title="App Switcher"
                  aria-label="App switcher"
                >
                  <Square size={18} />
                </button>
              </>
            )}
            <div className="footer-divider" />
            <button
              className="footer-action-btn"
              onClick={pressVolumeUp}
              title="Volume Up"
              aria-label="Volume up"
            >
              <Volume2 size={18} />
            </button>
            <button
              className="footer-action-btn"
              onClick={pressVolumeDown}
              title="Volume Down"
              aria-label="Volume down"
            >
              <Volume1 size={18} />
            </button>
            <button
              className="footer-action-btn"
              onClick={pressLock}
              title="Lock Device"
              aria-label="Lock device"
            >
              <Lock size={18} />
            </button>
            <button
              className="footer-action-btn"
              onClick={pressUnlock}
              title="Unlock Device"
              aria-label="Unlock device"
            >
              <Unlock size={18} />
            </button>
          </aside>
        </div>

        <div className="device-interactions-column">
          <div className="interaction-tabs" role="tablist">
            <button
              className={`tab-btn ${activeTab === 'actions' ? 'active' : ''}`}
              onClick={() => setActiveTab('actions')}
              role="tab"
              aria-selected={activeTab === 'actions'}
            >
              <Zap size={13} />
              <span>Actions</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'screenshot' ? 'active' : ''}`}
              onClick={() => setActiveTab('screenshot')}
              role="tab"
              aria-selected={activeTab === 'screenshot'}
            >
              <Camera size={13} />
              <span>Screenshot</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
              role="tab"
              aria-selected={activeTab === 'logs'}
            >
              <ScrollText size={13} />
              <span>Debug Logs</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
              onClick={() => setActiveTab('terminal')}
              role="tab"
              aria-selected={activeTab === 'terminal'}
            >
              <TerminalIcon size={13} />
              <span>Shell</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'omni' ? 'active' : ''}`}
              onClick={() => setActiveTab('omni')}
              role="tab"
              aria-selected={activeTab === 'omni'}
            >
              <Sparkles size={13} />
              <span>Omni-Vision</span>
            </button>
          </div>

          <div
            className={`interactions-scroll-area ${activeTab === 'terminal' ? 'terminal-mode' : ''
              } ${activeTab === 'screenshot' || activeTab === 'logs' ? 'screenshot-mode' : ''}`}
          >
            <div className="tab-content">
              {activeTab === 'omni' && (
                <div className="omni-inspector-tab-wrapper animate-fade-in">
                  <OmniInspector
                    sessionId={currentDevice.session_id ? String(currentDevice.session_id) : null}
                    udid={currentDevice.udid}
                    streamUrl={getStreamUrl()}
                    embedded
                    overlayTarget={canvasEl}
                    onModeChange={setOmniMode}
                  />
                </div>
              )}

              {activeTab === 'actions' && (
                <div className="actions-grid">
                  <div className="action-card full-width">
                    <h4 className="action-card-title">
                      <FileText size={18} color="var(--green)" /> Smart Input
                    </h4>
                    <p className="action-card-hint">
                      Relay keystrokes to the focused element on the device.
                    </p>
                    <input
                      type="text"
                      className="type-input-field compact"
                      placeholder="Type and press Enter to send…"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendText()}
                    />
                  </div>

                  <div className="action-card full-width">
                    <h4 className="action-card-title">
                      <Package size={18} color="var(--green)" /> App Management
                    </h4>
                    <div className="app-mgmt-content">
                      <div className="install-section">
                        <p className="compact-label">Install Package</p>
                        <div className="upload-box-row">
                          <label
                            className="file-upload-launcher"
                            title={
                              uploadFile ? uploadFile.name : 'Select an .apk, .ipa or .app file'
                            }
                          >
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
                        <p className="hint-text">Accepts .apk, .ipa or .app</p>
                      </div>

                      <div className="divider-v" />

                      <div className="uninstall-section">
                        <p className="compact-label">Quick Uninstall</p>
                        <div className="uninstall-controls-row">
                          <div className="select-wrapper">
                            <Select
                              selectSize="sm"
                              className="w-full"
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
                            </Select>
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
                      <Clipboard size={18} color="var(--green)" /> Clipboard
                    </h4>
                    <div className="clipboard-row">
                      <button className="btn-premium btn-sm" onClick={fetchClipboard}>
                        FETCH VALUE
                      </button>
                      <div className="clipboard-display compact">{clipboardContent}</div>
                    </div>
                  </div>

                  <div className="action-card full-width">
                    <h4 className="action-card-title">
                      <Move size={18} color="var(--green)" /> Directional Gestures
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
                      <p className="compact-label dpad-caption">Quick swipe in a direction</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'screenshot' && (
                <div className="action-card screenshot-card">
                  {/* No card title here: the tab bar already says SCREENSHOT, so a
                      "Captured Evidence" heading plus a hint restated the same thing
                      twice. The Actions tab keeps its titles because they distinguish
                      four cards from each other; this tab has one. */}
                  {screenshots.length > 0 && (
                    <header className="action-card-header">
                      <button className="btn-text-only" onClick={clearAllScreenshots}>
                        CLEAR ALL
                      </button>
                    </header>
                  )}

                  <div
                    className={`screenshot-workspace ${screenshots.length === 0 ? 'is-empty' : ''}`}
                  >
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
                            <Camera size={20} className="empty-gallery-icon" />
                            <p className="empty-gallery-title">No captures yet</p>
                            <p className="empty-gallery-hint">
                              Grab a screenshot of the device to begin analysis.
                            </p>
                          </div>
                        )}
                        {screenshots.map((s, idx) => (
                          <div
                            key={s.id}
                            className={`screenshot-thumb-item ${selectedScreenshotIndex === idx ? 'active' : ''
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
                                {formatDateTime(screenshots[selectedScreenshotIndex].timestamp)}
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
                      ) : null}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'logs' && (
                <div className="action-card screenshot-card">
                  <LogcatView udid={currentDevice.udid} platform={currentDevice.platform} />
                </div>
              )}

              {activeTab === 'terminal' && (
                <div className="action-card full-height">
                  <Terminal
                    platform={
                      (currentDevice.platform || '').toLowerCase() as 'android' | 'ios' | 'tvos'
                    }
                    prompt={`${(currentDevice.platform || '').toLowerCase() === 'ios' ? 'ios' : 'adb'
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
      {currentDevice.session_id &&
        !String(currentDevice.session_id).startsWith('manual_') && (
          <BugReportButton
            sessionId={String(currentDevice.session_id)}
            mode="slice"
            windowSec={60}
            variant="floating"
          />
        )}
    </div>
  );
}

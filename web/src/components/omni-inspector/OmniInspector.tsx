import React, { useState, useEffect, useRef } from 'react';
import {
    Eye,
    Search,
    MousePointer2,
    Code,
    Info,
    Cpu,
    Layers,
    Copy,
    Check,
    XCircle,
    RotateCw,
    ChevronLeft,
    ChevronRight,
    Target
} from 'lucide-react';
import { Badge } from '../ui/badge';
import XenonApiService from '../../api-service';
import './omni-inspector.css';

interface BBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

interface OCRWord {
    text: string;
    confidence: number;
    bbox: BBox;
}

interface OmniScanResult {
    timestamp: string;
    ocr: {
        text: string;
        words: OCRWord[];
    };
    ai_insights: string;
    screenshot?: string;
}

interface OmniInspectorProps {
    sessionId?: string | null;
    udid?: string | null;
}

const OmniInspector: React.FC<OmniInspectorProps> = ({ sessionId, udid }) => {
    const [loading, setLoading] = useState(true);
    const [scanData, setScanData] = useState<OmniScanResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [screenshot, setScreenshot] = useState<string | null>(null);
    const [selectedElement, setSelectedElement] = useState<OCRWord | null>(null);
    const [aiQuery, setAiQuery] = useState('');
    const [testingAi, setTestingAi] = useState(false);
    const [aiResults, setAiResults] = useState<any[]>([]);
    const [copied, setCopied] = useState(false);
    const [scanToast, setScanToast] = useState(false);

    // Zoom and Pan State
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });

    // Panel states
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [showHints, setShowHints] = useState(true);

    const [naturalDimensions, setNaturalDimensions] = useState({ width: 0, height: 0 });
    const viewportRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        const { naturalWidth, naturalHeight } = e.currentTarget;
        setNaturalDimensions({ width: naturalWidth, height: naturalHeight });
        // Precise auto-fit logic
        if (viewportRef.current) {
            const vWidth = viewportRef.current.clientWidth;
            const vHeight = viewportRef.current.clientHeight;
            // Maximize utilization: target 92% of available space
            const scaleX = (vWidth * 0.92) / naturalWidth;
            const scaleY = (vHeight * 0.92) / naturalHeight;
            const bestScale = Math.min(scaleX, scaleY);
            setZoom(bestScale);
            setOffset({ x: 0, y: 0 }); // Center strictly
        }
    };

    useEffect(() => {
        if (sessionId || udid) {
            performScan();
        } else {
            setError('No active session or device detected for Omni-Vision.');
            setLoading(false);
        }
    }, [sessionId, udid]);

    const performScan = async () => {
        setLoading(true);
        setError(null);
        setSelectedElement(null);
        setZoom(1);
        setOffset({ x: 0, y: 0 });

        try {
            // 1. Get screenshot
            let ssData;
            if (sessionId) {
                const ssResp = await fetch(`/xenon/api/session/${sessionId}/screenshot`);
                if (!ssResp.ok) throw new Error('Failed to fetch screenshot from session');
                ssData = await ssResp.json();
            } else if (udid) {
                const ssResp = await fetch(`/xenon/api/control/${udid}/screenshot`);
                if (!ssResp.ok) throw new Error('Failed to fetch screenshot from device');
                ssData = await ssResp.json();
            }
            if (ssData) setScreenshot(ssData.value || ssData.screenshot);

            // 2. Get Omni-Scan metadata
            let scanResult;
            if (sessionId) {
                scanResult = await XenonApiService.omniScan(sessionId);
            } else if (udid) {
                scanResult = await XenonApiService.omniScanControl(udid);
            }

            if (!scanResult) throw new Error('Failed to retrieve scan metadata');

            if (scanResult.status === 'error') {
                setError(scanResult.message || 'Screen analysis failed');
            } else {
                setScanData(scanResult.value || scanResult);
            }
        } catch (err: any) {
            console.error('Failed to perform Omni-Scan:', err);
            setError(err.message || 'An unexpected error occurred during scan');
        } finally {
            setLoading(false);
            if (!error) {
                setScanToast(true);
                setTimeout(() => setScanToast(false), 3000);
            }
        }
    };

    const handleAiSearch = async () => {
        if (!aiQuery) return;
        setTestingAi(true);
        try {
            const strategy = aiQuery.startsWith('icon:') ? '-custom:ai-icon' : '-custom:ai-text';
            const selector = aiQuery.replace('icon:', '').trim();

            let data;
            if (sessionId) {
                data = await XenonApiService.testAiLocator(sessionId, strategy, selector);
            } else if (udid) {
                data = await XenonApiService.testAiLocatorControl(udid, strategy, selector);
            }

            if (!data) throw new Error('Failed to test AI locator');

            if (data.status === 'error') {
                alert(`AI Search failed: ${data.message || 'Unknown error'}`);
            } else {
                const results = data.value || [];
                setAiResults(results);
                // Auto-select first result for immediate visual feedback
                if (results.length > 0) {
                    const first = results[0];
                    setSelectedElement({
                        text: first.text || aiQuery,
                        confidence: (first.confidence || 0.85) * 100,
                        bbox: {
                            x0: first.rect.x,
                            y0: first.rect.y,
                            x1: first.rect.x + first.rect.width,
                            y1: first.rect.y + first.rect.height
                        }
                    });
                }
            }
        } catch (err: any) {
            console.error('AI Search failed:', err);
            alert('AI Search encountered a technical error');
        } finally {
            setTestingAi(false);
        }
    };

    const performTap = async (word: OCRWord) => {
        if (!udid && !sessionId) return;
        if (naturalDimensions.width === 0) return;

        // Calculate center of the word for accurate tapping
        const centerX = Math.round((word.bbox.x0 + word.bbox.x1) / 2);
        const centerY = Math.round((word.bbox.y0 + word.bbox.y1) / 2);

        try {
            const targetUdid = udid || (await XenonApiService.getSessions()).find((s: any) => s.session_id === sessionId)?.udid;
            if (targetUdid) {
                // Ensure we send coordinates relative to the natural device resolution
                await XenonApiService.tap(targetUdid, centerX, centerY);
                console.log(`[Omni-Vision] Precision Tap on "${word.text}" at ${centerX}, ${centerY} (Natural: ${naturalDimensions.width}x${naturalDimensions.height})`);
            }
        } catch (err) {
            console.error('Interactive tap failed:', err);
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(Math.max(zoom * delta, 0.5), 5);
        setZoom(newZoom);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // Left click only
        setIsPanning(true);
        setStartPos({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isPanning) return;
        setOffset({
            x: e.clientX - startPos.x,
            y: e.clientY - startPos.y
        });
    };

    const handleMouseUp = () => {
        setIsPanning(false);
        if (showHints) setShowHints(false);
    };

    const zoomToFit = () => {
        if (imgRef.current && viewportRef.current) {
            const vWidth = viewportRef.current.clientWidth;
            const vHeight = viewportRef.current.clientHeight;
            const nWidth = imgRef.current.naturalWidth;
            const nHeight = imgRef.current.naturalHeight;
            const scaleX = (vWidth * 0.82) / nWidth;
            const scaleY = (vHeight * 0.82) / nHeight;
            setZoom(Math.min(scaleX, scaleY));
            setOffset({ x: 0, y: 0 });
        }
    };

    const zoomToActual = () => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };

    const copyLocator = (element: OCRWord | null) => {
        if (!element) return;
        const locator = `driver.findElement("-custom:ai-text", "${element.text}")`;
        try {
            navigator.clipboard.writeText(locator);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.warn('Clipboard access denied', err);
        }
    };

    const renderHighlights = () => {
        if (!imgRef.current) return null;

        const elements = [];

        // Render standard OCR words
        if (scanData && scanData.ocr) {
            elements.push(...scanData.ocr.words.map((word, idx) => {
                const style = {
                    left: `${(word.bbox.x0 / naturalDimensions.width) * 100}%`,
                    top: `${(word.bbox.y0 / naturalDimensions.height) * 100}%`,
                    width: `${((word.bbox.x1 - word.bbox.x0) / naturalDimensions.width) * 100}%`,
                    height: `${((word.bbox.y1 - word.bbox.y0) / naturalDimensions.height) * 100}%`,
                };

                return (
                    <div
                        key={`ocr-${idx}`}
                        className={`omni-highlight ${selectedElement === word ? 'active' : ''}`}
                        style={style}
                        onClick={(e) => {
                            e.stopPropagation();
                            setSelectedElement(word);
                        }}
                        onDoubleClick={() => performTap(word)}
                        title={`${word.text} (${Math.round(word.confidence)}%)`}
                    />
                );
            }));
        }

        // Render AI Search Results (High Priority Green Matches)
        if (aiResults.length > 0) {
            elements.push(...aiResults.map((res, idx) => {
                const x0 = res.rect.x;
                const y0 = res.rect.y;
                const x1 = res.rect.x + res.rect.width;
                const y1 = res.rect.y + res.rect.height;

                const style = {
                    left: `${(x0 / naturalDimensions.width) * 100}%`,
                    top: `${(y0 / naturalDimensions.height) * 100}%`,
                    width: `${(res.rect.width / naturalDimensions.width) * 100}%`,
                    height: `${(res.rect.height / naturalDimensions.height) * 100}%`,
                };

                const syntheticWord = {
                    text: res.text || aiQuery,
                    confidence: (res.confidence || 0.85) * 100,
                    bbox: { x0, y0, x1, y1 }
                };

                const isActive = selectedElement?.text === syntheticWord.text;

                return (
                    <div
                        key={`ai-${idx}`}
                        className={`omni-highlight active-ai ${isActive ? 'active' : ''}`}
                        style={style}
                        onClick={(e) => {
                            e.stopPropagation();
                            setSelectedElement(syntheticWord);
                        }}
                        onDoubleClick={() => performTap(syntheticWord)}
                        title={`AI Match: ${syntheticWord.text}`}
                    />
                );
            }));
        }

        return elements;
    };

    return (
        <div className="omni-inspector-container">
            {scanToast && (
                <div className="omni-toast animate-slide-in-top">
                    <Check size={14} color="#10b981" />
                    <span>Visual Synchronization Complete</span>
                </div>
            )}
            <div className="omni-inspector-header">
                <div className="omni-inspector-actions">
                    <div className="control-cluster-v2">
                        <button
                            className="omni-ai-btnSecondary"
                            onClick={() => {
                                if (imgRef.current && viewportRef.current) {
                                    const vWidth = viewportRef.current.clientWidth;
                                    const vHeight = viewportRef.current.clientHeight;
                                    const nWidth = imgRef.current.naturalWidth;
                                    const nHeight = imgRef.current.naturalHeight;
                                    const scaleX = (vWidth * 0.92) / nWidth;
                                    const scaleY = (vHeight * 0.92) / nHeight;
                                    setZoom(Math.min(scaleX, scaleY));
                                    setOffset({ x: 0, y: 0 });
                                }
                            }}
                            title="Auto-Fit Device to Viewport"
                        >
                            Reset View
                        </button>
                        <button
                            className={`omni-ai-btn ${loading ? 'pulse-premium' : ''}`}
                            onClick={performScan}
                            disabled={loading || (!sessionId && !udid)}
                            style={{ padding: '0 24px', minWidth: '160px' }}
                            title="Perform Deep Visual Scan"
                        >
                            <Target size={18} className={loading ? 'animate-pulse' : ''} />
                            {loading ? 'Analyzing...' : 'Refresh Scan'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="omni-inspector-body">
                {loading && (
                    <div className="omni-loading-overlay">
                        <div className="omni-spinner" />
                        <p className="pulse-text">Synchronizing Visual Assets...</p>
                    </div>
                )}

                {error && !loading && (
                    <div className="omni-error-view">
                        <XCircle size={48} color="#ef4444" />
                        <h3>Scan Interrupted</h3>
                        <p>{error}</p>
                        <div className="error-hint">
                            {error.includes('AI') ? (
                                <span>Tip: Connect an AI provider in Settings to enable high-fidelity insights.</span>
                            ) : (
                                <span>Tip: Ensure the device is connected and an Appium session is active.</span>
                            )}
                        </div>
                        <button className="omni-retry-btn" onClick={performScan}>
                            <RotateCw size={16} /> Try Again
                        </button>
                    </div>
                )}

                {!error && (
                    <>
                        {/* Panel 1: AI Sandbox (Left) */}
                        <div className={`omni-panel omni-panel-left ${leftCollapsed ? 'collapsed' : ''}`}>
                            <div className="omni-panel-toggle" onClick={() => setLeftCollapsed(!leftCollapsed)}>
                                {leftCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                            </div>
                            <div className="omni-panel-content">
                                <div className="omni-ai-panel">
                                    <div className="omni-ai-header">
                                        <Cpu size={14} />
                                        AI Locator Sandbox
                                        {!scanData?.ai_insights && (
                                            <Badge variant="secondary" className="ml-auto enterprise-badge-amber">
                                                Restricted Access
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="omni-ai-input-group elevation-clinical">
                                        <input
                                            className="omni-ai-input"
                                            placeholder="Search by text, icon, or intent..."
                                            value={aiQuery}
                                            onChange={(e) => setAiQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAiSearch()}
                                            disabled={!sessionId && !udid}
                                        />
                                        <button
                                            className="omni-ai-btn"
                                            onClick={handleAiSearch}
                                            disabled={testingAi || (!sessionId && !udid)}
                                            title="Execute AI Locator Test"
                                        >
                                            {testingAi ? <RotateCw size={14} className="animate-spin" /> : <Search size={16} />}
                                        </button>
                                    </div>

                                    {/* Example Chips */}
                                    <div className="omni-ai-examples">
                                        {['Login button', 'Settings icon', 'Contacts tab'].map(chip => (
                                            <button
                                                key={chip}
                                                className="omni-chip"
                                                onClick={() => setAiQuery(chip)}
                                                disabled={!sessionId && !udid}
                                            >
                                                {chip}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="enterprise-hint-box clinical-hint">
                                        <Info size={12} />
                                        <span>
                                            Enter natural language to identify complex UI elements.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Panel 2: Viewport (Center) */}
                        <div
                            className={`omni-viewport ${isPanning ? 'is-panning' : ''}`}
                            ref={viewportRef}
                            onWheel={handleWheel}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onClick={() => showHints && setShowHints(false)}
                            title="Scroll to Zoom | Drag to Pan"
                        >
                            {/* Floating Zoom Toolbar */}
                            <div className="omni-floating-toolbar animate-fade-in">
                                <button onClick={zoomToFit} title="Fit to Screen">Fit</button>
                                <button onClick={zoomToActual} title="100% Scale">1:1</button>
                                <div className="toolbar-divider" />
                                <button onClick={() => setZoom(z => Math.min(z * 1.2, 5))} title="Zoom In">+</button>
                                <button onClick={() => setZoom(z => Math.max(z * 0.8, 0.2))} title="Zoom Out">-</button>
                            </div>

                            {/* Contextual Hints */}
                            {showHints && !loading && screenshot && (
                                <div className="omni-context-hints animate-fade-out-delayed">
                                    <span>Click to inspect • Scroll to zoom • Drag to pan</span>
                                </div>
                            )}

                            {screenshot ? (
                                <div
                                    className="omni-hero-frame device-frame-glow animate-fade-in"
                                    style={{
                                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                                        maxHeight: '82%', /* Balanced hero sizing */
                                        maxWidth: '82%',
                                    }}
                                >
                                    <div className="device-frame-elite" />
                                    <div
                                        className="omni-screenshot-container"
                                        style={{
                                            aspectRatio: naturalDimensions.width > 0 ? `${naturalDimensions.width} / ${naturalDimensions.height}` : 'auto',
                                            height: naturalDimensions.width > 0 ? 'auto' : '100%',
                                            width: naturalDimensions.width > 0 ? 'auto' : '100%',
                                        }}
                                    >
                                        <img
                                            ref={imgRef}
                                            src={`data:image/png;base64,${screenshot}`}
                                            className="omni-screenshot hero-scaling"
                                            alt="Device Screen"
                                            draggable={false}
                                            onLoad={onImageLoad}
                                        />
                                        <div className="omni-overlay">
                                            {naturalDimensions.width > 0 && renderHighlights()}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                !loading && (
                                    <div className="omni-details-empty">
                                        <Layers size={48} />
                                        <p>Awaiting capture stream...</p>
                                    </div>
                                )
                            )}
                        </div>

                        {/* Panel 3: Element Details (Right) */}
                        <div className={`omni-panel omni-panel-right ${rightCollapsed ? 'collapsed' : ''}`}>
                            <div className="omni-panel-toggle" onClick={() => setRightCollapsed(!rightCollapsed)}>
                                {rightCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                            </div>
                            <div className="omni-panel-content">
                                <div className="omni-details-panel">
                                    {selectedElement ? (
                                        <div className="omni-element-card animate-fade-in" style={{ background: 'rgba(30, 41, 59, 0.4)', border: '1px solid var(--omni-border-elite)' }}>
                                            <div className="omni-ai-header omni-details-header" style={{ marginBottom: '16px' }}>
                                                <Layers size={14} />
                                                Element Intelligence
                                            </div>
                                            <div className="omni-section">
                                                <div className="omni-label">Detected Element</div>
                                                <div className="omni-value primary-value">
                                                    {selectedElement.text}
                                                </div>
                                            </div>

                                            <div className="omni-card-row-grid">
                                                <div className="omni-section">
                                                    <div className="omni-label">Confidence</div>
                                                    <Badge className="enterprise-badge-green">
                                                        {Math.round(selectedElement.confidence)}%
                                                    </Badge>
                                                </div>
                                                <div className="omni-section">
                                                    <div className="omni-label">Geometry</div>
                                                    <div className="omni-value secondary-value">
                                                        {Math.round((selectedElement.bbox.x0 + selectedElement.bbox.x1) / 2)} : {Math.round((selectedElement.bbox.y0 + selectedElement.bbox.y1) / 2)}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="omni-section">
                                                <div className="omni-label">Bounds</div>
                                                <div className="omni-value bounds-value">
                                                    [{selectedElement.bbox.x0}, {selectedElement.bbox.y0}, {selectedElement.bbox.x1}, {selectedElement.bbox.y1}]
                                                </div>
                                            </div>

                                            <div className="omni-action-cluster-vertical">
                                                <button
                                                    className="omni-tap-master-btn primary-action"
                                                    onClick={() => performTap(selectedElement)}
                                                >
                                                    <Target size={14} /> Tap Area
                                                </button>
                                                <button
                                                    className="omni-copy-btn secondary-action"
                                                    onClick={() => copyLocator(selectedElement)}
                                                >
                                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                                    Copy ID
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="omni-details-empty">
                                            <Info size={40} strokeWidth={1} style={{ opacity: 0.3 }} />
                                            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                                Select element to inspect diagnostic metadata.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default OmniInspector;

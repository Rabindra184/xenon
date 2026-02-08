import {
    Cpu, Layers, Copy, RotateCw, Check,
    ChevronRight, Target, ChevronDown, Box, Search, Layout, Grid3x3, MapPin,
    MousePointer2, Touchpad, ChevronUp, ChevronLeft, Clipboard
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import XenonApiService from '../../api-service';
import './omni-inspector.css';

export interface LocatorSuggestion {
    strategy: string;
    value: string;
    unique: boolean;
    score: number;
}

export interface InspectorNode {
    name: string;
    type: string;
    text?: string;
    label?: string;
    value?: string;
    rect: { x: number; y: number; width: number; height: number };
    xpath: string;
    suggestedLocators: LocatorSuggestion[];
    suggestedActions: any[];
    children: InspectorNode[];
    attributes: Record<string, any>;
}

export interface InspectorSnapshot {
    udid: string;
    platform: string;
    timestamp: string;
    screenshot: string;
    hierarchy: InspectorNode;
    metadata: { screenWidth: number; screenHeight: number; };
}

interface OmniInspectorProps {
    sessionId?: string | null;
    udid?: string | null;
    streamUrl?: string | null;  // MJPEG stream URL for live preview
}

const OmniInspector: React.FC<OmniInspectorProps> = ({ sessionId, udid, streamUrl }) => {
    const [loading, setLoading] = useState(true);
    const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedNode, setSelectedNode] = useState<InspectorNode | null>(null);
    const [hoveredNode, setHoveredNode] = useState<InspectorNode | null>(null);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['/']));
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedLocator, setCopiedLocator] = useState<string | null>(null);

    const [naturalDimensions, setNaturalDimensions] = useState({ width: 0, height: 0 });
    const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
    const [streamError, setStreamError] = useState(false);
    const [inspectorMode, setInspectorMode] = useState<'inspect' | 'interact'>('inspect');

    const containerRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const streamRef = useRef<HTMLImageElement>(null);

    // Interaction tracking
    const handleMouseDownRef = useRef<{ x: number; y: number; time: number } | null>(null);

    // Unified Dimension Logic (Corrected: Senior Reliability)
    const updateCanvasDimensions = useCallback(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const availableWidth = rect.width;
        const availableHeight = rect.height;

        const rootRect = snapshot?.hierarchy?.rect;
        let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width || 1;
        let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height || 1;

        if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
            deviceW = rootRect.width;
            deviceH = rootRect.height;
        }

        const deviceRatio = deviceW / deviceH;
        let width, height;

        if (availableWidth / availableHeight > deviceRatio) {
            height = availableHeight;
            width = height * deviceRatio;
        } else {
            width = availableWidth;
            height = width / deviceRatio;
        }
        setCanvasDimensions({ width, height });
    }, [snapshot, naturalDimensions]);

    useEffect(() => {
        updateCanvasDimensions();
        window.addEventListener('resize', updateCanvasDimensions);
        return () => window.removeEventListener('resize', updateCanvasDimensions);
    }, [updateCanvasDimensions]);

    useEffect(() => { if (udid) loadSnapshot(); }, [udid]);

    const loadSnapshot = async () => {
        if (!udid) return;
        setLoading(true);
        setError(null);
        try {
            const data = await XenonApiService.getInspectorSnapshot(udid);
            setSnapshot(data);
            // Auto-expand first 2 levels
            const expanded = new Set<string>(['/']);
            const expandLevel = (node: InspectorNode, level: number) => {
                if (level < 2) {
                    expanded.add(node.xpath);
                    node.children?.forEach(c => expandLevel(c, level + 1));
                }
            };
            if (data.hierarchy) expandLevel(data.hierarchy, 0);
            setExpandedNodes(expanded);
        } catch (err: any) {
            setError(err.message || 'Failed to capture snapshot');
        } finally {
            setLoading(false);
        }
    };

    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { naturalWidth, naturalHeight } = e.currentTarget;
        setNaturalDimensions({ width: naturalWidth, height: naturalHeight });
    };

    const onStreamError = () => {
        setStreamError(true);
    };

    const onStreamLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        setStreamError(false);
        const { naturalWidth, naturalHeight } = e.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) {
            setNaturalDimensions({ width: naturalWidth, height: naturalHeight });
        }
    };

    // Determine if we should use stream or screenshot
    const useStream = streamUrl && !streamError;

    // Interaction Handlers (Direct Device Control)
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (inspectorMode !== 'interact' || !udid) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        handleMouseDownRef.current = { x, y, time: Date.now() };
    };

    const handleMouseUp = async (e: React.MouseEvent<HTMLDivElement>) => {
        if (inspectorMode !== 'interact' || !udid || !handleMouseDownRef.current) return;

        const start = handleMouseDownRef.current;
        const rect = e.currentTarget.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        const timeDiff = Date.now() - start.time;

        const containerWidth = canvasDimensions.width;
        const containerHeight = canvasDimensions.height;

        const rootRect = snapshot?.hierarchy?.rect;
        let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width;
        let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height;

        if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
            deviceW = rootRect.width;
            deviceH = rootRect.height;
        }

        if (!deviceW || !deviceH || containerWidth === 0 || containerHeight === 0) {
            console.warn('Cannot interact: dimensions unknown', { deviceW, deviceH, containerWidth, containerHeight });
            return;
        }

        // Simplify Mapping: Wrapper now perfectly matches image ratio
        const mapToDevice = (vx: number, vy: number) => {
            const px = vx / containerWidth;
            const py = vy / containerHeight;

            return {
                x: Math.round(px * deviceW),
                y: Math.round(py * deviceH),
                px, py
            };
        };

        const startDevice = mapToDevice(start.x, start.y);
        const endDevice = mapToDevice(endX, endY);

        const viewportDistance = Math.sqrt(Math.pow(endX - start.x, 2) + Math.pow(endY - start.y, 2));

        console.log(`Interaction: mode=${inspectorMode}, time=${timeDiff}ms, vDist=${viewportDistance.toFixed(1)}px`);

        // Check if interaction is within device bounds (px/py between 0 and 1)
        if (startDevice.px < 0 || startDevice.px > 1 || startDevice.py < 0 || startDevice.py > 1) {
            console.warn('Interaction ignored: outside device bounds', { px: startDevice.px, py: startDevice.py });
            return;
        }

        try {
            if (timeDiff < 500 && viewportDistance < 10) {
                // Tap - use 10px viewport threshold
                console.log(`TAP at ${startDevice.x}, ${startDevice.y}`);
                await XenonApiService.tap(udid, startDevice.x, startDevice.y);
            } else if (timeDiff >= 500 && viewportDistance < 10) {
                // Touch and Hold
                console.log(`LONG PRESS at ${startDevice.x}, ${startDevice.y}`);
                await XenonApiService.touchAndHold(udid, startDevice.x, startDevice.y, timeDiff);
            } else if (viewportDistance >= 10) {
                // Swipe
                console.log(`SWIPE from ${startDevice.x},${startDevice.y} to ${endDevice.x},${endDevice.y}`);
                await XenonApiService.swipe(udid, startDevice.x, startDevice.y, endDevice.x, endDevice.y);
            }
        } catch (err) {
            console.error('Interaction failed:', err);
        }

        handleMouseDownRef.current = null;
    };

    const toggleExpand = (xpath: string) => {
        const next = new Set(expandedNodes);
        if (next.has(xpath)) next.delete(xpath); else next.add(xpath);
        setExpandedNodes(next);
    };

    const expandAll = () => {
        const all = new Set<string>();
        const collect = (n: InspectorNode) => { all.add(n.xpath); n.children?.forEach(collect); };
        if (snapshot?.hierarchy) collect(snapshot.hierarchy);
        setExpandedNodes(all);
    };

    const collapseAll = () => setExpandedNodes(new Set(['/']));

    const copyToClipboard = (text: string, strategy: string) => {
        navigator.clipboard.writeText(text);
        setCopiedLocator(strategy);
        setTimeout(() => setCopiedLocator(null), 2000);
    };

    const countNodes = (node: InspectorNode): number => {
        let count = 1;
        node.children?.forEach(c => count += countNodes(c));
        return count;
    };

    const getElementPath = (node: InspectorNode): string[] => {
        const parts = node.xpath.split('/').filter(Boolean);
        return parts.slice(-3);
    };

    const renderTree = (node: InspectorNode, depth = 0): React.ReactNode => {
        if (!node) return null;
        const isExpanded = expandedNodes.has(node.xpath);
        const hasChildren = node.children?.length > 0;
        const isSelected = selectedNode?.xpath === node.xpath;
        const isHovered = hoveredNode?.xpath === node.xpath;
        const displayName = node.name || node.type.split('.').pop() || 'Element';
        const matchesSearch = !searchQuery || displayName.toLowerCase().includes(searchQuery.toLowerCase()) || node.type.toLowerCase().includes(searchQuery.toLowerCase());

        if (!matchesSearch && !hasChildren) return null;

        return (
            <div key={node.xpath} className="tree-node">
                <div
                    className={`tree-item ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
                    onClick={() => setSelectedNode(node)}
                    onMouseEnter={() => setHoveredNode(node)}
                    onMouseLeave={() => setHoveredNode(null)}
                >
                    <div className="tree-item-indent" style={{ width: `${depth * 16}px` }} />
                    {hasChildren ? (
                        <button onClick={(e) => { e.stopPropagation(); toggleExpand(node.xpath); }} className="tree-toggle">
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                    ) : <span className="tree-toggle-spacer" />}
                    <Box size={12} className="tree-icon" />
                    <span className="tree-label">{displayName}</span>
                    {hasChildren && <span className="tree-badge">{node.children.length}</span>}
                </div>
                {isExpanded && hasChildren && (
                    <div className="tree-children">
                        {node.children.map(c => renderTree(c, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    const renderHighlights = (node: InspectorNode): React.ReactNode[] => {
        if (!naturalDimensions.width) return [];
        const nodes: React.ReactNode[] = [];
        const rootRect = snapshot?.hierarchy?.rect;
        let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width;
        let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height;

        if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
            deviceW = rootRect.width;
            deviceH = rootRect.height;
        }

        const processNode = (n: InspectorNode) => {
            if (n.rect?.width > 0 && n.rect?.height > 0) {
                nodes.push(
                    <div key={n.xpath} className="omni-hit-area" style={{
                        left: `${(n.rect.x / deviceW) * 100}%`,
                        top: `${(n.rect.y / deviceH) * 100}%`,
                        width: `${(n.rect.width / deviceW) * 100}%`,
                        height: `${(n.rect.height / deviceH) * 100}%`,
                    }}
                        onClick={(e) => { e.stopPropagation(); setSelectedNode(n); }}
                        onMouseEnter={() => setHoveredNode(n)}
                        onMouseLeave={() => setHoveredNode(null)}
                    />
                );
            }
            n.children?.forEach(processNode);
        };
        if (snapshot?.hierarchy) processNode(snapshot.hierarchy);
        return nodes;
    };

    const renderOverlayFrame = (node: InspectorNode | null, type: 'hover' | 'select') => {
        if (!node?.rect || !naturalDimensions.width) return null;
        const rootRect = snapshot?.hierarchy?.rect;
        let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width;
        let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height;

        if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
            deviceW = rootRect.width;
            deviceH = rootRect.height;
        }

        return (
            <div className={`omni-frame-${type}`} style={{
                left: `${(node.rect.x / deviceW) * 100}%`,
                top: `${(node.rect.y / deviceH) * 100}%`,
                width: `${(node.rect.width / deviceW) * 100}%`,
                height: `${(node.rect.height / deviceH) * 100}%`,
            }} />
        );
    };

    const totalElements = snapshot?.hierarchy ? countNodes(snapshot.hierarchy) : 0;

    return (
        <div className="omni-inspector-container">
            <div className="omni-main-content">
                {/* Left Panel: Device Preview */}
                <div className="omni-screenshot-panel">
                    <div className="omni-screenshot-header">
                        <div className="omni-header-left">
                            <span className="omni-screenshot-title">Device Preview</span>
                            <div className="omni-mode-toggle">
                                <button
                                    className={`omni-mode-btn ${inspectorMode === 'inspect' ? 'active' : ''}`}
                                    onClick={() => setInspectorMode('inspect')}
                                    title="Inspection Mode (Highlight Elements)"
                                >
                                    <MousePointer2 size={12} />
                                    <span>Inspect</span>
                                </button>
                                <button
                                    className={`omni-mode-btn ${inspectorMode === 'interact' ? 'active' : ''}`}
                                    onClick={() => setInspectorMode('interact')}
                                    title="Interaction Mode (Direct Control)"
                                >
                                    <Touchpad size={12} />
                                    <span>Interact</span>
                                </button>
                            </div>
                        </div>
                        <button className="omni-refresh-btn" onClick={loadSnapshot} disabled={loading}>
                            <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
                            {loading ? 'Capturing...' : 'Refresh'}
                        </button>
                    </div>

                    <div className="omni-screenshot-container" ref={containerRef}>
                        {loading && !useStream && (
                            <div className="omni-loading-overlay">
                                <div className="omni-spinner" />
                                <span>Capturing screen...</span>
                            </div>
                        )}

                        {!snapshot && !loading && !useStream && (
                            <div className="omni-empty-state">
                                <Target size={40} />
                                <span>Click Refresh to capture</span>
                            </div>
                        )}

                        {/* Direct Interaction Overlay Layer if needed, or put on wrapper */}
                        {useStream && (
                            <div
                                className={`omni-screenshot-wrapper ${inspectorMode === 'interact' ? 'interactable' : ''}`}
                                onMouseDown={handleMouseDown}
                                onMouseUp={handleMouseUp}
                            >
                                <img
                                    ref={streamRef}
                                    src={streamUrl!}
                                    onLoad={onStreamLoad}
                                    onError={onStreamError}
                                    className="omni-screenshot-img"
                                    style={inspectorMode === 'interact' ? { pointerEvents: 'none' } : {}}
                                    draggable={false}
                                    alt="Live Device Stream"
                                />
                                {snapshot?.hierarchy && inspectorMode === 'inspect' && (
                                    <div className="omni-overlay">
                                        {renderHighlights(snapshot.hierarchy)}
                                        {renderOverlayFrame(hoveredNode, 'hover')}
                                        {renderOverlayFrame(selectedNode, 'select')}
                                    </div>
                                )}
                            </div>
                        )}

                        {!useStream && snapshot?.screenshot && (
                            <div
                                className={`omni-screenshot-wrapper ${inspectorMode === 'interact' ? 'interactable' : ''}`}
                                onMouseDown={handleMouseDown}
                                onMouseUp={handleMouseUp}
                            >
                                <img
                                    ref={imgRef}
                                    src={`data:image/png;base64,${snapshot.screenshot}`}
                                    onLoad={onImageLoad}
                                    className="omni-screenshot-img"
                                    style={inspectorMode === 'interact' ? { pointerEvents: 'none' } : {}}
                                    draggable={false}
                                />
                                {inspectorMode === 'inspect' && (
                                    <div className="omni-overlay">
                                        {renderHighlights(snapshot.hierarchy)}
                                        {renderOverlayFrame(hoveredNode, 'hover')}
                                        {renderOverlayFrame(selectedNode, 'select')}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Center Panel: Source Tree */}
                <div className="omni-tree-panel">
                    <div className="omni-tree-header">
                        <div className="omni-tree-title">
                            <Layers size={14} />
                            <span>Source</span>
                            {totalElements > 0 && <span className="omni-count-badge">{totalElements} elements</span>}
                        </div>
                        <div className="omni-tree-actions">
                            <button onClick={expandAll} className="omni-action-btn" title="Expand All">
                                <Grid3x3 size={12} />
                            </button>
                            <button onClick={collapseAll} className="omni-action-btn" title="Collapse All">
                                <Layout size={12} />
                            </button>
                        </div>
                    </div>
                    <div className="omni-tree-search">
                        <Search size={14} />
                        <input
                            type="text"
                            placeholder="Filter elements..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="omni-clear-btn">×</button>
                        )}
                    </div>
                    <div className="omni-tree-content">
                        {snapshot?.hierarchy ? renderTree(snapshot.hierarchy) : (
                            <div className="omni-empty-state small">
                                <span>No hierarchy loaded</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Selected Element Details */}
                <div className="omni-details-panel">
                    <div className="omni-details-header">
                        <MapPin size={14} />
                        <span>Selected Element</span>
                    </div>
                    <div className="omni-details-content">
                        {selectedNode ? (
                            <>
                                <div className="omni-section">
                                    <div className="omni-section-header">Element Info</div>
                                    <div className="omni-info-table">
                                        <div className="omni-info-row">
                                            <span className="omni-info-key">Type</span>
                                            <span className="omni-info-value mono">{selectedNode.type}</span>
                                        </div>
                                        {selectedNode.text && (
                                            <div className="omni-info-row">
                                                <span className="omni-info-key">Text</span>
                                                <span className="omni-info-value">{selectedNode.text}</span>
                                            </div>
                                        )}
                                        <div className="omni-info-row">
                                            <span className="omni-info-key">Path</span>
                                            <span className="omni-info-value mono small">{getElementPath(selectedNode).join(' > ')}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="omni-section">
                                    <div className="omni-section-header">Layout</div>
                                    <div className="omni-layout-grid">
                                        <div className="omni-layout-item">
                                            <span className="omni-layout-label">X</span>
                                            <span className="omni-layout-value">{selectedNode.rect.x}</span>
                                        </div>
                                        <div className="omni-layout-item">
                                            <span className="omni-layout-label">Y</span>
                                            <span className="omni-layout-value">{selectedNode.rect.y}</span>
                                        </div>
                                        <div className="omni-layout-item">
                                            <span className="omni-layout-label">Width</span>
                                            <span className="omni-layout-value">{selectedNode.rect.width}</span>
                                        </div>
                                        <div className="omni-layout-item">
                                            <span className="omni-layout-label">Height</span>
                                            <span className="omni-layout-value">{selectedNode.rect.height}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="omni-section">
                                    <div className="omni-section-header">Locators</div>
                                    <div className="omni-locators-list">
                                        {selectedNode.suggestedLocators?.map(loc => (
                                            <div key={loc.strategy} className="omni-locator-row">
                                                <span className="omni-locator-strategy">{loc.strategy}</span>
                                                <code className="omni-locator-value">{loc.value}</code>
                                                <button
                                                    onClick={() => copyToClipboard(loc.value, loc.strategy)}
                                                    className={`omni-copy-btn ${copiedLocator === loc.strategy ? 'copied' : ''}`}
                                                >
                                                    {copiedLocator === loc.strategy ? <Check size={12} /> : <Copy size={12} />}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="omni-section">
                                    <div className="omni-section-header">Attributes</div>
                                    <div className="omni-attributes-table">
                                        {Object.entries(selectedNode.attributes || {}).filter(([_, v]) => v != null && v !== '').map(([key, value]) => (
                                            <div key={key} className="omni-attr-row">
                                                <span className="omni-attr-key">{key}</span>
                                                <span className="omni-attr-value">{String(value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="omni-empty-state">
                                <Target size={32} />
                                <span>Select an element from the tree or screenshot</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OmniInspector;

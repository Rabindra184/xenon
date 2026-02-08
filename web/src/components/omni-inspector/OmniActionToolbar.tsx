import React from 'react';
import { MousePointer2, MousePointerClick, Move, Video, Search } from 'lucide-react';
import { Badge } from '../ui/badge';

export type InspectorTool = 'select' | 'tap' | 'swipe' | 'record' | 'search';

interface OmniActionToolbarProps {
    activeTool: InspectorTool;
    onToolSelect: (tool: InspectorTool) => void;
    zoom: number;
}

const OmniActionToolbar: React.FC<OmniActionToolbarProps> = ({ activeTool, onToolSelect, zoom }) => {
    return (
        <div className="omni-viewport-toolbar glass-morphism elevation-premium">
            <div className="toolbar-group">
                <button
                    className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`}
                    onClick={() => onToolSelect('select')}
                    title="Select Element"
                >
                    <MousePointer2 size={18} />
                </button>
                <button
                    className={`tool-btn ${activeTool === 'tap' ? 'active' : ''}`}
                    onClick={() => onToolSelect('tap')}
                    title="Tap at Point"
                >
                    <MousePointerClick size={18} />
                </button>
                <button
                    className={`tool-btn ${activeTool === 'swipe' ? 'active' : ''}`}
                    onClick={() => onToolSelect('swipe')}
                    title="Swipe / Drag"
                >
                    <Move size={18} />
                </button>
            </div>

            <div className="toolbar-divider" />

            <div className="toolbar-group">
                <button
                    className={`tool-btn ${activeTool === 'search' ? 'active' : ''}`}
                    onClick={() => onToolSelect('search')}
                    title="Search Elements"
                >
                    <Search size={18} />
                </button>
                <button
                    className={`tool-btn ${activeTool === 'record' ? 'active' : ''}`}
                    onClick={() => onToolSelect('record')}
                    title="Record Session"
                >
                    <Video size={18} />
                </button>
            </div>

            <div className="toolbar-divider" />

            <div className="toolbar-info">
                <Badge variant="secondary" className="zoom-badge">
                    {Math.round(zoom * 100)}%
                </Badge>
            </div>
        </div>
    );
};

export default OmniActionToolbar;

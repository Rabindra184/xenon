import React, { useMemo, useState, useRef } from 'react';
import prettyMilliseconds from 'pretty-ms';
import { ISessionLog } from '../../interfaces/ISessionLog';
import { Clock, Activity } from 'lucide-react';

interface TraceWaterfallProps {
    logs: ISessionLog[];
    onCommandClick?: (logId: string) => void;
}

const TraceWaterfall: React.FC<TraceWaterfallProps> = ({ logs, onCommandClick }) => {
    const [scrubberPos, setScrubberPos] = useState<number | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);

    // Sort logs by creation time to ensure correct sequence
    const sortedLogs = useMemo(() => {
        return [...logs].sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeA - timeB;
        });
    }, [logs]);

    // Calculate total duration for scaling
    const timelineData = useMemo(() => {
        if (sortedLogs.length === 0) return null;

        const firstLog = sortedLogs[0];
        const sessionStart = new Date(firstLog.createdAt!).getTime();
        const lastLog = sortedLogs[sortedLogs.length - 1];
        const sessionEnd = new Date(lastLog.createdAt!).getTime() + (lastLog.duration || 100);
        const totalDuration = Math.max(sessionEnd - sessionStart, 1);

        return { sessionStart, totalDuration };
    }, [sortedLogs]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!bodyRef.current) return;
        const rect = bodyRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x >= 200) { // Only track in the bar area
            setScrubberPos(x - 200);
        } else {
            setScrubberPos(null);
        }
    };

    if (!timelineData || sortedLogs.length === 0) {
        return (
            <div className="waterfall-empty">
                <Activity size={48} className="empty-icon" />
                <p>Awaiting performance telemetry...</p>
            </div>
        );
    }

    const { sessionStart, totalDuration } = timelineData;

    return (
        <div className="waterfall-container elite-tier">
            <div className="waterfall-header">
                <div className="timeline-labels">
                    {[0, 20, 40, 60, 80, 100].map((percent) => (
                        <div key={percent} className="tick-label" style={{ left: `${percent}%` }}>
                            <span className="tick-mark" />
                            <span className="tick-text">{prettyMilliseconds((totalDuration * percent) / 100)}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div
                className="waterfall-body"
                ref={bodyRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setScrubberPos(null)}
            >
                {/* Timeline Grid System */}
                <div className="timeline-grid">
                    {[20, 40, 60, 80].map((percent) => (
                        <div key={percent} className="grid-line" style={{ left: `${percent}%` }} />
                    ))}
                    {scrubberPos !== null && (
                        <div className="scrubber-line" style={{ left: `${scrubberPos}px` }}>
                            <div className="scrubber-head" />
                        </div>
                    )}
                </div>

                {sortedLogs.map((log, index) => {
                    const logStart = new Date(log.createdAt!).getTime();
                    const startOffset = ((logStart - sessionStart) / totalDuration) * 100;
                    const durationWidth = ((log.duration || 10) / totalDuration) * 100;
                    const isSlow = log.duration && log.duration > 1500;

                    return (
                        <div
                            key={log.id}
                            className={`waterfall-row ${index % 2 === 0 ? 'even' : 'odd'}`}
                            onClick={() => onCommandClick?.(log.id)}
                        >
                            <div className="row-label">
                                <div className="command-meta">
                                    <span className={`method-badge ${log.method || 'POST'}`}>{log.method || 'POST'}</span>
                                    <span className="row-index">#{index + 1}</span>
                                </div>
                                <span className="command-name">{log.command_name}</span>
                            </div>
                            <div className="row-track">
                                <div
                                    className={`bar-container ${isSlow ? 'warning' : ''}`}
                                    style={{
                                        left: `${startOffset}%`,
                                        width: `${Math.max(durationWidth, 0.4)}%`,
                                    }}
                                >
                                    <div className="bar-glow" />
                                    <div className="bar-fill" />
                                    {durationWidth > 15 && (
                                        <div className="bar-info">
                                            <Clock size={10} />
                                            <span>{prettyMilliseconds(log.duration || 0)}</span>
                                        </div>
                                    )}
                                    {/* Tooltip trigger area */}
                                    <div className="bar-tooltip-anchor">
                                        <div className="custom-tooltip">
                                            <div className="tooltip-title">{log.command_name}</div>
                                            <div className="tooltip-row">
                                                <span>Duration:</span>
                                                <span className="value">{prettyMilliseconds(log.duration || 0)}</span>
                                            </div>
                                            {log.span_id && (
                                                <div className="tooltip-row">
                                                    <span>Span ID:</span>
                                                    <span className="value mono">{log.span_id.slice(0, 8)}...</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TraceWaterfall;

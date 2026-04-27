import * as React from 'react';
import { AnnotationOverlay, type NormalizedAnnotation } from './AnnotationOverlay';
import type { AnnotationShape } from './recording-group-store';

interface Props {
  udid: string;
  mjpegPort: number;
  recordingId?: string;
  annotateMode: boolean;
  shape: AnnotationShape;
  color: string;
  onAnnotation: (recordingId: string, ann: NormalizedAnnotation) => void;
}

export function DeviceTile({
  udid,
  mjpegPort,
  recordingId,
  annotateMode,
  shape,
  color,
  onAnnotation,
}: Props) {
  // The MJPEG server runs on the same host as the dashboard; use the current
  // page's hostname so this works whether you're on localhost or a remote hub.
  const url = `http://${window.location.hostname}:${mjpegPort}/`;
  const recording = !!recordingId;
  return (
    <div className="relative bg-black rounded overflow-hidden border border-[var(--border)]">
      <img
        src={url}
        alt={udid}
        style={{ width: '100%', display: 'block', objectFit: 'contain', aspectRatio: '9/16' }}
      />
      {recording && annotateMode && (
        <AnnotationOverlay
          enabled
          shape={shape}
          color={color}
          onCommit={(a) =>
            onAnnotation(recordingId!, a)
          }
        />
      )}
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
        {recording && (
          <span className="px-1.5 py-0.5 rounded bg-red-600/90 text-white">● REC</span>
        )}
        <span className="px-1.5 py-0.5 rounded bg-black/60 text-white/90">{udid}</span>
      </div>
    </div>
  );
}

import * as React from 'react';
import type { Layout, MosaicTile, AnnotationShape } from './recording-group-store';
import { DeviceTile } from './DeviceTile';
import type { NormalizedAnnotation } from './AnnotationOverlay';

const COLS: Record<Layout, string> = {
  '1': '1fr',
  '2x1': '1fr 1fr',
  '2x2': '1fr 1fr',
  '3x2': '1fr 1fr 1fr',
};
const ROWS: Record<Layout, string> = {
  '1': '1fr',
  '2x1': '1fr',
  '2x2': '1fr 1fr',
  '3x2': '1fr 1fr',
};

interface Props {
  layout: Layout;
  tiles: MosaicTile[];
  annotateMode: boolean;
  shape: AnnotationShape;
  color: string;
  onAnnotation: (recordingId: string, ann: NormalizedAnnotation) => void;
}

export function DeviceMosaic({
  layout,
  tiles,
  annotateMode,
  shape,
  color,
  onAnnotation,
}: Props) {
  if (tiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-dim)]">
        Pick devices from the panel and click "Add to mosaic" to start viewing.
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: COLS[layout],
        gridTemplateRows: ROWS[layout],
      }}
      className="h-full"
    >
      {tiles.map((t) => (
        <DeviceTile
          key={t.udid}
          udid={t.udid}
          mjpegPort={t.mjpegPort}
          recordingId={t.recordingId}
          annotateMode={annotateMode}
          shape={shape}
          color={color}
          onAnnotation={onAnnotation}
        />
      ))}
    </div>
  );
}

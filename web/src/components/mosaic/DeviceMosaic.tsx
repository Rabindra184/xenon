import * as React from 'react';
import {
  effectiveLayout,
  type Layout,
  type MosaicTile,
  type AnnotationShape,
} from './recording-group-store';
import { DeviceTile } from './DeviceTile';
import type { NormalizedAnnotation } from './AnnotationOverlay';

const COLS: Record<Exclude<Layout, 'auto'>, string> = {
  '1': '1fr',
  '2x1': '1fr 1fr',
  '2x2': '1fr 1fr',
  '3x2': '1fr 1fr 1fr',
};
const ROWS: Record<Exclude<Layout, 'auto'>, string> = {
  '1': '1fr',
  '2x1': '1fr',
  '2x2': '1fr 1fr',
  '3x2': '1fr 1fr',
};
const CELL_COUNT: Record<Exclude<Layout, 'auto'>, number> = {
  '1': 1,
  '2x1': 2,
  '2x2': 4,
  '3x2': 6,
};

interface Props {
  layout: Layout;
  tiles: MosaicTile[];
  annotateMode: boolean;
  shape: AnnotationShape;
  color: string;
  onAnnotation: (recordingId: string, ann: NormalizedAnnotation) => void;
  onRemove?: (udid: string) => void;
  /** Called when a device row from the picker is dropped on an empty cell. */
  onDropDevice?: (udid: string) => void;
}

export function DeviceMosaic({
  layout,
  tiles,
  annotateMode,
  shape,
  color,
  onAnnotation,
  onRemove,
  onDropDevice,
}: Props) {
  const eff = effectiveLayout(layout, tiles.length);
  const cells = CELL_COUNT[eff];

  if (tiles.length === 0 && layout !== 'auto') {
    // Layout is fixed (e.g. user picked 2×2) but no tiles yet — render the
    // empty placeholders so the user sees the grid shape and can drag/drop.
  }

  // Build the cell list: tiles first (in order), then empty placeholders to
  // fill the grid. In `auto` mode there are no extra placeholders — the grid
  // sizes itself to the tile count.
  const filledCount = tiles.length;
  const totalCells = layout === 'auto' ? Math.max(filledCount, 1) : cells;
  const placeholderCount = Math.max(0, totalCells - filledCount);

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: COLS[eff],
        gridTemplateRows: ROWS[eff],
      }}
      className="h-full"
    >
      {tiles.map((t) => (
        <DeviceTile
          key={t.udid}
          udid={t.udid}
          name={t.name}
          mjpegPort={t.mjpegPort}
          recordingId={t.recordingId}
          aspect={t.aspect}
          screenWidth={t.screenWidth}
          screenHeight={t.screenHeight}
          platform={t.platform}
          annotateMode={annotateMode}
          shape={shape}
          color={color}
          onAnnotation={onAnnotation}
          onRemove={onRemove}
        />
      ))}
      {Array.from({ length: placeholderCount }, (_, i) => (
        <EmptyCell key={`empty-${i}`} onDropDevice={onDropDevice} />
      ))}
    </div>
  );
}

function EmptyCell({ onDropDevice }: { onDropDevice?: (udid: string) => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!onDropDevice) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!hover) setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        setHover(false);
        if (!onDropDevice) return;
        e.preventDefault();
        const udid =
          e.dataTransfer.getData('application/x-xenon-udid') ||
          e.dataTransfer.getData('text/plain');
        if (udid) onDropDevice(udid);
      }}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed transition-colors ${
        hover
          ? 'border-emerald-500/60 bg-emerald-500/5'
          : 'border-[var(--border)] bg-[var(--surface-1,rgba(255,255,255,0.02))]'
      } text-[var(--text-dim)] min-h-[120px]`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xl ${
          hover ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-white/60'
        }`}
      >
        +
      </div>
      <div className="text-xs font-medium">Drag device here</div>
      <div className="text-[10px] opacity-70">or click one in the panel</div>
    </div>
  );
}

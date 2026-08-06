import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { AnnotationShape, OverlayAnnotation } from './recording-group-store';

export type NormalizedAnnotation = OverlayAnnotation;

interface Props {
  enabled: boolean;
  shape: AnnotationShape;
  color: string;
  onCommit: (a: NormalizedAnnotation) => void;
  /** Survives remounts when the parent keeps this list (keyed by recording). */
  committed?: NormalizedAnnotation[];
  onCommittedChange?: (next: NormalizedAnnotation[]) => void;
}

interface DragState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

function withAlpha(color: string, alpha: number): string {
  const c = (color || '#ff3333').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return c;
}

/**
 * Draw a committed / in-progress annotation onto a 2d canvas using normalized
 * geometry (0..1) relative to the canvas size. Uses a bright fill + thick
 * outline so strokes stay visible over live device video.
 */
export function paintAnnotation(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  ann: NormalizedAnnotation,
): void {
  const g = ann.geometry;
  const color = ann.color || '#ff3333';
  const stroke = Math.max(4, Math.round(Math.min(canvasW, canvasH) * 0.008));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (ann.shape === 'CIRCLE') {
    const cx = (g.x ?? 0) * canvasW;
    const cy = (g.y ?? 0) * canvasH;
    const rx = Math.max(2, (g.w ?? 0) * canvasW);
    const ry = Math.max(2, (g.h ?? 0) * canvasH);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(color, 0.22);
    ctx.fill();
    ctx.lineWidth = stroke + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.lineWidth = stroke;
    ctx.strokeStyle = color;
    ctx.stroke();
    return;
  }

  if (ann.shape === 'ARROW') {
    const x0 = (g.x ?? 0) * canvasW;
    const y0 = (g.y ?? 0) * canvasH;
    const x1 = x0 + (g.w ?? 0) * canvasW;
    const y1 = y0 + (g.h ?? 0) * canvasH;
    ctx.lineWidth = stroke + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.lineWidth = stroke;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = Math.max(14, stroke * 3);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(angle - 0.4), y1 - head * Math.sin(angle - 0.4));
    ctx.lineTo(x1 - head * Math.cos(angle + 0.4), y1 - head * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (ann.shape === 'TEXT' && ann.text) {
    const size = Math.max(16, Math.round(Math.min(canvasW, canvasH) * 0.035));
    ctx.font = `bold ${size}px sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(ann.text, (g.x ?? 0) * canvasW, (g.y ?? 0) * canvasH);
    ctx.fillStyle = color;
    ctx.fillText(ann.text, (g.x ?? 0) * canvasW, (g.y ?? 0) * canvasH);
    return;
  }

  // RECT + FREEHAND
  const x = (g.x ?? 0) * canvasW;
  const y = (g.y ?? 0) * canvasH;
  const w = Math.max(2, (g.w ?? 0) * canvasW);
  const h = Math.max(2, (g.h ?? 0) * canvasH);
  ctx.fillStyle = withAlpha(color, 0.22);
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = stroke + 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = stroke;
  ctx.strokeStyle = color;
  ctx.strokeRect(x, y, w, h);
}

function annotationFromDrag(
  shape: AnnotationShape,
  color: string,
  drag: DragState,
  canvasW: number,
  canvasH: number,
): NormalizedAnnotation | null {
  if (canvasW <= 0 || canvasH <= 0) return null;
  if (shape === 'CIRCLE') {
    const rPx = Math.hypot(drag.curX - drag.startX, drag.curY - drag.startY);
    if (rPx <= 4) return null;
    return {
      shape,
      color,
      geometry: {
        x: drag.startX / canvasW,
        y: drag.startY / canvasH,
        w: rPx / canvasW,
        h: rPx / canvasH,
      },
    };
  }
  if (shape === 'ARROW') {
    const dx = drag.curX - drag.startX;
    const dy = drag.curY - drag.startY;
    if (Math.hypot(dx, dy) <= 6) return null;
    return {
      shape,
      color,
      geometry: {
        x: drag.startX / canvasW,
        y: drag.startY / canvasH,
        w: dx / canvasW,
        h: dy / canvasH,
      },
    };
  }
  const x0 = Math.min(drag.startX, drag.curX) / canvasW;
  const y0 = Math.min(drag.startY, drag.curY) / canvasH;
  const w = Math.abs(drag.curX - drag.startX) / canvasW;
  const h = Math.abs(drag.curY - drag.startY) / canvasH;
  if (w <= 0.005 || h <= 0.005) return null;
  return { shape, color, geometry: { x: x0, y: y0, w, h } };
}

export function AnnotationOverlay({
  enabled,
  shape,
  color,
  onCommit,
  committed: controlledCommitted,
  onCommittedChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [localCommitted, setLocalCommitted] = useState<NormalizedAnnotation[]>([]);
  const committed = controlledCommitted ?? localCommitted;

  // Refs so ResizeObserver / paint always see the latest strokes (setting
  // canvas.width clears the bitmap; a stale redraw with [] looked like
  // annotations "vanishing immediately").
  const committedRef = useRef(committed);
  const dragRef = useRef(drag);
  const shapeRef = useRef(shape);
  const colorRef = useRef(color);
  const enabledRef = useRef(enabled);
  committedRef.current = committed;
  dragRef.current = drag;
  shapeRef.current = shape;
  colorRef.current = color;
  enabledRef.current = enabled;

  const setCommitted = React.useCallback(
    (updater: (prev: NormalizedAnnotation[]) => NormalizedAnnotation[]) => {
      const next = updater(committedRef.current);
      committedRef.current = next;
      if (onCommittedChange) onCommittedChange(next);
      else setLocalCommitted(next);
    },
    [onCommittedChange],
  );

  const paint = React.useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const a of committedRef.current) {
      paintAnnotation(ctx, c.width, c.height, a);
    }
    const d = dragRef.current;
    if (d) {
      const live = annotationFromDrag(shapeRef.current, colorRef.current, d, c.width, c.height);
      if (live) paintAnnotation(ctx, c.width, c.height, live);
    }
  }, []);

  // Size the canvas to its CSS box. Always re-paint from refs afterward —
  // assigning width/height wipes the bitmap.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      const w = Math.max(1, Math.round(c.clientWidth));
      const h = Math.max(1, Math.round(c.clientHeight));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      paint();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [paint]);

  useEffect(() => {
    paint();
  }, [drag, committed, paint]);

  // Leaving annotate mid-drag must drop capture so tap/swipe can resume.
  useEffect(() => {
    if (enabled) return;
    setDrag(null);
    const c = canvasRef.current;
    if (c && (c as any).hasPointerCapture) {
      try {
        // Release any active captures on this element.
        for (let id = 0; id < 8; id++) {
          if (c.hasPointerCapture?.(id)) c.releasePointerCapture(id);
        }
      } catch {
        /* ignore */
      }
    }
  }, [enabled]);

  const localPoint = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
  };

  const finishDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !enabledRef.current) {
      setDrag(null);
      return;
    }
    const c = canvasRef.current;
    if (!c || c.width <= 0) {
      setDrag(null);
      return;
    }
    const n = localPoint(e);
    const ann = annotationFromDrag(
      shapeRef.current,
      colorRef.current,
      { ...d, curX: n.px, curY: n.py },
      n.w,
      n.h,
    );
    if (ann) {
      setCommitted((prev) => [...prev, ann]);
      onCommit(ann);
    }
    setDrag(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const n = localPoint(e);
    setDrag({ startX: n.px, startY: n.py, curX: n.px, curY: n.py });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const n = localPoint(e);
    setDrag((prev) => (prev ? { ...prev, curX: n.px, curY: n.py } : prev));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    finishDrag(e);
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        // When disabled, must not intercept taps — interaction layer sits below
        // and needs the events after Annotate is toggled off.
        pointerEvents: enabled ? 'auto' : 'none',
        cursor: enabled ? 'crosshair' : 'default',
        // Below interaction (z-35) when idle; above video so strokes stay visible.
        zIndex: enabled ? 40 : 25,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

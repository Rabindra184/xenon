import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { AnnotationShape, OverlayAnnotation } from './recording-group-store';
import { rasterizeAnnotation } from './rasterizeAnnotation';

export type NormalizedAnnotation = OverlayAnnotation;

interface Props {
  enabled: boolean;
  shape: AnnotationShape;
  color: string;
  /** `image` is the mark rendered as the preview draws it; null if it could not be. */
  onCommit: (a: NormalizedAnnotation, image: string | null) => void;
  /** Survives remounts when the parent keeps this list (keyed by recording). */
  committed?: NormalizedAnnotation[];
  onCommittedChange?: (next: NormalizedAnnotation[]) => void;
  /**
   * Width / height of the video picture. The tile can be letterboxed (screen
   * size not reported yet, a landscape app), and marks must be measured
   * against the picture that gets recorded, not the black bars around it.
   */
  mediaAspect?: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where `object-fit: contain` puts a picture of `aspect` inside a box. */
export function fitContain(boxW: number, boxH: number, aspect: number | undefined): Box {
  const full = { left: 0, top: 0, width: boxW, height: boxH };
  if (!aspect || !(aspect > 0) || boxW <= 0 || boxH <= 0) return full;
  const boxAspect = boxW / boxH;
  if (Math.abs(boxAspect - aspect) < 1e-6) return full;
  if (aspect > boxAspect) {
    const height = boxW / aspect;
    return { left: 0, top: (boxH - height) / 2, width: boxW, height };
  }
  const width = boxH * aspect;
  return { left: (boxW - width) / 2, top: 0, width, height: boxH };
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height);

interface DragState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  /** Pointer path in canvas px; only FREEHAND uses it. */
  points: Array<[number, number]>;
}

const MIN_POINT_DIST = 2;
const MAX_POINTS = 2000;

/** Append a freehand point, dropping jitter under 2px and capping the path. */
export function appendPoint(
  points: Array<[number, number]>,
  x: number,
  y: number,
): Array<[number, number]> {
  if (points.length >= MAX_POINTS) return points;
  const last = points[points.length - 1];
  if (last && Math.hypot(x - last[0], y - last[1]) < MIN_POINT_DIST) return points;
  return [...points, [x, y]];
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

  if (ann.shape === 'FREEHAND' && (g.points?.length ?? 0) >= 2) {
    const pts = g.points!;
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * canvasW, pts[0][1] * canvasH);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * canvasW, pts[i][1] * canvasH);
    };
    ctx.lineWidth = stroke + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    trace();
    ctx.stroke();
    ctx.lineWidth = stroke;
    ctx.strokeStyle = color;
    trace();
    ctx.stroke();
    return;
  }

  // RECT, and FREEHAND rows saved before paths existed
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
  if (shape === 'FREEHAND') {
    if (drag.points.length < 2) return null;
    const xs = drag.points.map((p) => p[0]);
    const ys = drag.points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      shape,
      color,
      geometry: {
        // Bounding box: what the drawbox fallback and older readers use.
        x: minX / canvasW,
        y: minY / canvasH,
        w: Math.max(0.005, (Math.max(...xs) - minX) / canvasW),
        h: Math.max(0.005, (Math.max(...ys) - minY) / canvasH),
        points: drag.points.map(([px, py]) => [px / canvasW, py / canvasH] as [number, number]),
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
  mediaAspect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [localCommitted, setLocalCommitted] = useState<NormalizedAnnotation[]>([]);
  const [box, setBox] = useState<Box | null>(null);
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

  // Cover the video picture, not the whole tile: re-fit whenever the tile
  // resizes or the stream's frame shape changes.
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const place = () => {
      const next = mediaAspect
        ? fitContain(parent.clientWidth, parent.clientHeight, mediaAspect)
        : null;
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [mediaAspect]);

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
      { ...d, curX: n.px, curY: n.py, points: appendPoint(d.points, n.px, n.py) },
      n.w,
      n.h,
    );
    if (ann) {
      setCommitted((prev) => [...prev, ann]);
      onCommit(ann, rasterizeAnnotation(ann, n.w, n.h));
    }
    setDrag(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const n = localPoint(e);
    setDrag({ startX: n.px, startY: n.py, curX: n.px, curY: n.py, points: [[n.px, n.py]] });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const n = localPoint(e);
    setDrag((prev) =>
      prev
        ? { ...prev, curX: n.px, curY: n.py, points: appendPoint(prev.points, n.px, n.py) }
        : prev,
    );
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
        ...(box
          ? {
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
            }
          : {
              inset: 0,
              // A canvas is a replaced element: `inset` alone leaves it at its
              // intrinsic 300x150, so geometry was normalized to that band
              // instead of the tile and landed in the wrong place in the video.
              width: '100%',
              height: '100%',
            }),
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

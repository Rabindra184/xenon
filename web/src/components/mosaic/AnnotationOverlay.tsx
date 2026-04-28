import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { AnnotationShape } from './recording-group-store';

export interface NormalizedAnnotation {
  shape: AnnotationShape;
  geometry: { x: number; y: number; w?: number; h?: number };
  color: string;
  text?: string;
}

interface Props {
  enabled: boolean;
  shape: AnnotationShape;
  color: string;
  onCommit: (a: NormalizedAnnotation) => void;
}

interface DragState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

export function AnnotationOverlay({ enabled, shape, color, onCommit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // Resize canvas to match its rendered size so 1 css px = 1 canvas px.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      c.width = c.clientWidth;
      c.height = c.clientHeight;
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw the live drag rectangle as the user drags.
  const redraw = React.useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!drag) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    if (shape === 'RECT' || shape === 'ARROW' || shape === 'FREEHAND') {
      ctx.strokeRect(
        Math.min(drag.startX, drag.curX),
        Math.min(drag.startY, drag.curY),
        Math.abs(drag.curX - drag.startX),
        Math.abs(drag.curY - drag.startY),
      );
    } else if (shape === 'CIRCLE') {
      const r = Math.hypot(drag.curX - drag.startX, drag.curY - drag.startY);
      ctx.beginPath();
      ctx.arc(drag.startX, drag.startY, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [drag, color, shape]);

  useEffect(() => {
    redraw();
  }, [drag, redraw]);

  const norm = (e: React.MouseEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top, w: rect.width, h: rect.height };
  };

  const onDown = (e: React.MouseEvent) => {
    if (!enabled) return;
    const n = norm(e);
    setDrag({ startX: n.px, startY: n.py, curX: n.px, curY: n.py });
  };

  const onMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const n = norm(e);
    setDrag({ ...drag, curX: n.px, curY: n.py });
  };

  const onUp = (e: React.MouseEvent) => {
    if (!drag || !enabled) return;
    const n = norm(e);
    const x0 = Math.min(drag.startX, n.px) / n.w;
    const y0 = Math.min(drag.startY, n.py) / n.h;
    const w = Math.abs(n.px - drag.startX) / n.w;
    const h = Math.abs(n.py - drag.startY) / n.h;
    if (w > 0.005 && h > 0.005) {
      onCommit({ shape, color, geometry: { x: x0, y: y0, w, h } });
    }
    setDrag(null);
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: enabled ? 'auto' : 'none',
        cursor: enabled ? 'crosshair' : 'default',
      }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={() => setDrag(null)}
    />
  );
}

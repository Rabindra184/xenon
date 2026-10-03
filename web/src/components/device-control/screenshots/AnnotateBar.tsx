import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import type { AnnotationShape } from '../../mosaic/recording-group-store';

export const ANNOTATE_SHAPES: Array<{ id: AnnotationShape; label: string }> = [
  { id: 'RECT', label: 'Rect' },
  { id: 'CIRCLE', label: 'Circle' },
  { id: 'ARROW', label: 'Arrow' },
  { id: 'FREEHAND', label: 'Draw' },
];

interface Props {
  shape: AnnotationShape;
  color: string;
  marks: number;
  saving: boolean;
  onShape: (s: AnnotationShape) => void;
  onColor: (c: string) => void;
  onUndo: () => void;
  onClear: () => void;
  onCancel: () => void;
  onSave: () => void;
}

/** The tool row while drawing on a capture. The marks go on a copy; the original stays. */
export function AnnotateBar({
  shape,
  color,
  marks,
  saving,
  onShape,
  onColor,
  onUndo,
  onClear,
  onCancel,
  onSave,
}: Props) {
  return (
    <div className="shots-actions" role="toolbar" aria-label="Annotate">
      <div className="shots-shapes">
        {ANNOTATE_SHAPES.map((s) => (
          <Button
            key={s.id}
            variant="secondary"
            size="sm"
            aria-pressed={shape === s.id}
            className={shape === s.id ? 'is-pressed' : undefined}
            onClick={() => onShape(s.id)}
          >
            {s.label}
          </Button>
        ))}
        <input
          type="color"
          className="shots-color"
          value={color}
          onChange={(e) => onColor(e.target.value)}
          aria-label="Mark colour"
          title="Mark colour"
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onUndo} disabled={!marks || saving}>
        Undo mark
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear} disabled={!marks || saving}>
        Clear marks
      </Button>
      <span className="shots-actions-gap" />
      <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      <Button size="sm" onClick={onSave} disabled={!marks || saving}>
        {saving && <Loader2 className="animate-spin" size={13} aria-hidden="true" />}
        Save copy
      </Button>
    </div>
  );
}

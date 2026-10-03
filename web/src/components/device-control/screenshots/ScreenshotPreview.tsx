import * as React from 'react';
import { AnnotationOverlay, type NormalizedAnnotation } from '../../mosaic/AnnotationOverlay';
import type { AnnotationShape } from '../../mosaic/recording-group-store';
import { captureLabel, detailsLine } from './captureMeta';
import type { Capture } from './useScreenshots';

interface PictureProps {
  capture: Capture;
  actualSize?: boolean;
  onToggleSize?: () => void;
  annotate?: {
    shape: AnnotationShape;
    color: string;
    marks: NormalizedAnnotation[];
    onMarksChange: (next: NormalizedAnnotation[]) => void;
  };
}

/** One capture, fitted to its area, or 1:1 in a scrolling one. */
export function ScreenshotPicture({ capture, actualSize, onToggleSize, annotate }: PictureProps) {
  const aspect = capture.width && capture.height ? capture.width / capture.height : undefined;
  return (
    <div className={`shots-picture${actualSize && !annotate ? ' is-actual' : ''}`}>
      <div className="shots-picture-frame">
        <img
          src={capture.url}
          alt={captureLabel(capture)}
          draggable={false}
          onClick={annotate ? undefined : onToggleSize}
          className={onToggleSize && !annotate ? 'is-zoomable' : undefined}
        />
        {annotate && (
          <AnnotationOverlay
            enabled
            shape={annotate.shape}
            color={annotate.color}
            committed={annotate.marks}
            onCommittedChange={annotate.onMarksChange}
            onCommit={() => undefined}
            mediaAspect={aspect}
          />
        )}
      </div>
    </div>
  );
}

interface CompareProps {
  a: Capture;
  b: Capture | null;
}

/** Two captures side by side (one above the other in a narrow panel), each with its line. */
export function ScreenshotCompare({ a, b }: CompareProps) {
  return (
    <div className="shots-compare">
      {[a, b].map((c, i) => (
        <figure key={i} className="shots-compare-side">
          <span className="shots-compare-tag" aria-hidden="true">
            {i === 0 ? 'A' : 'B'}
          </span>
          {c ? (
            <>
              <ScreenshotPicture capture={c} />
              <figcaption className="shots-details">{detailsLine(c)}</figcaption>
            </>
          ) : (
            <p className="shots-compare-empty">Pick a screenshot in the list to compare with.</p>
          )}
        </figure>
      ))}
    </div>
  );
}

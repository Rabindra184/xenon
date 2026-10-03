import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Columns2,
  Copy,
  Download,
  FolderDown,
  Loader2,
  Maximize2,
  Minimize2,
  PenLine,
  Trash2,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { useToast } from '../../ui/toast';
import type { NormalizedAnnotation } from '../../mosaic/AnnotationOverlay';
import { initialMosaicState, type AnnotationShape } from '../../mosaic/recording-group-store';
import { failed } from '../actionMessages';
import { AnnotateBar } from './AnnotateBar';
import { captureFilename, captureLabel, detailsLine, zipFilename } from './captureMeta';
import { copyImage } from './copyImage';
import { capturesZip, saveBlob } from './downloadAll';
import { flattenMarks } from './imageTools';
import { ScreenshotCompare, ScreenshotPicture } from './ScreenshotPreview';
import { ScreenshotRail } from './ScreenshotRail';
import { MAX_KEPT, useScreenshots } from './useScreenshots';
import type { ScreenshotStore } from './screenshotStore';
import './screenshots.css';

interface Props {
  udid: string;
  /** The name its Devices card shows, for file names. */
  deviceName: string;
  /** Tests only: where captures are kept. */
  openStore?: () => Promise<ScreenshotStore>;
}

type Mode = 'view' | 'compare' | 'annotate';

/** Device control's Screenshot tab. */
export function ScreenshotsPanel({ udid, deviceName, openStore }: Props) {
  const { toast } = useToast();
  const shots = useScreenshots(udid, openStore);
  const { captures, selectedId, select } = shots;
  const selected = captures.find((c) => c.id === selectedId) ?? null;

  const [mode, setMode] = useState<Mode>('view');
  const [compareB, setCompareB] = useState<string | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const [shape, setShape] = useState<AnnotationShape>('RECT');
  const [color, setColor] = useState(initialMosaicState.color);
  const [marks, setMarks] = useState<NormalizedAnnotation[]>([]);
  const [saving, setSaving] = useState(false);
  const [zipping, setZipping] = useState(false);

  const leave = useCallback(() => {
    setMode('view');
    setMarks([]);
    setCompareB(null);
  }, []);

  // A side that was deleted ends the comparison; a deleted original ends annotate.
  useEffect(() => {
    if (mode === 'view') return;
    if (!selected) leave();
    else if (mode === 'compare' && compareB && !captures.some((c) => c.id === compareB))
      setCompareB(null);
  }, [mode, selected, compareB, captures, leave]);

  // Esc leaves compare and annotate. A native listener on the panel, not
  // React's onKeyDown: React 17 runs that from the app's root, after device
  // control's InPlaceDialog has seen the key and closed device control.
  const rootRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || modeRef.current === 'view') return;
      e.preventDefault();
      leave();
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [leave]);

  const pick = (id: string) => {
    if (mode === 'compare') {
      if (id !== selectedId) setCompareB(id);
      return;
    }
    if (mode === 'annotate' && id !== selectedId) leave();
    select(id);
  };

  const startCompare = () => {
    if (!selected) return;
    const i = captures.indexOf(selected);
    const other = captures[i + 1] ?? captures[i - 1] ?? null;
    setMarks([]);
    setCompareB(other?.id ?? null);
    setMode('compare');
  };

  const copy = async () => {
    if (!selected) return;
    if (await copyImage(selected.png)) toast(`Copied ${captureLabel(selected)}`, 'success');
    else toast('Your browser can’t copy pictures on this address. Use Download instead.', 'error');
  };

  const download = () => {
    if (selected) saveBlob(selected.png, captureFilename(deviceName, selected));
  };

  const downloadAll = async () => {
    setZipping(true);
    try {
      saveBlob(await capturesZip(deviceName, captures), zipFilename(deviceName));
    } catch (err) {
      toast(failed('make the zip', err), 'error');
    } finally {
      setZipping(false);
    }
  };

  const saveCopy = async () => {
    if (!selected || !marks.length) return;
    setSaving(true);
    try {
      const png = await flattenMarks(selected.png, marks);
      await shots.addMarkedCopy(selected, png);
      toast(`Saved a marked copy of ${captureLabel(selected)}`, 'success');
      leave();
    } catch (err) {
      toast(failed('save the marked copy', err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const count = captures.length;
  const kept = !shots.persistent
    ? 'Kept until you leave this page'
    : count >= MAX_KEPT
      ? `${count} of ${MAX_KEPT} kept · the oldest goes when you take another`
      : `${count} of ${MAX_KEPT} kept`;
  const compareSide = captures.find((c) => c.id === compareB) ?? null;

  return (
    <div ref={rootRef} className="shots-root">
      <header className="shots-head">
        <h4 className="shots-title">
          <Camera size={14} aria-hidden="true" />
          Screenshots
        </h4>
        {shots.ready && (
          <span
            className="shots-kept"
            title={
              shots.persistent
                ? 'This browser keeps the newest 50 screenshots of each phone.'
                : 'This browser isn’t saving screenshots here, for example in a private window.'
            }
          >
            {kept}
          </span>
        )}
        <span className="shots-actions-gap" />
        {mode === 'compare' ? (
          <Button variant="secondary" size="sm" onClick={leave}>
            Done
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={startCompare}
            disabled={count < 2 || mode === 'annotate'}
          >
            <Columns2 size={13} aria-hidden="true" />
            Compare
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={downloadAll} disabled={!count || zipping}>
          {zipping ? (
            <Loader2 className="animate-spin" size={13} aria-hidden="true" />
          ) : (
            <FolderDown size={13} aria-hidden="true" />
          )}
          Download all
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            leave();
            void shots.clearAll();
          }}
          disabled={!count}
        >
          Clear all
        </Button>
      </header>

      {shots.ready && !count && !shots.taking ? (
        <div className="shots-empty">
          <Camera size={22} aria-hidden="true" />
          <p className="shots-empty-title">No screenshots yet</p>
          <p className="shots-empty-hint">
            Take one to keep it here. This browser keeps the newest {MAX_KEPT} for this phone.
          </p>
          <Button size="md" onClick={() => void shots.take()}>
            <Camera size={14} aria-hidden="true" />
            Take screenshot
          </Button>
        </div>
      ) : shots.ready ? (
        <div className="shots-body">
          <ScreenshotRail
            captures={captures}
            activeId={mode === 'compare' ? (compareB ?? selectedId) : selectedId}
            compare={mode === 'compare' && selectedId ? { a: selectedId, b: compareB } : undefined}
            taking={shots.taking}
            onTake={() => void shots.take()}
            onPick={pick}
            onDelete={(id) => void shots.remove(id)}
          />
          <section className="shots-preview" aria-label="Preview">
            {selected && mode === 'compare' ? (
              <ScreenshotCompare a={selected} b={compareSide} />
            ) : selected ? (
              <>
                <ScreenshotPicture
                  capture={selected}
                  actualSize={actualSize}
                  onToggleSize={() => setActualSize((v) => !v)}
                  annotate={
                    mode === 'annotate'
                      ? { shape, color, marks, onMarksChange: setMarks }
                      : undefined
                  }
                />
                <footer className="shots-footer">
                  <p className="shots-details">{detailsLine(selected)}</p>
                  {mode === 'annotate' ? (
                    <AnnotateBar
                      shape={shape}
                      color={color}
                      marks={marks.length}
                      saving={saving}
                      onShape={setShape}
                      onColor={setColor}
                      onUndo={() => setMarks((m) => m.slice(0, -1))}
                      onClear={() => setMarks([])}
                      onCancel={leave}
                      onSave={() => void saveCopy()}
                    />
                  ) : (
                    <div className="shots-actions">
                      <Button variant="secondary" size="sm" onClick={() => void copy()}>
                        <Copy size={13} aria-hidden="true" />
                        Copy
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setActualSize(false);
                          setMode('annotate');
                        }}
                      >
                        <PenLine size={13} aria-hidden="true" />
                        Annotate
                      </Button>
                      <Button variant="secondary" size="sm" onClick={download}>
                        <Download size={13} aria-hidden="true" />
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={actualSize}
                        onClick={() => setActualSize((v) => !v)}
                      >
                        {actualSize ? (
                          <Minimize2 size={13} aria-hidden="true" />
                        ) : (
                          <Maximize2 size={13} aria-hidden="true" />
                        )}
                        Actual size
                      </Button>
                      <span className="shots-actions-gap" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shots-delete"
                        onClick={() => void shots.remove(selected.id)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  )}
                </footer>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

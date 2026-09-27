import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Film, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import {
  deleteRecording,
  getRecording,
  RecordingRequestError,
  sourceMp4Url,
  type GroupAnnotation,
  type PhoneSummary,
  type RecordingDetail,
} from '../../api-service/recordings';
import { useAuth } from '../../auth/auth-context';
import { PageHeader } from '../ui/page-header';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { Popover } from '../ui/Popover';
import { Menu, MenuItem } from '../ui/Menu';
import { useToast } from '../ui/toast';
import { AnnotationOverlay } from '../mosaic/AnnotationOverlay';
import { formatWhen } from './RecordingsPage';
import {
  clampTime,
  formatClock,
  onTimeline,
  positionPct,
  SKIP_MS,
  tilePhase,
  toOverlay,
  visibleAt,
} from './playback';
import { canDelete, deleteErrorMessage, downloadItems, startDownload } from './recordingActions';
import { useSyncedPlayback } from './useSyncedPlayback';
import './recordings.css';

const noop = () => undefined;
const STOP_FIRST = 'Stop the recording on Live devices first.';

/**
 * Focus is somewhere keys mean something else. The timeline (`input[type="range"]`)
 * and the Annotations checkbox are excluded: the transport's own Space/←/→ handling
 * should still apply to them, not a native text-entry escape hatch.
 */
function typingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.closest) return false;
  return !!node.closest(
    'input:not([type="range"]):not([type="checkbox"]), select, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]',
  );
}

function PlaybackTile({
  groupId,
  phone,
  timeMs,
  marks,
  showMarks,
  bind,
}: {
  groupId: string;
  phone: PhoneSummary;
  timeMs: number;
  marks: GroupAnnotation[];
  showMarks: boolean;
  bind: ReturnType<typeof useSyncedPlayback>['bind'];
}) {
  const [broken, setBroken] = React.useState(false);
  const [aspect, setAspect] = React.useState<number | undefined>(undefined);
  const failed = phone.status === 'FAILED' || phone.status === 'DISCARDED';
  const phase = tilePhase(timeMs, phone.offsetMs, phone.durationMs);
  const overlay = visibleAt(marks, timeMs)
    .map(toOverlay)
    .filter((a): a is NonNullable<ReturnType<typeof toOverlay>> => a !== null);
  let note: string | null = null;
  if (failed) note = `Recording failed: ${phone.failReason ?? 'unknown reason'}`;
  else if (broken) note = 'Video no longer available';
  else if (phase === 'before') note = `Joined at ${formatClock(phone.offsetMs)}`;
  return (
    <figure className="rec-tile theme-dark" aria-label={phone.name}>
      <figcaption className="rec-tile-name" title={phone.name}>
        {phone.name}
      </figcaption>
      <div className="rec-tile-screen">
        {!failed && (
          <video
            className="rec-tile-video"
            muted
            playsInline
            preload="auto"
            src={sourceMp4Url(groupId, phone.recordingId)}
            ref={bind(phone.recordingId, {
              offsetMs: phone.offsetMs,
              durationMs: phone.durationMs,
            })}
            onError={() => setBroken(true)}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight);
            }}
          />
        )}
        {!failed && showMarks && (
          <AnnotationOverlay
            enabled={false}
            shape="RECT"
            color="currentColor"
            onCommit={noop}
            committed={overlay}
            mediaAspect={aspect}
          />
        )}
        {note && <div className="rec-tile-note">{note}</div>}
      </div>
    </figure>
  );
}

function DownloadMenu({ detail }: { detail: RecordingDetail }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={ref}
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Download size={14} aria-hidden="true" />
        Download
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <Menu>
          {downloadItems(detail.summary).map((item) => (
            <MenuItem
              key={item.key}
              onClick={() => {
                setOpen(false);
                startDownload(item.url);
              }}
            >
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </>
  );
}

export default function RecordingPage() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const { toast } = useToast();
  const [detail, setDetail] = React.useState<RecordingDetail | null>(null);
  const [failure, setFailure] = React.useState<{ missing: boolean; message: string } | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [showMarks, setShowMarks] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setFailure(null);
    setDetail(null);
    getRecording(groupId)
      // Every time on the page is timeline time from here on: 0 at the earliest frame.
      .then((d) => live && setDetail(onTimeline(d)))
      .catch((e) => {
        if (!live) return;
        setFailure({
          missing: e instanceof RecordingRequestError && e.status === 404,
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      live = false;
    };
  }, [groupId, reloadKey]);

  const duration = detail?.summary.durationMs ?? 0;
  const pb = useSyncedPlayback(duration);
  // The keyboard listener below is attached once per loaded recording (see its own
  // deps), not on every render, so it reads the latest playback handle through this
  // ref rather than closing over a `pb` that would otherwise go stale.
  const pbRef = React.useRef(pb);
  pbRef.current = pb;

  const mountedRef = React.useRef(true);
  React.useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  React.useEffect(() => {
    if (!detail || detail.summary.status === 'recording') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typingTarget(e.target)) return;
      // Space on a focused button or link is that control's own click; handling
      // it here too would toggle twice.
      if (e.key === ' ' && (e.target as HTMLElement | null)?.closest?.('button, a, label')) return;
      if (e.key === ' ' && e.repeat) {
        // A held Space auto-repeats every ~30-90ms after the OS delay; without this
        // guard every repeat toggles play/pause again, flickering and ending in
        // whichever state the last repeat happened to land on.
        e.preventDefault();
        return;
      }
      const live = pbRef.current;
      if (e.key === ' ') {
        e.preventDefault();
        live.toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        live.seek(clampTime(live.timeMs + SKIP_MS, duration));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        live.seek(clampTime(live.timeMs - SKIP_MS, duration));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detail, duration]);

  if (failure) {
    return failure.missing ? (
      <EmptyState
        title="This recording isn't available"
        description="It may have been deleted, or it's on phones you can't see."
        action={
          <Link className="rec-link" to="/recordings">
            Back to Recordings
          </Link>
        }
      />
    ) : (
      <EmptyState
        title="Couldn't load this recording"
        description={failure.message}
        action={
          <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </Button>
        }
      />
    );
  }
  if (!detail) return <EmptyState title="Loading recording…" />;

  const { summary, bookmarks, annotations } = detail;
  const running = summary.status === 'recording';
  const names = summary.phones.map((p) => p.name).join(', ');
  const nameOf = (recordingId: string) =>
    summary.phones.find((p) => p.recordingId === recordingId)?.name ?? '';
  const subtitle = [
    names,
    summary.durationMs === null ? null : `Length ${formatClock(summary.durationMs)}`,
    `Recorded by ${summary.startedBy?.name ?? 'Unknown'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const allowDelete = canDelete(summary, me);

  const closeConfirm = () => {
    setConfirming(false);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRecording(groupId);
    } catch (e) {
      // The page may have unmounted while the request was in flight (route change,
      // or the dialog outliving the component in some other way); don't set state
      // on an unmounted component.
      if (mountedRef.current) {
        setDeleting(false);
        setDeleteError(deleteErrorMessage(e));
      }
      return;
    }
    // Navigating unmounts this page, so no state is set after it. Only navigate
    // (and toast) if the page is still around to have asked for the delete.
    if (mountedRef.current) {
      toast('Recording deleted', 'success');
      navigate('/recordings');
    }
  };

  return (
    <div className="rec-page">
      <nav className="rec-backbar">
        <Link className="rec-link" to="/recordings">
          <ArrowLeft size={14} aria-hidden="true" /> Recordings
        </Link>
      </nav>
      <PageHeader
        icon={Film}
        title={formatWhen(summary.startedAt)}
        subtitle={subtitle}
        action={
          <>
            {!running && summary.status !== 'failed' && <DownloadMenu detail={detail} />}
            {allowDelete && (
              <>
                <Button
                  variant="danger"
                  disabled={running}
                  aria-describedby={running ? 'rec-delete-reason' : undefined}
                  title={running ? STOP_FIRST : undefined}
                  onClick={() => {
                    setDeleteError(null);
                    setConfirming(true);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Delete
                </Button>
                {running && (
                  <span id="rec-delete-reason" className="sr-only">
                    {STOP_FIRST}
                  </span>
                )}
              </>
            )}
          </>
        }
      />
      {running ? (
        <EmptyState
          title="Still recording"
          description="Stop it on Live devices to play it here."
          action={
            <Link className="rec-link" to="/devices/live">
              Open Live devices
            </Link>
          }
        />
      ) : (
        <div className={`rec-body${bookmarks.length > 0 ? ' rec-body--with-list' : ''}`}>
          <div className="rec-player">
            <div className="rec-grid">
              {summary.phones.map((p) => (
                <PlaybackTile
                  key={p.recordingId}
                  groupId={groupId}
                  phone={p}
                  timeMs={pb.timeMs}
                  marks={annotations.filter((a) => a.recordingId === p.recordingId)}
                  showMarks={showMarks}
                  bind={pb.bind}
                />
              ))}
            </div>
            <div className="rec-transport">
              <Button
                variant="secondary"
                size="icon"
                aria-label={pb.playing ? 'Pause' : 'Play'}
                onClick={pb.toggle}
              >
                {pb.playing ? (
                  <Pause size={14} aria-hidden="true" />
                ) : (
                  <Play size={14} aria-hidden="true" />
                )}
              </Button>
              <span className="rec-num rec-clock">
                {formatClock(pb.timeMs)} / {formatClock(duration)}
              </span>
              <div className="rec-timeline">
                <input
                  type="range"
                  className="rec-range"
                  aria-label="Timeline"
                  aria-valuetext={`${formatClock(pb.timeMs)} of ${formatClock(duration)}`}
                  min={0}
                  max={duration}
                  step={100}
                  value={pb.timeMs}
                  onChange={(e) => pb.seek(Number(e.target.value))}
                />
                {bookmarks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="rec-mark"
                    style={{ left: `${positionPct(b.timecodeMs, duration)}%` }}
                    title={b.label}
                    aria-label={`Bookmark: ${b.label}, ${formatClock(b.timecodeMs)}`}
                    onClick={() => pb.seek(b.timecodeMs)}
                  />
                ))}
              </div>
              {/* Mounted at all times so a screen reader has an existing live region to
                  pick up the change — a status element created already-populated is
                  often not announced. */}
              <span role="status" className="rec-waiting">
                {pb.waiting ? 'Buffering…' : ''}
              </span>
              {summary.annotationCount > 0 && (
                <label className="rec-toggle">
                  <input
                    type="checkbox"
                    checked={showMarks}
                    onChange={(e) => setShowMarks(e.target.checked)}
                  />
                  Annotations
                </label>
              )}
            </div>
          </div>
          {bookmarks.length > 0 && (
            <section className="rec-bookmarks" aria-labelledby="rec-bookmarks-title">
              <h2 id="rec-bookmarks-title" className="rec-bookmarks-title">
                Bookmarks
              </h2>
              <ol className="rec-bookmark-list">
                {bookmarks.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="rec-bookmark"
                      onClick={() => pb.seek(b.timecodeMs)}
                    >
                      <span className="rec-bookmark-label">{b.label}</span>
                      <span className="rec-num rec-bookmark-meta">
                        {formatClock(b.timecodeMs)} · {nameOf(b.recordingId)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
      <Modal
        open={confirming}
        title="Delete this recording?"
        onClose={() => {
          // Ignore Escape and the × while a delete is in flight; the request
          // can't be cancelled once it's sent.
          if (deleting) return;
          closeConfirm();
        }}
        footer={
          <>
            <Button variant="secondary" onClick={closeConfirm} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              Delete
            </Button>
          </>
        }
      >
        <p>Its videos, bookmarks and annotations are removed for everyone.</p>
        {deleteError && (
          <p role="alert" className="rec-error">
            {deleteError}
          </p>
        )}
      </Modal>
    </div>
  );
}

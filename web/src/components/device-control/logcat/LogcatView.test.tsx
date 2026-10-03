import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { InPlaceDialog } from '../../ui/InPlaceDialog';
import LogcatView from './LogcatView';
import { formatLine } from './logcatRecording';
import { tagColor } from './tagColor';
import { installFakeLayout, settle, type FakeLayout } from './testing/fakeLayout';

/** jsdom reports style.color as rgb(); the palette is hex. */
const toRgb = (hex: string) => {
  const m = /^#(..)(..)(..)$/.exec(hex);
  if (!m) return hex;
  return `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`;
};

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));

// The hook owns the socket; the view's job is rendering and filtering.
const mockStream = vi.fn();
vi.mock('./useLogcatStream', () => ({
  useLogcatStream: (...args: unknown[]) => mockStream(...args),
}));

// `seq` is assigned by the hook on ingest and is what the row list is keyed
// on — see BufferedLogcatRecord. Fixtures need a distinct one each.
let nextSeq = 0;
const rec = (over: Record<string, unknown> = {}) => ({
  seq: nextSeq++,
  ts: Date.UTC(2026, 7, 9, 16, 11, 0),
  pid: 1408,
  tid: 1408,
  level: 'D',
  tag: 'Tile.WifiTile',
  message: 'handleUpdateState',
  pkg: 'com.android.systemui',
  ...over,
});

const streamState = (over: Record<string, unknown> = {}) => ({
  records: [],
  connected: true,
  clear: vi.fn(),
  deniedReason: null,
  exhausted: false,
  retry: vi.fn(),
  ...over,
});

const lastFilter = () => mockStream.mock.calls[mockStream.mock.calls.length - 1][2];
const row = (text: string) => screen.getByText(text).closest('.log-row') as HTMLElement;
const logLines = () => screen.getByRole('listbox', { name: 'Log lines' });
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More options' }));
const mount = (records: ReturnType<typeof rec>[]) => {
  mockStream.mockReturnValue(streamState({ records }));
  return render(<LogcatView udid="DEV-1" platform="android" />);
};

/**
 * Every describe renders the list, which needs a layout jsdom doesn't have,
 * and starts from a fresh stream mock.
 */
function useViewSetup() {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 600 });
    mockStream.mockReset();
    mockStream.mockReturnValue(streamState());
    toast.mockClear();
  });
  afterEach(() => layout.restore());
}

describe('LogcatView', () => {
  useViewSetup();

  it('renders an unsupported state for a platform with no transport', () => {
    // These three cases asserted "Android only" until iOS gained os_trace.
    // tvOS is now the platform with nothing wired up.
    render(<LogcatView udid="DEV-1" platform="tvos" />);
    expect(screen.getByText(/not available here/i)).toBeTruthy();
  });

  it('does not open a stream for a platform with no transport', () => {
    render(<LogcatView udid="DEV-1" platform="tvos" />);
    // second arg is `enabled`
    expect(mockStream).toHaveBeenCalledWith('DEV-1', false, undefined);
  });

  it('opens a stream for an Android device, filtered in the browser', () => {
    render(<LogcatView udid="DEV-1" platform="android" />);
    // No source filter: logcat streams everything and the pane narrows it.
    expect(mockStream).toHaveBeenCalledWith('DEV-1', true, undefined);
  });

  it('opens a stream for an iOS device, narrowed at the source', () => {
    // os_trace at Debug is 5,485 lines/sec device-wide, so the level has to be
    // pushed down to the device or the pane is unreadable. Debug is absent
    // until the level bar asks for it.
    render(<LogcatView udid="DEV-1" platform="ios" />);
    const [, enabled, filter] = mockStream.mock.calls[mockStream.mock.calls.length - 1];
    expect(enabled).toBe(true);
    expect(filter.levels).toContain('Error');
    expect(filter.levels).not.toContain('Debug');
  });

  // PID and TID left the row for the details panel.
  it('renders a record across its columns, and its PID and TID in the details', () => {
    mockStream.mockReturnValue(streamState({ records: [rec()] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('Tile.WifiTile')).toBeTruthy();
    expect(screen.getByText('com.android.systemui')).toBeTruthy();
    expect(screen.getByText('handleUpdateState')).toBeTruthy();
    fireEvent.click(row('handleUpdateState'));
    const panel = screen.getByRole('region', { name: 'Line details' });
    expect(within(panel).getAllByText('1408')).toHaveLength(2);
  });

  it('shows Live when connected and Connecting when not', () => {
    mockStream.mockReturnValue(streamState({ connected: false }));
    const { unmount } = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting');
    unmount();

    mockStream.mockReturnValue(streamState({ connected: true }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByRole('status')).toHaveTextContent('Live');
  });

  it('shows the shown / total counts', () => {
    mockStream.mockReturnValue(streamState({ records: [rec(), rec({ tag: 'Other' })] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('2 of 2 shown')).toBeTruthy();
  });

  it('marks synthetic records so they are not mistaken for device output', () => {
    mockStream.mockReturnValue(
      streamState({
        records: [rec({ synthetic: true, level: 'W', tag: 'xenon', message: '3 lines dropped' })],
      }),
    );
    const { container } = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(container.querySelector('.log-row.is-synthetic')).toBeTruthy();
  });

  // Correction 1: a 1008 (ownership/ticket) denial is terminal — the hook
  // surfaces it as `deniedReason` rather than silently retrying forever. The
  // view's job is to show that reason to the user, distinctly from the
  // ordinary Connecting state.
  it('surfaces the denial reason instead of showing Connecting', () => {
    mockStream.mockReturnValue(
      streamState({ connected: false, deniedReason: 'device held by another user' }),
    );
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByRole('status')).toHaveTextContent('Denied');
    expect(screen.queryByText('Connecting')).toBeNull();
    expect(screen.getByText(/device held by another user/)).toBeTruthy();
  });

  // Correction 3: exhausting MAX_ATTEMPTS must be visible and recoverable —
  // not an indefinite Connecting pill. A Reconnect control must be present
  // (in the banner now) and must call the hook's retry().
  it('shows a terminal offline state with a manual reconnect once retries are exhausted', () => {
    const retry = vi.fn();
    mockStream.mockReturnValue(streamState({ connected: false, exhausted: true, retry }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByRole('status')).toHaveTextContent('Offline');
    expect(screen.queryByText('Connecting')).toBeNull();
    const reconnectBtn = within(screen.getByRole('alert')).getByRole('button', {
      name: /reconnect/i,
    });
    fireEvent.click(reconnectBtn);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  // A live/connecting pane (no terminal state) must not show a reconnect
  // control — it would be a no-op affordance that implies something is wrong
  // when nothing is.
  it('does not show a reconnect control outside a terminal state', () => {
    mockStream.mockReturnValue(streamState({ connected: true }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.queryByRole('button', { name: /reconnect/i })).toBeNull();
  });

  // The documented `level:` grammar has to work from the text box. It did
  // not once: with the level control holding its own (empty) state, every
  // filter pass ran setLevelTerm(query, '') — and a falsy level makes
  // setLevelTerm STRIP the level term, so the one the user typed vanished.
  it('applies a level: term typed into the filter box while the bar is on All', () => {
    mockStream.mockReturnValue(
      streamState({
        records: [
          rec({ level: 'D', message: 'debug line' }),
          rec({ level: 'E', message: 'error line' }),
        ],
      }),
    );
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('2 of 2 shown')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'level:E' } });

    expect(screen.queryByText('debug line')).toBeNull();
    expect(screen.getByText('error line')).toBeTruthy();
    expect(screen.getByText('1 of 2 shown')).toBeTruthy();
  });

  // The level bar writes `level:` into the same query, so the bar and the
  // text box cannot disagree. Two states could, and did: box showing
  // `level:E` while the old dropdown showed W, W winning, no cue.
  it('keeps the level bar and the filter box in agreement, whichever one is used', () => {
    mockStream.mockReturnValue(streamState({ records: [rec()] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    const box = screen.getByLabelText('Filter logs') as HTMLInputElement;
    const level = (name: RegExp) => screen.getByRole('button', { name });

    // Typing moves the bar. parseQuery is last-token-wins, so the trailing
    // level:D is the one in effect and the one pressed.
    fireEvent.change(box, { target: { value: 'level:E tag:Tile level:D' } });
    expect(level(/^Debug and above/)).toHaveAttribute('aria-pressed', 'true');

    // Using the bar rewrites the box: exactly ONE level term survives (both
    // stray ones are replaced, not merely out-voted), other terms untouched.
    fireEvent.click(level(/^Warning and above/));
    expect(box.value).toBe('level:W tag:Tile');
    expect(level(/^Warning and above/)).toHaveAttribute('aria-pressed', 'true');

    // Choosing it again goes back to All, removing the term.
    fireEvent.click(level(/^Warning and above/));
    expect(box.value).toBe('tag:Tile');
    expect(level(/^All levels$/)).toHaveAttribute('aria-pressed', 'true');

    // So does All.
    fireEvent.click(level(/^Error and above/));
    fireEvent.click(level(/^All levels$/));
    expect(box.value).toBe('tag:Tile');
  });

  // A typo'd `level:X` is ignored outright by `matches`: no level filtering
  // is in effect, so All is the honest reading of the query. REWRITTEN half:
  // `level:V` used to read as "All levels" too, because the dropdown had no
  // V option; the bar has a Verbose button, and level:V presses it (it shows
  // every line, which its count says).
  it('presses All for a level term that filters nothing', () => {
    mockStream.mockReturnValue(streamState({ records: [rec()] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    const box = screen.getByLabelText('Filter logs');

    fireEvent.change(box, { target: { value: 'level:X' } });
    expect(screen.getByRole('button', { name: 'All levels' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(box, { target: { value: 'level:V' } });
    expect(screen.getByRole('button', { name: /^Verbose and above/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('names each level button for what it actually selects', () => {
    mockStream.mockReturnValue(streamState({ records: [rec({ level: 'F' })] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    const labels = within(screen.getByRole('group', { name: 'Log levels' }))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));

    // F is the highest level: "Fatal only", not "and above".
    expect(labels).toEqual([
      'All levels',
      'Verbose and above, 0 verbose lines',
      'Debug and above, 0 debug lines',
      'Info and above, 0 info lines',
      'Warning and above, 0 warning lines',
      'Error and above, 0 error lines',
      'Fatal only, 1 fatal line',
    ]);
  });

  // Correction 4 (view half): Pause only stops following — the hook has no
  // notion of "paused" and keeps delivering records regardless. A record that
  // arrives while paused must still be in the list (off-screen is fine;
  // dropped is not), and must not require a resume to appear.
  it('keeps rendering records that arrive while paused — Pause only stops following', () => {
    let currentRecords = [rec({ message: 'before-pause' })];
    mockStream.mockImplementation(() => streamState({ records: currentRecords }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('before-pause')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();

    currentRecords = [...currentRecords, rec({ message: 'arrived-while-paused' })];
    rerender(<LogcatView udid="DEV-1" platform="android" />);

    expect(screen.getByText('arrived-while-paused')).toBeTruthy();
    expect(screen.getByText('2 of 2 shown')).toBeTruthy();
  });

  // The pill alone says Offline with no explanation of what happened or that
  // the state is recoverable. Deleting the banner outright used to leave the
  // whole suite green.
  it('explains the exhausted state in an assertive banner, not just the pill', () => {
    mockStream.mockReturnValue(streamState({ connected: false, exhausted: true }));
    const { container } = render(<LogcatView udid="DEV-1" platform="android" />);

    const banner = container.querySelector('.log-banner.is-exhausted');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toMatch(/Connection lost after repeated attempts/);
    // A pane the user may not be looking at just went dead — announce it.
    expect(banner?.getAttribute('role')).toBe('alert');
  });

  it('announces the denial banner to assistive tech', () => {
    mockStream.mockReturnValue(
      streamState({ connected: false, deniedReason: 'device held by another user' }),
    );
    const { container } = render(<LogcatView udid="DEV-1" platform="android" />);
    const banner = container.querySelector('.log-banner.is-denied');
    expect(banner?.getAttribute('role')).toBe('alert');
  });

  // The `.is-error` dot was the only colour cue distinguishing "dead" from
  // "still trying", and nothing asserted it — hardcoding the error state to
  // false left the suite green.
  it('reddens the status dot in a terminal state only', () => {
    mockStream.mockReturnValue(streamState({ connected: true }));
    const live = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(live.container.querySelector('.log-live-dot.is-error')).toBeNull();
    live.unmount();

    mockStream.mockReturnValue(streamState({ connected: false }));
    const connecting = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(connecting.container.querySelector('.log-live-dot.is-error')).toBeNull();
    connecting.unmount();

    mockStream.mockReturnValue(streamState({ connected: false, exhausted: true }));
    const offline = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(offline.container.querySelector('.log-live-dot.is-error')).toBeTruthy();
    offline.unmount();

    mockStream.mockReturnValue(streamState({ connected: false, deniedReason: 'nope' }));
    const denied = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(denied.container.querySelector('.log-live-dot.is-error')).toBeTruthy();
  });

  // Rows are keyed on the ingest `seq`, not the array index: the hook's
  // buffer trims from the FRONT, so under index keys every trim shifts every
  // index and React repatches every row instead of dropping one.
  it('keeps a row DOM node across a front-trim of the buffer', () => {
    let current = [
      rec({ message: 'oldest' }),
      rec({ message: 'middle' }),
      rec({ message: 'newest' }),
    ];
    mockStream.mockImplementation(() => streamState({ records: current }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    const newestBefore = row('newest');

    current = current.slice(1); // the buffer overflowed; the oldest is gone
    rerender(<LogcatView udid="DEV-1" platform="android" />);

    // Under index keys 'newest' moves from index 2 to index 1 and React
    // rewrites the node that used to hold 'middle' — a different element.
    expect(row('newest')).toBe(newestBefore);
  });

  it('keeps the Export download alive: attached anchor, deferred revoke', () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:logcat');
    (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURL;
    let attachedAtClick: boolean | null = null;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      attachedAtClick = this.isConnected;
    });

    try {
      mockStream.mockReturnValue(streamState({ records: [rec()] }));
      render(<LogcatView udid="DEV-1" platform="android" />);
      fireEvent.click(screen.getByRole('button', { name: 'Export shown lines' }));

      expect(clickSpy).toHaveBeenCalledTimes(1);
      // Firefox ignores a click on an anchor that is not in the document.
      expect(attachedAtClick).toBe(true);
      // Revoking in the same task can cancel a download that has not started
      // reading the blob yet (Firefox, Safari).
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runOnlyPendingTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:logcat');
      // ...and the anchor is not left behind in the document.
      expect(document.querySelector('a[download]')).toBeNull();
    } finally {
      clickSpy.mockRestore();
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
      vi.useRealTimers();
    }
  });
});

/**
 * Android Studio parity controls: match-case, clear-filter, find with
 * prev/next, and wrapping long lines.
 */
describe('LogcatView — Android Studio parity controls', () => {
  useViewSetup();
  beforeEach(() => {
    nextSeq = 0;
  });

  it('clears the filter with the × button, and the button only exists when there is something to clear', () => {
    mount([rec()]);
    const box = screen.getByLabelText('Filter logs') as HTMLInputElement;

    // Absent while empty: a permanently visible clear button is a lie about
    // there being state to discard.
    expect(screen.queryByLabelText('Clear filter')).toBeNull();

    fireEvent.change(box, { target: { value: 'tag:nope' } });
    expect(screen.queryAllByText(/handleUpdateState/)).toHaveLength(0);

    fireEvent.click(screen.getByLabelText('Clear filter'));
    expect(box.value).toBe('');
    expect(screen.queryAllByText(/handleUpdateState/).length).toBeGreaterThan(0);
  });

  it('match case narrows the filter, and toggling it back off widens it again', () => {
    mount([rec({ tag: 'WifiService' })]);
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:wifi' } });
    // Insensitive by default -> matches.
    expect(screen.queryAllByText('WifiService').length).toBeGreaterThan(0);

    openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Match case' }));
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Match case' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryAllByText('WifiService')).toHaveLength(0);

    // Both directions: a one-way toggle would pass a test that only asserts
    // the narrowing.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Match case' }));
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Match case' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryAllByText('WifiService').length).toBeGreaterThan(0);
  });

  it('find reports a hit count without hiding non-matching rows', () => {
    mount([rec({ message: 'alpha' }), rec({ message: 'beta' }), rec({ message: 'alpha again' })]);
    fireEvent.change(screen.getByLabelText('Find in logs'), { target: { value: 'alpha' } });

    expect(screen.getByText('1/2')).toBeTruthy();
    // The distinction from the filter: `beta` is still on screen.
    expect(screen.queryAllByText(/beta/).length).toBeGreaterThan(0);
  });

  it('next/prev step through hits and wrap around', () => {
    mount([rec({ message: 'alpha' }), rec({ message: 'beta' }), rec({ message: 'alpha again' })]);
    fireEvent.change(screen.getByLabelText('Find in logs'), { target: { value: 'alpha' } });

    fireEvent.click(screen.getByLabelText('Next match'));
    expect(screen.getByText('2/2')).toBeTruthy();
    // Wraps rather than dead-ending at the last hit.
    fireEvent.click(screen.getByLabelText('Next match'));
    expect(screen.getByText('1/2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Previous match'));
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('disables the step buttons when nothing matches, and reports 0/0', () => {
    mount([rec({ message: 'alpha' })]);
    fireEvent.change(screen.getByLabelText('Find in logs'), { target: { value: 'zzz' } });

    expect(screen.getByText('0/0')).toBeTruthy();
    expect((screen.getByLabelText('Next match') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Previous match') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Enter steps forward and Shift+Enter steps back', () => {
    mount([rec({ message: 'alpha' }), rec({ message: 'alpha again' })]);
    const box = screen.getByLabelText('Find in logs');
    fireEvent.change(box, { target: { value: 'alpha' } });

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('2/2')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('stepping to a hit pauses, so following stops fighting the jump', () => {
    mount([rec({ message: 'alpha' }), rec({ message: 'alpha again' })]);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy(); // following

    fireEvent.change(screen.getByLabelText('Find in logs'), { target: { value: 'alpha' } });
    fireEvent.click(screen.getByLabelText('Next match'));

    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy(); // paused
  });

  it('wraps long lines by default, and the menu turns it off for the list', () => {
    mount([rec()]);
    openMenu();
    const item = screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' });
    expect(item).toHaveAttribute('aria-checked', 'true');
    expect(logLines()).not.toHaveClass('is-nowrap');

    fireEvent.click(item);
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(logLines()).toHaveClass('is-nowrap');
  });

  // Asserts the view derives each tag's colour FROM THE TAG, which is the
  // view's whole responsibility here. It deliberately does not assert that
  // two given tags differ: with a 12-colour palette collisions are inherent
  // (`WifiService` and `ActivityManager` genuinely collide), so that would be
  // asserting a property the design does not offer — Android Studio's palette
  // collides too. Palette spread is pinned in tagColor.test.ts, where it
  // belongs.
  it('colours each tag from the tag itself, not a single shared colour', () => {
    const tags = ['WifiService', 'QSClockBellTower', 'dalvikvm'];
    const { container } = mount(tags.map((t) => rec({ tag: t })));
    const rendered = Array.from(container.querySelectorAll('.log-tag')).map(
      (e) => (e as HTMLElement).style.color,
    );

    expect(rendered).toHaveLength(3);
    rendered.forEach((color, i) => {
      expect(color, tags[i]).toBeTruthy();
      // toBe on a raw hex would fail: jsdom normalises style.color to rgb().
      expect(toRgb(tagColor(tags[i]))).toBe(color);
    });
  });
});

/**
 * Recording: capture the raw stream between an explicit start and stop, then
 * download it. Distinct from Export, which saves the filtered view as-is.
 */
describe('LogcatView — recording', () => {
  useViewSetup();
  let created: { href: string; download: string; clicked: boolean };
  let captured: string;
  let RealBlob: typeof Blob;
  let clickSpy: MockInstance;

  beforeEach(() => {
    nextSeq = 0;
    // The download revokes its blob URL on a deferred timer. Fake timers keep
    // that call inside the test that caused it; see afterEach.
    vi.useFakeTimers();
    captured = '';
    created = { href: '', download: '', clicked: false };

    // Capture the Blob's text instead of letting jsdom attempt a download.
    (globalThis.URL as any).createObjectURL = vi.fn((blob: Blob) => {
      // Blob#text() is async; read the parts synchronously via the mock arg.
      captured = (blob as any).__text ?? captured;
      return 'blob:mock';
    });
    (globalThis.URL as any).revokeObjectURL = vi.fn();

    RealBlob = globalThis.Blob;
    (globalThis as any).Blob = function (parts: any[], opts: any) {
      const b = new RealBlob(parts, opts);
      (b as any).__text = parts.join('');
      return b;
    };

    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      created.clicked = true;
      created.href = this.href;
      created.download = this.download;
    });
  });

  // Undo every stub, or the next test's setup wraps this one's. A leaked
  // createElement spy did exactly that: each anchor went through one wrapper
  // per earlier test, the second defined `click` again, and the throw
  // surfaced as an unhandled error from inside the click handler.
  // Flush the deferred revoke first, while its stub still exists.
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    clickSpy.mockRestore();
    globalThis.Blob = RealBlob;
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  const recordBtn = () => screen.getByRole('button', { name: /record|stop ·/i });

  it('starts and stops, and only downloads on stop', () => {
    mount([rec({ message: 'before' })]);
    expect(created.clicked).toBe(false);

    fireEvent.click(recordBtn());
    expect(recordBtn().getAttribute('aria-pressed')).toBe('true');
    expect(created.clicked, 'starting must not download').toBe(false);

    fireEvent.click(recordBtn());
    expect(recordBtn().getAttribute('aria-pressed')).toBe('false');
    expect(created.clicked).toBe(true);
    expect(created.download).toMatch(/^logcat-DEV-1-.*\.txt$/);
  });

  // The window is what you asked for. Buffered history from before you pressed
  // Record is not part of it, or the file silently answers a different question.
  it('captures only records that arrive after start, not the existing buffer', () => {
    const before = [rec({ message: 'OLD-LINE' })];
    const { rerender } = mount(before);
    fireEvent.click(recordBtn());

    mockStream.mockReturnValue(streamState({ records: [...before, rec({ message: 'NEW-LINE' })] }));
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(recordBtn());

    expect(captured).toContain('NEW-LINE');
    expect(captured).not.toContain('OLD-LINE');
  });

  // A capture can be filtered afterwards; it cannot be unfiltered.
  it('captures unfiltered, even while a filter hides rows on screen', () => {
    const base = [rec({ tag: 'Keep' })];
    const { rerender } = mount(base);
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:Keep' } });
    fireEvent.click(recordBtn());

    mockStream.mockReturnValue(
      streamState({ records: [...base, rec({ tag: 'Hidden', message: 'HIDDEN-BY-FILTER' })] }),
    );
    rerender(<LogcatView udid="DEV-1" platform="android" />);

    // Filtered out of the view...
    expect(screen.queryByText('HIDDEN-BY-FILTER')).toBeNull();
    fireEvent.click(recordBtn());
    // ...but present in the capture.
    expect(captured).toContain('HIDDEN-BY-FILTER');
  });

  it('shows a live line count while recording', () => {
    const base = [rec()];
    const { rerender } = mount(base);
    fireEvent.click(recordBtn());
    mockStream.mockReturnValue(
      streamState({ records: [...base, rec({ message: 'a' }), rec({ message: 'b' })] }),
    );
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    expect(recordBtn().textContent).toContain('Stop · 2 lines');
  });

  it('writes a header naming the window', () => {
    const base = [rec()];
    const { rerender } = mount(base);
    fireEvent.click(recordBtn());
    mockStream.mockReturnValue(streamState({ records: [...base, rec({ message: 'x' })] }));
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(recordBtn());

    expect(captured).toContain('# Xenon logcat recording');
    expect(captured).toContain('# device:   DEV-1');
    expect(captured).toContain('# lines:    1');
  });

  it('a second recording does not carry over the first', () => {
    // The fixtures are built ONCE and reused. `rec()` assigns a fresh `seq`
    // per call, so re-creating a "same" record between the two recordings
    // would hand the second capture a record it has genuinely never seen —
    // the test would fail on its own fixture rather than on the behaviour.
    const base = rec();
    const first = rec({ message: 'FIRST' });
    const second = rec({ message: 'SECOND' });
    const { rerender } = mount([base]);

    fireEvent.click(recordBtn());
    mockStream.mockReturnValue(streamState({ records: [base, first] }));
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(recordBtn());
    expect(captured).toContain('FIRST');

    fireEvent.click(recordBtn());
    mockStream.mockReturnValue(streamState({ records: [base, first, second] }));
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(recordBtn());

    expect(captured).toContain('SECOND');
    expect(captured).not.toContain('FIRST');
  });
});

/**
 * The level bar's counts, the details panel, copying, the keys, the states
 * and Find reaching any line.
 */
describe('LogcatView — acting on lines', () => {
  useViewSetup();
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    nextSeq = 0;
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('counts the levels that pass the filter, minus its level term', () => {
    mount([
      rec({ level: 'E', tag: 'Wifi' }),
      rec({ level: 'E', tag: 'Other' }),
      rec({ level: 'D', tag: 'Wifi' }),
    ]);
    fireEvent.change(screen.getByLabelText('Filter logs'), {
      target: { value: 'tag:wifi level:E' },
    });
    expect(screen.getByRole('button', { name: 'Error and above, 1 error line' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Debug and above, 1 debug line' })).toBeTruthy();
  });

  it('on iOS, choosing Debug turns Debug on at the device, and Show only this app narrows it there', () => {
    mockStream.mockReturnValue(streamState({ records: [rec({ pkg: 'Food Truck' })] }));
    render(<LogcatView udid="DEV-1" platform="ios" />);
    fireEvent.click(screen.getByRole('button', { name: /^Debug and above/ }));
    expect(lastFilter().levels).toContain('Debug');
    fireEvent.click(row('handleUpdateState'));
    fireEvent.click(screen.getByRole('button', { name: 'Show only this app' }));
    expect(screen.getByLabelText('Filter logs')).toHaveValue('level:D package:"Food Truck"');
    expect(lastFilter().process).toBe('Food Truck');
  });

  it('says there is nothing to export instead of saving an empty file', () => {
    mount([rec({ tag: 'Wifi' })]);
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export shown lines' }));
    expect(toast).toHaveBeenCalledWith('No lines to export', 'info');
  });

  it('opens a line in the panel and filters by its tag and app from there', () => {
    mount([rec({ tag: 'Wifi', pkg: 'com.a' }), rec({ tag: 'chatty', pkg: 'com.b' })]);
    fireEvent.click(row('chatty'));
    const box = screen.getByLabelText('Filter logs');
    // The panel keeps its line while the filter hides it.
    fireEvent.change(box, { target: { value: 'tag:Old level:W' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show only this tag' }));
    expect(box).toHaveValue('tag:chatty level:W');
    fireEvent.click(screen.getByRole('button', { name: 'Show only this app' }));
    expect(box).toHaveValue('tag:chatty level:W package:com.b');
    fireEvent.click(screen.getByRole('button', { name: 'Hide this tag' }));
    expect(box).toHaveValue('tag:chatty level:W package:com.b -tag:chatty');
  });

  it('copies the selected lines with Cmd/Ctrl+C, in list order, as Export writes them', async () => {
    const lines = [rec({ message: 'one' }), rec({ message: 'two' }), rec({ message: 'three' })];
    mount(lines);
    fireEvent.click(row('three'));
    fireEvent.click(row('one'), { metaKey: true });
    fireEvent.keyDown(logLines(), { key: 'c', metaKey: true });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Copied 2 lines', 'success'));
    expect(writeText).toHaveBeenCalledWith(`${formatLine(lines[0])}\n${formatLine(lines[2])}`);
  });

  it('offers Copy selected lines in the menu only with a selection', async () => {
    mount([rec({ message: 'one' })]);
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Copy selected lines' })).toBeNull();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    fireEvent.click(row('one'));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy selected lines' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  });

  it('copies a line and its message from the panel', async () => {
    const line = rec({ message: 'boom' });
    mount([line]);
    fireEvent.click(row('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy line' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(formatLine(line)));
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('boom'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Copied the message', 'success'));
  });

  it('Esc closes the panel, then clears the selection', () => {
    mount([rec({ message: 'one' })]);
    fireEvent.click(row('one'));
    fireEvent.keyDown(logLines(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Line details' })).toBeNull();
    expect(row('one')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(logLines(), { key: 'Escape' });
    expect(row('one')).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps the line in the panel after Clear lines, and says it left the buffer', () => {
    const clear = vi.fn();
    const line = rec({ message: 'kept' });
    mockStream.mockReturnValue(streamState({ records: [line], clear }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(row('kept'));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear lines' }));
    expect(clear).toHaveBeenCalledTimes(1);
    mockStream.mockReturnValue(streamState({ records: [], clear }));
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    const panel = screen.getByRole('region', { name: 'Line details' });
    expect(panel).toHaveTextContent('kept');
    expect(panel).toHaveTextContent('This line has left the buffer');
    expect(screen.getByText('0 of 0 shown')).toBeTruthy();
  });

  it('says what is happening when there are no lines', () => {
    mockStream.mockReturnValue(streamState({ connected: false }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('Waiting for the phone’s first log line…')).toBeTruthy();
    mockStream.mockReturnValue(streamState({ connected: true }));
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('Connected. Lines appear here as the phone logs them.')).toBeTruthy();
  });

  it('says no lines match the filter, and Clear filter clears it', () => {
    mount([rec()]);
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:nope' } });
    const state = screen.getByText('tag:nope').closest('.log-state') as HTMLElement;
    expect(state).toHaveTextContent('No lines match tag:nope');
    fireEvent.click(within(state).getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByLabelText('Filter logs')).toHaveValue('');
  });

  it('/ focuses the filter and Cmd/Ctrl+F focuses Find, from inside the pane', () => {
    mount([rec()]);
    logLines().focus();
    fireEvent.keyDown(logLines(), { key: '/' });
    expect(document.activeElement).toBe(screen.getByLabelText('Filter logs'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Find in logs'));
    // Typing a slash into a field types a slash.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: '/' });
    expect(document.activeElement).toBe(screen.getByLabelText('Find in logs'));
  });

  it('Pause counts new lines in a pill, and Jump to latest follows again', () => {
    let records = [rec({ message: 'a' })];
    mockStream.mockImplementation(() => streamState({ records }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    records = [...records, rec({ message: 'b' }), rec({ message: 'c' })];
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(screen.getByRole('button', { name: '2 new lines · Jump to latest' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('highlights the match in the row, and reaches a match that is not rendered', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) =>
      rec({ message: i === 100 ? 'needle here' : `line ${i}` }),
    );
    mount(lines);
    await settle();
    fireEvent.change(screen.getByLabelText('Find in logs'), { target: { value: 'needle' } });
    fireEvent.keyDown(screen.getByLabelText('Find in logs'), { key: 'Enter' });
    await settle();
    expect(document.querySelector('.log-row.is-active-hit mark.log-mark')).toHaveTextContent(
      'needle',
    );
  });

  // Device control is an InPlaceDialog, which closes on an Esc nobody
  // handled. The pane's own Esc (close the panel, then clear the selection)
  // must count as handled, or it closes device control with the buffer,
  // any recording and the phone's hold.
  it('Esc closes the panel and clears the selection without closing device control', () => {
    const onClose = vi.fn();
    mockStream.mockReturnValue(streamState({ records: [rec({ message: 'one' })] }));
    render(
      <InPlaceDialog labelledBy="dc-title" onClose={onClose}>
        <h2 id="dc-title">Device control</h2>
        <LogcatView udid="DEV-1" platform="android" />
      </InPlaceDialog>,
    );
    fireEvent.click(row('one'));
    fireEvent.keyDown(logLines(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Line details' })).toBeNull();
    fireEvent.keyDown(logLines(), { key: 'Escape' });
    expect(row('one')).toHaveAttribute('aria-selected', 'false');
    expect(onClose).not.toHaveBeenCalled();
    // With nothing left to close in the pane, Esc is device control's.
    fireEvent.keyDown(logLines(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the shared empty state for a platform with no live logs', () => {
    const { container } = render(<LogcatView udid="DEV-1" platform="tvos" />);
    expect(container.querySelector('.empty-state')).toBeTruthy();
    expect(screen.queryByText(/logcat|os_trace/i)).toBeNull();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LogcatView from './LogcatView';

// jsdom does not implement scrollIntoView; LogcatView's follow-mode effect
// calls it on every render, so every test needs a stub or the component
// throws on mount.
Element.prototype.scrollIntoView = vi.fn();

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

beforeEach(() => {
  mockStream.mockReset();
  mockStream.mockReturnValue(streamState());
});

describe('LogcatView', () => {
  it('renders an unsupported state for a non-Android device', () => {
    render(<LogcatView udid="DEV-1" platform="ios" />);
    expect(screen.getByText(/Android only/i)).toBeTruthy();
  });

  it('does not open a stream for a non-Android device', () => {
    render(<LogcatView udid="DEV-1" platform="ios" />);
    // second arg is `enabled`
    expect(mockStream).toHaveBeenCalledWith('DEV-1', false);
  });

  it('opens a stream for an Android device', () => {
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(mockStream).toHaveBeenCalledWith('DEV-1', true);
  });

  it('renders a record across its columns', () => {
    mockStream.mockReturnValue(streamState({ records: [rec()] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('Tile.WifiTile')).toBeTruthy();
    expect(screen.getByText('com.android.systemui')).toBeTruthy();
    expect(screen.getByText('handleUpdateState')).toBeTruthy();
    expect(screen.getByText('1408-1408')).toBeTruthy();
  });

  it('shows LIVE when connected and CONNECTING when not', () => {
    mockStream.mockReturnValue(streamState({ connected: false }));
    const { unmount } = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('CONNECTING')).toBeTruthy();
    unmount();

    mockStream.mockReturnValue(streamState({ connected: true }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('LIVE')).toBeTruthy();
  });

  it('shows the visible / total counts', () => {
    mockStream.mockReturnValue(streamState({ records: [rec(), rec({ tag: 'Other' })] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });

  it('marks synthetic records so they are not mistaken for device output', () => {
    mockStream.mockReturnValue(
      streamState({
        records: [rec({ synthetic: true, level: 'W', tag: 'xenon', message: '3 lines dropped' })],
      }),
    );
    const { container } = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(container.querySelector('.logcat-row.is-synthetic')).toBeTruthy();
  });

  // Correction 1: a 1008 (ownership/ticket) denial is terminal — the hook
  // surfaces it as `deniedReason` rather than silently retrying forever. The
  // view's job is to show that reason to the user, distinctly from the
  // ordinary CONNECTING state.
  it('surfaces the denial reason instead of showing CONNECTING', () => {
    mockStream.mockReturnValue(
      streamState({ connected: false, deniedReason: 'device held by another user' }),
    );
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('DENIED')).toBeTruthy();
    expect(screen.queryByText('CONNECTING')).toBeNull();
    expect(screen.getByText(/device held by another user/)).toBeTruthy();
  });

  // Correction 3: exhausting MAX_ATTEMPTS must be visible and recoverable —
  // not an indefinite CONNECTING pill. A RECONNECT control must be present
  // and must call the hook's retry().
  it('shows a terminal offline state with a manual reconnect once retries are exhausted', () => {
    const retry = vi.fn();
    mockStream.mockReturnValue(streamState({ connected: false, exhausted: true, retry }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('OFFLINE')).toBeTruthy();
    expect(screen.queryByText('CONNECTING')).toBeNull();
    const reconnectBtn = screen.getByRole('button', { name: /reconnect/i });
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

  // REWRITTEN (was: "lets the level dropdown override a conflicting level:
  // term typed in the search box"). That test asserted a contract built on
  // two independent states — a `minLevel` the dropdown owned, reconciled with
  // `query` only at filter time — under which the dropdown always won. The
  // same design made `level:` unreachable from the text box (below), so it
  // could not stay. The query string is now the single source of truth and
  // the LAST control the user touched wins. The old test's actual regression
  // guard — setLevelTerm rather than string concatenation, so exactly one
  // `level:` term survives and parseQuery's last-token-wins cannot contradict
  // the dropdown — is preserved in the agreement test below.

  // The documented `level:` grammar has to work from the text box. It did
  // not: with the dropdown holding its own (empty) state, every filter pass
  // ran setLevelTerm(query, '') — and a falsy level makes setLevelTerm STRIP
  // the level term, so the one the user just typed was silently deleted.
  it('applies a level: term typed into the filter box while the dropdown is on All levels', () => {
    mockStream.mockReturnValue(
      streamState({
        records: [
          rec({ level: 'D', message: 'debug line' }),
          rec({ level: 'E', message: 'error line' }),
        ],
      }),
    );
    render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('2 / 2')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'level:E' } });

    expect(screen.queryByText('debug line')).toBeNull();
    expect(screen.getByText('error line')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  // "A level dropdown in the toolbar writes `level:` into the same query, so
  // the control and the text box cannot disagree." Two states could, and did:
  // box showing `level:E` while the dropdown showed W, W winning, no cue.
  it('keeps the dropdown and the filter box in agreement, whichever one is used', () => {
    mockStream.mockReturnValue(streamState({ records: [rec()] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    const box = screen.getByLabelText('Filter logs') as HTMLInputElement;
    const dropdown = screen.getByLabelText('Minimum log level') as HTMLSelectElement;

    // Typing moves the dropdown. parseQuery is last-token-wins, so the
    // trailing level:D is the one in effect and the one displayed.
    fireEvent.change(box, { target: { value: 'level:E tag:Tile level:D' } });
    expect(dropdown.value).toBe('D');

    // Using the dropdown rewrites the box: exactly ONE level term survives
    // (both stray ones are replaced, not merely out-voted — this is the old
    // test's setLevelTerm-not-concatenation guard), other terms untouched.
    fireEvent.change(dropdown, { target: { value: 'W' } });
    expect(box.value).toBe('level:W tag:Tile');
    expect(dropdown.value).toBe('W');

    // Back to "All levels" removes the term rather than leaving a stale one.
    fireEvent.change(dropdown, { target: { value: '' } });
    expect(box.value).toBe('tag:Tile');
    expect(dropdown.value).toBe('');
  });

  // `level:V` selects every record (V is the lowest level) and a typo'd
  // `level:X` is ignored outright by `matches`. In both cases no level
  // filtering is in effect, so "All levels" is the honest reading of the
  // query, not a disagreement with it.
  it('shows All levels for a level term that filters nothing', () => {
    mockStream.mockReturnValue(streamState({ records: [rec()] }));
    render(<LogcatView udid="DEV-1" platform="android" />);
    const dropdown = screen.getByLabelText('Minimum log level') as HTMLSelectElement;

    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'level:V' } });
    expect(dropdown.value).toBe('');
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'level:X' } });
    expect(dropdown.value).toBe('');
  });

  it('labels each level option for what it actually selects', () => {
    render(<LogcatView udid="DEV-1" platform="android" />);
    const labels = Array.from(
      screen.getByLabelText('Minimum log level').querySelectorAll('option'),
    ).map((o) => o.textContent);

    // No "V and above": V is the lowest level, so it is "All levels" said
    // twice. No "F and above": nothing is above F.
    expect(labels).toEqual([
      'All levels',
      'D and above',
      'I and above',
      'W and above',
      'E and above',
      'F only',
    ]);
  });

  // Correction 4 (view half): FREEZE only pauses auto-scroll — the hook has
  // no notion of "frozen" and keeps delivering records regardless. A record
  // that arrives while frozen must still be in the DOM (off-screen is fine;
  // dropped is not), and must not require an unfreeze to appear.
  it('keeps rendering records that arrive while frozen — FREEZE only pauses auto-scroll', () => {
    let currentRecords = [rec({ message: 'before-freeze' })];
    mockStream.mockImplementation(() => streamState({ records: currentRecords }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('before-freeze')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /freeze/i }));
    expect(screen.getByRole('button', { name: /follow/i })).toBeTruthy();

    // Simulate the hook delivering a new flushed batch while the view is
    // frozen — re-render with the same props, as the real component would
    // re-render when the mocked hook's return value changes.
    currentRecords = [...currentRecords, rec({ message: 'arrived-while-frozen' })];
    rerender(<LogcatView udid="DEV-1" platform="android" />);

    expect(screen.getByText('arrived-while-frozen')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });

  // The pill alone says OFFLINE with no explanation of what happened or that
  // the state is recoverable. Deleting the banner outright used to leave the
  // whole suite green.
  it('explains the exhausted state in an assertive banner, not just the pill', () => {
    mockStream.mockReturnValue(streamState({ connected: false, exhausted: true }));
    const { container } = render(<LogcatView udid="DEV-1" platform="android" />);

    const banner = container.querySelector('.logcat-status-banner.is-exhausted');
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
    const banner = container.querySelector('.logcat-status-banner.is-denied');
    expect(banner?.getAttribute('role')).toBe('alert');
  });

  // The `.is-error` dot was the only colour cue distinguishing "dead" from
  // "still trying", and nothing asserted it — hardcoding isErrorStatus to
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
  // index and React repatches all 5000 rows instead of dropping one.
  it('keeps a row DOM node across a front-trim of the buffer', () => {
    let current = [
      rec({ message: 'oldest' }),
      rec({ message: 'middle' }),
      rec({ message: 'newest' }),
    ];
    mockStream.mockImplementation(() => streamState({ records: current }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    const newestBefore = screen.getByText('newest').closest('.logcat-row');

    current = current.slice(1); // the buffer overflowed; the oldest is gone
    rerender(<LogcatView udid="DEV-1" platform="android" />);

    // Under index keys 'newest' moves from index 2 to index 1 and React
    // rewrites the node that used to hold 'middle' — a different element.
    expect(screen.getByText('newest').closest('.logcat-row')).toBe(newestBefore);
  });

  it('keeps the EXPORT download alive: attached anchor, deferred revoke', () => {
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
      fireEvent.click(screen.getByRole('button', { name: /export/i }));

      expect(clickSpy).toHaveBeenCalledTimes(1);
      // Firefox ignores a click on an anchor that is not in the document.
      expect(attachedAtClick).toBe(true);
      // Revoking in the same task can cancel a download that has not started
      // reading the blob yet (Firefox, Safari).
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
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

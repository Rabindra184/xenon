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

const rec = (over: Record<string, unknown> = {}) => ({
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

  // Correction 5: the level dropdown must win over a user-typed `level:` term
  // in the free-text box — setLevelTerm, not string concatenation. Regression
  // guard for the last-token-wins bug: typing `level:E` after selecting the
  // W dropdown must not resurrect an E-only view.
  it('lets the level dropdown override a conflicting level: term typed in the search box', () => {
    mockStream.mockReturnValue(
      streamState({
        records: [
          rec({ level: 'W', message: 'warn line' }),
          rec({ level: 'E', message: 'error line' }),
        ],
      }),
    );
    render(<LogcatView udid="DEV-1" platform="android" />);

    fireEvent.change(screen.getByLabelText('Minimum log level'), { target: { value: 'W' } });
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'level:E' } });

    // Under naive concatenation (`level:${minLevel} ${query}`), the
    // user-typed `level:E` would win (last-token-wins) and hide the W line.
    // setLevelTerm keeps the dropdown's W authoritative, so both lines show.
    expect(screen.getByText('warn line')).toBeTruthy();
    expect(screen.getByText('error line')).toBeTruthy();
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
});

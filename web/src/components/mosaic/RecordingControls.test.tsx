import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RecordingControls } from './RecordingControls';

vi.mock('../../api-service/recordings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api-service/recordings')>()),
  stopRecording: vi.fn().mockResolvedValue({
    recordings: [{ status: 'STOPPED', sizeBytes: 4096 }],
  }),
}));
import {
  MosaicContext,
  initialMosaicState,
  mosaicReducer,
  type MosaicState,
} from './recording-group-store';

function recording(annotateMode: boolean, withMarks: boolean): MosaicState {
  let s = mosaicReducer(initialMosaicState, {
    type: 'ADD_TILE',
    tile: { udid: 'u1', mjpegPort: 0 },
  });
  s = mosaicReducer(s, {
    type: 'START_RECORDING',
    groupId: 'g',
    startedAt: Date.now(),
    tileIds: { u1: 'r1' },
  });
  s = mosaicReducer(s, { type: 'SET_ANNOTATE_MODE', enabled: annotateMode });
  if (withMarks) {
    s = mosaicReducer(s, {
      type: 'SET_OVERLAY_ANNOTATIONS',
      recordingId: 'r1',
      annotations: [{ shape: 'RECT', color: 'red', geometry: { x: 0, y: 0, w: 0.1, h: 0.1 } }],
    });
  }
  return s;
}

function idleWithTile(): MosaicState {
  return mosaicReducer(initialMosaicState, {
    type: 'ADD_TILE',
    tile: { udid: 'u1', mjpegPort: 0 },
  });
}

function stopped(): MosaicState {
  return mosaicReducer(recording(false, false), {
    type: 'STOP_RECORDING',
    downloadableVideoCount: 1,
    compositeEnabled: false,
  });
}

function mount(state: MosaicState, dispatch = vi.fn()) {
  return render(
    <MosaicContext.Provider value={{ state, dispatch }}>
      <RecordingControls selectedUdids={['u1']} onClearMarks={vi.fn()} />
    </MosaicContext.Provider>,
  );
}

// Names only: the REC timer's text changes every second and is not a button.
const buttonNames = () => screen.getAllByRole('button').map((b) => b.textContent?.trim());

// The button's accessible name comes from its `title` here, so Clear is matched
// by prefix rather than by its visible label.
describe('RecordingControls toolbar', () => {
  // Controls appearing and disappearing in a right-aligned row slid every
  // button under the cursor: a click meant for Arrow landed on Clear marks.
  it('renders the same buttons whether or not annotate is on or marks exist', () => {
    const { unmount } = mount(recording(false, false));
    const off = buttonNames();
    unmount();
    mount(recording(true, true));
    expect(buttonNames()).toEqual(off);
  });

  it('disables rather than hides: shapes when annotate is off, Clear when there are no marks', () => {
    mount(recording(false, false));
    expect((screen.getByRole('button', { name: 'Rect' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: /^clear marks/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('enables the shapes and Clear once annotating with marks', () => {
    mount(recording(true, true));
    expect((screen.getByRole('button', { name: 'Rect' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      (screen.getByRole('button', { name: /^clear marks/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('has no Bookmark option', () => {
    mount(recording(true, true));
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
  });
});

describe('RecordingControls labels', () => {
  // The buttons used text symbols as icons (⏹ Stop, ✎ Annotate), which a
  // screen reader reads out as part of the name.
  it('labels its buttons in words', () => {
    mount(idleWithTile());
    // Interact / Annotate are the switch's tabs, not buttons.
    expect(buttonNames()).toEqual(['Record', 'Stop']);
  });

  it('labels the download link in words', () => {
    const { container } = mount(stopped());
    expect(container.querySelector('a[download]')?.textContent?.trim()).toBe('Download video');
  });

  // A greyed-out Record button sat beside the timer for the whole recording.
  it('shows the REC timer in place of Record while recording', () => {
    mount(recording(false, false));
    expect(buttonNames()).not.toContain('Record');
    expect(screen.getByText(/REC/)).toBeInTheDocument();
  });

  // The download button is in the toolbar above the banner, not below it.
  it('points up to the download button when the video is ready', async () => {
    const dispatch = vi.fn();
    mount(recording(false, false), dispatch);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });
    const messages = dispatch.mock.calls
      .map(([a]) => a)
      .filter((a) => a.type === 'SET_BANNER' && a.banner)
      .map((a) => a.banner.message as string);
    expect(messages).toEqual(['Video ready. Download it with the button above.']);
  });

  it('does not call the grid a mosaic', () => {
    const { container } = mount(idleWithTile());
    const titles = Array.from(container.querySelectorAll('[title]')).map((e) =>
      e.getAttribute('title'),
    );
    expect(titles.filter((t) => /mosaic/i.test(t ?? ''))).toEqual([]);
  });
});

describe('Interact / Annotate switch', () => {
  const tab = (name: string) => screen.getByRole('tab', { name }) as HTMLButtonElement;

  it('shows Interact selected and Annotate unavailable before recording', () => {
    mount(idleWithTile());
    expect(tab('Interact')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Annotate')).toBeDisabled();
    expect(tab('Annotate')).toHaveAttribute('title', 'Start recording to annotate');
  });

  it('starts a recording on Interact, with the drawing tools off', () => {
    const s = mosaicReducer(idleWithTile(), {
      type: 'START_RECORDING',
      groupId: 'g',
      startedAt: Date.now(),
      tileIds: { u1: 'r1' },
    });
    mount(s);
    expect(tab('Interact')).toHaveAttribute('aria-selected', 'true');
    expect((screen.getByRole('button', { name: 'Rect' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('switches to Annotate on click', () => {
    const dispatch = vi.fn();
    mount(recording(false, false), dispatch);
    fireEvent.click(tab('Annotate'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ANNOTATE_MODE', enabled: true });
  });

  it('declares Esc as the way back to Interact', () => {
    mount(recording(true, false));
    expect(tab('Interact')).toHaveAttribute('aria-keyshortcuts', 'Escape');
  });

  it('returns to Interact on Esc while annotating', () => {
    const dispatch = vi.fn();
    mount(recording(true, false), dispatch);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ANNOTATE_MODE', enabled: false });
  });

  it('ignores Esc typed into a text field', () => {
    const dispatch = vi.fn();
    mount(recording(true, false), dispatch);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    input.remove();
    expect(dispatch).not.toHaveBeenCalled();
  });

  // In Interact mode a focused Android tile sends Esc to the phone as Back.
  it('leaves Esc alone when not annotating', () => {
    const dispatch = vi.fn();
    mount(recording(false, false), dispatch);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

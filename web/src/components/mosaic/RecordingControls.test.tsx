import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordingControls } from './RecordingControls';
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

function mount(state: MosaicState) {
  return render(
    <MosaicContext.Provider value={{ state, dispatch: vi.fn() }}>
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

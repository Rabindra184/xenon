import { describe, expect, it } from 'vitest';
import type { SetupProgress } from '../src/shared/types';
import {
  SETUP_INTERRUPTED,
  iphoneSetupSkipped,
  mergeProgress,
  rowDetail,
  rowState,
  runShownFor,
  setupSummary,
  stepLabel,
} from '../src/renderer/src/setupProgress';
import { GO_IOS_SKIP_NOTE } from '../src/shared/setupNotes';
import { planGoIosStep } from '../src/main/setupPlan';

const row = (step: string, done: boolean, ok = true, detail = ''): SetupProgress => ({
  step,
  done,
  ok,
  detail,
});

describe('mergeProgress', () => {
  it('appends a step it has not seen', () => {
    expect(mergeProgress([], row('locate-appium', false))).toEqual([row('locate-appium', false)]);
  });

  it('keeps one row per step: the end event replaces the start event', () => {
    const started = mergeProgress([], row('install-plugin', false, true, 'appium plugin install xenon'));
    const ended = mergeProgress(started, row('install-plugin', true, true, 'ok'));
    expect(ended).toEqual([row('install-plugin', true, true, 'ok')]);
  });

  it('lets the latest state win when a step fails', () => {
    const rows = mergeProgress([row('install-go-ios', false)], row('install-go-ios', true, false, 'npm failed'));
    expect(rows).toEqual([row('install-go-ios', true, false, 'npm failed')]);
  });

  it('orders rows by first appearance, not by latest update', () => {
    let rows: SetupProgress[] = [];
    for (const p of [
      row('locate-appium', false),
      row('locate-appium', true),
      row('install-plugin', false),
      row('install-driver:xcuitest', false),
      row('install-plugin', true),
      row('install-driver:xcuitest', true),
    ]) {
      rows = mergeProgress(rows, p);
    }
    expect(rows.map((r) => r.step)).toEqual(['locate-appium', 'install-plugin', 'install-driver:xcuitest']);
    expect(rows.every((r) => r.done)).toBe(true);
  });

  it('does not mutate the rows it is given', () => {
    const prev = [row('locate-appium', false)];
    const next = mergeProgress(prev, row('locate-appium', true));
    expect(prev).toEqual([row('locate-appium', false)]);
    expect(next).not.toBe(prev);
  });
});

describe('stepLabel', () => {
  it.each([
    ['locate-appium', 'Finding Appium'],
    ['plugin-source', 'Choosing where to get Xenon'],
    ['uninstall-plugin', 'Removing the old Xenon'],
    ['install-plugin', 'Installing Xenon'],
    ['update-plugin', 'Updating Xenon'],
    ['install-driver:uiautomator2', 'Installing Android support'],
    ['install-driver:xcuitest', 'Installing iOS support'],
    ['install-go-ios', 'Installing real-iPhone support'],
    ['verify-plugin', 'Checking the install'],
  ])('maps %s to plain words', (step, label) => {
    expect(stepLabel(step)).toBe(label);
  });

  it('returns an unknown id unchanged', () => {
    expect(stepLabel('something-new')).toBe('something-new');
  });
});

describe('setupSummary', () => {
  it('says setup finished on success', () => {
    expect(setupSummary({ ok: true, failedStep: null })).toEqual({
      message: 'Setup finished',
      kind: 'success',
    });
  });

  it('names the failed step in plain words', () => {
    expect(setupSummary({ ok: false, failedStep: 'install-go-ios' })).toEqual({
      message: "Setup didn't finish: Installing real-iPhone support failed. See the steps on Setup.",
      kind: 'error',
    });
  });

  it('still ends honestly when the failed step is unknown', () => {
    expect(setupSummary({ ok: false, failedStep: null })).toEqual({
      message: "Setup didn't finish: Something failed. See the steps on Setup.",
      kind: 'error',
    });
  });
});

describe('SETUP_INTERRUPTED', () => {
  // What ends a run whose request itself failed, so there is no result to summarise.
  it('says setup did not finish and points at the steps, as an error', () => {
    expect(SETUP_INTERRUPTED).toEqual({
      message: "Setup didn't finish. See the steps on Setup.",
      kind: 'error',
    });
  });
});

describe('GO_IOS_SKIP_NOTE', () => {
  it('is exactly the note main emits when the installed plugin has no go-ios installer', () => {
    expect(GO_IOS_SKIP_NOTE).toBe(
      "This Xenon version can't set up iPhones from here. Update Xenon, then run Set up again.",
    );
    expect(planGoIosStep({ platform: 'both', pluginDir: '/p', scriptExists: false })).toEqual({
      kind: 'skip',
      detail: GO_IOS_SKIP_NOTE,
    });
  });
});

describe('rowState / rowDetail', () => {
  const start = row('install-plugin', false, false, 'appium plugin install --source=local /repo');
  const ok = row('install-plugin', true, true, 'ok');
  const failed = row('install-go-ios', true, false, 'npm failed: ENOTFOUND');
  const skipped = row('install-go-ios', true, true, GO_IOS_SKIP_NOTE);

  it('a started row is running and shows no detail (its detail is the raw command line)', () => {
    expect(rowState(start)).toBe('running');
    expect(rowDetail(start)).toBeNull();
  });

  it('a finished ok row is ok and shows no detail', () => {
    expect(rowState(ok)).toBe('ok');
    expect(rowDetail(ok)).toBeNull();
    expect(rowState(row('install-driver:xcuitest', true, true, 'already installed'))).toBe('ok');
    expect(rowDetail(row('install-driver:xcuitest', true, true, 'already installed'))).toBeNull();
  });

  it('a failed row is failed and shows the raw detail', () => {
    expect(rowState(failed)).toBe('failed');
    expect(rowDetail(failed)).toBe('npm failed: ENOTFOUND');
  });

  it('a failed row with no detail has nothing to show', () => {
    expect(rowDetail(row('verify-plugin', true, false, ''))).toBeNull();
  });

  it('a finished go-ios row carrying the skip note is a note, not a tick, and shows the note', () => {
    expect(rowState(skipped)).toBe('note');
    expect(rowDetail(skipped)).toBe(GO_IOS_SKIP_NOTE);
  });

  it('a go-ios row that succeeded normally stays ok', () => {
    const done = row('install-go-ios', true, true, 'go-ios v1.2.1 installed');
    expect(rowState(done)).toBe('ok');
    expect(rowDetail(done)).toBeNull();
  });

  it('the skip note on some other step is not treated as a note', () => {
    expect(rowState(row('install-plugin', true, true, GO_IOS_SKIP_NOTE))).toBe('ok');
  });

  it('a running go-ios row is running even if it somehow carries the note', () => {
    expect(rowState(row('install-go-ios', false, false, GO_IOS_SKIP_NOTE))).toBe('running');
  });
});

describe('iphoneSetupSkipped', () => {
  it('is true when the go-ios row is the skip note', () => {
    expect(iphoneSetupSkipped([row('install-plugin', true), row('install-go-ios', true, true, GO_IOS_SKIP_NOTE)])).toBe(
      true,
    );
  });

  it('is false for a normal run, an empty run, and a failed go-ios step', () => {
    expect(iphoneSetupSkipped([row('install-plugin', true), row('install-go-ios', true, true, 'done')])).toBe(false);
    expect(iphoneSetupSkipped([])).toBe(false);
    expect(iphoneSetupSkipped([row('install-go-ios', true, false, 'npm failed')])).toBe(false);
  });
});

describe('setupSummary with a skipped iPhone step', () => {
  it('does not say "Setup finished" when iPhone setup was skipped', () => {
    expect(setupSummary({ ok: true, failedStep: null }, { iphoneSkipped: true })).toEqual({
      message: 'Setup finished, but iPhones still need attention. See the steps on Setup.',
      kind: 'error',
    });
  });

  it('still says "Setup finished" when nothing was skipped', () => {
    expect(setupSummary({ ok: true, failedStep: null }, { iphoneSkipped: false })).toEqual({
      message: 'Setup finished',
      kind: 'success',
    });
    expect(setupSummary({ ok: true, failedStep: null })).toEqual({ message: 'Setup finished', kind: 'success' });
  });

  it('a failed run reports the failure, whether or not iPhones were skipped', () => {
    expect(setupSummary({ ok: false, failedStep: 'install-plugin' }, { iphoneSkipped: true })).toEqual({
      message: "Setup didn't finish: Installing Xenon failed. See the steps on Setup.",
      kind: 'error',
    });
  });
});

describe('runShownFor: a Set up run’s steps and summary belong to the profile it ran for', () => {
  const steps = [row('locate-appium', true), row('install-plugin', true)];
  const finished = { message: 'Setup finished', kind: 'success' as const };
  const run = { profileId: 'a', progress: steps, summary: finished };

  it('shows them on that profile', () => {
    expect(runShownFor(run, 'a')).toEqual({ progress: steps, summary: finished });
  });

  it('shows nothing of them on another profile', () => {
    expect(runShownFor(run, 'b')).toEqual({ progress: [], summary: null });
    expect(runShownFor(run, null)).toEqual({ progress: [], summary: null });
  });

  it('shows nothing before any run', () => {
    expect(runShownFor({ profileId: null, progress: [], summary: null }, 'a')).toEqual({ progress: [], summary: null });
  });
});

import { describe, expect, it } from 'vitest';
import type { SetupProgress } from '../src/shared/types';
import { mergeProgress, setupSummary, stepLabel } from '../src/renderer/src/setupProgress';

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
      message: "Setup didn't finish: Installing real-iPhone support failed. See the steps on the Health tab.",
      kind: 'error',
    });
  });

  it('still ends honestly when the failed step is unknown', () => {
    expect(setupSummary({ ok: false, failedStep: null })).toEqual({
      message: "Setup didn't finish: Something failed. See the steps on the Health tab.",
      kind: 'error',
    });
  });
});

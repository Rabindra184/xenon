import { describe, expect, it } from 'vitest';
import { clipboardError, errorReason } from './actionMessages';

describe('errorReason', () => {
  it('uses the error’s message, else nothing', () => {
    expect(errorReason(new Error('not installed'))).toBe('not installed');
    expect(errorReason({ message: '  ' })).toBe('');
    expect(errorReason(undefined)).toBe('');
  });
});

describe('clipboardError', () => {
  // The Android hint showed on iOS too, where the clipboard comes from
  // WebDriverAgent and Appium Settings doesn't exist.
  it('points Android at Appium Settings', () => {
    expect(clipboardError('android', new Error('x'))).toBe(
      'Couldn’t read the clipboard. Check that the Appium Settings app is installed on the device.',
    );
  });

  it('gives iOS the actual reason', () => {
    expect(clipboardError('ios', new Error('WDA is not running'))).toBe(
      'Couldn’t read the clipboard: WDA is not running',
    );
    expect(clipboardError('ios', undefined)).toBe('Couldn’t read the clipboard.');
  });
});

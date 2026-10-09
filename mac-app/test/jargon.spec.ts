import { describe, expect, it } from 'vitest';
import { findJargon } from './e2e/jargon';

describe('findJargon', () => {
  it('passes plain words', () => {
    expect(findJargon('Tests at the same time', ['maxSessions'])).toEqual([]);
  });

  it('finds an option key used as a word', () => {
    expect(findJargon('maxSessions is 8', ['maxSessions'])).toEqual(['maxSessions']);
  });

  it('only counts an option key as a whole word', () => {
    expect(findJargon('maxSessionsTotal is 8', ['maxSessions'])).toEqual([]);
  });

  it('leaves option keys with no capital letter alone, since they read as words', () => {
    expect(findJargon('Share with a hub', ['hub'])).toEqual([]);
  });

  it('finds an environment name', () => {
    expect(findJargon('Set APPIUM_HOME', [])).toEqual(['APPIUM_HOME']);
  });

  it('lets HTTP, HTTPS and JSON through', () => {
    expect(findJargon('Use HTTP or HTTPS and paste JSON', [])).toEqual([]);
  });

  it('finds each command', () => {
    expect(findJargon('Run npm i -g appium', [])).toEqual(['npm', 'appium']);
    expect(findJargon('Run brew install go-ios', [])).toEqual(['brew']);
    expect(findJargon('Run xcode-select --install', [])).toEqual(['xcode-select']);
  });

  it('lets Appium in a sentence through', () => {
    expect(findJargon('Appium isn’t installed on this Mac.', [])).toEqual([]);
  });

  it('finds an absolute path', () => {
    expect(findJargon('Saved to /Users/qa/x/', [])).toHaveLength(1);
    expect(findJargon('In ~/.appium/node_modules/ now', [])).toHaveLength(1);
  });

  it('does not count a web address as a path', () => {
    expect(findJargon('http://localhost:4723/wd/hub', [])).toEqual([]);
  });

  it('returns every hit', () => {
    expect(findJargon('Set ANDROID_HOME, then run npm install in /opt/x/', ['maxSessions'])).toEqual([
      'ANDROID_HOME',
      'npm',
      '/opt/x/'
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { exportNotice } from '../src/renderer/src/exportNotice';

describe('exportNotice', () => {
  it('says nothing when nothing was left out', () => {
    expect(exportNotice([], false)).toBeNull();
    expect(exportNotice([], true)).toBeNull();
  });

  it('says one secret value was left out, in the singular', () => {
    expect(exportNotice(['MY_TOKEN'], false)).toBe('1 secret value was left out — enter it again after importing');
  });

  it('says how many secret values were left out, in the plural', () => {
    expect(exportNotice(['A_KEY', 'B_KEY', 'cloud.apiKey'], false)).toBe(
      '3 secret values were left out — enter them again after importing'
    );
    expect(exportNotice(['A_KEY', 'B_KEY'], false)).toBe('2 secret values were left out — enter them again after importing');
  });

  it('lists the names after the sentence when technical details are on', () => {
    expect(exportNotice(['DATABASE_URL', 'cloud.apiKey', 'proxy.auth.password'], true)).toBe(
      '3 secret values were left out — enter them again after importing: DATABASE_URL, cloud.apiKey, proxy.auth.password'
    );
    expect(exportNotice(['MY_TOKEN'], true)).toBe(
      '1 secret value was left out — enter it again after importing: MY_TOKEN'
    );
  });

  it('keeps names out of the sentence when technical details are off', () => {
    expect(exportNotice(['DATABASE_URL', 'cloud.apiKey'], false)).not.toMatch(/DATABASE_URL|cloud\.apiKey/);
  });
});

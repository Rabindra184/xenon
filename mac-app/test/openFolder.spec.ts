import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHELL } from '../src/renderer/src/copy/shell';
import { _resetToasts, subscribeToasts, type Toast } from '../src/renderer/src/components/ui/toastStore';
import { openFolder } from '../src/renderer/src/openFolder';
import type { Profile } from '../src/shared/types';

// R82: Open log folder and Open Appium folder say so when the folder can't be opened (a file, or not
// there), instead of doing nothing at all.
let shown: Toast[] = [];
let unsubscribe: () => void;
const openPath = vi.fn<(kind: string, profile?: Profile) => Promise<string>>();

beforeEach(() => {
  _resetToasts();
  shown = [];
  unsubscribe = subscribeToasts((t) => (shown = [...t]));
  openPath.mockReset();
  vi.stubGlobal('window', { xenon: { server: { openPath } } });
});

afterEach(() => {
  unsubscribe();
  vi.unstubAllGlobals();
});

describe('openFolder (R82)', () => {
  it('says nothing when the folder opened', async () => {
    openPath.mockResolvedValue('');
    await openFolder('logs');
    expect(openPath).toHaveBeenCalledWith('logs', undefined);
    expect(shown).toEqual([]);
  });

  it.each(['That isn’t a folder, so it wasn’t opened.', 'That folder isn’t there.', 'Failed to open path'])(
    'shows a plain error toast when main answers %j',
    async (answer) => {
      openPath.mockResolvedValue(answer);
      const profile = { id: 'p', server: { appiumHome: '/x/setup.command' } } as unknown as Profile;
      await openFolder('appiumHome', profile);
      expect(openPath).toHaveBeenCalledWith('appiumHome', profile);
      expect(shown).toMatchObject([{ message: SHELL.openFolderFailed, kind: 'error' }]);
    }
  );

  it('shows the same toast when the request itself fails', async () => {
    openPath.mockRejectedValue(new Error('Error invoking remote method'));
    await openFolder('logs');
    expect(shown).toMatchObject([{ message: SHELL.openFolderFailed, kind: 'error' }]);
  });

  it('words it plainly', () => {
    expect(SHELL.openFolderFailed).toBe('Couldn’t open that folder.');
  });
});

import type { Profile } from '@shared/types';
import { toast } from './components/ui/toastStore';
import { SHELL } from './copy/shell';

/**
 * Opens the log folder or a profile's Appium folder in Finder (Open log folder, Open Appium folder).
 * Main opens only a folder that is one (M8) and answers '' when it did; anything else, or a request
 * that failed, is said in an error toast rather than nothing at all (R82).
 */
export async function openFolder(kind: 'logs' | 'appiumHome', profile?: Profile): Promise<void> {
  let answer: string;
  try {
    answer = await window.xenon.server.openPath(kind, profile);
  } catch {
    answer = 'failed';
  }
  if (answer !== '') toast(SHELL.openFolderFailed, 'error');
}

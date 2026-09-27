export type DeviceView = 'cards' | 'table';
export const VIEW_KEY = 'xenon.devices.view';

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The URL's view if it names one, else the stored choice. */
export function parseView(params: URLSearchParams, stored: DeviceView): DeviceView {
  const v = params.get('view');
  return v === 'table' || v === 'cards' ? v : stored;
}

/**
 * The table always goes in the URL. Cards only goes in when it disagrees
 * with the stored preference — otherwise a `?view=cards` link can't outlive
 * the first filter change or keystroke: with `table` stored, writing the URL
 * from `view` alone would drop `view=cards` on the next `write()` and the
 * page would flip to the table underneath the user.
 */
export function viewToParams(params: URLSearchParams, view: DeviceView, stored: DeviceView): void {
  if (view === 'table' || view !== stored) params.set('view', view);
  else params.delete('view');
}

export function loadView(storage: Pick<Storage, 'getItem'> | null = browserStorage()): DeviceView {
  try {
    return storage?.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}

export function saveView(
  view: DeviceView,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  try {
    storage?.setItem(VIEW_KEY, view);
  } catch {
    // Blocked or full storage: the choice holds for this visit only.
  }
}

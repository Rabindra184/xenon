// Checked by `npm run typecheck` (tsconfig.web.json includes test/renderer), not run: the window
// must handle every menu action it is sent, so a new MenuAction fails to compile until it does.
import type { MenuHandlers } from '../../src/renderer/src/hooks/useMenuActions';

const noop = (): void => undefined;

export const everyHandler: MenuHandlers = {
  'new-profile': noop,
  'import-profiles': noop,
  'export-profile': noop,
  'manage-profiles': noop,
  'toggle-server': noop,
  'start-server': noop,
  'launch-preview': noop,
  'export-config': noop
};

// @ts-expect-error Export Config… has no handler: a forgotten action does not compile.
export const oneLeftOut: MenuHandlers = {
  'new-profile': noop,
  'import-profiles': noop,
  'export-profile': noop,
  'manage-profiles': noop,
  'toggle-server': noop,
  'start-server': noop,
  'launch-preview': noop
};

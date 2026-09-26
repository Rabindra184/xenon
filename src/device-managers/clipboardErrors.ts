/**
 * A clipboard operation this device can't do at all, as opposed to one that
 * failed this time. The control route answers 501 for it: retrying won't help.
 */
export class ClipboardUnsupportedError extends Error {
  readonly code = 'clipboard_unsupported';

  constructor(message: string) {
    super(message);
    this.name = 'ClipboardUnsupportedError';
  }
}

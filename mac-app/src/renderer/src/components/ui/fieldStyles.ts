// The look every text-like input shares. The boundary is `dim` (3:1 against the
// page), or the full danger colour when the value is wrong; the `line` colour is
// only for decorative separators. 32 px tall, so well over the 24 px target.
export function inputClasses(invalid: boolean): string {
  return [
    'focus-ring h-8 rounded-md border bg-surface2 px-2 text-sm text-ink placeholder:text-dim disabled:opacity-50',
    invalid ? 'border-danger' : 'border-dim'
  ].join(' ');
}

export const LABEL_CLASSES = 'text-sm font-medium text-ink';
export const ERROR_CLASSES = 'text-xs font-medium text-danger';

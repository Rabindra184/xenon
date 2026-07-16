import { useEffect, useState } from 'react';
import { parseJsonDraft } from '../../schemaForm';
import { cn } from '../../cn';

/**
 * JSON editor with an explicit invalid state: the draft text is kept (never
 * silently discarded) and a parse error is shown until the user fixes it.
 * Commits on blur; empty text unsets the value.
 */
export function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const committed = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(committed);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Follow external value changes (e.g. profile switch) unless the user is mid-edit.
  useEffect(() => {
    if (!dirty) setText(committed);
  }, [committed, dirty]);

  const commit = () => {
    const res = parseJsonDraft(text);
    if (res.ok) {
      setError(null);
      setDirty(false);
      onChange(res.value);
    } else {
      setError(res.error);
    }
  };

  return (
    <>
      <textarea
        value={text}
        placeholder="JSON"
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onBlur={commit}
        rows={4}
        aria-invalid={!!error}
        className={cn(
          'focus-ring w-full rounded-md border bg-surface2 px-2 py-1 font-mono text-xs text-ink',
          error ? 'border-danger/60' : 'border-line-strong'
        )}
      />
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';
import { addChip, removeChip } from '../../editorModel';

/** String-array editor: type + Enter to add, × to remove. Empty list = unset. */
export function ChipListEditor({
  value,
  onChange,
  placeholder
}: {
  value: string[];
  onChange: (v: string[] | undefined) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const next = addChip(value, draft);
    if (next !== value) onChange(next);
    setDraft('');
  };

  const remove = (i: number) => {
    const next = removeChip(value, i);
    onChange(next.length ? next : undefined);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface2 px-2 py-1.5">
      {value.map((chip, i) => (
        <span
          key={chip}
          className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-ink"
        >
          {chip}
          <button onClick={() => remove(i)} aria-label={`Remove ${chip}`} className="focus-ring rounded text-dim hover:text-danger">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder ?? 'add + Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        className="focus-ring min-w-[8rem] flex-1 rounded bg-transparent px-1 py-0.5 font-mono text-xs text-ink placeholder:text-dim"
      />
    </div>
  );
}

import React from 'react';
import { tokenizeJson, prettyJson, type JsonToken } from './log-derive';

interface Props {
  value: unknown;
  /** Optional max-height before scrolling. Default: no limit. */
  maxHeightPx?: number;
}

const tokenCls: Record<JsonToken['kind'], string> = {
  key:     'text-[var(--blue)]',
  string:  'text-[var(--green)]',
  number:  'text-[var(--amber)]',
  boolean: 'text-[var(--amber)]',
  null:    'text-[var(--text-dim)] italic',
  punct:   'text-[var(--text-muted)]',
  plain:   'text-[var(--text)]',
};

export const JsonBlock: React.FC<Props> = ({ value, maxHeightPx }) => {
  const pretty = prettyJson(value);
  if (!pretty) {
    return <span className="text-[var(--text-dim)] text-xs">(empty)</span>;
  }
  let tokens: JsonToken[];
  try {
    tokens = tokenizeJson(pretty);
  } catch {
    tokens = [{ text: pretty, kind: 'plain' }];
  }
  return (
    <pre
      className="font-mono text-[11px] leading-relaxed bg-[var(--bg)] border border-[var(--border)] rounded-md p-3 overflow-x-auto whitespace-pre"
      style={maxHeightPx ? { maxHeight: maxHeightPx, overflowY: 'auto' } : undefined}
    >
      {tokens.map((t, i) => (
        <span key={i} className={tokenCls[t.kind]}>
          {t.text}
        </span>
      ))}
    </pre>
  );
};

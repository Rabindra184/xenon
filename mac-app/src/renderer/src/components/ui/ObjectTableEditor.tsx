import { useEffect, useState } from 'react';
import { Braces, Plus, Trash2 } from 'lucide-react';
import { rowsToValue } from '../../editorModel';
import { JsonField } from './JsonField';

/**
 * Row-per-entry editor for arrays of objects (simulators, emulators) whose item
 * shape is known from the schema. "Edit as JSON" stays available as an escape
 * hatch for shapes the table can't express.
 */
export function ObjectTableEditor({
  columns,
  value,
  onChange
}: {
  columns: string[];
  value: Array<Record<string, string>>;
  onChange: (v: Array<Record<string, string>> | undefined) => void;
}) {
  const [rows, setRows] = useState<Array<Record<string, string>>>(value);
  const [jsonMode, setJsonMode] = useState(false);

  useEffect(() => setRows(value), [value]);

  const set = (i: number, col: string, v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [col]: v } : row)));
  const commit = (next = rows) => onChange(rowsToValue(next));

  if (jsonMode) {
    return (
      <div>
        <JsonField value={value.length ? value : undefined} onChange={(v) => onChange(v as never)} />
        <button onClick={() => setJsonMode(false)} className="focus-ring mt-1 rounded text-xs text-accent">
          Edit as table
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface2 p-2">
      {rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="pb-1 text-left font-medium text-muted">
                  {c}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className="pr-2">
                    <input
                      value={row[c] ?? ''}
                      aria-label={`${c} row ${i + 1}`}
                      onChange={(e) => set(i, c, e.target.value)}
                      onBlur={() => commit()}
                      className="focus-ring w-full rounded border border-line bg-app px-1.5 py-1 font-mono text-ink"
                    />
                  </td>
                ))}
                <td className="w-6">
                  <button
                    onClick={() => {
                      const next = rows.filter((_, j) => j !== i);
                      setRows(next);
                      commit(next);
                    }}
                    aria-label="Remove row"
                    className="focus-ring rounded text-dim hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-1 flex items-center gap-3">
        <button
          onClick={() => setRows((r) => [...r, Object.fromEntries(columns.map((c) => [c, '']))])}
          className="focus-ring inline-flex items-center gap-1 rounded text-xs text-accent"
        >
          <Plus size={13} /> Add row
        </button>
        <button
          onClick={() => setJsonMode(true)}
          className="focus-ring inline-flex items-center gap-1 rounded text-xs text-dim hover:text-ink"
        >
          <Braces size={12} /> Edit as JSON
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Braces, Plus, Trash2 } from 'lucide-react';
import { rowsToValue } from '../../editorModel';
import { JsonField } from './JsonField';

/** One column: the property each entry keeps it under, and what the table calls it. */
export interface TableColumn {
  key: string;
  label: string;
}

/**
 * Row-per-entry editor for arrays of objects (simulators, emulators) whose item
 * shape is known from the schema. "Edit as JSON" stays available as an escape
 * hatch for shapes the table can't express.
 */
export function ObjectTableEditor({
  columns,
  value,
  onChange,
  labelledBy
}: {
  columns: TableColumn[];
  value: Array<Record<string, string>>;
  onChange: (v: Array<Record<string, string>> | undefined) => void;
  /** The id of the setting's name on screen: the table is a group it names. */
  labelledBy?: string;
}) {
  const [rows, setRows] = useState<Array<Record<string, string>>>(value);
  const [jsonMode, setJsonMode] = useState(false);
  // A cell's text is the table's own until the cell loses focus. The rows follow `value` only
  // when its content changes (another profile, Edit as JSON), never while a cell is being
  // edited: a save's answer brings the same rows back as new objects, and taking them then
  // would drop what is being typed.
  const editing = useRef(false);
  const followed = useRef(JSON.stringify(value));

  useEffect(() => {
    const content = JSON.stringify(value);
    if (editing.current || content === followed.current) return;
    followed.current = content;
    setRows(value);
  }, [value]);

  const set = (i: number, col: string, v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [col]: v } : row)));
  const commit = (next = rows) => onChange(rowsToValue(next));

  if (jsonMode) {
    return (
      <div>
        <JsonField labelledBy={labelledBy} value={value.length ? value : undefined} onChange={(v) => onChange(v as never)} />
        <button onClick={() => setJsonMode(false)} className="focus-ring mt-1 rounded text-xs text-accent">
          Edit as table
        </button>
      </div>
    );
  }

  return (
    <div role="group" aria-labelledby={labelledBy} className="rounded-md border border-line bg-surface2 p-2">
      {rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="pb-1 text-left font-medium text-muted">
                  {c.label}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="pr-2">
                    <input
                      value={row[c.key] ?? ''}
                      aria-label={`${c.label} row ${i + 1}`}
                      onChange={(e) => set(i, c.key, e.target.value)}
                      onFocus={() => {
                        editing.current = true;
                      }}
                      onBlur={() => {
                        editing.current = false;
                        commit();
                      }}
                      className="focus-ring w-full rounded border border-dim bg-app px-1.5 py-1 font-mono text-ink"
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
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-1 flex items-center gap-3">
        <button
          onClick={() => setRows((r) => [...r, Object.fromEntries(columns.map((c) => [c.key, '']))])}
          className="focus-ring inline-flex items-center gap-1 rounded text-xs text-accent"
        >
          <Plus size={14} /> Add row
        </button>
        <button
          onClick={() => setJsonMode(true)}
          className="focus-ring inline-flex items-center gap-1 rounded text-xs text-dim hover:text-ink"
        >
          <Braces size={14} /> Edit as JSON
        </button>
      </div>
    </div>
  );
}

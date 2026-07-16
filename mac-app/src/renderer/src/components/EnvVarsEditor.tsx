import { Plus, Trash2 } from 'lucide-react';

interface Props {
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}

// Arbitrary non-secret environment variables (e.g. OTEL_* observability config)
// injected on the Appium process at launch. Secrets take precedence over any
// same-named var here.
export function EnvVarsEditor({ env, onChange }: Props) {
  const rows = Object.entries(env);

  const setKey = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  };
  const setVal = (key: string, value: string) => onChange({ ...env, [key]: value });
  const remove = (key: string) => {
    const next = { ...env };
    delete next[key];
    onChange(next);
  };
  const add = () => {
    if ('' in env) return; // avoid duplicate empty key
    onChange({ ...env, '': '' });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">Environment variables</h4>
          <p className="text-xs text-muted">
            Extra non-secret vars (e.g. OTEL_EXPORTER_OTLP_ENDPOINT). Stored in the profile; injected at launch.
          </p>
        </div>
        <button onClick={add} className="focus-ring inline-flex items-center gap-1 rounded text-xs text-accent">
          <Plus size={14} /> Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-xs text-dim">No extra environment variables.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(([key, value], i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={key}
                placeholder="KEY"
                onChange={(e) => setKey(key, e.target.value.trim())}
                className="focus-ring w-1/3 rounded-md border border-line-strong bg-surface2 px-2 py-1 font-mono text-xs text-ink"
              />
              <span className="text-dim">=</span>
              <input
                value={value}
                placeholder="value"
                onChange={(e) => setVal(key, e.target.value)}
                className="focus-ring flex-1 rounded-md border border-line-strong bg-surface2 px-2 py-1 font-mono text-xs text-ink"
              />
              <button onClick={() => remove(key)} className="focus-ring rounded text-dim hover:text-danger" title="Remove" aria-label="Remove variable">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

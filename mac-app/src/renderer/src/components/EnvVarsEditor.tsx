import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { envVarSecret } from '../keyRows';
import { SETTINGS } from '../copy/settings';
import { KEYS } from '../copy/keys';

interface Props {
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}

const W = SETTINGS.technical.env;

// Arbitrary non-secret environment variables (e.g. OTEL_* observability config)
// injected on the Appium process at launch. Secrets take precedence over any
// same-named var here. A row of All settings' Technical group.
export function EnvVarsEditor({ env, onChange }: Props) {
  const headingId = useId();
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
    <div role="group" aria-labelledby={headingId} className="py-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="text-sm font-medium text-ink">
            {W.title}
          </h3>
          <p className="text-xs text-muted">{W.help}</p>
        </div>
        <button onClick={add} className="focus-ring inline-flex h-6 items-center gap-1 rounded px-1 text-xs text-accent">
          <Plus size={14} aria-hidden="true" /> {W.add}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-xs text-muted">{W.none}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(([key, value], i) => {
            const secret = envVarSecret(key);
            return (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <input
                    value={key}
                    placeholder={W.namePlaceholder}
                    aria-label={W.nameLabel(i + 1)}
                    onChange={(e) => setKey(key, e.target.value.trim())}
                    className="focus-ring h-8 w-1/3 rounded-md border border-dim bg-surface2 px-2 font-mono text-xs text-ink placeholder:text-dim"
                  />
                  <span aria-hidden="true" className="text-muted">
                    =
                  </span>
                  <input
                    value={value}
                    placeholder={W.valuePlaceholder}
                    aria-label={W.valueLabel(i + 1)}
                    onChange={(e) => setVal(key, e.target.value)}
                    className="focus-ring h-8 flex-1 rounded-md border border-dim bg-surface2 px-2 font-mono text-xs text-ink placeholder:text-dim"
                  />
                  <button
                    onClick={() => remove(key)}
                    className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:text-danger"
                    title={W.remove}
                    aria-label={W.remove}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
                {secret && (
                  // Words in the text colour, with the warning colour on the border: warning text on the
                  // page is under 4.5:1 in light.
                  <p className="mt-1 border-l-2 border-warn pl-2 text-xs text-ink">
                    {W.secretName(key, KEYS.secrets[secret].label)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

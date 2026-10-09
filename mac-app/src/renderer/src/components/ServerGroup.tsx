import { useId } from 'react';
import { SHELL } from '../copy/shell';
import { FieldFrame, fieldDescribedBy } from './ui/Field';
import { Group } from './ui/Group';
import { inputClasses } from './ui/fieldStyles';

interface Props {
  /** The port box's own text, so a half-typed or cleared value never reaches the profile as NaN. */
  portText: string;
  onPortChange: (text: string) => void;
  /** The port's problem, if any, shown under the field. */
  portError?: string;
}

const S = SHELL.settings;

/**
 * The server's port, at the top of Settings, marked with its `server.port` key
 * so a start that finds a problem can put the cursor in it. The server's other
 * settings are technical (TechnicalGroup).
 */
export function ServerGroup({ portText, onPortChange, portError }: Props) {
  const portId = useId();

  return (
    <Group title={S.server}>
      <div className="py-3">
        {/* The port commits on every valid keystroke, as Start reads it; an invalid draft blocks Start instead. */}
        <FieldFrame fieldId={portId} label={S.port} error={portError} settingKey="server.port">
          <input
            id={portId}
            type="number"
            inputMode="numeric"
            value={portText}
            onChange={(e) => onPortChange(e.target.value)}
            // A wheel over a focused number box changes it. Scrolling the page must not.
            onWheel={(e) => e.currentTarget.blur()}
            aria-invalid={portError ? true : undefined}
            aria-describedby={fieldDescribedBy(portId, { error: portError })}
            className={`${inputClasses(!!portError)} w-24`}
          />
        </FieldFrame>
      </div>
    </Group>
  );
}

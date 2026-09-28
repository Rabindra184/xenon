import * as React from 'react';
import { ArrowRightLeft, RefreshCw, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/button';
import { Select } from '../ui/select';
import { FieldGroup } from '../ui/FieldGroup';

export interface TeamOption {
  id: string;
  name: string;
}

/**
 * Shared (value '') or one of `teams`, like the Devices page's team picker.
 * An app on a team is listed, downloaded and run only by that team's members
 * and admins; a shared app by everyone.
 */
export const TeamSelect: React.FC<{
  id: string;
  value: string;
  teams: TeamOption[];
  onChange: (teamId: string) => void;
  disabled?: boolean;
}> = ({ id, value, teams, onChange, disabled }) => (
  <Select
    id={id}
    value={value}
    disabled={disabled}
    className="w-full"
    onChange={(e) => onChange(e.target.value)}
  >
    <option value="">Shared</option>
    {teams.map((t) => (
      <option key={t.id} value={t.id}>
        {t.name}
      </option>
    ))}
  </Select>
);

const TEAM_HELP = 'Members of the team can see and run it. Shared apps are open to everyone.';

/**
 * Admin upload: pick the team first, then the file. The file input lives on
 * the page (the empty state's button uses it too), so "Choose file…" hands
 * back to the caller, which opens it and closes this dialog once a file is
 * picked.
 */
export const UploadAppDialog: React.FC<{
  open: boolean;
  teams: TeamOption[];
  teamId: string;
  onTeamChange: (teamId: string) => void;
  onChooseFile: () => void;
  onClose: () => void;
}> = ({ open, teams, teamId, onTeamChange, onChooseFile, onClose }) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Upload app"
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onChooseFile}>
          <Upload size={14} className="mr-1" />
          Choose file…
        </Button>
      </>
    }
  >
    <FieldGroup label="Team" htmlFor="upload-app-team" description={TEAM_HELP}>
      <TeamSelect id="upload-app-team" value={teamId} teams={teams} onChange={onTeamChange} />
    </FieldGroup>
  </Modal>
);

/**
 * Admin "Move to team". The error stays in the dialog: a modal hides the rest
 * of the page, toasts included.
 */
export const MoveAppDialog: React.FC<{
  app: { id: string; name: string; teamId?: string | null } | null;
  teams: TeamOption[];
  onMove: (teamId: string | null) => Promise<void>;
  onClose: () => void;
}> = ({ app, teams, onMove, onClose }) => {
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(app?.teamId ?? '');
    setError(null);
  }, [app]);

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      await onMove(value || null);
    } catch (e: any) {
      setError(e?.message || 'Could not move the app');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!app}
      onClose={onClose}
      title="Move to team"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={move} disabled={busy}>
            {busy ? (
              <RefreshCw size={14} className="mr-1 animate-spin" />
            ) : (
              <ArrowRightLeft size={14} className="mr-1" />
            )}
            Move
          </Button>
        </>
      }
    >
      <p className="app-move-name">{app?.name}</p>
      <FieldGroup
        label="Team"
        htmlFor="move-app-team"
        description={TEAM_HELP}
        error={error ?? undefined}
      >
        <TeamSelect
          id="move-app-team"
          value={value}
          teams={teams}
          onChange={setValue}
          disabled={busy}
        />
      </FieldGroup>
    </Modal>
  );
};

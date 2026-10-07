import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { Profile, ServerState } from '@shared/types';
import { Badge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Sheet } from '../components/ui/Dialog';
import { TextField } from '../components/ui/TextField';
import { COMMON } from '../copy/common';
import { PROFILES } from '../copy/profiles';
import { profileName, profileSummary } from '../profileSummary';
import { profileServerBadge } from '../serverStatus';

export interface ProfilesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Profile[];
  /** The profile that is open; Export… saves this one. */
  activeId: string | null;
  /** The server's status and the profile it was started for, which its row marks. */
  server: Pick<ServerState, 'status' | 'profileId'>;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
  onExport: () => void;
  /** What the last export left out, in a sentence; null when there is nothing to say. */
  notice: string | null;
}

/** A row's button to give focus back to when what replaced it goes away. */
type Refocus = { id: string; action: 'rename' | 'delete' };

/**
 * Every profile with its summary, and what can be done with it: Rename,
 * Duplicate and Delete in each row, Import and Export below. Rename and
 * Delete change the row itself, in place: a name box (Enter or leaving it
 * saves, Escape puts the old name back), and a question with Delete and Cancel.
 * Nothing here is ever blocked: any profile, the last one too, can be deleted.
 */
export function ProfilesSheet({
  open,
  onOpenChange,
  profiles,
  activeId,
  server,
  onRename,
  onDuplicate,
  onDelete,
  onNew,
  onImport,
  onExport,
  notice
}: ProfilesSheetProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [refocus, setRefocus] = useState<Refocus | null>(null);
  const body = useRef<HTMLDivElement>(null);

  // A row's rename box and question are gone with the sheet.
  useEffect(() => {
    if (open) return;
    setRenamingId(null);
    setConfirmingId(null);
  }, [open]);

  // Put focus back on the button that opened the box or the question, once the row has its buttons again.
  useEffect(() => {
    if (!refocus) return;
    body.current
      ?.querySelector<HTMLElement>(`[data-profile-id="${CSS.escape(refocus.id)}"] [data-action="${refocus.action}"]`)
      ?.focus();
    setRefocus(null);
  }, [refocus]);

  return (
    <Sheet
      open={open}
      // Escape (or a click outside) while a name is being typed belongs to the box: it puts the old
      // name back, and a second one closes the sheet.
      onOpenChange={(next) => {
        if (!next && renamingId) return;
        onOpenChange(next);
      }}
      title={PROFILES.sheet.title}
      description={PROFILES.sheet.description}
    >
      <div ref={body} tabIndex={-1} className="min-h-0 flex-1 space-y-3 overflow-auto p-5 focus:outline-none">
        {notice && <Banner tone="info">{notice}</Banner>}
        {profiles.length === 0 ? (
          <EmptyState
            title={PROFILES.sheet.empty}
            action={
              <Button variant="primary" onClick={onNew} icon={<Plus size={14} aria-hidden="true" />}>
                {PROFILES.sheet.newProfile}
              </Button>
            }
          />
        ) : (
          <ul aria-label={PROFILES.sheet.list} className="divide-y divide-line rounded-lg border border-line">
            {profiles.map((p) => (
              <ProfileRow
                key={p.id}
                profile={p}
                current={p.id === activeId}
                badge={profileServerBadge(server, p.id)}
                renaming={renamingId === p.id}
                confirming={confirmingId === p.id}
                onStartRename={() => {
                  setConfirmingId(null);
                  setRenamingId(p.id);
                }}
                onFinishRename={(name, returnFocus) => {
                  setRenamingId(null);
                  if (name !== null && name !== p.name) onRename(p.id, name);
                  if (returnFocus) setRefocus({ id: p.id, action: 'rename' });
                }}
                onDuplicate={() => onDuplicate(p.id)}
                onAskDelete={() => {
                  setRenamingId(null);
                  setConfirmingId(p.id);
                }}
                onCancelDelete={() => {
                  setConfirmingId(null);
                  setRefocus({ id: p.id, action: 'delete' });
                }}
                onConfirmDelete={() => {
                  setConfirmingId(null);
                  // The row is about to go; keep focus in the sheet.
                  body.current?.focus();
                  onDelete(p.id);
                }}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <Button onClick={onImport} icon={<Download size={14} aria-hidden="true" />}>
            {PROFILES.sheet.import}
          </Button>
          <Button onClick={onExport} disabled={activeId === null} icon={<Upload size={14} aria-hidden="true" />}>
            {PROFILES.sheet.export}
          </Button>
        </div>
        <p className="text-xs text-muted">{PROFILES.sheet.exportHint}</p>
      </div>
    </Sheet>
  );
}

// Every state of a row is this tall at least. Leaving a name box saves it and puts the row back, and a
// shorter box would pull the rows below it up before the click that left it was over, losing the click.
const ROW = 'flex min-h-24 flex-col justify-center gap-2 p-3';

interface RowProps {
  profile: Profile;
  current: boolean;
  /** The server's status word, when the server was started for this profile. */
  badge: ReturnType<typeof profileServerBadge>;
  renaming: boolean;
  confirming: boolean;
  onStartRename: () => void;
  /** `name` is null when the box was cancelled. `returnFocus`: the keyboard ended it, so focus goes back to Rename. */
  onFinishRename: (name: string | null, returnFocus: boolean) => void;
  onDuplicate: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function ProfileRow({
  profile,
  current,
  badge,
  renaming,
  confirming,
  onStartRename,
  onFinishRename,
  onDuplicate,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete
}: RowProps) {
  const nameId = useId();
  const questionId = useId();
  const shownName = profileName(profile.name);

  if (confirming) {
    return (
      <li data-testid="profile-row" data-profile-id={profile.id} className={ROW}>
        <div role="group" aria-labelledby={questionId} className="flex flex-col gap-2">
          <p id={questionId} className="text-sm text-ink">
            {PROFILES.sheet.deleteQuestion(shownName)}
          </p>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" aria-label={PROFILES.sheet.confirmDelete} onClick={onConfirmDelete}>
              {PROFILES.sheet.delete}
            </Button>
            {/* The safe choice has focus, so a stray Enter doesn't delete. */}
            <Button size="sm" autoFocus onClick={onCancelDelete}>
              {COMMON.cancel}
            </Button>
          </div>
        </div>
      </li>
    );
  }

  if (renaming) {
    return (
      <li data-testid="profile-row" data-profile-id={profile.id} className={ROW}>
        <RenameBox initial={profile.name} onFinish={onFinishRename} />
      </li>
    );
  }

  // The buttons share a few words across rows, so each is described by its row's name and summary.
  const describedBy = nameId;
  return (
    <li data-testid="profile-row" data-profile-id={profile.id} className={ROW}>
      <div className="min-w-0">
        <p className="flex items-center gap-2">
          <span id={nameId} className="truncate text-sm font-medium text-ink">
            {shownName}
          </span>
          {current && <Badge>{PROFILES.sheet.current}</Badge>}
          {badge && <Badge tone={badge.tone}>{badge.word}</Badge>}
        </p>
        <p className="truncate text-xs text-muted">{profileSummary(profile)}</p>
      </div>
      <div className="-ml-2 flex items-center gap-1">
        <Button
          size="sm"
          variant="quiet"
          data-action="rename"
          aria-describedby={describedBy}
          icon={<Pencil size={14} aria-hidden="true" />}
          onClick={onStartRename}
        >
          {PROFILES.sheet.rename}
        </Button>
        <Button
          size="sm"
          variant="quiet"
          data-action="duplicate"
          aria-describedby={describedBy}
          icon={<Copy size={14} aria-hidden="true" />}
          onClick={onDuplicate}
        >
          {PROFILES.sheet.duplicate}
        </Button>
        <Button
          size="sm"
          variant="quiet"
          data-action="delete"
          aria-describedby={describedBy}
          icon={<Trash2 size={14} aria-hidden="true" />}
          onClick={onAskDelete}
        >
          {PROFILES.sheet.delete}
        </Button>
      </div>
    </li>
  );
}

/**
 * The name box of a row being renamed. Enter or leaving the box saves what was
 * typed (an empty name changes nothing); Escape puts the old name back. It ends
 * once, whichever comes first.
 */
function RenameBox({
  initial,
  onFinish
}: {
  initial: string;
  onFinish: (name: string | null, returnFocus: boolean) => void;
}) {
  const [text, setText] = useState(typeof initial === 'string' ? initial : '');
  const ended = useRef(false);

  const end = (save: boolean, returnFocus: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const name = text.trim();
    onFinish(save && name !== '' ? name : null, returnFocus);
  };

  return (
    <TextField
      label={PROFILES.sheet.renameLabel}
      hideLabel
      data-testid="profile-name"
      value={text}
      onChange={setText}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          end(true, true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          end(false, true);
        }
      }}
      onBlur={() => end(true, false)}
    />
  );
}

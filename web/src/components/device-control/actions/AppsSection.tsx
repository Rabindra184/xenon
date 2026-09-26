import * as React from 'react';
import { Check, Copy, Library, Loader2, Package, RefreshCw, Search, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import XenonApiService from '../../../api-service';
import { Button } from '../../ui/button';
import { Menu, MenuItem } from '../../ui/Menu';
import { Modal } from '../../ui/Modal';
import { Popover } from '../../ui/Popover';
import { useToast } from '../../ui/toast';
import { errorReason, failed } from '../actionMessages';
import {
  filterApps,
  libraryAppsFor,
  libraryNote,
  looksLikePackageId,
  platformNoun,
  uploadAccept,
  type LibraryApp,
} from './appsList';
import { COPY_BLOCKED, copyText } from './copyText';

interface Props {
  udid: string;
  platform: string;
  deviceName: string;
}

type Load = 'loading' | 'ready' | 'error';

/**
 * Install from the Apps library or a file, and the installed apps as a
 * searchable list. Package ids used to sit in a native dropdown you couldn't
 * search, and installs took only a file from your computer.
 */
export function AppsSection({ udid, platform, deviceName }: Props) {
  const { toast, removeToast } = useToast();
  const navigate = useNavigate();

  const [apps, setApps] = React.useState<string[]>([]);
  const [appsState, setAppsState] = React.useState<Load>('loading');
  const [appsError, setAppsError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [installing, setInstalling] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [library, setLibrary] = React.useState<LibraryApp[]>([]);
  const [libraryState, setLibraryState] = React.useState<Load>('loading');
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const libraryButton = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const loadApps = React.useCallback(async () => {
    setAppsState('loading');
    try {
      const list = await XenonApiService.listApps(udid);
      setApps(Array.isArray(list) ? list : []);
      setAppsState('ready');
    } catch (err) {
      setAppsError(errorReason(err));
      setAppsState('error');
    }
  }, [udid]);

  React.useEffect(() => {
    loadApps();
  }, [loadApps]);

  // The device takes a moment to report an install or uninstall.
  const reloadSoon = (ms: number) => setTimeout(loadApps, ms);

  React.useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(null), 1500);
    return () => clearTimeout(t);
  }, [copiedId]);

  const loadLibrary = async () => {
    setLibraryState('loading');
    try {
      const list = await XenonApiService.getApps();
      setLibrary(Array.isArray(list) ? list : []);
      setLibraryState('ready');
    } catch {
      setLibraryState('error');
    }
  };

  const openLibrary = () => {
    if (installing) return;
    setMenuOpen(true);
    loadLibrary();
  };

  const closeMenu = () => {
    setMenuOpen(false);
    libraryButton.current?.focus();
  };

  // Focus the first choice once there is one, so the arrow keys work at once.
  React.useEffect(() => {
    if (!menuOpen || libraryState === 'loading') return;
    const item = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)');
    item?.focus();
  }, [menuOpen, libraryState]);

  const install = async (label: string, run: () => Promise<any>) => {
    setInstalling(true);
    const toastId = toast(`Installing ${label} on ${deviceName}…`, 'loading', 0);
    try {
      const result = await run();
      if (result?.success) {
        toast(`Installed ${label} on ${deviceName}`, 'success');
        reloadSoon(5000);
      } else {
        toast(failed(`install ${label}`, { message: result?.error }), 'error');
      }
    } catch (err) {
      toast(failed(`install ${label}`, err), 'error');
    } finally {
      removeToast(toastId);
      setInstalling(false);
    }
  };

  const installFromLibrary = (app: LibraryApp) => {
    closeMenu();
    install(app.name, () => XenonApiService.installRepositoryApp(udid, app.id));
  };

  const uploadChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) install(file.name, () => XenonApiService.uploadAndInstallApp(udid, file));
  };

  const uninstallConfirmed = async () => {
    const id = confirm;
    setConfirm(null);
    if (!id) return;
    const toastId = toast(`Uninstalling ${id} from ${deviceName}…`, 'loading', 0);
    try {
      await XenonApiService.uninstallApp(udid, id);
      toast(`Uninstalled ${id} from ${deviceName}`, 'success');
      reloadSoon(3000);
    } catch (err) {
      toast(failed(`uninstall ${id}`, err), 'error');
    } finally {
      removeToast(toastId);
    }
  };

  const copyId = async (id: string, target: HTMLElement) => {
    if (await copyText(id)) {
      setCopiedId(id);
      return;
    }
    const idText = target.closest('li')?.querySelector('.actions-app-id');
    if (idText) window.getSelection()?.selectAllChildren(idText);
    toast(COPY_BLOCKED, 'info');
  };

  const shown = filterApps(apps, query);
  const typed = query.trim();
  const offerTyped =
    appsState === 'ready' &&
    shown.length === 0 &&
    looksLikePackageId(typed) &&
    !apps.includes(typed);
  const matches = libraryAppsFor(library, platform);

  const row = (id: string, note?: string) => (
    <li key={id} className="actions-app-row">
      <span className="actions-app-id">{id}</span>
      {note && <span className="actions-app-note">{note}</span>}
      <span className="actions-app-tools">
        <Button
          variant="ghost"
          size="icon"
          aria-label={copiedId === id ? 'Copied' : `Copy ${id}`}
          title={copiedId === id ? 'Copied' : 'Copy package ID'}
          onClick={(e) => copyId(id, e.currentTarget)}
        >
          {copiedId === id ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <Copy size={13} aria-hidden="true" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="actions-app-uninstall"
          aria-label={`Uninstall ${id}`}
          onClick={() => setConfirm(id)}
        >
          Uninstall
        </Button>
      </span>
    </li>
  );

  return (
    <section className="actions-section" aria-labelledby="actions-apps-title">
      <div className="actions-section-head">
        <h4 id="actions-apps-title" className="actions-section-title">
          <Package size={15} aria-hidden="true" /> Apps
        </h4>
        <div className="actions-section-tools">
          <Button
            ref={libraryButton}
            variant="tonal"
            size="sm"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            // aria-disabled, not disabled: focus comes back here after an
            // install is chosen, and a disabled button would drop it.
            aria-disabled={installing || undefined}
            onClick={openLibrary}
          >
            {installing ? (
              <Loader2 className="animate-spin" size={13} aria-hidden="true" />
            ) : (
              <Library size={13} aria-hidden="true" />
            )}
            Install from library
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-disabled={installing || undefined}
            onClick={() => !installing && fileInput.current?.click()}
          >
            <Upload size={13} aria-hidden="true" /> Upload file
          </Button>
          <input
            ref={fileInput}
            type="file"
            hidden
            aria-label="App file to upload"
            accept={uploadAccept(platform)}
            onChange={uploadChosen}
          />
        </div>
      </div>

      <Popover open={menuOpen} onClose={closeMenu} anchorRef={libraryButton} placement="bottom-end">
        <div ref={menuRef} className="actions-library-menu">
          <Menu>
            {libraryState === 'loading' && (
              <MenuItem disabled onClick={() => {}}>
                Loading…
              </MenuItem>
            )}
            {libraryState === 'error' && (
              <MenuItem onClick={loadLibrary}>Couldn’t load the library. Retry</MenuItem>
            )}
            {libraryState === 'ready' && matches.length === 0 && (
              <>
                <MenuItem disabled onClick={() => {}}>
                  No {platformNoun(platform)} apps in the library yet
                </MenuItem>
                <MenuItem onClick={() => navigate('/apps')}>Open the Apps library</MenuItem>
              </>
            )}
            {libraryState === 'ready' &&
              matches.map((app) => (
                <MenuItem
                  key={app.id}
                  note={libraryNote(app) || undefined}
                  onClick={() => installFromLibrary(app)}
                >
                  {app.name}
                </MenuItem>
              ))}
          </Menu>
        </div>
      </Popover>

      <div className="actions-apps-tools">
        <div className="actions-search">
          <Search size={13} className="actions-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="type-input-field compact"
            aria-label="Search installed apps"
            placeholder={`Search ${apps.length} installed apps`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh installed apps"
          title="Refresh"
          onClick={loadApps}
        >
          <RefreshCw size={13} aria-hidden="true" />
        </Button>
      </div>

      {appsState === 'loading' && apps.length === 0 && (
        <p className="actions-list-note">Loading apps…</p>
      )}
      {appsState === 'error' && (
        <div className="actions-list-note" role="alert">
          Couldn’t load the apps{appsError ? `: ${appsError}` : '.'}
          <Button variant="secondary" size="sm" onClick={loadApps}>
            Retry
          </Button>
        </div>
      )}
      {appsState === 'ready' && apps.length === 0 && (
        <p className="actions-list-note">No apps installed</p>
      )}
      {appsState === 'ready' && apps.length > 0 && shown.length === 0 && !offerTyped && (
        <p className="actions-list-note">No apps match “{typed}”</p>
      )}

      <ul className="actions-apps-list" aria-label="Installed apps">
        {shown.map((id) => row(id))}
        {offerTyped && row(typed, 'Not in the list')}
      </ul>

      <Modal
        open={confirm !== null}
        title="Uninstall app?"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={uninstallConfirmed}>
              Uninstall
            </Button>
          </>
        }
      >
        <p className="actions-confirm-text">
          Uninstall <code>{confirm}</code> from{' '}
          <span className="actions-confirm-device">{deviceName}</span>? The app and its data are
          removed from the device.
        </p>
      </Modal>
    </section>
  );
}

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, Copy, LogOut, RefreshCw } from 'lucide-react';
import XenonApiService, { AgentSignIn } from '../../api-service';
import { PageHeader } from '../ui/page-header';
import { Card } from '../ui/Card';
import { Button } from '../ui/button';
import { Modal } from '../ui/Modal';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
import { useToast } from '../ui/toast';
import { useAuth } from '../../auth/auth-context';
import { formatDateTime, formatRelative } from '../../utils/time';
import { scopeWords } from '../oauth/scopeWords';
import { AgentSetup, agentSetups, installerSetup, isPlainHttpHub } from './agentCommands';

/** The connected agents: none to list with sign-in off, or the server didn't answer. */
type SignInList = { kind: 'off' } | { kind: 'failed' } | { kind: 'list'; items: AgentSignIn[] };

type Load =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; hub: string; signIns: SignInList };

/** The lab's origin from its MCP endpoint's URL, else the page's own. */
function hubFrom(url: string | undefined): string {
  if (url) {
    try {
      return new URL(url).origin;
    } catch {
      /* fall through */
    }
  }
  return window.location.origin;
}

/**
 * "AI agents" (`/agents`): for every signed-in user, the command that adds
 * this lab to each coding agent, with this lab's address filled in, and the
 * agents they have signed in, each with Sign out. The address is the one the
 * server gives agents (`features.mcpServer.url`: XENON_PUBLIC_URL when set),
 * since an agent's sign-in must name exactly that.
 */
export default function AgentsPage() {
  const { toast } = useToast();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [copied, setCopied] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState<string | null>(null);
  /** The sign-in whose Sign out is being confirmed. */
  const [confirming, setConfirming] = useState<AgentSignIn | null>(null);

  const { me } = useAuth();
  const signInOff = me?.authDisabled === true;

  // "Not available" and "sign-in is off" only from what the server says, never
  // from a failed request (a 429, a restart): that gets Try again instead.
  const read = useCallback(async () => {
    const [server, list] = await Promise.allSettled([
      XenonApiService.getMcpServer(),
      signInOff ? Promise.resolve(null) : XenonApiService.getAgentSignIns(),
    ]);
    if (server.status === 'rejected') return setLoad({ kind: 'failed' });
    if (!server.value) return setLoad({ kind: 'unavailable' });
    const signIns: SignInList =
      list.status === 'rejected'
        ? { kind: 'failed' }
        : list.value === null
          ? { kind: 'off' }
          : { kind: 'list', items: list.value };
    setLoad({ kind: 'ready', hub: hubFrom(server.value.url), signIns });
  }, [signInOff]);

  useEffect(() => {
    void read();
  }, [read]);

  async function copy(client: string, command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(client);
      window.setTimeout(() => setCopied((c) => (c === client ? null : c)), 1500);
    } catch {
      toast("Couldn't copy. Select the command and copy it yourself.", 'error');
    }
  }

  async function signOut(signIn: AgentSignIn) {
    setSigningOut(signIn.id);
    try {
      await XenonApiService.revokeAgentSignIn(signIn.id);
      setConfirming(null);
      toast(`${signIn.clientName} is signed out`, 'success');
      await read();
    } catch (e) {
      setConfirming(null);
      toast(`Couldn't sign it out: ${(e as Error).message}`, 'error');
    } finally {
      setSigningOut(null);
    }
  }

  return (
    <div>
      <PageHeader
        icon={Bot}
        title="AI agents"
        subtitle="Add this lab to your coding agent. It signs in with your account in this browser and uses the lab as you."
      />
      <div className="px-6 py-6 max-w-5xl space-y-6">
        {load.kind === 'loading' && (
          <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </p>
        )}

        {load.kind === 'failed' && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-muted)]">
              Couldn't load this page. The server didn't answer.
            </p>
            <Button variant="secondary" size="sm" onClick={() => void read()}>
              Try again
            </Button>
          </div>
        )}

        {load.kind === 'unavailable' && (
          <p className="text-sm text-[var(--text-muted)]">
            AI agents aren't available on this server. Open the dashboard of the Xenon server your
            lab's tests connect to.
          </p>
        )}

        {load.kind === 'ready' && (
          <>
            <Commands hub={load.hub} copied={copied} onCopy={copy} />
            <SignIns
              signIns={load.signIns}
              signingOut={signingOut}
              onSignOut={setConfirming}
              onRetry={() => void read()}
            />
          </>
        )}
      </div>
      <Modal
        open={confirming !== null}
        title={confirming ? `Sign out ${confirming.clientName}?` : ''}
        onClose={() => {
          // The request can't be taken back once it is sent.
          if (signingOut) return;
          setConfirming(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirming(null)}
              disabled={signingOut !== null}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirming && void signOut(confirming)}
              disabled={signingOut !== null}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          It stops working at once, and the phones it leased are given back.
        </p>
      </Modal>
    </div>
  );
}

function Commands({
  hub,
  copied,
  onCopy,
}: {
  hub: string;
  copied: string | null;
  onCopy: (client: string, command: string) => void;
}) {
  const plainHttp = isPlainHttpHub(hub);
  return (
    <Card header={<h2 id="agent-commands">Add Xenon to your agent</h2>}>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Run the command for your agent on your computer, or add the entry to its settings file. The
        first time the agent uses Xenon, it opens this browser for you to allow it.
      </p>
      {plainHttp && (
        <p role="note" className="mb-4 flex items-start gap-2 text-sm text-[var(--text)]">
          <AlertTriangle
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[var(--color-warning)]"
          />
          <span>
            This lab is on plain HTTP. Some agents, Claude Code among them, won&apos;t sign in to a
            lab on another computer over plain HTTP. Xenon&apos;s installer connects them through a
            bridge on your computer, but the bridge encrypts nothing: ask your lab admin to put the
            lab behind HTTPS.
          </span>
        </p>
      )}
      <div className="mb-4 border-b border-[var(--border)] pb-4">
        <Setup setup={installerSetup(hub)} copied={copied === 'installer'} onCopy={onCopy} />
      </div>
      <p className="mb-3 text-sm text-[var(--text-muted)]">Or add one agent yourself:</p>
      <ul aria-labelledby="agent-commands" className="space-y-4">
        {agentSetups(hub).map((setup) => (
          <li key={setup.client}>
            <Setup setup={setup} copied={copied === setup.client} onCopy={onCopy} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Setup({
  setup,
  copied,
  onCopy,
}: {
  setup: AgentSetup;
  copied: boolean;
  onCopy: (client: string, command: string) => void;
}) {
  const { client, label } = setup;
  return (
    <>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">{label}</h3>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Copy the ${label} ${setup.kind === 'config' ? 'entry' : 'command'}`}
          onClick={() => onCopy(client, setup.text)}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {setup.kind === 'config' && (
        <p className="mb-1.5 text-sm text-[var(--text-muted)]">
          Add this to <code className="font-mono text-mono-data">{setup.file}</code>:
        </p>
      )}
      <code className="block whitespace-pre-wrap break-all rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 font-mono text-mono-data text-[var(--text)]">
        {setup.text}
      </code>
      {setup.after && <p className="mt-1.5 text-sm text-[var(--text-muted)]">{setup.after}</p>}
    </>
  );
}

function SignIns({
  signIns,
  signingOut,
  onSignOut,
  onRetry,
}: {
  signIns: SignInList;
  signingOut: string | null;
  onSignOut: (signIn: AgentSignIn) => void;
  onRetry: () => void;
}) {
  const listed = signIns.kind === 'list' && signIns.items.length > 0;
  return (
    <Card header={<h2 id="connected-agents">Connected agents</h2>} padded={!listed}>
      {signIns.kind === 'off' ? (
        <p className="text-sm text-[var(--text-muted)]">
          Sign-in is turned off on this server, so agents connect without signing in and there is
          nothing to list.
        </p>
      ) : signIns.kind === 'failed' ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-muted)]">
            Couldn't load your connected agents. The server didn't answer.
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : signIns.items.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No agent is signed in yet. Run a command above, then allow the agent when it opens this
          browser.
        </p>
      ) : (
        <Table aria-labelledby="connected-agents">
          <THead>
            <TR>
              <TH>Agent</TH>
              <TH>What it can do</TH>
              <TH>Signed in</TH>
              <TH>Last used</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {signIns.items.map((s) => (
              <TR key={s.id}>
                {/* The agent picks its name: a long one with no spaces must
                    wrap, or the auto-sized table pushes Sign out off the card. */}
                <TD className="[overflow-wrap:anywhere]">{s.clientName}</TD>
                <TD>
                  <ul className="space-y-0.5">
                    {s.scopes.map((scope) => (
                      <li key={scope}>{scopeWords(scope)}</li>
                    ))}
                  </ul>
                </TD>
                <TD>{formatDateTime(s.createdAt)}</TD>
                <TD>{s.lastUsedAt ? formatRelative(s.lastUsedAt) : 'Never'}</TD>
                <TD style={{ textAlign: 'right' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Sign out ${s.clientName}`}
                    disabled={signingOut === s.id}
                    onClick={() => onSignOut(s)}
                  >
                    <LogOut size={14} aria-hidden="true" />
                    {signingOut === s.id ? 'Signing out…' : 'Sign out'}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

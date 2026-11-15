import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Copy, LogOut, RefreshCw } from 'lucide-react';
import XenonApiService, { AgentSignIn } from '../../api-service';
import { PageHeader } from '../ui/page-header';
import { Card } from '../ui/Card';
import { Button } from '../ui/button';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
import { useToast } from '../ui/toast';
import { formatDateTime, formatRelative } from '../../utils/time';
import { scopeWords } from '../oauth/scopeWords';
import { agentCommands, isPlainHttpHub } from './agentCommands';

type Load =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; hub: string; signIns: AgentSignIn[] | null };

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

  const read = useCallback(async () => {
    const [server, signIns] = await Promise.all([
      XenonApiService.getMcpServer(),
      XenonApiService.getAgentSignIns().catch(() => null),
    ]);
    if (!server) return setLoad({ kind: 'unavailable' });
    setLoad({ kind: 'ready', hub: hubFrom(server.url), signIns });
  }, []);

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
    if (!window.confirm(`Sign out ${signIn.clientName}? It stops working at once.`)) return;
    setSigningOut(signIn.id);
    try {
      await XenonApiService.revokeAgentSignIn(signIn.id);
      toast(`${signIn.clientName} is signed out`, 'success');
      await read();
    } catch (e) {
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
        subtitle="Add this lab to your coding agent. It signs in with your account in this browser, and can do what your account can."
      />
      <div className="px-6 py-6 max-w-5xl space-y-6">
        {load.kind === 'loading' && (
          <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </p>
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
            <SignIns signIns={load.signIns} signingOut={signingOut} onSignOut={signOut} />
          </>
        )}
      </div>
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
        Run the command for your agent on your computer. The first time the agent uses Xenon, it
        opens this browser for you to allow it.
        {plainHttp &&
          " This lab is on plain HTTP, which some agents won't sign in over, so every agent connects through Xenon's installer, which signs in from your computer."}
      </p>
      <ul aria-labelledby="agent-commands" className="space-y-4">
        {agentCommands(hub, plainHttp).map(({ client, label, command }) => (
          <li key={client}>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text)]">{label}</h3>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Copy the ${label} command`}
                onClick={() => onCopy(client, command)}
              >
                {copied === client ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
                {copied === client ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <code className="block whitespace-pre-wrap break-all rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 font-mono text-mono-data text-[var(--text)]">
              {command}
            </code>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SignIns({
  signIns,
  signingOut,
  onSignOut,
}: {
  signIns: AgentSignIn[] | null;
  signingOut: string | null;
  onSignOut: (signIn: AgentSignIn) => void;
}) {
  return (
    <Card
      header={<h2 id="connected-agents">Connected agents</h2>}
      padded={signIns === null || signIns.length === 0}
    >
      {signIns === null ? (
        <p className="text-sm text-[var(--text-muted)]">
          Sign-in is turned off on this server, so agents connect without signing in and there is
          nothing to list.
        </p>
      ) : signIns.length === 0 ? (
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
            {signIns.map((s) => (
              <TR key={s.id}>
                <TD className="break-words">{s.clientName}</TD>
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

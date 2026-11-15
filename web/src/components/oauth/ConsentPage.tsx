import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import XenonApiService, { OAuthConsentRequest } from '../../api-service';
import { useAuth } from '../../auth/auth-context';
import { AuthShell } from '../../pages/auth-shell';
import { Button } from '../ui/button';
import { backToAgent } from './backToAgent';
import { scopeWords } from './scopeWords';

/** The host a tester recognises: the hub's with its port, as they type it. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Where the browser goes back to after the answer: the address's host for a
 * loopback or https address, else the app its link scheme opens. This is
 * what says which agent is asking; the name is whatever it gave itself.
 */
export function returnAddress(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) {
      return url.hostname;
    }
    return `the app that opens ${url.protocol} links`;
  } catch {
    return redirectUri;
  }
}

type View =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'unreadable' }
  | { kind: 'asking'; request: OAuthConsentRequest }
  | { kind: 'left'; request: OAuthConsentRequest };

/**
 * The page an agent's sign-in opens (`/oauth/consent/:requestId`): the agent,
 * this lab and what the agent may do, with Allow and Deny. Behind the route
 * guard, so a signed-out visitor signs in first and comes back here.
 *
 * It leaves only for the `redirectTo` the server's answer names; nothing in
 * this page's address decides where the browser goes. The server refuses to
 * let it be framed (src/app/index.ts).
 */
export default function ConsentPage() {
  const { requestId = '' } = useParams<{ requestId: string }>();
  const { me, refresh } = useAuth();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const answer = await XenonApiService.getOAuthConsent(requestId);
      if (answer.ok) setView({ kind: 'asking', request: answer.request });
      else if (answer.status === 401) {
        // Signed out meanwhile: the route guard sends them to sign in and back.
        await refresh();
      } else if (answer.status === 404) setView({ kind: 'gone' });
      else setView({ kind: 'unreadable' });
    } catch {
      setView({ kind: 'unreadable' });
    }
  }, [requestId, refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(request: OAuthConsentRequest, allow: boolean) {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const { redirectTo } = await XenonApiService.answerOAuthConsent(requestId, allow);
      if (backToAgent(redirectTo)) {
        setView({ kind: 'left', request });
      } else {
        setError("The agent's address can't be opened from this page.");
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404) setView({ kind: 'gone' });
      else setError((e as Error).message || 'Your answer could not be sent. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthShell>
      {view.kind === 'loading' && (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the sign-in…
        </p>
      )}

      {view.kind === 'gone' && (
        <>
          <h1 className="text-title font-semibold tracking-tight mb-2">Sign-in not found</h1>
          <p className="text-sm text-[var(--text-muted)]">
            This sign-in has expired or was already answered. Start it again from your agent.
          </p>
        </>
      )}

      {view.kind === 'unreadable' && (
        <>
          <h1 className="text-title font-semibold tracking-tight mb-2">
            Couldn't load this sign-in
          </h1>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            The server didn't answer. Try again in a moment.
          </p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </>
      )}

      {view.kind === 'left' && (
        <>
          <h1 className="text-title font-semibold tracking-tight mb-2">Done</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Going back to {returnAddress(view.request.redirectUri)}. You can close this tab if
            nothing happens.
          </p>
        </>
      )}

      {view.kind === 'asking' && (
        <Asking
          request={view.request}
          email={me?.email}
          sending={sending}
          error={error}
          onAnswer={(allow) => void answer(view.request, allow)}
        />
      )}
    </AuthShell>
  );
}

function Asking({
  request,
  email,
  sending,
  error,
  onAnswer,
}: {
  request: OAuthConsentRequest;
  email?: string;
  sending: boolean;
  error: string | null;
  onAnswer: (allow: boolean) => void;
}) {
  const name = request.client.name;
  const canGrant = request.scopes.length > 0;
  return (
    <div>
      <h1 className="text-title font-semibold tracking-tight mb-2 break-words">
        Allow {name} to use Xenon?
      </h1>
      <p className="text-sm text-[var(--text-muted)] mb-4 break-words">
        {name} wants to use Xenon at{' '}
        <strong className="text-[var(--text)]">{hostOf(request.hub)}</strong>.
      </p>

      <div className="mb-5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2.5 text-sm">
        <p className="text-[var(--text)]">
          After you answer, you go back to{' '}
          <strong className="font-semibold">{returnAddress(request.redirectUri)}</strong>.
        </p>
        <p className="mt-1 text-[var(--text-muted)]">
          The agent chose its own name. Allow it only if you just started this sign-in from there.
        </p>
      </div>

      {canGrant ? (
        <>
          <h2 id="consent-scopes" className="text-sm font-semibold text-[var(--text)] mb-2">
            What it can do
          </h2>
          <ul
            aria-labelledby="consent-scopes"
            className="mb-5 list-disc space-y-1 pl-5 text-sm text-[var(--text)]"
          >
            {request.scopes.map((scope) => (
              <li key={scope}>{scopeWords(scope)}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-5 text-sm text-[var(--text)]">
          The agent asked for nothing your account can give, so it can't sign in. Deny to tell it.
        </p>
      )}

      {email && (
        <p className="mb-5 text-sm text-[var(--text-muted)] break-words">
          Signed in as <strong className="text-[var(--text)]">{email}</strong>. The agent acts as
          you until you sign it out on the AI agents page.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-3 py-2.5 text-sm text-[var(--text)]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={sending} onClick={() => onAnswer(false)}>
          Deny
        </Button>
        {canGrant && (
          <Button variant="primary" disabled={sending} onClick={() => onAnswer(true)}>
            Allow
          </Button>
        )}
      </div>
    </div>
  );
}

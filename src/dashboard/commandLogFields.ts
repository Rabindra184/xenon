import { isNetworkCaptureScript } from '../interceptors/xenonScripts';
import { CommandPrivacy, MASKED, maskTypedText, sensitiveResponse } from './commandPrivacy';

/** What the command log keeps in place of a network-capture script's arguments or answer. */
export const NETWORK_CAPTURE_NOT_KEPT = 'Not kept: network capture is shown to admins only';

/**
 * The `body` and `response` the command log (SessionLog) keeps for a command.
 * The log is read by everyone who can see the session (`session_log`, bug
 * reports), so a network-capture script (NETWORK_CAPTURE_SCRIPTS) keeps
 * neither its arguments nor its answer: they are the capture itself (a HAR,
 * the requests' headers and bodies, the mocks), which REST shows to admins
 * only.
 * The script's name stays, and a failed call keeps its error, which says why
 * and carries no capture.
 *
 * CommandInterceptor answers these scripts before its post-command hooks, so
 * a session on this server's own phone records one only when it fails. A hub
 * with its dashboard on records every command it forwards to a node, and
 * through 2.15 kept a test's `xenon: exportHar` whole. Failure analysis sends
 * a session's last commands' answers to the AI provider, so they went there
 * too.
 *
 * `requestBody` is the client's W3C body (`{ script, args }`) or, from
 * CommandInterceptor, the command's arguments (`[script, args]`).
 *
 * `privacy` says whether the client marked the command sensitive and whether
 * typed text is masked for the session (commandPrivacy.ts).
 */
export function commandLogFields(
  commandName: string | undefined,
  requestBody: unknown,
  responseBody: string,
  isSuccess: boolean,
  privacy: CommandPrivacy = {},
): { body: string; response: string } {
  // A command its client marked sensitive keeps neither, only a failure's
  // code; one that typed keeps its text masked (commandPrivacy.ts).
  if (privacy.sensitive) {
    return { body: JSON.stringify(MASKED), response: sensitiveResponse(responseBody, isSuccess) };
  }
  const body = JSON.stringify(
    privacy.maskInput ? maskTypedText(commandName, requestBody) : requestBody,
  );
  if (commandName !== 'execute') return { body, response: responseBody };

  const fromCommand = Array.isArray(requestBody);
  const script = fromCommand
    ? requestBody[0]
    : (requestBody as { script?: unknown } | null | undefined)?.script;
  if (!isNetworkCaptureScript(script)) return { body, response: responseBody };

  return {
    body: JSON.stringify(
      fromCommand ? [script, NETWORK_CAPTURE_NOT_KEPT] : { script, args: NETWORK_CAPTURE_NOT_KEPT },
    ),
    response: isSuccess ? JSON.stringify({ value: NETWORK_CAPTURE_NOT_KEPT }) : responseBody,
  };
}

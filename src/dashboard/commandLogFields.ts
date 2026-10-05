import { isNetworkCaptureScript } from '../interceptors/xenonScripts';

/** What the command log keeps in place of a network-capture script's arguments or answer. */
export const NETWORK_CAPTURE_NOT_KEPT = 'Not kept: network capture is shown to admins only';

/**
 * The `body` and `response` the command log (SessionLog) keeps for a command.
 * The log is read by everyone who can see the session (`session_log`, bug
 * reports), so a network-capture script (NETWORK_CAPTURE_SCRIPTS) keeps
 * neither its arguments nor its answer: they are the capture itself (a HAR,
 * the requests' headers and bodies, the mocks), which only admins may read.
 * The script's name stays, and a failed call keeps its error, which says why
 * and carries no capture.
 *
 * CommandInterceptor answers these scripts before its post-command hooks, so
 * a session on this server's own phone records one only when it fails. A hub
 * records every command it forwards to a node, and through 2.15 kept a test's
 * `xenon: exportHar` whole.
 *
 * `requestBody` is the client's W3C body (`{ script, args }`) or, from
 * CommandInterceptor, the command's arguments (`[script, args]`).
 */
export function commandLogFields(
  commandName: string | undefined,
  requestBody: unknown,
  responseBody: string,
  isSuccess: boolean,
): { body: string; response: string } {
  const body = JSON.stringify(requestBody);
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

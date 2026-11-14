import { Container } from 'typedi';
import type { OutgoingHttpHeaders } from 'http';
import type { IDevice } from '../interfaces/IDevice';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from './hubSessionToken';
import { readAnswer, sendToNode } from './forwardToNode';
import { nodeWebDriverUrl } from './nodeWebDriverUrl';

/** How long the hub waits for a node to end a session it is undoing. */
export const END_REMOTE_SESSION_TIMEOUT_MS = 60_000;

/**
 * End a session on the server that runs it, as a client's DELETE through the
 * gateway would (createHubRouting's deleteRemote): `DELETE
 * <its WebDriver URL>/session/<id>`, with the hub's session token for a node
 * and none for a cloud provider (whose credentials are in its URL). Sent once.
 * Resolves with the server's status; rejects when it can't be reached or
 * doesn't answer in time.
 */
export async function endRemoteSession(
  device: IDevice,
  sessionId: string,
  fallbackBasePath: string,
  timeoutMs = END_REMOTE_SESSION_TIMEOUT_MS,
): Promise<number> {
  const url = `${await nodeWebDriverUrl(device, fallbackBasePath)}/session/${encodeURIComponent(
    sessionId,
  )}`;
  const headers: OutgoingHttpHeaders = {};
  if (!device.cloud) {
    const token = await Container.get(HubSessionTokenIssuer).tokenFor(sessionId);
    if (token) headers[HUB_TOKEN_HEADER] = token;
  }
  const answer = await readAnswer(
    await sendToNode({ url, method: 'DELETE', headers, signal: AbortSignal.timeout(timeoutMs) }),
  );
  return answer.status;
}

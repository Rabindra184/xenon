import https from 'https';
import axios from 'axios';
import { Container, Service } from 'typedi';
import type { RequestHandler } from 'express';
import log from '../logger';
import { nodeUrl } from '../helpers';
import { normalizeBasePath } from '../app/appiumBasePath';
import { PluginContext } from '../PluginContext';
import type { IDevice } from '../interfaces/IDevice';

/**
 * Where a node's WebDriver API lives.
 *
 * A phone's `host` column is the node's origin (`http://<ip>:<port>`), never
 * its Appium base path, and a hub and its nodes need not share one. So each
 * Xenon server says what its base path is at `GET /xenon/api/webdriver`,
 * which needs no login (the path is part of every client's URL anyway), and
 * the hub asks a node before it sends that node a session or a command.
 *
 * The answer is kept for a minute. A node that does not answer it (an older
 * Xenon, or one that is down) is taken to share the hub's own base path, the
 * one rule that held before, and asked again after a few seconds.
 */

export const WEBDRIVER_INFO_PATH = '/xenon/api/webdriver';
export const BASE_PATH_TTL_MS = 60_000;
export const FALLBACK_TTL_MS = 10_000;
export const LOOKUP_TIMEOUT_MS = 3_000;

/** What a server answers at WEBDRIVER_INFO_PATH. */
export function webdriverInfo(basePath: unknown): { basePath: string } {
  return { basePath: normalizeBasePath(basePath) };
}

export function webdriverInfoHandler(basePath: () => unknown): RequestHandler {
  return (_req, res) => {
    res.json(webdriverInfo(basePath()));
  };
}

/** A phone host's origin: scheme, host and port, without a path or trailing slash. */
export function originOf(host: string): string {
  try {
    return new URL(host).origin;
  } catch {
    return host.replace(/\/+$/, '');
  }
}

@Service()
export class NodeBasePathResolver {
  private readonly logger = log.scope('NodeBasePath');
  private readonly cache = new Map<string, { basePath: string; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<string>>();
  now: () => number = () => Date.now();

  /** The node's base path, or `fallback` when the node does not say. */
  async resolve(origin: string, fallback: string): Promise<string> {
    const hit = this.cache.get(origin);
    if (hit && hit.expiresAt > this.now()) return hit.basePath;

    const inFlight = this.pending.get(origin);
    if (inFlight) return inFlight;

    const lookup = this.lookUp(origin, normalizeBasePath(fallback)).finally(() =>
      this.pending.delete(origin),
    );
    this.pending.set(origin, lookup);
    return lookup;
  }

  forget(origin: string): void {
    this.cache.delete(origin);
  }

  private async lookUp(origin: string, fallback: string): Promise<string> {
    let advertised: string | undefined;
    try {
      const rejectUnauthorized = Container.get(PluginContext).pluginArgs?.tlsRejectUnauthorized;
      const response = await axios.get(`${origin}${WEBDRIVER_INFO_PATH}`, {
        timeout: LOOKUP_TIMEOUT_MS,
        validateStatus: (status) => status === 200,
        httpsAgent: new https.Agent({ rejectUnauthorized: rejectUnauthorized !== false }),
      });
      const basePath = response.data?.basePath;
      if (typeof basePath === 'string') advertised = normalizeBasePath(basePath);
    } catch (err: any) {
      this.logger.debug(`${origin} did not say its base path (${err?.message ?? err})`);
    }

    if (advertised === undefined) {
      this.logger.info(
        `Node ${origin} did not report its WebDriver base path; using this hub's ('${fallback}').`,
      );
    }
    const basePath = advertised ?? fallback;
    this.cache.set(origin, {
      basePath,
      expiresAt: this.now() + (advertised === undefined ? FALLBACK_TTL_MS : BASE_PATH_TTL_MS),
    });
    return basePath;
  }
}

/**
 * The WebDriver base URL of the server that drives a phone: a cloud
 * provider's own URL, or a node's origin plus its own base path.
 * `fallbackBasePath` is this hub's, for a node that does not say.
 */
export async function nodeWebDriverUrl(device: IDevice, fallbackBasePath: string): Promise<string> {
  if (device.cloud) return nodeUrl(device, fallbackBasePath);
  const origin = originOf(device.host);
  const basePath = await Container.get(NodeBasePathResolver).resolve(origin, fallbackBasePath);
  return `${origin}${basePath}`;
}

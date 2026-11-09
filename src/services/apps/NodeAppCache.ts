import { createHash } from 'crypto';
import { createWriteStream, promises as fsp } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import axios from 'axios';
import { Container, Service } from 'typedi';
import { config } from '../../config';
import { axiosProxyConfig } from '../../helpers/outboundProxy';
import { PluginContext } from '../../PluginContext';
import { HubApp } from '../session/appCapability';
import log from '../../logger';

/** How many builds a node keeps; the least recently used beyond it are deleted. */
export const NODE_APP_CACHE_KEEP = 10;

/** A download left behind by a process that died is removed after this long. */
const STALE_PARTIAL_MS = 60 * 60 * 1000;

/** The longest a download from the hub may take, inside the hub's create limit. */
export const NODE_APP_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

const PARTIAL = '.partial';

/**
 * The uploaded apps a node holds for its hub's sessions (ENH-19).
 *
 * A hub hands the node's driver a download URL with a single-use ticket, and
 * Appium caches downloads by the whole URL, so the driver downloaded every
 * build again for every session. The hub now also says which app it is
 * (`hubApp`: id, md5, size, extension). The node fetches a build once, with
 * that session's ticket, checks its md5, and keeps it; a later session's
 * driver is handed the file, and its ticket goes unused. The ticket stays
 * single-use: a build is fetched only when the node doesn't hold it.
 *
 * Files are named by the hub, the app's id and its md5, so a file is only
 * ever the bytes the hub described. Written to a partial file and renamed,
 * so a reader never sees half a build; two creates of one build share one
 * download.
 */
@Service()
export class NodeAppCache {
  private logger = log.scope('NodeAppCache');
  private inflight = new Map<string, Promise<string>>();
  /** Where the builds are kept. A field, so a spec can point it elsewhere. */
  dir = path.join(config.cacheDir, 'app-cache');
  keep = NODE_APP_CACHE_KEEP;

  /**
   * A local file holding the build `app` describes, downloaded from `url`
   * (the hub's ticketed download URL) when the node doesn't hold it yet.
   * Throws when it can't be fetched or isn't the build the hub described.
   */
  async fileFor(url: string, app: HubApp): Promise<string> {
    const file = path.join(this.dir, this.fileName(url, app));
    if (await this.holds(file, app)) {
      this.logger.info(`App ${app.id} (${app.md5}) is already on this node: ${file}`);
      return file;
    }
    const running = this.inflight.get(file);
    if (running) return running;
    const fetching = this.fetchInto(url, app, file).finally(() => this.inflight.delete(file));
    this.inflight.set(file, fetching);
    return fetching;
  }

  /** `<hub>-<app id>-<md5><extension>`: the hub as a hash of its origin. */
  fileName(url: string, app: HubApp): string {
    const hub = createHash('sha256').update(new URL(url).origin).digest('hex').slice(0, 16);
    return `${hub}-${app.id}-${app.md5}${app.extension}`;
  }

  /** Whether `file` is there at the size the hub gave; marks it used when it is. */
  private async holds(file: string, app: HubApp): Promise<boolean> {
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile() || stat.size !== app.size) return false;
      const now = new Date();
      await fsp.utimes(file, now, now);
      return true;
    } catch {
      return false;
    }
  }

  private async fetchInto(url: string, app: HubApp, file: string): Promise<string> {
    await fsp.mkdir(this.dir, { recursive: true });
    const partial = `${file}.${process.pid}.${Date.now()}${PARTIAL}`;
    const started = Date.now();
    try {
      const md5 = await this.download(url, partial);
      const { size } = await fsp.stat(partial);
      if (md5 !== app.md5 || size !== app.size) {
        throw new Error(
          `the hub sent ${size} bytes with md5 ${md5}, not the ${app.size} bytes with md5 ${app.md5} it described`,
        );
      }
      await fsp.rename(partial, file);
    } catch (error: any) {
      await fsp.rm(partial, { force: true }).catch(() => undefined);
      throw new Error(`Could not fetch app ${app.id} from the hub: ${error?.message ?? error}`);
    }
    this.logger.info(
      `Fetched app ${app.id} (${app.size} bytes) from the hub in ${Date.now() - started} ms; ` +
        'later sessions on this node reuse it',
    );
    await this.prune(file).catch((error) =>
      this.logger.warn(`Could not prune the app cache: ${error?.message ?? error}`),
    );
    return file;
  }

  /** Streams `url` into `to`, returning the md5 of what was written. */
  async download(url: string, to: string): Promise<string> {
    const pluginArgs = Container.get(PluginContext).pluginArgs as any;
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: NODE_APP_DOWNLOAD_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: (status) => status === 200,
      ...axiosProxyConfig(url, { rejectUnauthorized: pluginArgs?.tlsRejectUnauthorized !== false }),
    });
    const hash = createHash('md5');
    const hashing = new Transform({
      transform(chunk, _encoding, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(response.data, hashing, createWriteStream(to, { flags: 'wx' }));
    return hash.digest('hex');
  }

  /**
   * Keeps the `keep` most recently used builds and deletes the rest, and
   * partial files a dead process left. `justWritten` is never deleted.
   */
  private async prune(justWritten: string): Promise<void> {
    const entries = await fsp.readdir(this.dir);
    const now = Date.now();
    const builds: Array<{ file: string; used: number }> = [];
    for (const name of entries) {
      const file = path.join(this.dir, name);
      const stat = await fsp.stat(file).catch(() => undefined);
      if (!stat?.isFile()) continue;
      if (name.endsWith(PARTIAL)) {
        if (now - stat.mtimeMs > STALE_PARTIAL_MS) await fsp.rm(file, { force: true });
        continue;
      }
      builds.push({ file, used: stat.mtimeMs });
    }
    builds.sort((a, b) => b.used - a.used);
    for (const { file } of builds.slice(this.keep)) {
      if (file === justWritten) continue;
      await fsp.rm(file, { force: true });
      this.logger.info(`Removed ${path.basename(file)} from the app cache`);
    }
  }
}

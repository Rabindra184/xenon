import fs from 'fs';
import path from 'path';

/**
 * ARB foreclosure guard #2: every artifact path flows through this interface
 * so the S3/object-store backend later is an implementation swap, not a
 * call-site migration. FsArtifactStore must stay byte-identical to the
 * legacy string concatenation it replaces.
 */
export interface ArtifactStore {
  resolve(...segments: string[]): string;
  ensureDir(...segments: string[]): Promise<string>;
  createReadStream(relPath: string): fs.ReadStream;
  exists(relPath: string): Promise<boolean>;
}

export class FsArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  resolve(...segments: string[]): string {
    // Byte-identical to the legacy `path.join(config.recordingsAssetsPath, ...)`
    // this replaced — including under a RELATIVE root (e.g. a relative
    // XENON_RECORDINGS_ASSETS_PATH override): path.join stays relative,
    // path.resolve would silently absolutize it. path.resolve is used ONLY
    // to compute an absolute form for the traversal guard, never for the
    // returned value.
    const joined = path.join(this.rootDir, ...segments);
    const absRoot = path.resolve(this.rootDir);
    const abs = path.resolve(joined);
    if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) {
      throw new Error(`artifact path escapes store root: ${joined}`);
    }
    return joined;
  }

  async ensureDir(...segments: string[]): Promise<string> {
    const dir = this.resolve(...segments);
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  }

  createReadStream(relPath: string): fs.ReadStream {
    return fs.createReadStream(this.resolve(relPath));
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.promises.access(this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }
}

export const ARTIFACT_STORE = 'artifact-store'; // TypeDI token

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
    const abs = path.resolve(this.rootDir, ...segments);
    if (!abs.startsWith(path.resolve(this.rootDir) + path.sep) && abs !== path.resolve(this.rootDir)) {
      throw new Error(`artifact path resolves outside the store root: ${abs}`);
    }
    return abs;
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

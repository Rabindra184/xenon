import * as fs from 'fs';
import * as path from 'path';
import { CapturedRequest } from './types';

export interface RequestBufferOptions {
  capacity: number;
  bodySpillThreshold: number;
  spillDir: string;
}

export class RequestBuffer {
  private entries: CapturedRequest[] = [];

  constructor(private readonly opts: RequestBufferOptions) {
    if (!fs.existsSync(opts.spillDir)) {
      fs.mkdirSync(opts.spillDir, { recursive: true });
    }
  }

  push(entry: CapturedRequest): void {
    const stored = this.spillBodyIfNeeded(entry);
    this.entries.push(stored);
    while (this.entries.length > this.opts.capacity) {
      const evicted = this.entries.shift();
      if (evicted) this.deleteSpill(evicted.bodyPath);
    }
  }

  list(): CapturedRequest[] {
    return [...this.entries];
  }

  get(id: string): CapturedRequest | undefined {
    return this.entries.find((e) => e.id === id);
  }

  clear(): void {
    for (const e of this.entries) this.deleteSpill(e.bodyPath);
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }

  private spillBodyIfNeeded(entry: CapturedRequest): CapturedRequest {
    const body = entry.resBody;
    if (typeof body === 'string' && body.length > this.opts.bodySpillThreshold) {
      const fileName = `${entry.id}-${Date.now()}.body`;
      const filePath = path.join(this.opts.spillDir, fileName);
      fs.writeFileSync(filePath, body, 'utf8');
      return { ...entry, resBody: null, bodyPath: filePath };
    }
    return entry;
  }

  private deleteSpill(bodyPath: string | undefined): void {
    if (!bodyPath) return;
    try {
      if (fs.existsSync(bodyPath)) fs.unlinkSync(bodyPath);
    } catch (e) {
      /* ignore */
    }
  }
}

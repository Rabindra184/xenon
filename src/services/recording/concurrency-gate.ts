import { Service } from 'typedi';
import { config } from '../../config';

/**
 * Server-wide cap on simultaneous free-form (mosaic) recordings.
 * Automation/session recordings are tracked separately via VideoPipelineService
 * and are NOT counted against this gate — they bypass it entirely.
 */
@Service()
export class ConcurrencyGate {
  private active = new Set<string>();
  private readonly limit: number;

  constructor(limit?: number) {
    this.limit = limit ?? config.maxConcurrentRecordings ?? 4;
  }

  /**
   * Atomic admission: either ALL recordingIds are admitted, or none are.
   * Returns true on success; false if admitting them would exceed the limit.
   */
  tryAcquire(recordingIds: string[]): boolean {
    if (this.active.size + recordingIds.length > this.limit) return false;
    for (const id of recordingIds) this.active.add(id);
    return true;
  }

  release(recordingId: string): void {
    this.active.delete(recordingId);
  }

  activeCount(): number {
    return this.active.size;
  }

  getLimit(): number {
    return this.limit;
  }
}

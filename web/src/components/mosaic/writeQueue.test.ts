import { describe, expect, it } from 'vitest';
import { createWriteQueue } from './writeQueue';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('createWriteQueue', () => {
  it('runs writes strictly in order, so a clear cannot overtake a mark', async () => {
    const q = createWriteQueue();
    const order: string[] = [];
    const mark = deferred();
    const a = q.enqueue(async () => {
      await mark.promise;
      order.push('mark');
    });
    const b = q.enqueue(async () => {
      order.push('clear');
    });
    await Promise.resolve();
    await Promise.resolve();
    // The clear waits for the in-flight mark.
    expect(order).toEqual([]);
    mark.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['mark', 'clear']);
  });

  it('keeps going after a failed write', async () => {
    const q = createWriteQueue();
    const failed = q.enqueue(async () => {
      throw new Error('boom');
    });
    const next = q.enqueue(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('returns each write its own result', async () => {
    const q = createWriteQueue();
    const [x, y] = await Promise.all([q.enqueue(async () => 1), q.enqueue(async () => 2)]);
    expect([x, y]).toEqual([1, 2]);
  });
});

import { describe, expect, it } from 'vitest';
import { judgeStreamStatus } from './streamLiveness';

const running = (startedAt?: string) => ({
  httpStatus: 200,
  body: { status: 'running', startedAt },
});

describe('judgeStreamStatus', () => {
  it('remembers when a running stream started', () => {
    expect(judgeStreamStatus(running('A'), undefined)).toEqual({ ended: false, startedAt: 'A' });
  });

  it('keeps a running stream that started when the tile connected', () => {
    expect(judgeStreamStatus(running('A'), 'A')).toEqual({ ended: false, startedAt: 'A' });
  });

  it('says a stopped stream has ended', () => {
    const answer = { httpStatus: 200, body: { status: 'stopped' } };
    expect(judgeStreamStatus(answer, 'A').ended).toBe(true);
  });

  it('says a stream that is starting again has ended', () => {
    const answer = { httpStatus: 200, body: { status: 'starting', startedAt: 'B' } };
    expect(judgeStreamStatus(answer, 'A').ended).toBe(true);
  });

  // Stopping a stream ends every viewer's connection, so a stream that was
  // stopped and started again between two checks is not the one on screen.
  it('says a stream restarted since the tile connected has ended', () => {
    expect(judgeStreamStatus(running('B'), 'A').ended).toBe(true);
  });

  it('says the stream has ended when the device is gone', () => {
    expect(judgeStreamStatus({ httpStatus: 404 }, 'A').ended).toBe(true);
  });

  it('keeps waiting when the server answers with an error', () => {
    expect(judgeStreamStatus({ httpStatus: 503 }, 'A')).toEqual({ ended: false, startedAt: 'A' });
  });

  // Android reports no start time; a running stream is then simply running.
  it('does not need a start time', () => {
    expect(judgeStreamStatus(running(), undefined)).toEqual({
      ended: false,
      startedAt: undefined,
    });
  });
});

import 'reflect-metadata';
import { expect } from 'chai';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';

describe('SelectorEvent table', function () {
  this.timeout(90_000);
  useScratchDatabase();

  it('keeps who did what to a selector, and why', async () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 2, 10, 0, s));
    await prisma.selectorEvent.create({
      data: {
        original_strategy: 'xpath',
        original_selector: '//a',
        action: 'muted',
        user_id: 'u-1',
        reason: 'Screen being redesigned',
        createdAt: at(0),
      },
    });
    await prisma.selectorEvent.create({
      data: {
        original_strategy: 'xpath',
        original_selector: '//a',
        action: 'unmuted',
        createdAt: at(1),
      },
    });

    const rows = await prisma.selectorEvent.findMany({
      where: { original_strategy: 'xpath', original_selector: '//a' },
      orderBy: { createdAt: 'desc' },
    });
    expect(rows.map((r) => r.action)).to.deep.equal(['unmuted', 'muted']);
    expect(rows[0]).to.include({ user_id: null, reason: null });
    expect(rows[1]).to.include({ user_id: 'u-1', reason: 'Screen being redesigned' });
  });
});

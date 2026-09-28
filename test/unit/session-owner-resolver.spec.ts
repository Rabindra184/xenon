import 'reflect-metadata';
import { expect } from 'chai';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';

// A stub shaped like the two Prisma delegates the resolver touches, counting
// calls so the caching contract is observable.
function stubDb(opts: {
  session?: { api_key_id: string | null; user_id?: string | null } | null;
  apiKey?: { userId: string } | null;
  user?: { email: string; name: string } | null;
}) {
  const calls = { session: 0, apiKey: 0, user: 0 };
  return {
    calls,
    session: {
      findUnique: async () => {
        calls.session += 1;
        return opts.session ?? null;
      },
    },
    apiKey: {
      findUnique: async () => {
        calls.apiKey += 1;
        return opts.apiKey ?? null;
      },
    },
    user: {
      findUnique: async () => {
        calls.user += 1;
        return opts.user ?? null;
      },
    },
  };
}

describe('SessionOwnerResolver.ownerOf', () => {
  it('resolves session -> apiKey -> userId', async () => {
    const db = stubDb({ session: { api_key_id: 'key_1' }, apiKey: { userId: 'usr_alice' } });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal('usr_alice');
  });

  it('returns null when the session has no api_key_id', async () => {
    const db = stubDb({ session: { api_key_id: null } });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal(null);
  });

  it('returns null when the session row is missing', async () => {
    const db = stubDb({ session: null });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal(null);
  });

  it('returns null when the api key row is gone', async () => {
    const db = stubDb({ session: { api_key_id: 'key_1' }, apiKey: null });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal(null);
  });

  it('caches a resolved owner — session ownership never changes', async () => {
    const db = stubDb({ session: { api_key_id: 'key_1' }, apiKey: { userId: 'usr_alice' } });
    const r = new SessionOwnerResolver(db);
    await r.ownerOf('sess-1');
    await r.ownerOf('sess-1');
    expect(db.calls.session).to.equal(1);
    expect(db.calls.apiKey).to.equal(1);
  });

  it('does NOT cache an unresolved owner — the row may not be written yet', async () => {
    const db = stubDb({ session: null });
    const r = new SessionOwnerResolver(db);
    await r.ownerOf('sess-1');
    await r.ownerOf('sess-1');
    expect(db.calls.session).to.equal(2);
  });

  it('prefers user_id and skips the ApiKey hop entirely', async () => {
    const db = stubDb({
      session: { api_key_id: 'key_1', user_id: 'usr_direct' },
      apiKey: { userId: 'usr_via_key' },
    });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal('usr_direct');
    expect(db.calls.apiKey, 'ApiKey should not be queried when user_id is set').to.equal(0);
  });

  it('falls back to the ApiKey hop for rows written before user_id existed', async () => {
    const db = stubDb({
      session: { api_key_id: 'key_1', user_id: null },
      apiKey: { userId: 'usr_legacy' },
    });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal('usr_legacy');
    expect(db.calls.apiKey).to.equal(1);
  });

  it('returns null when neither column resolves an owner', async () => {
    const db = stubDb({ session: { api_key_id: null, user_id: null } });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal(null);
  });

  it('does NOT cache an unresolved owner when the session row exists but neither column resolves', async () => {
    const db = stubDb({ session: { api_key_id: null, user_id: null } });
    const r = new SessionOwnerResolver(db);
    await r.ownerOf('sess-1');
    await r.ownerOf('sess-1');
    expect(db.calls.session).to.equal(2);
    // The public re-query assertion above already holds even for a resolver
    // that wrongly caches a null (the read side's own truthiness check masks
    // it), so it alone can't catch that regression — pin the cache's internal
    // state directly: a resolved-but-empty owner must never occupy a slot.
    expect(
      (r as unknown as { ownerCache: Map<string, string> }).ownerCache.has('sess-1'),
      'an unresolved owner must not be written into the cache',
    ).to.equal(false);
  });

  it('caches an owner resolved from user_id', async () => {
    const db = stubDb({ session: { api_key_id: null, user_id: 'usr_direct' } });
    const r = new SessionOwnerResolver(db);
    await r.ownerOf('sess-1');
    await r.ownerOf('sess-1');
    expect(db.calls.session).to.equal(1);
  });
});

describe('SessionOwnerResolver.displayName', () => {
  it('prefers email', async () => {
    const db = stubDb({ user: { email: 'alice@example.com', name: 'Alice' } });
    const r = new SessionOwnerResolver(db);
    expect(await r.displayName('usr_alice')).to.equal('alice@example.com');
  });

  it('returns null for an id that is not a user (e.g. a legacy apiKey id)', async () => {
    const db = stubDb({ user: null });
    const r = new SessionOwnerResolver(db);
    expect(await r.displayName('key_abc')).to.equal(null);
  });

  it('caches a resolved name', async () => {
    const db = stubDb({ user: { email: 'alice@example.com', name: 'Alice' } });
    const r = new SessionOwnerResolver(db);
    await r.displayName('usr_alice');
    await r.displayName('usr_alice');
    expect(db.calls.user).to.equal(1);
  });
});

// Prisma-shaped findMany delegates over fixed tables, recording each query so
// "one query for the whole list" is observable.
function tableDb(opts: {
  sessions: Array<{ id: string; api_key_id: string | null; user_id: string | null }>;
  apiKeys?: Array<{ id: string; userId: string }>;
}) {
  const queries: Array<{ table: string; ids: string[] }> = [];
  const pick = <T extends { id: string }>(rows: T[], where: any) =>
    rows.filter((row) => (where.id.in as string[]).includes(row.id));
  return {
    queries,
    session: {
      findUnique: async (): Promise<unknown> => {
        throw new Error('ownersOf must not look sessions up one by one');
      },
      findMany: async ({ where }: any): Promise<unknown[]> => {
        queries.push({ table: 'session', ids: [...where.id.in] });
        return pick(opts.sessions, where);
      },
    },
    apiKey: {
      findUnique: async (): Promise<unknown> => {
        throw new Error('ownersOf must not look keys up one by one');
      },
      findMany: async ({ where }: any): Promise<unknown[]> => {
        queries.push({ table: 'apiKey', ids: [...where.id.in] });
        return pick(opts.apiKeys ?? [], where);
      },
    },
  };
}

describe('SessionOwnerResolver.ownersOf', () => {
  it("resolves every session's owner with one query, by ownerOf's rule", async () => {
    const db = tableDb({
      sessions: [
        { id: 's1', api_key_id: 'k1', user_id: 'usr_direct' },
        { id: 's2', api_key_id: null, user_id: null },
      ],
    });
    const r = new SessionOwnerResolver(db);
    const owners = await r.ownersOf(['s1', 's2', 's-missing']);
    expect([...owners.entries()]).to.deep.equal([
      ['s1', 'usr_direct'],
      ['s2', null],
      ['s-missing', null],
    ]);
    expect(db.queries).to.deep.equal([{ table: 'session', ids: ['s1', 's2', 's-missing'] }]);
  });

  it('takes the ApiKey hop in one more query, only for rows written before user_id', async () => {
    const db = tableDb({
      sessions: [
        { id: 's1', api_key_id: 'k1', user_id: null },
        { id: 's2', api_key_id: 'k2', user_id: null },
        { id: 's3', api_key_id: 'k1', user_id: 'usr_direct' },
      ],
      apiKeys: [
        { id: 'k1', userId: 'usr_legacy_1' },
        { id: 'k2', userId: 'usr_legacy_2' },
      ],
    });
    const r = new SessionOwnerResolver(db);
    const owners = await r.ownersOf(['s1', 's2', 's3']);
    expect(owners.get('s1')).to.equal('usr_legacy_1');
    expect(owners.get('s2')).to.equal('usr_legacy_2');
    expect(owners.get('s3')).to.equal('usr_direct');
    expect(db.queries).to.have.length(2);
    expect(db.queries[1].table).to.equal('apiKey');
    expect(db.queries[1].ids).to.have.members(['k1', 'k2']);
  });

  it('agrees with ownerOf and shares its cache of resolved owners', async () => {
    const db = tableDb({ sessions: [{ id: 's1', api_key_id: null, user_id: 'usr_a' }] });
    const r = new SessionOwnerResolver(db);
    expect((await r.ownersOf(['s1'])).get('s1')).to.equal('usr_a');
    // Resolved above, so ownerOf answers from the cache; its findUnique would throw.
    expect(await r.ownerOf('s1')).to.equal('usr_a');
    // And a cached owner is not queried again.
    await r.ownersOf(['s1']);
    expect(db.queries).to.have.length(1);
  });

  it('does not cache an unresolved owner', async () => {
    const db = tableDb({ sessions: [] });
    const r = new SessionOwnerResolver(db);
    await r.ownersOf(['s1']);
    await r.ownersOf(['s1']);
    expect(db.queries).to.have.length(2);
  });

  it('makes no query for an empty list, and asks for a repeated id once', async () => {
    const db = tableDb({ sessions: [{ id: 's1', api_key_id: null, user_id: 'usr_a' }] });
    const r = new SessionOwnerResolver(db);
    expect((await r.ownersOf([])).size).to.equal(0);
    expect(db.queries).to.deep.equal([]);
    await r.ownersOf(['s1', 's1']);
    expect(db.queries).to.deep.equal([{ table: 'session', ids: ['s1'] }]);
  });

  it('lets a failed query reject, so the caller can fail closed', async () => {
    const db = tableDb({ sessions: [] });
    db.session.findMany = async (): Promise<unknown[]> => {
      throw new Error('database is locked');
    };
    const r = new SessionOwnerResolver(db);
    let caught: unknown;
    try {
      await r.ownersOf(['s1']);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error)?.message).to.equal('database is locked');
  });
});

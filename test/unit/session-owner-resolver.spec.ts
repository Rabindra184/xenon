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

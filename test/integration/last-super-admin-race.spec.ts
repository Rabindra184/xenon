import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { usersRouter } from '../../src/app/routers/users';
import { prisma, prismaTransactions } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';

/** Resolves for every caller once `parties` have arrived, or after `ms`. */
function barrier(parties: number, ms: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  const timer = setTimeout(release, ms);
  return async () => {
    arrived += 1;
    if (arrived >= parties) {
      clearTimeout(timer);
      release();
    }
    await open;
  };
}

/**
 * The scratch client with every `user.count`, its own and inside a
 * transaction, waiting at `meanwhile` once it has answered.
 */
function countingWaits(client: any, meanwhile: () => Promise<void>): any {
  const users = new Proxy(client.user, {
    get(target, prop) {
      if (prop === 'count') {
        return async (args: unknown) => {
          const n = await target.count(args);
          await meanwhile();
          return n;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'user') return users;
      if (prop === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>, options?: unknown) =>
          target.$transaction((tx: unknown) => fn(countingWaits(tx, meanwhile)), options);
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('the last active super-admin stays, whatever changes run at once', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let seq = 0;

  beforeEach(async () => {
    await scratch.db.userSession.deleteMany({});
    await scratch.db.user.deleteMany({});
  });

  async function superAdmin() {
    seq += 1;
    return scratch.db.user.create({
      data: {
        email: `race-sa-${seq}@xenon.local`,
        name: `Race SA ${seq}`,
        passwordHash: 'x',
        accessKey: `xen_RACE${String(seq).padStart(8, '0')}`,
        role: 'SUPER_ADMIN',
      },
    });
  }

  /** The router, with both changes reading the count before either writes. */
  function racingApp() {
    const bothCounted = barrier(2, 500);
    (prisma.user.count as sinon.SinonStub).callsFake(async (args: any) => {
      const n = await scratch.db.user.count(args);
      await bothCounted();
      return n;
    });
    const waiting = countingWaits(scratch.db, bothCounted);
    (prismaTransactions.$transaction as unknown as sinon.SinonStub).callsFake(
      (...args: unknown[]) => waiting.$transaction(...args),
    );
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // A super-admin who isn't one of the two users changed.
      (req as any).auth = {
        userId: 'caller',
        role: 'SUPER_ADMIN',
        scopes: 'admin,devices,sessions,read',
      };
      next();
    });
    app.use('/users', usersRouter());
    return app;
  }

  const activeSuperAdmins = () =>
    scratch.db.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } });

  it('lets one of a demotion and a deactivation of the last two through, never both', async () => {
    const [a, b] = [await superAdmin(), await superAdmin()];
    const app = racingApp();
    const answers = await Promise.all([
      request(app).patch(`/users/${a.id}`).send({ role: 'MEMBER' }),
      request(app).patch(`/users/${b.id}`).send({ status: 'INACTIVE' }),
    ]);
    expect(answers.map((r) => r.status).sort()).to.deep.equal([200, 400]);
    const refused = answers.find((r) => r.status === 400)!;
    expect(refused.body.error).to.match(/last active super-admin/);
    expect(await activeSuperAdmins()).to.equal(1);
  });

  it('lets one of two deletions of the last two through, never both', async () => {
    const [a, b] = [await superAdmin(), await superAdmin()];
    const app = racingApp();
    const answers = await Promise.all([
      request(app).delete(`/users/${a.id}`),
      request(app).delete(`/users/${b.id}`),
    ]);
    expect(answers.map((r) => r.status).sort()).to.deep.equal([204, 400]);
    expect(answers.find((r) => r.status === 400)!.body.error).to.match(/last active super-admin/);
    expect(await activeSuperAdmins()).to.equal(1);
    expect(await scratch.db.user.count()).to.equal(1);
  });

  it('still demotes, deactivates and deletes a super-admin while another stays', async () => {
    const [a, b, c, d] = [
      await superAdmin(),
      await superAdmin(),
      await superAdmin(),
      await superAdmin(),
    ];
    const app = racingApp();
    expect((await request(app).patch(`/users/${a.id}`).send({ role: 'ADMIN' })).status).to.equal(
      200,
    );
    expect(
      (await request(app).patch(`/users/${b.id}`).send({ status: 'INACTIVE' })).status,
    ).to.equal(200);
    expect((await request(app).delete(`/users/${c.id}`)).status).to.equal(204);
    expect(await activeSuperAdmins()).to.equal(1);
    // And the last one stays.
    const last = await request(app).delete(`/users/${d.id}`);
    expect(last.status).to.equal(400);
    expect(await activeSuperAdmins()).to.equal(1);
  });
});

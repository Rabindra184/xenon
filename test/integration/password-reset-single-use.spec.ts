import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { authPublicRouter } from '../../src/app/routers/auth';
import { UserService } from '../../src/services/UserService';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { prisma } from '../../src/prisma';
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

describe('a password reset link is used once', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let seq = 0;

  function app() {
    const a = express();
    a.use(express.json());
    a.use('/auth', authPublicRouter());
    return a;
  }

  async function seedUser(status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
    seq += 1;
    return Container.get(UserService).createUser({
      email: `reset-once-${seq}@xenon.local`,
      name: `Reset Once ${seq}`,
      password: 'original-pw-1',
      role: 'MEMBER',
      status,
    });
  }

  const storedHash = async (userId: string) =>
    (await scratch.db.user.findUnique({ where: { id: userId } }))!.passwordHash;

  it('lets one of two resets sent together with one link through, never both', async () => {
    const user = await seedUser();
    const { raw } = await Container.get(PasswordResetService).createToken(user.id);

    // Both requests read the link before either writes: the order that let
    // both through when the link was marked used only after the new password.
    const bothRead = barrier(2, 1_000);
    (prisma.passwordResetToken.findUnique as sinon.SinonStub).callsFake(async (args: any) => {
      const row = await scratch.db.passwordResetToken.findUnique(args);
      await bothRead();
      return row;
    });

    const passwords = ['first-new-pw-1', 'second-new-pw-2'];
    const answers = await Promise.all(
      passwords.map((newPassword) =>
        request(app()).post('/auth/reset-password').send({ token: raw, newPassword }),
      ),
    );

    expect(answers.map((a) => a.status).sort()).to.deep.equal([204, 404]);
    const refused = answers.find((a) => a.status === 404)!;
    expect(refused.body).to.deep.equal({ error: 'invalid or expired token' });

    // The password is the one whose reset was answered 204, and only that one.
    const hash = await storedHash(user.id);
    const winner = passwords[answers.findIndex((a) => a.status === 204)];
    const loser = passwords.find((p) => p !== winner)!;
    const users = Container.get(UserService);
    expect(await users.verifyPassword(winner, hash)).to.equal(true);
    expect(await users.verifyPassword(loser, hash)).to.equal(false);
  });

  it('refuses a link once it has been used', async () => {
    const user = await seedUser();
    const { raw } = await Container.get(PasswordResetService).createToken(user.id);
    const first = await request(app())
      .post('/auth/reset-password')
      .send({ token: raw, newPassword: 'first-new-pw-1' });
    expect(first.status).to.equal(204);
    const hash = await storedHash(user.id);

    const again = await request(app())
      .post('/auth/reset-password')
      .send({ token: raw, newPassword: 'second-new-pw-2' });
    expect(again.status).to.equal(404);
    expect(await storedHash(user.id)).to.equal(hash);
  });

  it("refuses an Inactive user's link, as an invalid one", async () => {
    const user = await seedUser();
    const { raw } = await Container.get(PasswordResetService).createToken(user.id);
    await scratch.db.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    const before = await storedHash(user.id);

    const check = await request(app()).post('/auth/reset-password/check').send({ token: raw });
    expect(check.status).to.equal(404);
    expect(check.body).to.deep.equal({ error: 'invalid or expired token' });

    const reset = await request(app())
      .post('/auth/reset-password')
      .send({ token: raw, newPassword: 'new-pw-for-inactive' });
    expect(reset.status).to.equal(404);
    expect(reset.body).to.deep.equal({ error: 'invalid or expired token' });
    expect(await storedHash(user.id)).to.equal(before);
  });

  it('refuses a link whose user was made Inactive after it was checked', async () => {
    const user = await seedUser();
    const { raw } = await Container.get(PasswordResetService).createToken(user.id);
    const before = await storedHash(user.id);

    // The check passes, then the user is deactivated before the link is spent.
    (prisma.passwordResetToken.findUnique as sinon.SinonStub).callsFake(async (args: any) => {
      const row = await scratch.db.passwordResetToken.findUnique(args);
      await scratch.db.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
      return row;
    });

    const reset = await request(app())
      .post('/auth/reset-password')
      .send({ token: raw, newPassword: 'new-pw-for-inactive' });
    expect(reset.status).to.equal(404);
    expect(await storedHash(user.id)).to.equal(before);
  });
});

import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { useScratchDatabase } from '../helpers/scratch-database';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { GrantStore } from '../../src/services/oauth/grantStore';
import { RevokedGrants } from '../../src/services/oauth/revokedGrants';
import { prisma } from '../../src/prisma';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A token's `gid` stands only while its grant is live by GrantStore's own
 * rule: not revoked, not past its own `expiresAt`, its maximum life
 * (XENON_MCP_REFRESH_MAX_DAYS) or its idle window. A grant that has lapsed
 * but hasn't been pruned yet used to stand, so a day-long session token
 * minted under it (xenon_session_capabilities) kept working after the
 * sign-in had ended.
 */
describe("RevokedGrants: a lapsed grant doesn't stand", () => {
  useScratchDatabase({ wholeSuite: true });

  let user: SeededUser;

  before(async () => {
    user = await seedUser('MEMBER', { name: 'Lapsed Agent Owner' });
  });

  async function grant(): Promise<string> {
    const { grantId } = await Container.get(GrantStore).create(user.user.id, 'spec-agent', [
      'appium:use',
    ]);
    return grantId;
  }

  it('a live grant stands', async () => {
    expect(await new RevokedGrants().isLive(await grant())).to.equal(true);
  });

  it('a grant past its own expiresAt does not', async () => {
    const id = await grant();
    await prisma.mcpGrant.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await new RevokedGrants().isLive(id)).to.equal(false);
  });

  it('a grant past its 90-day maximum does not, whatever its expiresAt says', async () => {
    const id = await grant();
    await prisma.mcpGrant.update({
      where: { id },
      data: {
        createdAt: new Date(Date.now() - 91 * DAY_MS),
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    });
    expect(await new RevokedGrants().isLive(id)).to.equal(false);
  });

  it('a grant unused past its idle window does not', async () => {
    const id = await grant();
    await prisma.mcpGrant.update({
      where: { id },
      data: { lastUsedAt: new Date(Date.now() - 31 * DAY_MS) },
    });
    expect(await new RevokedGrants().isLive(id)).to.equal(false);
  });
});

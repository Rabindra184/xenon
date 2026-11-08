import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import SelectorHealthRouter from '../../src/app/routers/selector-health';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import {
  canSeeSelectorFinds,
  parseFingerprintQuery,
  readFingerprint,
} from '../../src/services/selector-health/fingerprintRead';
import { RESILIO_PATH_FORMAT } from '../../src/services/healing/resilioPath';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * Xenon Test checks a suite's locators are healable before they break: it
 * needs to know what this server has learnt about a selector, which only
 * Xenon's database held (ENH-14). The answer names the identifying
 * attributes a fingerprint holds, never their values (the app's text).
 */
describe("reading a selector's fingerprint", () => {
  const scratch = useScratchDatabase();
  // Fingerprints may be kept outside the scratch database (the in-memory
  // store test:all uses), and saving without a path keeps a stored one: each
  // test learns a selector of its own.
  let PAY = '';
  let run = 0;
  beforeEach(() => {
    run += 1;
    PAY = `com.shop:id/pay-${process.pid}-${run}`;
  });

  const learn = (
    selector: string,
    nodeName: string,
    attributes: Array<{ name: string; value: string }>,
    path?: unknown,
  ) =>
    Container.get(HealEtalonService).saveSignature('id', selector, { nodeName, attributes }, path);

  beforeEach(async () => {
    await scratch.db.locatorEtalon.deleteMany({});
    await scratch.db.sessionLog.deleteMany({});
    await scratch.db.session.deleteMany({});
  });

  it('describes it by names only, never values', async () => {
    await learn(
      PAY,
      'android.widget.Button',
      [
        { name: 'resource-id', value: PAY },
        { name: 'text', value: 'Pay £1,240.00 to Jane' },
        { name: 'content-desc', value: 'null' },
        { name: 'x', value: '40' },
      ],
      { format: RESILIO_PATH_FORMAT, nodes: [{ tag: 'hierarchy' }] },
    );

    const answer = await readFingerprint({ strategy: 'id', selector: PAY }, undefined);

    expect(answer).to.include({
      strategy: 'id',
      selector: PAY,
      type: 'android.widget.Button',
      hasPath: true,
      hasIdentity: true,
    });
    // "null" is UiAutomator2's unset attribute: not identity.
    expect(answer?.identityAttributes).to.deep.equal(['resource-id', 'text']);
    expect(JSON.stringify(answer)).not.to.include('Jane');
    expect(answer?.updatedAt).to.be.a('string');
  });

  it('says when it has no path or nothing that says which element it is', async () => {
    await learn(PAY, 'XCUIElementTypeAny', [{ name: 'x', value: '40' }]);

    const answer = await readFingerprint({ strategy: '', selector: PAY }, undefined);

    expect(answer).to.include({ hasPath: false, hasIdentity: false });
    expect(answer?.identityAttributes).to.deep.equal([]);
  });

  it('answers nothing for an unknown selector, or one learnt under another strategy', async () => {
    await learn(PAY, 'android.widget.Button', [{ name: 'resource-id', value: PAY }]);

    expect(await readFingerprint({ strategy: 'id', selector: 'nope' }, undefined)).to.equal(null);
    expect(await readFingerprint({ strategy: 'xpath', selector: PAY }, undefined)).to.equal(null);
  });

  describe('who may see it', () => {
    const session = (id: string) =>
      scratch.db.session.create({
        data: {
          id,
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'n',
          has_live_video: false,
          device_udid: 'p',
          device_platform: 'android',
          device_version: '14',
        },
      });
    const find = (sessionId: string, selector: string) =>
      scratch.db.sessionLog.create({
        data: {
          session_id: sessionId,
          command_name: 'findElement',
          url: '/element',
          method: 'POST',
          title: 'Find element',
          response: '{}',
          original_strategy: 'id',
          original_selector: selector,
          is_success: true,
          is_error: false,
          is_healed: false,
        } as any,
      });

    it('a member whose session ran a find of it, healed or not', async () => {
      await session('s-mine');
      await session('s-theirs');
      await find('s-mine', PAY);
      await find('s-theirs', `${PAY}-secret`);
      const mine = { id: { in: ['s-mine'] } };

      expect(await canSeeSelectorFinds({ strategy: 'id', selector: PAY }, mine)).to.equal(true);
      expect(
        await canSeeSelectorFinds({ strategy: 'id', selector: `${PAY}-secret` }, mine),
      ).to.equal(false);
    });

    it("an admin always; a member never sees one only another's session found", async () => {
      await learn(`${PAY}-secret`, 'android.widget.Button', [
        { name: 'resource-id', value: `${PAY}-secret` },
      ]);
      await session('s-theirs');
      await find('s-theirs', `${PAY}-secret`);
      const query = { strategy: 'id', selector: `${PAY}-secret` };

      expect(await readFingerprint(query, undefined)).to.not.equal(null);
      expect(await readFingerprint(query, { id: { in: ['s-mine'] } })).to.equal(null);
    });
  });

  describe('GET /healing/fingerprint', () => {
    const app = express();
    app.use((req: any, _res, next) => {
      req.auth = {
        kind: 'user-session',
        userId: 'admin',
        role: 'ADMIN',
        scopes: 'admin',
        teamIds: undefined,
      };
      next();
    });
    const router = express.Router();
    SelectorHealthRouter.register(router);
    app.use(router);

    it('answers 200, 404 like an unknown selector, and 400 without a selector', async () => {
      await learn(PAY, 'android.widget.Button', [{ name: 'resource-id', value: PAY }]);

      const found = await request(app)
        .get('/healing/fingerprint')
        .query({ strategy: 'id', selector: PAY });
      expect(found.status).to.equal(200);
      expect(found.body.identityAttributes).to.deep.equal(['resource-id']);

      const missing = await request(app).get('/healing/fingerprint').query({ selector: 'nope' });
      expect(missing.status).to.equal(404);
      expect(missing.body).to.deep.equal({ error: 'not_found', message: 'Selector not found' });

      expect((await request(app).get('/healing/fingerprint')).status).to.equal(400);
    });
  });

  it('reads its query', () => {
    expect(parseFingerprintQuery({ selector: PAY, strategy: 'id' })).to.deep.equal({
      strategy: 'id',
      selector: PAY,
    });
    expect(parseFingerprintQuery({})).to.equal(null);
    expect(parseFingerprintQuery({ selector: 'x'.repeat(4001) })).to.equal(null);
  });
});

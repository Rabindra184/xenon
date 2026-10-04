import 'reflect-metadata';
import { expect } from 'chai';
import axios from 'axios';
import sinon from 'sinon';
import { Container } from 'typedi';
import { NotificationService } from '../../src/services/NotificationService';
import {
  WEBHOOK_EVENTS,
  EVENT_TYPES,
  renderTemplate,
  sessionFailedPayload,
} from '../../src/services/webhookEvents';
// What the dashboard offers as chips: plain JSON, so a spec can read it.
import WEBHOOK_EVENT_VARIABLES from '../../web/src/components/webhook-settings/webhookEventVariables.json';

/**
 * One documented payload per event, and every way a webhook turns it into a
 * message (the built-in Slack text, the generic JSON, a custom template) reads
 * those same names.
 *
 * `session_failed` used to send the database row (`id`, `failure_reason`, ...)
 * while the built-in Slack text read `sessionId` and `failureReason` and said
 * "undefined", and the dashboard's template chips offered the same two names,
 * which never substituted.
 */

const URL = 'https://hooks.example.com/T000/B000/xyz';

/** A Session row as Prisma returns it. */
const SESSION_ROW = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  name: 'Checkout flow',
  status: 'failed',
  failure_reason: 'Element not found: ~pay-now',
  device_udid: 'R58M123',
  device_name: 'Galaxy S9+',
  device_platform: 'android',
  device_version: '10',
  startTime: new Date('2026-10-04T09:00:00.000Z'),
  endTime: new Date('2026-10-04T09:02:30.000Z'),
  desired_capabilities: '{"platformName":"android","appium:app":"/secret/app.apk"}',
  session_capabilities: '{"deviceName":"x"}',
  api_key_id: 'key-1',
  user_id: 'user-1',
  ai_analysis: '{"long":"analysis"}',
};

describe('webhook payloads', () => {
  afterEach(() => sinon.restore());

  describe('session_failed', () => {
    it('is built from the session row with the documented names', () => {
      expect(sessionFailedPayload(SESSION_ROW as any)).to.deep.equal({
        sessionId: 'a1b2c3d4-0000-4000-8000-000000000001',
        sessionName: 'Checkout flow',
        failureReason: 'Element not found: ~pay-now',
        udid: 'R58M123',
        deviceName: 'Galaxy S9+',
        platform: 'android',
        osVersion: '10',
        startTime: '2026-10-04T09:00:00.000Z',
        endTime: '2026-10-04T09:02:30.000Z',
      });
    });

    it('leaves out what a webhook has no business with: capabilities, keys, analysis', () => {
      const payload = JSON.stringify(sessionFailedPayload(SESSION_ROW as any));
      for (const secret of ['/secret/app.apk', 'key-1', 'user-1', 'analysis', 'capabilities']) {
        expect(payload).not.to.contain(secret);
      }
    });

    it('never has a missing value: unknown ones are empty text', () => {
      const payload = sessionFailedPayload({
        id: 's-2',
        status: 'failed',
        device_udid: 'U',
        device_platform: 'ios',
        device_version: '17',
        device_name: null,
        name: null,
        failure_reason: null,
        startTime: new Date('2026-10-04T09:00:00.000Z'),
        endTime: null,
      } as any);
      expect(payload).to.include({
        sessionName: '',
        failureReason: '',
        deviceName: '',
        endTime: '',
      });
      for (const value of Object.values(payload)) expect(value).to.be.a('string');
    });
  });

  describe('the built-in Slack message', () => {
    let svc: NotificationService;
    let post: sinon.SinonStub;
    beforeEach(() => {
      svc = Container.get(NotificationService);
      post = sinon.stub(axios, 'post').resolves({ status: 200 });
    });

    const slackFor = async (event: any, payload: any) => {
      sinon
        .stub(svc, 'getConfigs')
        .resolves([
          { id: 'a', url: URL, events: JSON.stringify([event]), type: 'slack', active: true },
        ] as any);
      await svc.dispatchEvent(event, payload);
      return post.firstCall.args[1].attachments[0];
    };

    it('names the failed session and why, instead of "undefined"', async () => {
      const attachment = await slackFor('session_failed', sessionFailedPayload(SESSION_ROW as any));

      expect(attachment.text).to.contain('Session Failed');
      expect(attachment.text).to.contain('a1b2c3d4-0000-4000-8000-000000000001');
      expect(attachment.text).to.contain('Element not found: ~pay-now');
      expect(attachment.text).to.contain('Galaxy S9+');
      expect(attachment.text).not.to.contain('undefined');
      expect(JSON.stringify(attachment)).not.to.contain('undefined');
    });

    it('says so when no reason was recorded', async () => {
      const attachment = await slackFor(
        'session_failed',
        sessionFailedPayload({ ...SESSION_ROW, failure_reason: null } as any),
      );
      expect(attachment.text).to.contain('no reason recorded');
    });

    it('names the device for a device event', async () => {
      const attachment = await slackFor('device_offline', WEBHOOK_EVENTS.device_offline.sample());
      expect(attachment.text).to.contain('test-device-udid');
      expect(attachment.text).not.to.contain('undefined');
    });
  });

  describe('the generic webhook', () => {
    it('sends the event name and the documented payload', async () => {
      const svc = Container.get(NotificationService);
      const post = sinon.stub(axios, 'post').resolves({ status: 200 });
      sinon
        .stub(svc, 'getConfigs')
        .resolves([
          { id: 'a', url: URL, events: '["session_failed"]', type: 'webhook', active: true },
        ] as any);

      await svc.dispatchEvent('session_failed', sessionFailedPayload(SESSION_ROW as any));

      expect(post.firstCall.args[1]).to.deep.equal({
        event: 'session_failed',
        payload: sessionFailedPayload(SESSION_ROW as any),
      });
    });
  });

  describe('a custom template', () => {
    const data = { eventType: 'session_failed', ...sessionFailedPayload(SESSION_ROW as any) };

    it('fills the names the dashboard offers as chips', () => {
      expect(
        renderTemplate(
          '{"text": "{{eventType}}: {{sessionId}} on {{deviceName}}: {{failureReason}}"}',
          data,
        ),
      ).to.deep.equal({
        text: 'session_failed: a1b2c3d4-0000-4000-8000-000000000001 on Galaxy S9+: Element not found: ~pay-now',
      });
    });

    it('keeps the JSON valid when a value holds quotes, a backslash or a line break', () => {
      const body = renderTemplate('{"text": "Failed: {{failureReason}}", "n": 1}', {
        failureReason: 'No element "~pay"\nline two \\ done',
      });
      expect(body).to.deep.equal({ text: 'Failed: No element "~pay"\nline two \\ done', n: 1 });
    });

    it('fills a number or a list written without quotes', () => {
      expect(
        renderTemplate('{"heals": {{totalHeals}}, "top": {{hotspots}}}', {
          totalHeals: 12,
          hotspots: [{ healCount: 7 }],
        }),
      ).to.deep.equal({ heals: 12, top: [{ healCount: 7 }] });
    });

    it('sends a template that is not JSON as text', () => {
      expect(renderTemplate('Session {{sessionId}} failed', data)).to.deep.equal({
        text: 'Session a1b2c3d4-0000-4000-8000-000000000001 failed',
      });
    });

    it('leaves a name the event does not have as it was written, so a typo shows', () => {
      expect(renderTemplate('{"text": "{{sessionID}} / {{udid}}"}', data)).to.deep.equal({
        text: '{{sessionID}} / R58M123',
      });
    });

    it('reaches into a list with dots', () => {
      expect(
        renderTemplate('{"text": "{{hotspots.0.originalSelector}}"}', {
          hotspots: [{ originalSelector: '~login' }],
        }),
      ).to.deep.equal({ text: '~login' });
    });

    it('is what a real event is sent as', async () => {
      const svc = Container.get(NotificationService);
      const post = sinon.stub(axios, 'post').resolves({ status: 200 });
      sinon.stub(svc, 'getConfigs').resolves([
        {
          id: 'a',
          url: URL,
          events: '["session_failed"]',
          type: 'slack',
          active: true,
          payloadTemplate: '{"text": "{{sessionId}}: {{failureReason}}"}',
        },
      ] as any);

      await svc.dispatchEvent('session_failed', sessionFailedPayload(SESSION_ROW as any));

      expect(post.firstCall.args[1]).to.deep.equal({
        text: 'a1b2c3d4-0000-4000-8000-000000000001: Element not found: ~pay-now',
      });
    });
  });

  describe('Send test', () => {
    let svc: NotificationService;
    let post: sinon.SinonStub;
    beforeEach(() => {
      svc = Container.get(NotificationService);
      post = sinon.stub(axios, 'post').resolves({ status: 200 });
    });

    it('fills the template from a sample of the event asked for', async () => {
      await svc.sendTest(
        URL,
        'slack',
        '{"text": "{{eventType}}: {{failureReason}} ({{deviceName}})"}',
        'session_failed',
      );

      const sample = WEBHOOK_EVENTS.session_failed.sample();
      expect(post.firstCall.args[1]).to.deep.equal({
        text: `session_failed: ${sample.failureReason} (${sample.deviceName})`,
      });
      expect(JSON.stringify(post.firstCall.args[1])).not.to.contain('{{');
    });

    it('sends the built-in session_failed message when there is no template', async () => {
      await svc.sendTest(URL, 'slack', null, 'session_failed');

      const text = post.firstCall.args[1].attachments[0].text;
      expect(text).to.contain('Session Failed');
      expect(text).not.to.contain('undefined');
    });

    it('sends a device_new sample when no event is named, as before', async () => {
      await svc.sendTest(URL, 'webhook');
      expect(post.firstCall.args[1]).to.include({ event: 'device_new' });
    });

    it('can test every event', async () => {
      for (const event of EVENT_TYPES) {
        post.resetHistory();
        await svc.sendTest(URL, 'slack', null, event);
        expect(post.calledOnce, event).to.equal(true);
        expect(JSON.stringify(post.firstCall.args[1]), event).not.to.contain('undefined');
      }
    });
  });

  describe('the documented variables', () => {
    for (const event of EVENT_TYPES) {
      it(`${event}: each one is in the sample, so the test message fills it`, () => {
        const sample = WEBHOOK_EVENTS[event].sample();
        for (const { name } of WEBHOOK_EVENTS[event].variables) {
          expect(sample, name).to.have.property(name);
          expect(sample[name], name).not.to.equal(undefined);
        }
      });

      it(`${event}: the dashboard offers exactly these as template chips`, () => {
        expect(WEBHOOK_EVENT_VARIABLES[event]).to.deep.equal(
          WEBHOOK_EVENTS[event].variables.map((v) => v.name),
        );
      });
    }
  });

  describe('session_failed, once per session', () => {
    it('is sent once however many times the session ends', async () => {
      const svc = Container.get(NotificationService);
      const dispatch = sinon.stub(svc, 'dispatchEvent').resolves();

      await svc.notifySessionFailed({ ...SESSION_ROW, id: 'once-1' } as any);
      await svc.notifySessionFailed({ ...SESSION_ROW, id: 'once-1' } as any);
      await svc.notifySessionFailed({ ...SESSION_ROW, id: 'once-2' } as any);

      expect(dispatch.callCount).to.equal(2);
      expect(dispatch.firstCall.args[0]).to.equal('session_failed');
      expect(dispatch.firstCall.args[1].sessionId).to.equal('once-1');
    });

    it('is sent once when two ends race', async () => {
      const svc = Container.get(NotificationService);
      const dispatch = sinon
        .stub(svc, 'dispatchEvent')
        .callsFake(() => new Promise((resolve) => setTimeout(resolve, 20)));

      await Promise.all([
        svc.notifySessionFailed({ ...SESSION_ROW, id: 'race-1' } as any),
        svc.notifySessionFailed({ ...SESSION_ROW, id: 'race-1' } as any),
      ]);

      expect(dispatch.callCount).to.equal(1);
    });
  });
});

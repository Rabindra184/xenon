import 'reflect-metadata';
import { expect } from 'chai';
import axios from 'axios';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { NotificationService } from '../../src/services/NotificationService';
import { createRouter } from '../../src/app/index';
import { config } from '../../src/config';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * "Send test" on a webhook always said it worked: it called the Slack sender
 * whatever the webhook's type, and every sender caught its own delivery
 * error and only logged it. A template that wasn't JSON was also posted
 * twice. Deliveries now fail visibly where a caller wants to know (the
 * test), and live events still go on to the next webhook when one fails.
 */
describe('webhook delivery', () => {
  const URL = 'https://hooks.example.com/T000/B000/xyz';
  afterEach(() => sinon.restore());

  describe('NotificationService', () => {
    let svc: NotificationService;
    let post: sinon.SinonStub;
    beforeEach(() => {
      svc = Container.get(NotificationService);
      post = sinon.stub(axios, 'post');
    });

    for (const type of ['slack', 'webhook']) {
      it(`sendTest fails when a ${type} webhook refuses the delivery`, async () => {
        post.rejects(new Error('Request failed with status code 404'));
        const err = await svc.sendTest(URL, type).then(
          () => null,
          (e: Error) => e,
        );
        expect(err?.message).to.equal('Request failed with status code 404');
      });

      it(`sendTest delivers to a ${type} webhook once`, async () => {
        post.resolves({ status: 200 });
        await svc.sendTest(URL, type);
        expect(post.callCount).to.equal(1);
        expect(post.firstCall.args[0]).to.equal(URL);
      });
    }

    it('sendTest posts a generic webhook its event and payload', async () => {
      post.resolves({ status: 200 });
      await svc.sendTest(URL, 'webhook');
      expect(post.firstCall.args[1]).to.include({ event: 'device_new' });
    });

    it('posts a template that is not JSON once, as text', async () => {
      post.resolves({ status: 200 });
      await svc.sendTest(URL, 'webhook', 'Device {{name}} joined');
      expect(post.callCount).to.equal(1);
      expect(post.firstCall.args[1]).to.deep.equal({ text: 'Device Test Device joined' });
    });

    it('fails a template delivery that is refused, without posting again', async () => {
      post.rejects(new Error('boom'));
      const err = await svc.sendTest(URL, 'webhook', '{"text":"{{name}}"}').then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).to.equal('boom');
      expect(post.callCount).to.equal(1);
    });

    it('dispatchEvent still goes on to the next webhook when one fails', async () => {
      sinon.stub(svc, 'getConfigs').resolves([
        {
          id: 'a',
          url: 'https://a.example',
          events: '["device_new"]',
          type: 'webhook',
          active: true,
        },
        {
          id: 'b',
          url: 'https://b.example',
          events: '["device_new"]',
          type: 'slack',
          active: true,
        },
      ] as any);
      post.withArgs('https://a.example').rejects(new Error('down'));
      post.withArgs('https://b.example').resolves({ status: 200 });
      await svc.dispatchEvent('device_new', { name: 'Pixel', udid: 'u1' });
      expect(post.calledWith('https://b.example')).to.equal(true);
    });
  });

  describe('the routes', () => {
    useScratchDatabase();
    let app: express.Express;
    let saved: boolean;
    before(() => {
      app = express();
      app.use('/xenon', createRouter({ bindHostOrIp: '127.0.0.1', enableDashboard: true } as any));
    });
    beforeEach(() => {
      saved = config.authDisabled as boolean;
      config.authDisabled = true;
    });
    afterEach(() => {
      config.authDisabled = saved;
    });

    it('POST /api/webhook/test answers 502 when the delivery fails', async () => {
      sinon.stub(axios, 'post').rejects(new Error('getaddrinfo ENOTFOUND hooks.example.com'));
      const r = await request(app)
        .post('/xenon/api/webhook/test')
        .send({ url: URL, type: 'webhook' })
        .timeout(5000);
      expect(r.status).to.equal(502);
      expect(r.body).to.deep.equal({
        error: 'delivery_failed',
        message: 'getaddrinfo ENOTFOUND hooks.example.com',
      });
    });

    it('POST /api/webhook/test answers 200 when the webhook accepts it', async () => {
      sinon.stub(axios, 'post').resolves({ status: 200 });
      const r = await request(app)
        .post('/xenon/api/webhook/test')
        .send({ url: URL, type: 'slack' })
        .timeout(5000);
      expect(r.status).to.equal(200);
      expect(r.body).to.deep.equal({ success: true });
    });

    it('POST /api/webhook/test without a url answers 400', async () => {
      const r = await request(app).post('/xenon/api/webhook/test').send({}).timeout(5000);
      expect(r.status).to.equal(400);
    });

    it('DELETE /api/webhook/:id with an unknown id answers 404', async () => {
      const r = await request(app).delete('/xenon/api/webhook/no-such-hook').timeout(5000);
      expect(r.status).to.equal(404);
      expect(r.body).to.deep.equal({ error: 'not_found', message: 'Webhook not found' });
    });
  });
});

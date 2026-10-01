import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import express from 'express';
import { Container } from 'typedi';
import { loopbackServers } from '../helpers/loopbackServer';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import {
  openNodeMjpegRelay,
  recordingSourceFor,
} from '../../src/services/recording/nodeRecordingSource';

/**
 * Recording a node's phone on a hub. The recording's ffmpeg reads a loopback
 * port, as for this server's own phones; for a node's phone that port is a
 * relay to the node's MJPEG stream, signed for the recording's user on every
 * connection. ffmpeg reconnects on any hiccup, and the hub's control token
 * lasts a minute, so a token taken once would end the recording on the first
 * reconnect after that.
 */
describe('nodeRecordingSource', () => {
  const loopback = loopbackServers();
  const closers: (() => Promise<void>)[] = [];
  let context: PluginContext;
  let saved: Partial<PluginContext>;

  beforeEach(() => {
    context = Container.get(PluginContext);
    saved = { ...context };
    context.setContext({ ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any, 1, 'hub-1', '');
  });

  afterEach(async () => {
    Object.assign(context, saved);
    for (const close of closers.splice(0)) await close();
    await loopback.closeAll();
  });

  /** A node serving GET /control/p/stream, recording each request's token. */
  async function fakeNode(status = 200) {
    const seen: { token?: string; closed: boolean }[] = [];
    const app = express();
    app.get('/xenon/api/control/p/stream', (req, res) => {
      const call = { token: req.header('x-xenon-hub-token'), closed: false };
      seen.push(call);
      req.on('close', () => (call.closed = true));
      if (status !== 200) return res.status(status).json({ error: 'node says no' });
      res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=f' });
      const timer = setInterval(() => res.write('--f\r\nFRAME\r\n'), 30);
      res.on('close', () => clearInterval(timer));
    });
    const origin = `http://127.0.0.1:${((await loopback.serve(app)).address() as any).port}`;
    return { origin, seen };
  }

  /** Read from the relay until `n` frames arrived, then hang up. */
  const read = (port: number, n = 2) =>
    new Promise<{ status?: number; type?: string; body: string }>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c.toString();
          if (body.split('FRAME').length > n) {
            req.destroy();
            resolve({ status: res.statusCode, type: String(res.headers['content-type']), body });
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', (e: any) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
    });

  it('relays the node’s stream, signed afresh for each connection', async () => {
    const node = await fakeNode();
    let n = 0;
    const relay = await openNodeMjpegRelay(
      { udid: 'p', host: node.origin, actorId: 'alice' },
      { controlToken: async (grant) => `token-${++n}-${grant.userId}-${grant.udid}` },
    );
    closers.push(() => relay.close());

    const first = await read(relay.port);
    const second = await read(relay.port);

    expect(first.status).to.equal(200);
    expect(first.type).to.include('multipart/x-mixed-replace');
    expect(second.body).to.include('FRAME');
    expect(node.seen.map((s) => s.token)).to.deep.equal(['token-1-alice-p', 'token-2-alice-p']);
  });

  it('hangs up on the node when the reader goes, and stops listening when closed', async () => {
    const node = await fakeNode();
    const relay = await openNodeMjpegRelay(
      { udid: 'p', host: node.origin, actorId: 'alice' },
      { controlToken: async () => null },
    );
    await read(relay.port);
    await new Promise((r) => setTimeout(r, 100));
    expect(node.seen[0].closed, 'the node’s request ends with the reader').to.equal(true);

    await relay.close();
    const refused = await new Promise<string>((resolve) => {
      http
        .get({ host: '127.0.0.1', port: relay.port, path: '/' }, () => resolve('answered'))
        .on('error', (e: any) => resolve(e.code));
    });
    expect(refused).to.equal('ECONNREFUSED');
  });

  it('passes on the node’s refusal, so the recording ends rather than hangs', async () => {
    const node = await fakeNode(409);
    const relay = await openNodeMjpegRelay(
      { udid: 'p', host: node.origin, actorId: 'alice' },
      { controlToken: async () => null },
    );
    closers.push(() => relay.close());
    const res = await read(relay.port);
    expect(res.status).to.equal(409);
  });

  describe('recordingSourceFor', () => {
    const rows: Record<string, any> = {};
    const find = async (udid: string) => rows[udid] ?? null;

    it('is null for this server’s own phone and an unknown one', async () => {
      rows.own = { udid: 'own', host: 'http://10.0.0.9:4723', nodeId: 'hub-1' };
      expect(await recordingSourceFor('own', 'alice', { findDevice: find })).to.equal(null);
      expect(await recordingSourceFor('ghost', 'alice', { findDevice: find })).to.equal(null);
    });

    it('opens a relay for a node’s phone, and refuses a cloud provider’s', async () => {
      const node = await fakeNode();
      rows.p = { udid: 'p', host: node.origin, nodeId: 'node-1' };
      const relay = await recordingSourceFor('p', 'alice', {
        findDevice: find,
        controlToken: async () => null,
      });
      expect(relay?.port).to.be.a('number');
      closers.push(() => (relay as any).close());

      rows.c = { udid: 'c', host: 'https://hub.cloud.example', cloud: '{"cloudName":"x"}' };
      let error: any;
      await recordingSourceFor('c', 'alice', { findDevice: find }).catch((e) => (error = e));
      expect(error?.message).to.match(/cloud provider/);
    });
  });
});

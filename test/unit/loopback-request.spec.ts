import { expect } from 'chai';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import request from '../helpers/loopbackRequest';

// The drop-in for supertest's request(app) that listens on 127.0.0.1, where
// it connects, instead of on every address. See test/helpers/loopbackRequest.ts.
describe('loopbackRequest', () => {
  function echoApp() {
    const app = express();
    app.use(express.json());
    app.all('/echo', (req, res) => {
      res.json({ method: req.method, query: req.query, body: req.body });
    });
    return app;
  }

  it('serves the app on 127.0.0.1, not on every address', async () => {
    const server = http.createServer(echoApp());
    let bound: AddressInfo | undefined;
    server.on('listening', () => {
      bound = server.address() as AddressInfo;
    });
    const res = await request(server).get('/echo');
    expect(res.status).to.equal(200);
    expect(bound?.address).to.equal('127.0.0.1');
  });

  it('closes the server it started once the request is answered', async () => {
    const server = http.createServer(echoApp());
    await request(server).get('/echo');
    expect(server.listening).to.equal(false);
  });

  it('keeps what supertest does with a request: method, query, body', async () => {
    const res = await request(echoApp()).post('/echo').query({ a: '1' }).send({ b: 2 });
    expect(res.body).to.deep.equal({ method: 'POST', query: { a: '1' }, body: { b: 2 } });
  });

  it('answers several requests sent to one server at once', async () => {
    const server = http.createServer(echoApp());
    const answers = await Promise.all([
      request(server).get('/echo').query({ n: '1' }),
      request(server).get('/echo').query({ n: '2' }),
    ]);
    expect(answers.map((r) => r.body.query.n)).to.deep.equal(['1', '2']);
  });

  it('uses a server that is already listening, and leaves it open', async () => {
    const server = http.createServer(echoApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await request(server).get('/echo');
      expect(res.status).to.equal(200);
      expect(server.listening).to.equal(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('sends to a URL as given', async () => {
    const server = http.createServer(echoApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await request(`http://127.0.0.1:${port}`).get('/echo');
      expect(res.body.method).to.equal('GET');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server as IoServer } from 'socket.io';
import { SocketClient } from '../../src/services/SocketClient';

/**
 * A node's live-events connection to its hub. socket.io-client never tries a
 * refused handshake again. The hub answers `unavailable` when it could not
 * check the node's credential (its database or signing key unavailable), and
 * `unauthorized` when the credential doesn't admit it. Through 2.36 both were
 * `unauthorized`, and a node whose handshake met a database hiccup on the hub
 * had no live-events connection until it restarted.
 */
describe("a node's live-events connection when the hub can't check it", () => {
  let httpServer: http.Server | undefined;
  let hubIo: IoServer | undefined;
  let client: SocketClient | undefined;

  async function hub(answer: () => string | undefined): Promise<string> {
    const listening = http.createServer();
    httpServer = listening;
    hubIo = new IoServer(listening);
    hubIo.use((_socket, next) => {
      const refusal = answer();
      next(refusal ? new Error(refusal) : undefined);
    });
    await new Promise<void>((r) => listening.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
  }

  async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  afterEach(async () => {
    client?.close();
    client = undefined;
    await new Promise<void>((r) => (hubIo ? hubIo.close(() => r()) : r()));
    hubIo = undefined;
    const open = httpServer;
    if (open?.listening) await new Promise<void>((r) => open.close(() => r()));
    httpServer = undefined;
  });

  it('tries again after `unavailable`, and connects once the hub can check it', async () => {
    let handshakes = 0;
    const url = await hub(() => (++handshakes <= 2 ? 'unavailable' : undefined));
    client = new SocketClient();
    client.initialize(url, 'http://node.lab:4723', { retryDelayMs: 20 });

    await until(() => client!.isConnected(), 'the node to connect');
    expect(handshakes).to.equal(3);
  });

  it('does not try again after `unauthorized`', async () => {
    let handshakes = 0;
    const url = await hub(() => {
      handshakes += 1;
      return 'unauthorized';
    });
    client = new SocketClient();
    client.initialize(url, 'http://node.lab:4723', { retryDelayMs: 20 });

    await until(() => handshakes === 1, 'the handshake');
    await new Promise((r) => setTimeout(r, 200));
    expect(handshakes).to.equal(1);
    expect(client.isConnected()).to.equal(false);
  });
});

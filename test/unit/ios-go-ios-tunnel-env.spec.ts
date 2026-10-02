import 'reflect-metadata';
import { expect } from 'chai';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { IOSLogStreamService } from '../../src/device-managers/ios/IOSLogStreamService';
import { IOSTunnels } from '../../src/device-managers/ios/IOSTunnels';
import { WDAClient } from '../../src/device-managers/ios/WDAClient';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';

/**
 * On iOS 17+ a go-ios command finds its phone's tunnel through
 * GO_IOS_AGENT_PORT. Each phone has its own tunnel now, so each command has
 * to carry its own phone's port, or it reaches go-ios's default 60105, where
 * no tunnel listens.
 *
 * `go-ios` here is a shell script that reports the port it was run with.
 */

const WITH_TUNNEL = 'test-iphone-tunnel-00008150';
const NO_TUNNEL = 'test-iphone-plain-00008110';

const FAKE_GO_IOS = `#!/bin/sh
# Stands in for go-ios: reports the GO_IOS_AGENT_PORT it was run with.
case "$1" in
  screenshot) printf 'port=%s' "$GO_IOS_AGENT_PORT" > "$5" ;;
  syslog) printf '{"msg":"port=%s"}\\n' "$GO_IOS_AGENT_PORT"; exec sleep 5 ;;
esac
`;

/** iOS 17+, not streaming: it has a tunnel only once one is opened for it. */
const NEEDS_TUNNEL = 'test-iphone-idle-00008120';

/**
 * IOSTunnels as if WITH_TUNNEL's tunnel ran on 12100, NO_TUNNEL needed none
 * (below iOS 17), and NEEDS_TUNNEL got one on 12102 once borrowed.
 */
const tunnels = {
  borrowed: new Set<string>(),
  borrowCalls: [] as string[],
  borrowError: undefined as Error | undefined,
  async borrow(udid: string): Promise<number | null> {
    this.borrowCalls.push(udid);
    if (this.borrowError) throw this.borrowError;
    if (udid === NEEDS_TUNNEL) this.borrowed.add(udid);
    return udid === WITH_TUNNEL ? 12100 : udid === NEEDS_TUNNEL ? 12102 : null;
  },
  envFor(udid: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' };
    delete env.GO_IOS_AGENT_PORT;
    if (udid === WITH_TUNNEL) env.GO_IOS_AGENT_PORT = '12100';
    if (this.borrowed.has(udid)) env.GO_IOS_AGENT_PORT = '12102';
    return env;
  },
};

describe("go-ios commands find their own phone's tunnel (GO_IOS_AGENT_PORT)", () => {
  let dir: string;
  let goIOS: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-fake-goios-'));
    goIOS = path.join(dir, 'ios');
    fs.writeFileSync(goIOS, FAKE_GO_IOS, { mode: 0o755 });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    tunnels.borrowed.clear();
    tunnels.borrowCalls = [];
    tunnels.borrowError = undefined;
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === IOSTunnels) return tunnels;
      if (token === IOSStreamService) {
        return { goIOSPath: goIOS, isGoIOSAvailable: async () => true };
      }
      if (token === ProcessRegistry) return { track: () => 'tracked' };
      return real(token);
    });
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async ({ udid }: { udid: string }) => ({ udid, realDevice: true }),
    } as any);
  });

  afterEach(() => sinon.restore());

  describe("device control's screenshot (WDAClient)", () => {
    it("runs go-ios screenshot with the phone's tunnel port", async () => {
      const png = await new WDAClient().getScreenshot(WITH_TUNNEL);

      expect(Buffer.from(png, 'base64').toString()).to.equal('port=12100');
    });

    it('runs it with no tunnel port for a phone that has no tunnel', async () => {
      const png = await new WDAClient().getScreenshot(NO_TUNNEL);

      expect(Buffer.from(png, 'base64').toString()).to.equal('port=');
    });

    // On iOS 17+ the screenshot service is reached only through the tunnel,
    // and a phone that isn't streaming has none.
    it("opens the phone's tunnel for a screenshot when it has none", async () => {
      const png = await new WDAClient().getScreenshot(NEEDS_TUNNEL);

      expect(tunnels.borrowCalls).to.deep.equal([NEEDS_TUNNEL]);
      expect(Buffer.from(png, 'base64').toString()).to.equal('port=12102');
    });

    it("says why, when the tunnel can't start and WebDriverAgent can't answer either", async () => {
      tunnels.borrowError = new Error(
        'The go-ios tunnel for X exited before it was ready (exit code 1): failed to start tunnel: EOF',
      );
      const client = new WDAClient();
      sinon.stub(client as any, 'sendWDACommand').rejects(new Error('connect ECONNREFUSED'));

      const err = await client.getScreenshot(NEEDS_TUNNEL).then(
        () => null,
        (e: Error) => e,
      );

      expect(err?.message).to.match(/exited before it was ready .*failed to start tunnel: EOF/);
    });
  });

  describe('the logs read (WDAClient syslog)', () => {
    let client: WDAClient;

    beforeEach(() => {
      client = new WDAClient();
    });

    afterEach(() => {
      (client as any).stopLogStream(WITH_TUNNEL);
      (client as any).stopLogStream(NO_TUNNEL);
    });

    /** The first line the phone's syslog yields; the first read starts it. */
    async function firstLine(udid: string): Promise<string> {
      for (let i = 0; i < 50; i++) {
        const lines = await client.getLogs(udid);
        if (lines) return lines;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return '';
    }

    it("runs go-ios syslog with the phone's tunnel port", async () => {
      expect(await firstLine(WITH_TUNNEL)).to.equal('port=12100');
    });

    it('runs it with no tunnel port for a phone that has no tunnel', async () => {
      expect(await firstLine(NO_TUNNEL)).to.equal('port=');
    });
  });

  describe('the live logs pane (IOSLogStreamService ostrace)', () => {
    class CapturingLogs extends IOSLogStreamService {
      spawned: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      protected async goIOSPath(): Promise<string> {
        return goIOS;
      }
      protected spawnProcess(command: string, args: string[], env?: NodeJS.ProcessEnv): any {
        this.spawned.push({ command, args, env });
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        return proc;
      }
    }

    it("runs go-ios ostrace with the phone's tunnel port", async () => {
      const logs = new CapturingLogs();

      await (logs as any).spawnOstrace(WITH_TUNNEL, {});

      expect(logs.spawned[0].args[0]).to.equal('ostrace');
      expect(logs.spawned[0].env?.GO_IOS_AGENT_PORT).to.equal('12100');
    });

    it('runs it with no tunnel port for a phone that has no tunnel', async () => {
      const logs = new CapturingLogs();

      await (logs as any).spawnOstrace(NO_TUNNEL, {});

      expect(logs.spawned[0].env, 'an environment is passed').to.not.equal(undefined);
      expect(logs.spawned[0].env?.GO_IOS_AGENT_PORT).to.equal(undefined);
    });
  });
});

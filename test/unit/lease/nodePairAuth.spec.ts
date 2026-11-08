import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import {
  defaultNodePairAuthProvider,
  nodeCredentialsReady,
  resolveNodePairAuth,
} from '../../../src/services/lease/LeaseService';
import { PluginContext } from '../../../src/PluginContext';
import { config } from '../../../src/config';

describe('resolveNodePairAuth (lease port-allocator hub→node credentials)', () => {
  it('returns the configured hub node-pair credentials when both are set', () => {
    expect(
      resolveNodePairAuth({ hubAccessKey: 'ak_hub', hubToken: 'tok_hub', authDisabled: false }),
    ).to.deep.equal({ accessKey: 'ak_hub', token: 'tok_hub' });
  });

  it('returns empty credentials when auth is disabled and none are configured', () => {
    // Auth-disabled hubs accept any credentials on the node port-allocator, so
    // leasing must still work locally without provisioned node-pair keys.
    expect(
      resolveNodePairAuth({ hubAccessKey: undefined, hubToken: undefined, authDisabled: true }),
    ).to.deep.equal({ accessKey: '', token: '' });
  });

  it('throws a clear, actionable error when auth is enabled but credentials are missing', () => {
    expect(() =>
      resolveNodePairAuth({ hubAccessKey: undefined, hubToken: undefined, authDisabled: false }),
    ).to.throw(/XENON_HUB_ACCESS_KEY/);
  });

  it('treats a half-configured pair (only one of key/token) as unconfigured', () => {
    expect(
      resolveNodePairAuth({ hubAccessKey: 'ak_hub', hubToken: undefined, authDisabled: true }),
    ).to.deep.equal({ accessKey: '', token: '' });
    expect(() =>
      resolveNodePairAuth({ hubAccessKey: 'ak_hub', hubToken: undefined, authDisabled: false }),
    ).to.throw(/XENON_HUB_ACCESS_KEY/);
  });
});

describe("the default node credentials, and this server's own phones", () => {
  let saved: { args: any; port: number; authDisabled: boolean; key?: string; token?: string };

  beforeEach(() => {
    const context = Container.get(PluginContext);
    saved = {
      args: context.pluginArgs,
      port: context.port,
      authDisabled: config.authDisabled,
      key: config.hubAccessKey,
      token: config.hubToken,
    };
    context.pluginArgs = { ...context.pluginArgs, bindHostOrIp: '127.0.0.1' } as any;
    context.port = 4723;
    config.authDisabled = false;
    config.hubAccessKey = undefined;
    config.hubToken = undefined;
  });

  afterEach(() => {
    const context = Container.get(PluginContext);
    context.pluginArgs = saved.args;
    context.port = saved.port;
    config.authDisabled = saved.authDisabled;
    config.hubAccessKey = saved.key;
    config.hubToken = saved.token;
  });

  it('needs none for an own phone, with sign-in on', async () => {
    const provider = defaultNodePairAuthProvider();
    expect(await provider.nodePairAuth('http://127.0.0.1:4723')).to.deep.equal({
      accessKey: '',
      token: '',
    });
    expect(await provider.reaches?.('http://127.0.0.1:4723')).to.equal(true);
  });

  it("can't reach another server's phone without them", async () => {
    const provider = defaultNodePairAuthProvider();
    expect(await provider.reaches?.('http://10.9.9.9:4723')).to.equal(false);
    let thrown: Error | undefined;
    try {
      await provider.nodePairAuth('http://10.9.9.9:4723');
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).to.match(/XENON_HUB_ACCESS_KEY/);
  });

  it('is ready with both credentials, or with sign-in off', () => {
    expect(nodeCredentialsReady({ authDisabled: false })).to.equal(false);
    expect(nodeCredentialsReady({ authDisabled: false, hubAccessKey: 'k' })).to.equal(false);
    expect(
      nodeCredentialsReady({ authDisabled: false, hubAccessKey: 'k', hubToken: 't' }),
    ).to.equal(true);
    expect(nodeCredentialsReady({ authDisabled: true })).to.equal(true);
  });
});

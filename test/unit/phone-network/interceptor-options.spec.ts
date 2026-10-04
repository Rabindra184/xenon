import 'reflect-metadata';
import { expect } from 'chai';
import { getXenonCapabilities, XENON_CAPABILITIES } from '../../../src/XenonCapabilityManager';
import { resolveInterceptorOptions } from '../../../src/services/interceptor/interceptorOptions';

const capsOf = (alwaysMatch: Record<string, unknown>) =>
  getXenonCapabilities({ alwaysMatch, firstMatch: [{}] });

/**
 * The server's `interceptor` option was declared in schema.json and shown in
 * Xenon Control, but nothing read it: turning it on did nothing. It is now the
 * default for this server's sessions, and a session's own capability wins
 * field by field.
 */
describe('resolveInterceptorOptions: the server option is the default, the session decides', () => {
  it('leaves capture off when neither the session nor the server turns it on', () => {
    expect(resolveInterceptorOptions(capsOf({}), undefined).enabled).to.equal(false);
    expect(resolveInterceptorOptions(capsOf({}), {}).enabled).to.equal(false);
  });

  it("turns capture on for a session that doesn't say, when the server's option is on", () => {
    const opts = resolveInterceptorOptions(capsOf({}), { enabled: true });
    expect(opts.enabled).to.equal(true);
    expect(opts.captureBodies).to.equal(true);
    expect(opts.mocks).to.deep.equal([]);
  });

  it("lets a session turn capture off when the server's option is on", () => {
    const object = resolveInterceptorOptions(capsOf({ 'xe:interceptor': { enabled: false } }), {
      enabled: true,
    });
    expect(object.enabled).to.equal(false);
    const flat = resolveInterceptorOptions(capsOf({ 'xe:interceptorEnabled': false }), {
      enabled: true,
    });
    expect(flat.enabled).to.equal(false);
  });

  it("lets a session turn capture on when the server's option is off", () => {
    const opts = resolveInterceptorOptions(capsOf({ 'xe:interceptor': { enabled: true } }), {
      enabled: false,
    });
    expect(opts.enabled).to.equal(true);
  });

  it("takes bufferSize and captureBodies from the server when the session doesn't set them", () => {
    const opts = resolveInterceptorOptions(capsOf({ 'xe:interceptor': { enabled: true } }), {
      bufferSize: 50,
      captureBodies: false,
    });
    expect(opts.bufferSize).to.equal(50);
    expect(opts.captureBodies).to.equal(false);
  });

  it("keeps the session's own bufferSize and captureBodies over the server's", () => {
    const opts = resolveInterceptorOptions(
      capsOf({ 'xe:interceptor': { enabled: true, bufferSize: 7, captureBodies: true } }),
      { bufferSize: 50, captureBodies: false },
    );
    expect(opts.bufferSize).to.equal(7);
    expect(opts.captureBodies).to.equal(true);
  });

  it('keeps mocks and host filters from the session only', () => {
    const mocks = [{ match: { url: '**/x' }, respondWith: { status: 204 } }];
    const opts = resolveInterceptorOptions(
      capsOf({
        'xe:interceptor': { mocks, includeHosts: ['a.example'], excludeHosts: ['b.example'] },
      }),
      { enabled: true },
    );
    expect(opts.mocks).to.deep.equal(mocks);
    expect(opts.includeHosts).to.deep.equal(['a.example']);
    expect(opts.excludeHosts).to.deep.equal(['b.example']);
  });

  it('reads a session that sets nothing about capture as unset, not as off', () => {
    const caps = capsOf({});
    expect(caps[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(undefined);
    expect(caps[XENON_CAPABILITIES.INTERCEPTOR_CAPTURE_BODIES]).to.equal(undefined);
  });

  it('reads an interceptor object without `enabled` as unset', () => {
    const caps = capsOf({ 'xe:interceptor': { bufferSize: 3 } });
    expect(caps[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(undefined);
    expect(resolveInterceptorOptions(caps, { enabled: true }).enabled).to.equal(true);
  });

  it("reads `enabled: 'false'` as off", () => {
    const caps = capsOf({ 'xe:interceptor': { enabled: 'false' } });
    expect(caps[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(false);
  });
});

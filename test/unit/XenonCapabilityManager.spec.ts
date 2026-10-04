import 'reflect-metadata';
import chai from 'chai';
import { getXenonCapabilities, XENON_CAPABILITIES } from '../../src/XenonCapabilityManager';
import { ISessionCapability } from '../../src/interfaces/ISessionCapability';

chai.should();
const expect = chai.expect;

function caps(alwaysMatch: any, firstMatchEntry: any = {}): ISessionCapability {
  return { alwaysMatch, firstMatch: [firstMatchEntry] };
}

describe('XenonCapabilityManager.getXenonCapabilities — interceptor activation', () => {
  it('activates via bare `interceptor` cap', () => {
    const out = getXenonCapabilities(caps({ interceptor: { enabled: true } }));
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(true);
  });

  it('activates via `xe:interceptor` cap', () => {
    const out = getXenonCapabilities(caps({ 'xe:interceptor': { enabled: true } }));
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(true);
  });

  it('activates via nested `xe:options.interceptor` cap', () => {
    const out = getXenonCapabilities(caps({ 'xe:options': { interceptor: { enabled: true } } }));
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(true);
  });

  it('activates via the `xenon:options.interceptor` alias', () => {
    const out = getXenonCapabilities(caps({ 'xenon:options': { interceptor: { enabled: true } } }));
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(true);
  });

  it('activates via flat `interceptorEnabled` cap', () => {
    const out = getXenonCapabilities(caps({ interceptorEnabled: true }));
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(true);
  });

  it('respects bufferSize from xenon:options.interceptor', () => {
    const out = getXenonCapabilities(
      caps({ 'xenon:options': { interceptor: { enabled: true, bufferSize: 250 } } }),
    );
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(true);
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_BUFFER_SIZE]).to.equal(250);
  });

  it('activates via flat alias inside `xenon:options` (interceptorEnabled)', () => {
    const out = getXenonCapabilities(caps({ 'xenon:options': { interceptorEnabled: true } }));
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(true);
  });

  it('lets xe:options win over xenon:options field by field', () => {
    const out = getXenonCapabilities(
      caps(
        { 'xenon:options': { interceptorEnabled: true, name: 'old-name', build: 'nightly' } },
        { 'xe:options': { interceptorEnabled: false, name: 'new-name' } },
      ),
    );
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(false);
    expect(out[XENON_CAPABILITIES.SESSION_NAME]).to.equal('new-name');
    expect(out[XENON_CAPABILITIES.BUILD_NAME]).to.equal('nightly');
  });

  it("leaves no interceptor cap unset, for the server's `interceptor` option to decide", () => {
    // Off unless the server's option turns it on: resolveInterceptorOptions,
    // test/unit/phone-network/interceptor-options.spec.ts.
    const out = getXenonCapabilities(caps({}));
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(undefined);
  });

  it('does not throw when firstMatch is missing entirely', () => {
    const malformed = { alwaysMatch: { interceptor: { enabled: true } } } as any;
    expect(() => getXenonCapabilities(malformed)).to.not.throw();
    const out = getXenonCapabilities(malformed);
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(true);
  });
});

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

  it('activates via nested `xenon:options.interceptor` cap', () => {
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

  it('treats no interceptor cap as disabled', () => {
    const out = getXenonCapabilities(caps({}));
    expect(out[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]).to.equal(false);
  });
});

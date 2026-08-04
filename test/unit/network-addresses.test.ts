import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import os from 'os';
import {
  listIpv4Addresses,
  pickAdvertisedLanIp,
  resolveAdvertisedBindHost,
  shouldAutoResolveBindHost,
  isDeviceNetworkIp,
  sanitizeDeviceNetworkIp,
} from '../../src/helpers/networkAddresses';

describe('networkAddresses', () => {
  afterEach(() => sinon.restore());

  it('shouldAutoResolveBindHost treats loopback and wildcard as auto', () => {
    expect(shouldAutoResolveBindHost(undefined)).to.equal(true);
    expect(shouldAutoResolveBindHost('')).to.equal(true);
    expect(shouldAutoResolveBindHost('0.0.0.0')).to.equal(true);
    expect(shouldAutoResolveBindHost('127.0.0.1')).to.equal(true);
    expect(shouldAutoResolveBindHost('localhost')).to.equal(true);
    expect(shouldAutoResolveBindHost('auto')).to.equal(true);
    expect(shouldAutoResolveBindHost('192.168.0.104')).to.equal(false);
  });

  it('pickAdvertisedLanIp prefers private LAN over link-local', () => {
    sinon.stub(os, 'networkInterfaces').returns({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as any],
      en0: [{ address: '192.168.0.104', family: 'IPv4', internal: false } as any],
      bridge0: [{ address: '169.254.38.95', family: 'IPv4', internal: false } as any],
    });

    expect(listIpv4Addresses()).to.deep.equal(['192.168.0.104', '169.254.38.95']);
    expect(pickAdvertisedLanIp()).to.equal('192.168.0.104');
    expect(resolveAdvertisedBindHost('127.0.0.1')).to.equal('192.168.0.104');
  });

  it('resolveAdvertisedBindHost keeps explicit non-loopback values', () => {
    sinon.stub(os, 'networkInterfaces').returns({
      en0: [{ address: '192.168.0.104', family: 'IPv4', internal: false } as any],
    });
    expect(resolveAdvertisedBindHost('10.0.0.8')).to.equal('10.0.0.8');
  });

  it('isDeviceNetworkIp accepts IPv4 and rejects MAC addresses', () => {
    expect(isDeviceNetworkIp('192.168.0.106')).to.equal(true);
    expect(isDeviceNetworkIp('88:1e:5a:d6:7b:47')).to.equal(false);
    expect(sanitizeDeviceNetworkIp('88:1e:5a:d6:7b:47')).to.equal('');
    expect(sanitizeDeviceNetworkIp('192.168.0.106')).to.equal('192.168.0.106');
  });
});

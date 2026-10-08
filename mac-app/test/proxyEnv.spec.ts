import { describe, expect, it } from 'vitest';
import { proxyEnv, proxyUrl, withLoopback } from '../src/main/proxyEnv';

const PASSWORD = 'p@ss:w/rd';

describe('proxyUrl', () => {
  it('builds the address with the user name and the password escaped', () => {
    expect(proxyUrl({ host: 'squid.lab', port: 3128, auth: { username: 'qa' } }, PASSWORD)).toBe(
      'http://qa:p%40ss%3Aw%2Frd@squid.lab:3128'
    );
  });

  it('uses the proxy’s protocol', () => {
    const url = proxyUrl({ protocol: 'https', host: 'squid.lab', port: 3128, auth: { username: 'qa' } }, PASSWORD);
    expect(url?.startsWith('https://')).toBe(true);
    expect(url).toBe('https://qa:p%40ss%3Aw%2Frd@squid.lab:3128');
  });

  it('takes a protocol written with its colon, as Xenon does', () => {
    expect(proxyUrl({ protocol: 'https:', host: 'squid.lab', auth: { username: 'qa' } }, PASSWORD)).toBe(
      'https://qa:p%40ss%3Aw%2Frd@squid.lab'
    );
  });

  it('leaves the port out when there is none', () => {
    expect(proxyUrl({ host: 'squid.lab', auth: { username: 'qa' } }, PASSWORD)).toBe('http://qa:p%40ss%3Aw%2Frd@squid.lab');
  });

  it('escapes the user name too', () => {
    expect(proxyUrl({ host: 'squid.lab', auth: { username: 'q a@lab' } }, 'x')).toBe('http://q%20a%40lab:x@squid.lab');
  });

  it('is null without a host', () => {
    expect(proxyUrl({ port: 3128, auth: { username: 'qa' } }, PASSWORD)).toBeNull();
    expect(proxyUrl({ host: '  ', auth: { username: 'qa' } }, PASSWORD)).toBeNull();
    expect(proxyUrl({ host: 7, auth: { username: 'qa' } }, PASSWORD)).toBeNull();
  });

  it('is null without a user name', () => {
    expect(proxyUrl({ host: 'squid.lab', port: 3128 }, PASSWORD)).toBeNull();
    expect(proxyUrl({ host: 'squid.lab', auth: {} }, PASSWORD)).toBeNull();
    expect(proxyUrl({ host: 'squid.lab', auth: { username: '' } }, PASSWORD)).toBeNull();
    expect(proxyUrl({ host: 'squid.lab', auth: 'qa' }, PASSWORD)).toBeNull();
  });

  it('is null for a proxy that is not an object', () => {
    for (const proxy of [undefined, null, 'http://squid.lab:3128', 3128, ['squid.lab']]) {
      expect(proxyUrl(proxy, PASSWORD)).toBeNull();
    }
  });
});

describe('withLoopback', () => {
  it('is the loopback hosts when nothing is named', () => {
    expect(withLoopback(undefined)).toBe('localhost,127.0.0.1,::1');
    expect(withLoopback('')).toBe('localhost,127.0.0.1,::1');
  });

  it('keeps the hosts already named, first, and adds each loopback host once', () => {
    expect(withLoopback('.lab.example,localhost')).toBe('.lab.example,localhost,127.0.0.1,::1');
    expect(withLoopback(' a.example , ,b.example,a.example ')).toBe('a.example,b.example,localhost,127.0.0.1,::1');
  });
});

describe('proxyEnv', () => {
  it('sets the proxy under both spellings Xenon reads, and NO_PROXY with loopback under both', () => {
    const url = 'http://qa:p%40ss%3Aw%2Frd@squid.lab:3128';
    expect(proxyEnv(url, '.lab.example')).toEqual({
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      http_proxy: url,
      https_proxy: url,
      NO_PROXY: '.lab.example,localhost,127.0.0.1,::1',
      no_proxy: '.lab.example,localhost,127.0.0.1,::1'
    });
  });
});

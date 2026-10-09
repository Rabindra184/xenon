import { describe, expect, it } from 'vitest';
import {
  proxyEnv,
  proxyStringCredentials,
  proxyStringUrl,
  proxyStringWithoutPassword,
  proxyUrl,
  withLoopback
} from '../src/main/proxyEnv';

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
  it('is the loopback hosts when nothing is named, *.localhost included as the option had it', () => {
    expect(withLoopback(undefined)).toBe('localhost,127.0.0.1,::1,.localhost');
    expect(withLoopback('')).toBe('localhost,127.0.0.1,::1,.localhost');
  });

  it('keeps the hosts already named, first, and adds each loopback host once', () => {
    expect(withLoopback('.lab.example,localhost')).toBe('.lab.example,localhost,127.0.0.1,::1,.localhost');
    expect(withLoopback(' a.example , ,b.example,a.example ')).toBe(
      'a.example,b.example,localhost,127.0.0.1,::1,.localhost'
    );
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
      NO_PROXY: '.lab.example,localhost,127.0.0.1,::1,.localhost',
      no_proxy: '.lab.example,localhost,127.0.0.1,::1,.localhost'
    });
  });
});

// A proxy written as one address, which Xenon takes as it is (http:// added when it names no scheme).
describe('a proxy written as a string', () => {
  it('gives its user name and password, unescaped', () => {
    expect(proxyStringCredentials('http://qa:p%40ss%3Aw%2Frd@squid.lab:3128')).toEqual({ username: 'qa', password: PASSWORD });
    expect(proxyStringCredentials('qa:p%40ss@squid.lab:3128')).toEqual({ username: 'qa', password: 'p@ss' });
    expect(proxyStringCredentials('http://qa@squid.lab:3128')).toEqual({ username: 'qa', password: '' });
  });

  it('gives none for an address without credentials, or one that does not parse', () => {
    expect(proxyStringCredentials('http://squid.lab:3128')).toBeNull();
    expect(proxyStringCredentials('squid.lab:3128')).toBeNull();
    expect(proxyStringCredentials('http://bad host')).toBeNull();
    expect(proxyStringCredentials('')).toBeNull();
  });

  it('keeps a password it cannot unescape as written', () => {
    expect(proxyStringCredentials('http://qa:100%@squid.lab')).toEqual({ username: 'qa', password: '100%' });
  });

  it('drops the password and keeps the user name, so the Keychain one can go back in at launch', () => {
    expect(proxyStringWithoutPassword('http://qa:p%40ss@squid.lab:3128')).toBe('http://qa@squid.lab:3128');
    expect(proxyStringWithoutPassword('qa:p%40ss@squid.lab:3128')).toBe('http://qa@squid.lab:3128');
    expect(proxyStringWithoutPassword('https://qa:x@squid.lab')).toBe('https://qa@squid.lab');
  });

  it('builds the address with a password, when it names a user', () => {
    expect(proxyStringUrl('http://qa@squid.lab:3128', PASSWORD)).toBe('http://qa:p%40ss%3Aw%2Frd@squid.lab:3128');
    expect(proxyStringUrl('qa:old@squid.lab:3128', PASSWORD)).toBe('http://qa:p%40ss%3Aw%2Frd@squid.lab:3128');
    expect(proxyStringUrl('http://bad host', PASSWORD)).toBeNull();
  });
});

describe('a proxy written as a string with a password and no user name', () => {
  it('gives the password with an empty user name', () => {
    expect(proxyStringCredentials('http://:p%40ss%3Aw%2Frd@squid.lab:3128')).toEqual({ username: '', password: PASSWORD });
    expect(proxyStringCredentials(':p%40ss%3Aw%2Frd@squid.lab:3128')).toEqual({ username: '', password: PASSWORD });
  });

  it('drops the password', () => {
    expect(proxyStringWithoutPassword('http://:p%40ss@squid.lab:3128')).toBe('http://squid.lab:3128');
    expect(proxyStringWithoutPassword(':p%40ss@squid.lab:3128')).toBe('http://squid.lab:3128');
  });

  it('builds the address with the password and an empty user name, as it was written', () => {
    expect(proxyStringUrl('http://squid.lab:3128', PASSWORD)).toBe('http://:p%40ss%3Aw%2Frd@squid.lab:3128');
    expect(proxyStringUrl(':old@squid.lab:3128', PASSWORD)).toBe('http://:p%40ss%3Aw%2Frd@squid.lab:3128');
  });
});

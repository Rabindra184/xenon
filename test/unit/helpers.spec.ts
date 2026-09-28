import { expect } from 'chai';
import { redactSecrets } from '../../src/helpers';

describe('redactSecrets', () => {
  it('should redact sensitive keys', () => {
    const obj = {
      apiKey: 'secret123',
      password: 'password123',
      normal: 'value',
    };
    const redacted = redactSecrets(obj);
    expect(redacted.apiKey).to.equal('***REDACTED***');
    expect(redacted.password).to.equal('***REDACTED***');
    expect(redacted.normal).to.equal('value');
  });

  it('should handle nested objects', () => {
    const obj = {
      nested: {
        token: 'secretToken',
      },
    };
    const redacted = redactSecrets(obj);
    expect(redacted.nested.token).to.equal('***REDACTED***');
  });

  it('should handle arrays', () => {
    const obj = {
      list: [{ secretKey: 'key1' }, { normal: 'value' }],
    };
    const redacted = redactSecrets(obj);
    expect(redacted.list[0].secretKey).to.equal('***REDACTED***');
    expect(redacted.list[1].normal).to.equal('value');
  });

  it('should handle circular references', () => {
    const obj: any = {
      name: 'root',
    };
    obj.self = obj;

    const redacted = redactSecrets(obj);
    expect(redacted.name).to.equal('root');
    expect(redacted.self).to.equal('[Circular]');
  });

  it('should handle circular references in arrays', () => {
    const arr: any[] = [];
    arr.push(arr);

    const redacted = redactSecrets(arr);
    expect(redacted[0]).to.equal('[Circular]');
  });

  // Half of an xe:options credential pair: without its token it proves
  // nothing, but it names the key a leaked token would complete.
  it('should redact access keys in every spelling', () => {
    const KEY = 'xen_AbC123dEf456';
    const obj = {
      accessKey: KEY,
      access_key: KEY,
      ACCESS_KEY: KEY,
      'x-xenon-access-key': KEY,
      'xe:options': { accessKey: KEY, leaseId: 'lse_1' },
    };
    const redacted = redactSecrets(obj);
    expect(redacted).to.deep.equal({
      accessKey: '***REDACTED***',
      access_key: '***REDACTED***',
      ACCESS_KEY: '***REDACTED***',
      'x-xenon-access-key': '***REDACTED***',
      'xe:options': { accessKey: '***REDACTED***', leaseId: 'lse_1' },
    });
  });

  // GET /xenon/api/profile/access-key and /auth/me hand the caller their own
  // key. Logging the same object must not take it out of the response.
  it('should leave the object it was given untouched', () => {
    const body = { accessKey: 'xen_AbC123dEf456', nested: { token: 't' } };
    redactSecrets(body);
    expect(body).to.deep.equal({ accessKey: 'xen_AbC123dEf456', nested: { token: 't' } });
  });

  it('should redact falsy sensitive values', () => {
    const obj = {
      password: '',
      token: null,
      secret: false,
      apiKey: 0,
    };
    const redacted = redactSecrets(obj);
    expect(redacted.password).to.equal('***REDACTED***');
    expect(redacted.token).to.equal('***REDACTED***');
    expect(redacted.secret).to.equal('***REDACTED***');
    expect(redacted.apiKey).to.equal('***REDACTED***');
  });
});

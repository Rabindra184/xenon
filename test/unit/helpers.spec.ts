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

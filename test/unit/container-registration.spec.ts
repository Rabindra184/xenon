import 'reflect-metadata';
import { expect } from 'chai';
import { Container, Service, Token } from 'typedi';
import { saveRegistrations } from '../helpers/container-registration';

describe('saveRegistrations (test helper)', () => {
  it('puts back the instance that was built before a fake replaced it', () => {
    @Service()
    class Built {}
    const before = Container.get(Built);
    const restore = saveRegistrations(Built);
    Container.set(Built, { fake: true });
    expect(Container.get(Built)).to.deep.equal({ fake: true });
    restore();
    expect(Container.get(Built)).to.equal(before);
  });

  it('leaves a @Service() class that was never built registered, and still unbuilt', () => {
    let built = 0;
    @Service()
    class Lazy {
      constructor() {
        built += 1;
      }
    }
    const restore = saveRegistrations(Lazy);
    Container.set(Lazy, { fake: true });
    restore();
    expect(built, 'saving and restoring build nothing').to.equal(0);
    expect(Container.get(Lazy)).to.be.instanceOf(Lazy);
    expect(built).to.equal(1);
  });

  it('removes again an id that had no registration', () => {
    const token = new Token<string>('container-registration.spec');
    const restore = saveRegistrations(token);
    Container.set(token, 'fake');
    restore();
    expect(Container.has(token)).to.equal(false);
  });

  it('restores several ids at once', () => {
    @Service()
    class A {}
    @Service()
    class B {}
    const a = Container.get(A);
    const b = Container.get(B);
    const restore = saveRegistrations(A, B);
    Container.set(A, {});
    Container.set(B, {});
    restore();
    expect(Container.get(A)).to.equal(a);
    expect(Container.get(B)).to.equal(b);
  });
});

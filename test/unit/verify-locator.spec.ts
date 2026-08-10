import { expect } from 'chai';
import {
  elementIdOf,
  verifyLocator,
  type DriverLike,
  type VerifyLocatorResult,
} from '../../src/services/inspector/verifyLocator';

const W3C = 'element-6066-11e4-a52e-4f735466cecf';

/** A driver stub that records what it was asked to do. */
function fakeDriver(over: Partial<DriverLike> & { els?: any[] } = {}) {
  const calls: string[] = [];
  const els = over.els ?? [{ [W3C]: 'el-1' }];
  const d: DriverLike & { calls: string[] } = {
    calls,
    findElements: async (s: string, v: string) => {
      calls.push(`find:${s}=${v}`);
      return els;
    },
    getElementRect: async (id: string) => {
      calls.push(`rect:${id}`);
      return { x: 10, y: 20, width: 30, height: 40 };
    },
    click: async (id: string) => {
      calls.push(`click:${id}`);
    },
    clear: async (id: string) => {
      calls.push(`clear:${id}`);
    },
    setValue: async (t: string, id: string) => {
      calls.push(`setValue:${t}:${id}`);
    },
    ...over,
  } as any;
  return d;
}

const clock = () => {
  let t = 1000;
  return () => (t += 5);
};

describe('elementIdOf', () => {
  it('reads the W3C key', () => {
    expect(elementIdOf({ [W3C]: 'abc' })).to.equal('abc');
  });

  // Both key shapes exist in the wild depending on protocol era; reading only
  // one silently makes every action fail with "element without an id".
  it('falls back to the legacy ELEMENT key', () => {
    expect(elementIdOf({ ELEMENT: 'legacy-1' })).to.equal('legacy-1');
  });

  it('prefers W3C when a driver sends both', () => {
    expect(elementIdOf({ [W3C]: 'w3c', ELEMENT: 'legacy' })).to.equal('w3c');
  });

  it('returns undefined rather than throwing on a malformed element', () => {
    expect(elementIdOf({} as any)).to.equal(undefined);
    expect(elementIdOf(undefined as any)).to.equal(undefined);
  });
});

describe('verifyLocator', () => {
  it('reports a unique match with its rect', async () => {
    const d = fakeDriver();
    const r = await verifyLocator(d, { strategy: 'id', selector: 'com.x:id/ok' }, clock());

    expect(r.found).to.equal(true);
    expect(r.count).to.equal(1);
    expect(r.rect).to.deep.equal({ x: 10, y: 20, width: 30, height: 40 });
    expect(r.actionPerformed).to.equal('none');
    expect(r.error).to.equal(undefined);
    expect((d as any).calls[0]).to.equal('find:id=com.x:id/ok');
  });

  it('reports a clean miss without an error — not found is an answer, not a failure', async () => {
    const d = fakeDriver({ els: [] });
    const r = await verifyLocator(d, { strategy: 'id', selector: 'nope' }, clock());

    expect(r.found).to.equal(false);
    expect(r.count).to.equal(0);
    expect(r.error).to.equal(undefined);
  });

  // findElements, not findElement: a locator matching three things is a
  // different defect from one matching none, and findElement hides it.
  it('surfaces ambiguity as a count rather than picking the first', async () => {
    const d = fakeDriver({ els: [{ [W3C]: 'a' }, { [W3C]: 'b' }, { [W3C]: 'c' }] });
    const r = await verifyLocator(
      d,
      { strategy: 'class name', selector: 'android.widget.TextView' },
      clock(),
    );

    expect(r.found).to.equal(true);
    expect(r.count).to.equal(3);
    // No rect for an ambiguous match — a box would claim a precision the
    // locator does not have.
    expect(r.rect).to.equal(undefined);
  });

  it('reports a driver throw as an error, distinct from a miss', async () => {
    const d = fakeDriver({
      findElements: async () => {
        throw new Error('invalid selector: unclosed bracket');
      },
    });
    const r = await verifyLocator(d, { strategy: 'xpath', selector: '//bad[' }, clock());

    expect(r.found).to.equal(false);
    expect(r.count).to.equal(0);
    expect(r.error).to.contain('unclosed bracket');
  });

  it('requires both strategy and selector', async () => {
    const d = fakeDriver();
    const a = await verifyLocator(d, { strategy: '', selector: 'x' }, clock());
    const b = await verifyLocator(d, { strategy: 'id', selector: '' }, clock());
    expect(a.error).to.contain('required');
    expect(b.error).to.contain('required');
    expect((d as any).calls).to.have.length(0);
  });

  describe('actions', () => {
    it('taps the element Appium returned', async () => {
      const d = fakeDriver();
      const r = await verifyLocator(d, { strategy: 'id', selector: 'ok', action: 'tap' }, clock());

      expect(r.actionPerformed).to.equal('tap');
      expect(r.actionError).to.equal(undefined);
      expect((d as any).calls).to.include('click:el-1');
    });

    it('clears and sends keys', async () => {
      const d1 = fakeDriver();
      const r1 = await verifyLocator(
        d1,
        { strategy: 'id', selector: 'f', action: 'clear' },
        clock(),
      );
      expect(r1.actionPerformed).to.equal('clear');
      expect((d1 as any).calls).to.include('clear:el-1');

      const d2 = fakeDriver();
      const r2 = await verifyLocator(
        d2,
        { strategy: 'id', selector: 'f', action: 'sendKeys', text: 'hello' },
        clock(),
      );
      expect(r2.actionPerformed).to.equal('sendKeys');
      expect((d2 as any).calls).to.include('setValue:hello:el-1');
    });

    // Acting on "the first of four" is how a test passes locally and taps the
    // wrong thing in CI. It would also have this tool endorse a locator that
    // needs rewriting.
    it('refuses to act on an ambiguous locator, and says why', async () => {
      const d = fakeDriver({ els: [{ [W3C]: 'a' }, { [W3C]: 'b' }] });
      const r = await verifyLocator(
        d,
        { strategy: 'class name', selector: 'X', action: 'tap' },
        clock(),
      );

      expect(r.found).to.equal(true);
      expect(r.count).to.equal(2);
      expect(r.actionPerformed).to.equal('none');
      expect(r.actionError).to.contain('2 elements match');
      expect((d as any).calls.some((c: string) => c.startsWith('click'))).to.equal(false);
    });

    // The element EXISTS but could not be acted on — disabled, covered,
    // off-screen. Materially different from "locator not found", and the
    // distinction is the whole diagnostic value.
    it('keeps found=true when the find works but the action fails', async () => {
      const d = fakeDriver({
        click: async () => {
          throw new Error('element not interactable');
        },
      });
      const r = await verifyLocator(d, { strategy: 'id', selector: 'ok', action: 'tap' }, clock());

      expect(r.found).to.equal(true);
      expect(r.count).to.equal(1);
      expect(r.error, 'a failed action is not a failed find').to.equal(undefined);
      expect(r.actionError).to.contain('not interactable');
    });

    it('reports a driver that cannot perform the action rather than throwing', async () => {
      const d = fakeDriver({ click: undefined });
      const r = await verifyLocator(d, { strategy: 'id', selector: 'ok', action: 'tap' }, clock());
      expect(r.found).to.equal(true);
      expect(r.actionError).to.contain('does not support click');
    });

    it('does not act when no action was asked for', async () => {
      const d = fakeDriver();
      await verifyLocator(d, { strategy: 'id', selector: 'ok' }, clock());
      const calls = (d as any).calls as string[];
      expect(calls.some((c) => /^(click|clear|setValue)/.test(c))).to.equal(false);
    });
  });

  it('times the round trip', async () => {
    const d = fakeDriver();
    const r: VerifyLocatorResult = await verifyLocator(
      d,
      { strategy: 'id', selector: 'ok' },
      clock(),
    );
    expect(r.elapsedMs).to.be.greaterThan(0);
  });

  it('survives a rect lookup that fails, without losing the successful find', async () => {
    const d = fakeDriver({
      getElementRect: async () => {
        throw new Error('stale element');
      },
    });
    const r = await verifyLocator(d, { strategy: 'id', selector: 'ok' }, clock());
    expect(r.found).to.equal(true);
    expect(r.rect).to.equal(undefined);
  });
});

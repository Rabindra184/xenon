import { act, fireEvent } from '@testing-library/react';

/**
 * A pretend layout for testing the log list in jsdom. Tests only.
 *
 * jsdom lays nothing out: every element is 0 px tall, `scrollTop` is a plain
 * number that never moves the content and never fires `scroll`, there is no
 * `Element#scrollTo` and no `ResizeObserver`. The virtual list measures its
 * viewport and its rows and scrolls itself, so without this it renders no
 * rows at all. This gives:
 *
 * - every `[role="listbox"]` a fixed viewport, a content height read from its
 *   tallest child's `style.height` (the list's sizer), a `scrollTop` clamped
 *   the way a browser clamps it, which fires `scroll` after the change (a
 *   browser does it on the next frame, never inside the assignment), and
 *   `scrollTo({ top })`;
 * - every `[data-index]` element (a row) the height `rowHeight` gives it;
 * - no `ResizeObserver`, so the virtualizer measures rows as they render.
 *
 * Install it in a `beforeEach` inside the `describe` that needs it and call
 * `restore()` in the matching `afterEach`: it changes `HTMLElement.prototype`,
 * which every later test in the process would otherwise inherit.
 */
export interface FakeLayoutOptions {
  /** The list's visible height. Default 400. */
  viewportHeight?: number;
  /** The list's and the rows' width. Default 800. */
  viewportWidth?: number;
  /** A row's height. Default 20 for every row. */
  rowHeight?: (row: HTMLElement) => number;
}

export interface FakeLayout {
  restore(): void;
}

const PATCHED = [
  'offsetHeight',
  'offsetWidth',
  'clientHeight',
  'clientWidth',
  'scrollHeight',
  'scrollTop',
  'scrollTo',
] as const;

const scrollTops = new WeakMap<Element, number>();

const isList = (el: Element) => el.getAttribute('role') === 'listbox';
const isRow = (el: Element) => el.hasAttribute('data-index');

/** The descriptor jsdom itself uses, wherever on the chain it lives. */
function inherited(name: string): PropertyDescriptor | undefined {
  return (
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, name) ??
    Object.getOwnPropertyDescriptor(Element.prototype, name)
  );
}

export function installFakeLayout(options: FakeLayoutOptions = {}): FakeLayout {
  const viewportHeight = options.viewportHeight ?? 400;
  const viewportWidth = options.viewportWidth ?? 800;
  const rowHeight = options.rowHeight ?? (() => 20);
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

  const ownBefore = new Map<string, PropertyDescriptor | undefined>();
  const jsdom = new Map<string, PropertyDescriptor | undefined>();
  PATCHED.forEach((name) => {
    ownBefore.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    jsdom.set(name, inherited(name));
  });
  const original = (name: string, el: Element): number => {
    const get = jsdom.get(name)?.get;
    return get ? (get.call(el) as number) : 0;
  };

  const contentHeight = (el: Element) => {
    let tallest = viewportHeight;
    Array.from(el.children).forEach((child) => {
      const h = parseFloat((child as HTMLElement).style.height);
      if (h > tallest) tallest = h;
    });
    return tallest;
  };
  const maxScroll = (el: Element) => Math.max(0, contentHeight(el) - viewportHeight);

  const getter = (name: string, value: (el: HTMLElement) => number | undefined) =>
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        const v = value(this);
        return v === undefined ? original(name, this) : v;
      },
    });

  getter('offsetHeight', (el) => (isList(el) ? viewportHeight : isRow(el) ? rowHeight(el) : undefined));
  getter('offsetWidth', (el) => (isList(el) || isRow(el) ? viewportWidth : undefined));
  getter('clientHeight', (el) => (isList(el) ? viewportHeight : undefined));
  getter('clientWidth', (el) => (isList(el) ? viewportWidth : undefined));
  getter('scrollHeight', (el) => (isList(el) ? contentHeight(el) : undefined));

  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return isList(this) ? scrollTops.get(this) ?? 0 : original('scrollTop', this);
    },
    set(this: HTMLElement, value: number) {
      if (!isList(this)) {
        jsdom.get('scrollTop')?.set?.call(this, value);
        return;
      }
      const next = Math.max(0, Math.min(maxScroll(this), value));
      if (next === (scrollTops.get(this) ?? 0)) return;
      scrollTops.set(this, next);
      // A browser says so after the change, never inside the assignment.
      setTimeout(() => this.dispatchEvent(new Event('scroll')), 0);
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, arg?: ScrollToOptions | number, y?: number) {
      const top = typeof arg === 'number' ? y : arg?.top;
      if (typeof top === 'number') this.scrollTop = top;
    },
  });

  const resizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
  if (resizeObserver) delete (window as unknown as Record<string, unknown>).ResizeObserver;

  return {
    restore() {
      PATCHED.forEach((name) => {
        const before = ownBefore.get(name);
        if (before) Object.defineProperty(HTMLElement.prototype, name, before);
        else delete proto[name];
      });
      if (resizeObserver) Object.defineProperty(window, 'ResizeObserver', resizeObserver);
    },
  };
}

/**
 * A scroll the user makes: a wheel on the list, then the list moves to `top`
 * (clamped) and fires `scroll` at once.
 */
export function userScroll(list: HTMLElement, top: number): void {
  fireEvent.wheel(list);
  const max = Math.max(0, list.scrollHeight - list.clientHeight);
  scrollTops.set(list, Math.max(0, Math.min(max, top)));
  fireEvent.scroll(list);
}

/** Lets queued scroll events and animation frames run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  }
}

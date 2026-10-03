import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeLayout, settle, userScroll, type FakeLayout } from './fakeLayout';

const list = (contentHeight: number) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'listbox');
  const sizer = document.createElement('div');
  sizer.style.height = `${contentHeight}px`;
  el.appendChild(sizer);
  document.body.appendChild(el);
  return el;
};

describe('installFakeLayout', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 400, rowHeight: () => 33 });
  });
  afterEach(() => {
    layout.restore();
    document.body.innerHTML = '';
  });

  it('gives a list its viewport and its content height', () => {
    const el = list(1000);
    expect(el.offsetHeight).toBe(400);
    expect(el.clientHeight).toBe(400);
    expect(el.offsetWidth).toBe(800);
    expect(el.scrollHeight).toBe(1000);
  });

  it('measures a row by its height function', () => {
    const row = document.createElement('div');
    row.setAttribute('data-index', '0');
    expect(row.offsetHeight).toBe(33);
  });

  it('clamps scrollTop, and says so after the change as a browser does', async () => {
    const el = list(1000);
    const onScroll = vi.fn();
    el.addEventListener('scroll', onScroll);
    el.scrollTop = 5000;
    expect(el.scrollTop).toBe(600);
    expect(onScroll).not.toHaveBeenCalled();
    await settle();
    expect(onScroll).toHaveBeenCalledTimes(1);
    el.scrollTo({ top: 100 });
    expect(el.scrollTop).toBe(100);
  });

  it('has the user scroll with a wheel first and a scroll event at once', () => {
    const el = list(1000);
    const seen: string[] = [];
    el.addEventListener('wheel', () => seen.push('wheel'));
    el.addEventListener('scroll', () => seen.push(`scroll ${el.scrollTop}`));
    userScroll(el, 250);
    expect(seen).toEqual(['wheel', 'scroll 250']);
  });

  it('has no ResizeObserver while installed', () => {
    expect('ResizeObserver' in window).toBe(false);
  });
});

describe('installFakeLayout: restore', () => {
  it('puts back everything it changed', () => {
    const had = 'ResizeObserver' in window;
    const layout = installFakeLayout();
    layout.restore();
    const el = list(1000);
    expect(el.offsetHeight).toBe(0);
    expect(el.scrollHeight).toBe(0);
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')).toBeUndefined();
    expect('ResizeObserver' in window).toBe(had);
    document.body.innerHTML = '';
  });
});

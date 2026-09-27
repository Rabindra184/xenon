import { describe, expect, it } from 'vitest';
import { loadView, parseView, saveView, VIEW_KEY, viewToParams } from './deviceView';

describe('device view', () => {
  it('lets the URL win over the stored choice', () => {
    expect(parseView(new URLSearchParams('view=table'), 'cards')).toBe('table');
    expect(parseView(new URLSearchParams('view=cards'), 'table')).toBe('cards');
    expect(parseView(new URLSearchParams(''), 'table')).toBe('table');
    expect(parseView(new URLSearchParams('view=grid'), 'cards')).toBe('cards');
  });

  it('always writes the table, whatever is stored', () => {
    const p = new URLSearchParams('q=pixel');
    viewToParams(p, 'table', 'cards');
    expect(p.toString()).toBe('q=pixel&view=table');
  });

  it('writes cards too, when it disagrees with the stored preference', () => {
    // Otherwise a `?view=cards` link can't outlive the first filter change:
    // with `table` stored, dropping the param here would flip the page to
    // the table on the very next write.
    const p = new URLSearchParams('q=pixel');
    viewToParams(p, 'cards', 'table');
    expect(p.toString()).toBe('q=pixel&view=cards');
  });

  it('leaves cards out of the URL when it already matches storage', () => {
    const p = new URLSearchParams('q=pixel&view=cards');
    viewToParams(p, 'cards', 'cards');
    expect(p.toString()).toBe('q=pixel');
  });

  it('remembers the choice, and treats broken storage as cards', () => {
    const saved: Record<string, string> = {};
    saveView('table', { setItem: (k: string, v: string) => void (saved[k] = v) });
    expect(saved[VIEW_KEY]).toBe('table');
    expect(loadView({ getItem: () => 'table' })).toBe('table');
    expect(loadView({ getItem: () => 'nonsense' })).toBe('cards');
    expect(
      loadView({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('cards');
    expect(() =>
      saveView('table', {
        setItem: () => {
          throw new Error('full');
        },
      }),
    ).not.toThrow();
  });
});

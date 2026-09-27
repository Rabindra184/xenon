import { describe, expect, it } from 'vitest';
import { loadView, parseView, saveView, VIEW_KEY, viewToParams } from './deviceView';

describe('device view', () => {
  it('lets the URL win over the stored choice', () => {
    expect(parseView(new URLSearchParams('view=table'), 'cards')).toBe('table');
    expect(parseView(new URLSearchParams('view=cards'), 'table')).toBe('cards');
    expect(parseView(new URLSearchParams(''), 'table')).toBe('table');
    expect(parseView(new URLSearchParams('view=grid'), 'cards')).toBe('cards');
  });

  it('puts only the table in the URL', () => {
    const p = new URLSearchParams('q=pixel');
    viewToParams(p, 'table');
    expect(p.toString()).toBe('q=pixel&view=table');
    viewToParams(p, 'cards');
    expect(p.toString()).toBe('q=pixel');
  });

  it('remembers the choice, and treats broken storage as cards', () => {
    const saved: Record<string, string> = {};
    saveView('table', { setItem: (k: string, v: string) => void (saved[k] = v) });
    expect(saved[VIEW_KEY]).toBe('table');
    expect(loadView({ getItem: () => 'table' })).toBe('table');
    expect(loadView({ getItem: () => 'nonsense' })).toBe('cards');
    expect(loadView({ getItem: () => { throw new Error('blocked'); } })).toBe('cards');
    expect(() => saveView('table', { setItem: () => { throw new Error('full'); } })).not.toThrow();
  });
});

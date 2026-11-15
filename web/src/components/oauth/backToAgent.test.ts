import { describe, it, expect, vi, afterEach } from 'vitest';
import { backToAgent, canGoBackTo } from './backToAgent';

describe('backToAgent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("goes to the agent's loopback, https or app address", () => {
    expect(canGoBackTo('http://127.0.0.1:47831/callback?code=c')).toBe(true);
    expect(canGoBackTo('https://agent.example/cb?code=c')).toBe(true);
    expect(canGoBackTo('cursor://anysphere.cursor-retrieval/oauth?code=c')).toBe(true);
  });

  it("never runs an address that would run code or isn't an address", () => {
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<p>x</p>',
      'vbscript:x',
      'blob:https://x/1',
      'file:///etc/passwd',
      'not a url',
      '',
    ]) {
      expect(canGoBackTo(bad), bad).toBe(false);
    }
  });

  it('assigns the page only for an address it may go to', () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });
    try {
      expect(backToAgent('javascript:alert(1)')).toBe(false);
      expect(assign).not.toHaveBeenCalled();
      expect(backToAgent('http://127.0.0.1:5000/cb?code=c')).toBe(true);
      expect(assign).toHaveBeenCalledWith('http://127.0.0.1:5000/cb?code=c');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});

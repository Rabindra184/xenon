import { CompiledMock, Mock, RequestSummary, UrlMatcher } from './types';

export class MockEngine {
  private mocks: CompiledMock[] = [];
  private counter = 0;

  addMock(mock: Mock): string {
    const id = mock.id ?? this.generateId();
    const compiled: CompiledMock = { ...mock, id, addedAt: Date.now() };
    this.mocks.push(compiled);
    return id;
  }

  removeMock(id: string): boolean {
    const before = this.mocks.length;
    this.mocks = this.mocks.filter((m) => m.id !== id);
    return this.mocks.length < before;
  }

  clear(): void {
    this.mocks = [];
  }

  list(): CompiledMock[] {
    return [...this.mocks];
  }

  match(req: RequestSummary): CompiledMock | null {
    for (let i = this.mocks.length - 1; i >= 0; i--) {
      const mock = this.mocks[i];
      if (this.matches(mock, req)) return mock;
    }
    return null;
  }

  private matches(mock: CompiledMock, req: RequestSummary): boolean {
    const { url, method } = mock.match;
    if (method && method.toUpperCase() !== req.method.toUpperCase()) return false;
    return this.urlMatches(url, req.url);
  }

  private urlMatches(matcher: UrlMatcher, url: string): boolean {
    if (matcher instanceof RegExp) return matcher.test(url);
    if (matcher.includes('*')) return globToRegExp(matcher).test(url);
    return matcher === url;
  }

  private generateId(): string {
    this.counter += 1;
    return `mock-${Date.now().toString(36)}-${this.counter}`;
  }
}

function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i++;
    } else if (ch === '*') {
      pattern += '[^/]*';
    } else if ('.+?^$()[]{}|\\'.includes(ch)) {
      pattern += '\\' + ch;
    } else {
      pattern += ch;
    }
  }
  return new RegExp(`^${pattern}$`);
}

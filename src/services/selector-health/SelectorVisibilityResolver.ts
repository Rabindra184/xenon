import { Service } from 'typedi';
import log from '../../logger';
import { visibleSessionWhere } from '../device-access/sessionVisibility';
import { canSeeSelector } from './access';
import { SelectorKey, SessionScope } from './selectorKeys';

/**
 * How long an answer is reused. A selector event is rare, but a verification
 * run can send several at once, each to every dashboard connected.
 */
export const SELECTOR_VISIBILITY_TTL_MS = 5_000;
/** A lookup that takes longer answers no for that event, and isn't cached. */
export const SELECTOR_VISIBILITY_LOOKUP_TIMEOUT_MS = 2_000;
const MAX_ENTRIES = 10_000;

/** A dashboard caller who isn't an admin: their user and teams, as REST computes `req.auth`. */
export interface SelectorViewer {
  userId?: string;
  teamIds: string[];
}

export interface SelectorVisibilityResolverDeps {
  /** The viewer's sessions as a Session `where`; REST's `visibleSessionWhere` by default. */
  sessionScope?: (viewer: SelectorViewer) => Promise<SessionScope>;
  /** Whether the selector healed in those sessions; REST's `canSeeSelector` by default. */
  healedIn?: (key: SelectorKey, scope: SessionScope) => Promise<boolean>;
  now?: () => number;
  lookupTimeoutMs?: number;
}

interface Entry<T> {
  value: Promise<T>;
  /** When the lookup settled; undefined while it runs. */
  settledAt?: number;
}

/**
 * Whether a dashboard caller may see a selector, for the `selector_*` live
 * events: Selector Health's own rule (`access.ts`), a selector healed in at
 * least one session the caller may see. Admins see every selector and are
 * never asked about.
 *
 * Answers are cached for {@link SELECTOR_VISIBILITY_TTL_MS} per viewer (user
 * and teams, so a member's tabs share one) and selector, and a viewer's
 * sessions are read once for all their selectors. Concurrent questions share
 * one lookup. A lookup that fails, or outlasts
 * {@link SELECTOR_VISIBILITY_LOOKUP_TIMEOUT_MS}, answers no and isn't cached.
 */
@Service()
export class SelectorVisibilityResolver {
  private readonly scopes = new Map<string, Entry<SessionScope>>();
  private readonly answers = new Map<string, Entry<boolean>>();

  // An interface-typed parameter emits `Object`, which TypeDI leaves alone; a
  // function-typed one would make Container.get throw.
  constructor(private readonly deps: SelectorVisibilityResolverDeps = {}) {}

  /** Never rejects. */
  canSee(key: SelectorKey, viewer: SelectorViewer): Promise<boolean> {
    const who = JSON.stringify([viewer.userId ?? null, Array.from(new Set(viewer.teamIds)).sort()]);
    const answer = this.cached(
      this.answers,
      JSON.stringify([who, key.strategy, key.selector]),
      async () => {
        const scope = await this.cached(this.scopes, who, () => this.sessionScope(viewer));
        return this.healedIn(key, scope);
      },
    );
    return answer.catch((err: any) => {
      log.warn(
        `[SelectorVisibility] could not tell who may see ${key.strategy}=${key.selector}: ` +
          `${err?.message ?? err}; its event went to admins only`,
      );
      return false;
    });
  }

  private cached<T>(map: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const entry = map.get(key);
    if (
      entry &&
      (entry.settledAt === undefined || this.now() - entry.settledAt < SELECTOR_VISIBILITY_TTL_MS)
    ) {
      return entry.value;
    }
    const fresh: Entry<T> = { value: Promise.resolve(undefined as unknown as T) };
    fresh.value = this.bounded(load).then(
      (value) => {
        fresh.settledAt = this.now();
        return value;
      },
      (err) => {
        if (map.get(key) === fresh) map.delete(key);
        throw err;
      },
    );
    if (map.size >= MAX_ENTRIES && !map.has(key)) map.clear();
    map.set(key, fresh);
    return fresh.value;
  }

  private bounded<T>(load: () => Promise<T>): Promise<T> {
    const timeoutMs = this.deps.lookupTimeoutMs ?? SELECTOR_VISIBILITY_LOOKUP_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`took over ${timeoutMs} ms`)), timeoutMs);
      timer.unref?.();
    });
    const lookup = new Promise<T>((resolve) => resolve(load()));
    return Promise.race([lookup, timedOut]).finally(() => clearTimeout(timer));
  }

  private sessionScope(viewer: SelectorViewer): Promise<SessionScope> {
    if (this.deps.sessionScope) return this.deps.sessionScope(viewer);
    return visibleSessionWhere(viewer) as Promise<SessionScope>;
  }

  private healedIn(key: SelectorKey, scope: SessionScope): Promise<boolean> {
    return (this.deps.healedIn ?? canSeeSelector)(key, scope);
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}

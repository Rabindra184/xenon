import { AsyncLocalStorage } from 'async_hooks';

/**
 * The allocation the session gateway made for one `POST <basePath>/session`,
 * on its way to the plugin.
 *
 * For a phone this server drives, the gateway allocates in front of Appium's
 * route, then calls `next()` inside this request's async context. Appium's
 * route, its umbrella driver and every plugin before Xenon's run inside that
 * context, so XenonPlugin.createSession finds the allocation here and does not
 * allocate a second phone (sessionCreate.ts).
 *
 * It is handed over at most once. Whatever happens first wins:
 * - the plugin takes it, and from then on releasing the phone on failure is
 *   the plugin's job (SessionLifecycleService.completeLocalSession);
 * - or the request ends without the plugin taking it (Appium or another
 *   plugin refused the create first, or the client went away), and the
 *   gateway abandons it, which gives the phone back. A plugin that arrives
 *   after that finds it closed.
 *
 * Both happen on the event loop, so there is no interleaving between them.
 * Once taken or given back it keeps no reference to the allocation: things
 * the driver starts during the create (sockets, timers) keep this context,
 * and with it this object, for as long as they live.
 */
export class CreateHandoff<T> {
  private state: 'waiting' | 'taken' | 'closed' = 'waiting';

  constructor(
    private allocation: T | undefined,
    private readonly giveBack: (allocation: T) => void,
  ) {}

  /** The allocation, once. Throws when it was taken already or given back. */
  take(): T {
    if (this.state === 'taken') {
      throw new Error("This request's device allocation was already used by a createSession.");
    }
    if (this.state === 'closed') {
      throw new Error(
        'The request was closed before its session was created; its device was given back.',
      );
    }
    this.state = 'taken';
    const allocation = this.allocation as T;
    this.allocation = undefined;
    return allocation;
  }

  /** Give the allocation back if nobody took it. Safe to call more than once. */
  abandon(): void {
    if (this.state !== 'waiting') return;
    this.state = 'closed';
    const allocation = this.allocation as T;
    this.allocation = undefined;
    try {
      this.giveBack(allocation);
    } catch {
      /* the giver logs its own failures; a throw here would reach the socket */
    }
  }
}

const handoffs = new AsyncLocalStorage<CreateHandoff<unknown>>();

/** Run `fn` (the rest of the request) with this handoff as its context. */
export function runWithCreateHandoff<T, R>(handoff: CreateHandoff<T>, fn: () => R): R {
  return handoffs.run(handoff as CreateHandoff<unknown>, fn);
}

/** The handoff of the create request this code runs for, if the gateway made one. */
export function currentCreateHandoff<T = unknown>(): CreateHandoff<T> | undefined {
  return handoffs.getStore() as CreateHandoff<T> | undefined;
}

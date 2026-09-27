import { Container } from 'typedi';

type Registration = { id: unknown } & Record<string, unknown>;

/**
 * Remembers what the container holds for each of `ids` and returns a function
 * that puts it back. Call it in `beforeEach`, before registering fakes, and
 * call what it returns in `afterEach`, the way useArtifactStore() restores
 * ARTIFACT_STORE. Every spec then passes alone and in any order.
 *
 * The two shortcuts both leak into the specs that run later:
 * - `Container.remove(SomeService)` unregisters a @Service() class for the
 *   rest of the process, so the next spec's `Container.get` throws
 *   ServiceNotFoundError.
 * - `Container.set({ id, type })` throws away an instance someone already
 *   built and holds.
 *
 * This copies the registration itself, so a service that was never built is
 * not built here either: building one would build its dependencies too.
 */
export function saveRegistrations(...ids: unknown[]): () => void {
  // TypeDI keeps findService private in its types, but the registration is
  // the thing to copy: Container.set() later merges fields into the same
  // object, so it has to be a copy.
  const container = Container.of() as unknown as {
    findService(id: unknown): Registration | undefined;
  };
  const saved = ids.map((id) => {
    const found = container.findService(id);
    return { id, registration: found ? { ...found } : undefined };
  });
  return () => {
    for (const { id, registration } of [...saved].reverse()) {
      if (registration) Container.set(registration as any);
      else Container.remove(id as any);
    }
  };
}

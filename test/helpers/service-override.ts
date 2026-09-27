import { Container } from 'typedi';

type ServiceClass = new (...args: any[]) => unknown;

const overridden = new Set<ServiceClass>();

/**
 * Register `value` as the instance of a TypeDI @Service class until
 * `restoreServices()` runs. Call that from an afterEach inside your describe.
 */
export function overrideService(id: ServiceClass, value: unknown): void {
  Container.set(id, value);
  overridden.add(id);
}

/**
 * Put every overridden class back to "not built yet", the state
 * Container.reset() leaves a service in, without touching any other
 * registration. Container.remove() would unregister the class outright, and a
 * later Container.get() of it anywhere in the mocha process would throw
 * ServiceNotFoundError.
 */
export function restoreServices(): void {
  for (const id of overridden) Container.set({ id, type: id } as any);
  overridden.clear();
}

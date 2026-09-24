import os from 'os';
import { Container } from 'typedi';
import { ARTIFACT_STORE, FsArtifactStore } from '../../src/services/artifacts/ArtifactStore';

/**
 * Register an ArtifactStore for the enclosing `describe`, the way
 * ServerManager does at boot, so recording paths resolve under test.
 *
 * Call it inside a `describe`, never at the top of a file. A top-level hook
 * belongs to mocha's root suite and runs for every spec in the process; that
 * is how one spec's store once hid another spec's missing registration. On
 * the way out it puts back whatever was registered before, rather than
 * removing it, because an enclosing suite may still need it.
 */
export function useArtifactStore(root: string = os.tmpdir()): void {
  let previous: unknown;
  before(() => {
    previous = Container.has(ARTIFACT_STORE) ? Container.get(ARTIFACT_STORE) : undefined;
    Container.set(ARTIFACT_STORE, new FsArtifactStore(root));
  });
  after(() => {
    if (previous === undefined) Container.remove(ARTIFACT_STORE);
    else Container.set(ARTIFACT_STORE, previous);
  });
}

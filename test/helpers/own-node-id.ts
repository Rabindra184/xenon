import { Container } from 'typedi';
import { PluginContext } from '../../src/PluginContext';

/**
 * The node id of "this server" in a spec, for fake rows that are its own
 * phones. /control sends another server's phone's actions to that server
 * (src/app/routers/nodePhoneControl.ts) and decides whose a phone is by its
 * row's nodeId, which discovery always writes. A fake row without one, whose
 * host isn't one of this server's, is another server's phone.
 */
export const OWN_NODE_ID = 'this-server';

/**
 * Give the PluginContext OWN_NODE_ID for each test of the enclosing
 * `describe`, and put the old one back after it. Call it inside a describe.
 */
export function useOwnNodeId(): void {
  let saved = '';
  beforeEach(() => {
    const context = Container.get(PluginContext);
    saved = context.nodeId;
    context.nodeId = OWN_NODE_ID;
  });
  afterEach(() => {
    Container.get(PluginContext).nodeId = saved;
  });
}

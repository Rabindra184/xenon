import { Container } from 'typedi';
import { DeviceStoreFactory } from '../data-service/device-store';
import { IDevice } from '../interfaces/IDevice';
import { PluginContext } from '../PluginContext';
import { localDeviceHosts } from './localDeviceHosts';

/**
 * This server's own Device row for a phone it drives: the udid under one of
 * the hosts its discovery files phones under (localDeviceHosts), never
 * another server's row. A hub's table also holds its nodes' rows, and a node
 * on the same machine sees the same phones (an iPhone, emulator-5554), so a
 * udid alone may name the node's row, with the node's holds and sessions.
 *
 * One lookup per own host, usually just one. Null when none of them has the
 * phone.
 */
export async function findOwnDevice(udid: string): Promise<IDevice | null> {
  const ctx = Container.get(PluginContext);
  const store = DeviceStoreFactory.getStore();
  for (const host of localDeviceHosts(ctx.pluginArgs, ctx.port).hosts) {
    const device = await store.findDevice({ udid, host });
    if (device) return device;
  }
  return null;
}

import 'reflect-metadata';
import { Container } from 'typedi';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { v4 as uuidv4 } from 'uuid';
import { XenonDatabase } from '../../src/data-service/db';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import IOSDeviceManager from '../../src/device-managers/IOSDeviceManager';
import { XenonManager } from '../../src/device-managers';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';
import { saveRegistrations } from './container-registration';

/**
 * The classes setupTestContainer() builds. Each call makes new ones, with its
 * own PluginContext; the ones already registered are put back by
 * resetTestContainer().
 */
const BUILT: Array<new (...args: any[]) => unknown> = [
  PluginContext,
  IOSDiscoveryService,
  AndroidDeviceManager,
  IOSDeviceManager,
  XenonManager,
];

/** What each setupTestContainer() call not yet undone replaced, newest last. */
const undo: Array<() => void> = [];

/**
 * Registers a PluginContext configured for testing, and the device managers
 * built with it. Undo it with resetTestContainer() in the same `describe`.
 *
 * Only the ids it builds are replaced. It used to Container.reset(), which
 * discarded every singleton in the process, including the ones other specs
 * and the server's own modules had built and still held.
 */
export function setupTestContainer(overrides?: Partial<IPluginArgs>): {
  context: PluginContext;
  androidManager: AndroidDeviceManager;
  iosManager: IOSDeviceManager;
  xenonManager: XenonManager;
  nodeId: string;
  port: number;
} {
  undo.push(saveRegistrations('LocalStorage', ...BUILT));
  // Unbuilt again, so the Container.get() calls below make new instances.
  for (const id of BUILT) Container.set({ id, type: id });

  const nodeId = uuidv4();
  const port = 4723;
  const pluginArgs: IPluginArgs = Object.assign({}, DefaultPluginArgs, overrides || {});

  // Mock LocalStorage
  Container.set('LocalStorage', {
    getItem: (key: string) => null,
    setItem: (key: string, value: string) => {},
    removeItem: (key: string) => {},
  });

  // Initialize PluginContext
  const context = Container.get(PluginContext);
  context.setContext(pluginArgs, port, nodeId, '');

  // Get managers (they'll use the PluginContext via DI)
  const androidManager = Container.get(AndroidDeviceManager);
  const iosManager = Container.get(IOSDeviceManager);
  const xenonManager = Container.get(XenonManager);

  return {
    context,
    androidManager,
    iosManager,
    xenonManager,
    nodeId,
    port,
  };
}

/**
 * Creates a mock PluginContext and AndroidDeviceManager for unit testing.
 * Use this when you need to stub/spy on the manager.
 */
export function createTestAndroidManager(pluginArgs?: Partial<IPluginArgs>): AndroidDeviceManager {
  const { androidManager } = setupTestContainer(pluginArgs);
  return androidManager;
}

/**
 * Creates a mock PluginContext and IOSDeviceManager for unit testing.
 */
export function createTestIOSManager(pluginArgs?: Partial<IPluginArgs>): IOSDeviceManager {
  const { iosManager } = setupTestContainer(pluginArgs);
  return iosManager;
}

/**
 * Creates a XenonManager configured for testing.
 */
export function createTestXenonManager(pluginArgs?: Partial<IPluginArgs>): XenonManager {
  const { xenonManager } = setupTestContainer(pluginArgs);
  xenonManager.init();
  return xenonManager;
}

/**
 * Puts back every registration the setupTestContainer() calls since the last
 * reset replaced, newest first, and empties the in-memory device database.
 *
 * It changes nothing else. It used to stub device discovery on the
 * AndroidDeviceManager and IOSDiscoveryService prototypes and never restore
 * the stubs, so every spec that ran later got no devices from discovery.
 */
export async function resetTestContainer() {
  for (const restore of undo.splice(0).reverse()) restore();
  await XenonDatabase.reset();
}

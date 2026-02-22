import 'reflect-metadata';
import { Container } from 'typedi';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { v4 as uuidv4 } from 'uuid';
import { XenonDatabase } from '../../src/data-service/db';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import IOSDeviceManager from '../../src/device-managers/IOSDeviceManager';
import { XenonManager } from '../../src/device-managers';
import sinon from 'sinon';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';

const sandbox = sinon.createSandbox();

/**
 * Test utility to initialize the TypeDI Container with a PluginContext
 * configured for testing purposes.
 */
export function setupTestContainer(overrides?: Partial<IPluginArgs>): {
  context: PluginContext;
  androidManager: AndroidDeviceManager;
  iosManager: IOSDeviceManager;
  xenonManager: XenonManager;
  nodeId: string;
  port: number;
} {
  // Reset container to ensure clean state between tests
  Container.reset();

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

export async function resetTestContainer() {
  sandbox.restore();
  Container.reset();

  // Stub discovery methods to prevent background pollution
  sandbox.stub(AndroidDeviceManager.prototype, 'getDevices').resolves([]);
  sandbox.stub(IOSDiscoveryService.prototype, 'getDevices').resolves([]);

  // @ts-ignore - Stubbing internal methods to be extra safe
  sandbox.stub(AndroidDeviceManager.prototype, 'fetchAndroidDevices').resolves([]);
  // @ts-ignore
  sandbox.stub(IOSDiscoveryService.prototype, 'fetchLocalIOSDevices').resolves([]);
  // @ts-ignore
  sandbox.stub(IOSDiscoveryService.prototype, 'fetchLocalSimulators').resolves([]);

  // Clear DeviceStoreFactory static caches to prevent cross-test pollution
  // @ts-ignore - Accessing private static members for test cleanup
  DeviceStoreFactory._deviceStore = undefined;
  // @ts-ignore
  DeviceStoreFactory._pendingSessionStore = undefined;
  // @ts-ignore
  DeviceStoreFactory._cliArgsStore = undefined;
  // @ts-ignore
  DeviceStoreFactory._healEtalonStore = undefined;

  await XenonDatabase.reset();
}

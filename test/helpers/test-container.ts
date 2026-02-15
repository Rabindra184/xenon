import { Container } from 'typedi';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { v4 as uuidv4 } from 'uuid';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import IOSDeviceManager from '../../src/device-managers/IOSDeviceManager';
import { XenonManager } from '../../src/device-managers';

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

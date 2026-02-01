import { Request, Response, Router } from 'express';
import { DeviceStoreFactory } from '../../data-service/device-store';

import { XenonManager } from '../../device-managers';
import Container from 'typedi';
import log from '../../logger';
import { InternalHttpClient } from '../../InternalHttpClient';
import { blockDevice, unblockDevice } from '../../data-service/device-service';
import { MjpegProxy } from 'mjpeg-proxy';
import IOSStreamService from '../../device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../device-managers/android/AndroidStreamService';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';

const router = Router();

async function getDeviceInfo(udid: string) {
  return await DeviceStoreFactory.getStore().findDevice({ udid });
}

async function getDeviceManagerForPlatform(platform: string) {
  const dfm = Container.get(XenonManager);
  const instances = await dfm.deviceInstances();
  return instances.find((instance: any) => {
    if (platform === 'android' && instance.constructor.name === 'AndroidDeviceManager') return true;
    if (
      (platform === 'ios' || platform === 'tvos') &&
      instance.constructor.name === 'IOSDeviceManager'
    )
      return true;
    return false;
  });
}

router.post('/:udid/tap', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { x, y } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (device.host && !device.host.includes(req.get('host') || '')) {
    log.info(`Proxying tap for ${udid} to ${device.host}`);
    try {
      await InternalHttpClient.post(`${device.host}${req.originalUrl}`, req.body);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      return res.status(err.response?.status || 500).send(err.response?.data || err.message);
    }
  }

  if (manager && manager.tap) {
    await manager.tap(udid, x, y);
    return res.status(200).send({ success: true });
  } else if (device.platform === 'ios' && device.wdaLocalPort) {
    // Fallback/Direct WDA call for iOS
    try {
      await InternalHttpClient.post(
        `http://localhost:${device.wdaLocalPort}/session/None/wda/tap`,
        { x, y },
      );
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`WDA Tap failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or tap not supported');
});

router.post('/:udid/swipe', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { x, y, endX, endY, duration = 1000 } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (device.host && !device.host.includes(req.get('host') || '')) {
    log.info(`Proxying swipe for ${udid} to ${device.host}`);
    try {
      await InternalHttpClient.post(`${device.host}${req.originalUrl}`, req.body);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      return res.status(err.response?.status || 500).send(err.response?.data || err.message);
    }
  }

  if (manager && manager.swipe) {
    await manager.swipe(udid, x, y, endX, endY, duration);
    return res.status(200).send({ success: true });
  }
  res.status(400).send('Manager not found or swipe not supported');
});

router.post('/:udid/text', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { text } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (device.host && !device.host.includes(req.get('host') || '')) {
    log.info(`Proxying typeText for ${udid} to ${device.host}`);
    try {
      await InternalHttpClient.post(`${device.host}${req.originalUrl}`, req.body);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      return res.status(err.response?.status || 500).send(err.response?.data || err.message);
    }
  }

  if (manager && manager.typeText) {
    try {
      await manager.typeText(udid, text);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`❌ typeText failed for ${udid}: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or typeText not supported');
});

router.post('/:udid/keyevent', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { keyCode } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (device.host && !device.host.includes(req.get('host') || '')) {
    log.info(`Proxying keyevent for ${udid} to ${device.host}`);
    try {
      await InternalHttpClient.post(`${device.host}${req.originalUrl}`, req.body);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      return res.status(err.response?.status || 500).send(err.response?.data || err.message);
    }
  }

  if (manager && manager.pressKey) {
    try {
      await manager.pressKey(udid, keyCode);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`❌ pressKey failed for ${udid}: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or pressKey not supported');
});

router.get('/:udid/screenshot', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  // Principal Engineer Optimization: If a high-speed stream is already running for Android,
  // we should grab the latest frame instead of triggering a heavy ADB screencap.
  if (device.platform === 'android') {
    const streamSession = AndroidStreamService.getInstance().getStreamStatus(udid);
    if (streamSession?.status === 'running' && streamSession.latestFrame) {
      log.info(`Manual Control: Using cached stream frame for ${udid} screenshot.`);
      return res.status(200).send({ screenshot: streamSession.latestFrame.toString('base64') });
    }
  }

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.getScreenshot) {
    const base64 = await manager.getScreenshot(udid);
    return res.status(200).send({ screenshot: base64 });
  }
  res.status(400).send('Manager not found or screenshot not supported');
});

router.get('/:udid/clipboard', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.getClipboard) {
    try {
      const content = await manager.getClipboard(udid);
      log.info(`Fetched clipboard for ${udid} (${device.platform}): ${content?.length || 0} chars`);
      return res.status(200).send({ content });
    } catch (err: any) {
      log.error(`Failed to fetch clipboard for ${udid}: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or getClipboard not supported');
});

router.post('/:udid/clipboard', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { content } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.setClipboard) {
    await manager.setClipboard(udid, content);
    return res.status(200).send({ success: true });
  }
  res.status(400).send('Manager not found or setClipboard not supported');
});

router.post('/:udid/touchAndHold', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { x, y, duration = 1000 } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (device.host && !device.host.includes(req.get('host') || '')) {
    log.info(`Proxying touchAndHold for ${udid} to ${device.host}`);
    try {
      await InternalHttpClient.post(`${device.host}${req.originalUrl}`, req.body);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      return res.status(err.response?.status || 500).send(err.response?.data || err.message);
    }
  }

  if (manager && manager.touchAndHold) {
    await manager.touchAndHold(udid, x, y, duration);
    return res.status(200).send({ success: true });
  }
  res.status(400).send('Manager not found or touchAndHold not supported');
});

router.post('/:udid/lock', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.lock) {
    await manager.lock(udid);
    return res.status(200).send({ success: true });
  }
  res.status(400).send('Manager not found or lock not supported');
});

router.post('/:udid/unlock', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.unlock) {
    await manager.unlock(udid);
    return res.status(200).send({ success: true });
  }
  res.status(400).send('Manager not found or unlock not supported');
});

router.post('/:udid/install', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { appPath } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.installApp) {
    await manager.installApp(udid, appPath);
    return res.status(200).send({ success: true });
  }
  res.status(400).send('Manager not found or installApp not supported');
});

router.post('/:udid/install-repository-app', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { appId } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  try {
    const { APP_SERVICE } = await import('../../dashboard/services/app-service');
    const app = await APP_SERVICE.getAppById(appId);
    if (!app) return res.status(404).send('App not found in repository');

    const manager = await getDeviceManagerForPlatform(device.platform);
    if (manager && manager.installApp) {
      // If it's a local file, pass the path.
      // In a distributed setup, the node would ideally download it.
      // For now, we assume hub-node shared storage or hub-local execution.
      await manager.installApp(udid, app.filepath);
      return res.status(200).send({ success: true, message: `Installed ${app.name}` });
    }
    res.status(400).send('Manager not found or installApp not supported');
  } catch (err: any) {
    log.error(`Installation from repository failed: ${err.message}`);
    res.status(500).send({ error: err.message });
  }
});

router.post('/:udid/upload-install', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  const appFile = req.files.app as any;
  if (!appFile) return res.status(400).send('File "app" is required');

  const tmpDir = path.join(os.tmpdir(), 'xenon-uploads');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const appPath = path.join(tmpDir, `${Date.now()}-${appFile.name}`);

  try {
    await appFile.mv(appPath);
    const manager = await getDeviceManagerForPlatform(device.platform);
    if (manager && manager.installApp) {
      await manager.installApp(udid, appPath);
      // Clean up after installation
      setTimeout(() => fs.remove(appPath).catch(() => {}), 10000);
      return res
        .status(200)
        .send({ success: true, message: `App ${appFile.name} installed successfully` });
    }
    res.status(400).send('Manager not found or installApp not supported');
  } catch (err: any) {
    log.error(`Installation failed for ${udid}: ${err.message}`);
    res.status(500).send({ error: err.message });
  }
});

router.post('/:udid/uninstall', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { bundleId } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.uninstallApp) {
    await manager.uninstallApp(udid, bundleId);
    return res.status(200).send({ success: true });
  }
  res.status(400).send('Manager not found or uninstallApp not supported');
});

router.get('/:udid/apps', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.listApps) {
    try {
      const apps = await manager.listApps(udid);
      log.info(`Found ${apps.length} apps installed on device ${udid}`);
      return res.status(200).send(apps);
    } catch (err: any) {
      log.error(`Failed to list apps for ${udid}: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or listApps not supported');
});

router.get('/:udid/logs', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.getLogs) {
    try {
      const logs = await manager.getLogs(udid);
      return res.status(200).send({ logs });
    } catch (err: any) {
      log.error(`Failed to fetch logs for ${udid}: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or getLogs not supported');
});

const MJPEG_PROXY_CACHE: Map<string, any> = new Map();

/**
 * Start stream endpoint - Initiates WDA and MJPEG streaming for iOS devices
 */
router.post('/:udid/stream/start', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  // Principal Insight: Automation Protection
  // If the device is already busy (e.g., Appium session or another Control session)
  // we must block new manual control requests.
  const isCurrentlyControlledManually =
    (device.platform === 'ios' || device.platform === 'tvos'
      ? IOSStreamService.getInstance().getStreamStatus(udid)
      : AndroidStreamService.getInstance().getStreamStatus(udid)) !== undefined;

  if (device.busy && !isCurrentlyControlledManually) {
    log.warn(`Manual Control refused for ${udid}: Device is already busy.`);
    return res.status(409).send({
      success: false,
      error: 'Device is currently busy with another session.',
    });
  }

  try {
    let result;
    if (device.platform === 'ios' || device.platform === 'tvos') {
      const iosStreamService = IOSStreamService.getInstance();
      result = await iosStreamService.startStream(udid);
    } else {
      const androidStreamService = AndroidStreamService.getInstance();
      result = await androidStreamService.startStream(udid);
    }

    // Refresh device info (Lazy loading of dimensions if missing)
    try {
      const manager = await getDeviceManagerForPlatform(device.platform);
      if (
        manager &&
        manager.getAdditionalDeviceInfo &&
        (!device.screenWidth || !device.screenHeight)
      ) {
        log.info(`Fetching missing dimensions for ${udid} on stream start`);
        const additionalInfo = await manager.getAdditionalDeviceInfo(device);
        if (additionalInfo && Object.keys(additionalInfo).length > 0) {
          await DeviceStoreFactory.getStore().updateDevice(udid, device.host, additionalInfo);
        }
      }
    } catch (e) {
      log.warn(`Non-critical: Failed to fetch additional device info during stream start: ${e}`);
    }

    // Principal Insight: Concurrency Protection
    // Mark device as "Busy" so automation sessions don't pick it up
    await blockDevice(udid, device.host);
    log.info(`Manual Control: Device ${udid} locked for active UI session.`);

    log.info(`Stream started for ${udid} - Port: ${result.mjpegPort}`);

    return res.status(200).send({
      success: true,
      mjpegPort: result.mjpegPort,
      streamUrl: `/xenon/api/control/${udid}/stream`,
    });
  } catch (err: any) {
    log.error(`Failed to start stream for ${udid}: ${err.message}`);
    return res.status(500).send({
      success: false,
      error: err.message,
    });
  }
});

/**
 * Stop stream endpoint
 */
router.post('/:udid/stream/stop', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  try {
    if (device.platform === 'ios' || device.platform === 'tvos') {
      await IOSStreamService.getInstance().stopStream(udid);
    } else {
      await AndroidStreamService.getInstance().stopStream(udid);
    }

    // Clear MJPEG proxy cache
    MJPEG_PROXY_CACHE.delete(udid);

    log.info(`Stream stopped for ${udid}`);
    return res.status(200).send({ success: true });
  } catch (err: any) {
    log.error(`Failed to stop stream for ${udid}: ${err.message}`);
    return res.status(500).send({ success: false, error: err.message });
  }
});

/**
 * Stream status endpoint - Get current stream status for a device
 */
router.get('/:udid/stream/status', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  if (device.platform === 'ios' || device.platform === 'tvos') {
    const iosStreamService = IOSStreamService.getInstance();
    const session = iosStreamService.getStreamStatus(udid);

    if (session) {
      return res.status(200).send({
        udid,
        status: session.status,
        wdaPort: session.wdaPort,
        mjpegPort: session.mjpegPort,
        startedAt: session.startedAt,
        lastError: session.lastError,
      });
    }
  } else {
    const androidStreamService = AndroidStreamService.getInstance();
    const session = androidStreamService.getStreamStatus(udid);
    if (session) {
      return res.status(200).send({
        udid,
        status: session.status,
        mjpegPort: session.mjpegPort,
      });
    }
  }

  return res.status(200).send({
    udid,
    status: 'stopped',
    mjpegPort: device.mjpegServerPort,
  });
});

/**
 * MJPEG Stream endpoint - Proxies the MJPEG stream from WDA
 * Auto-starts the stream if not running (for iOS devices)
 */
router.get('/:udid/stream', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  let mjpegPort = device.mjpegServerPort;

  // For iOS devices, try to auto-start the stream if not available
  if (device.platform === 'ios' || device.platform === 'tvos') {
    const iosStreamService = IOSStreamService.getInstance();
    const session = iosStreamService.getStreamStatus(udid);

    if (session && session.status === 'running') {
      mjpegPort = session.mjpegPort;
    } else {
      try {
        log.info(
          `Stream for iOS device ${udid} requested (Status: ${session?.status || 'idle'})...`,
        );
        const result = await iosStreamService.startStream(udid);
        mjpegPort = result.mjpegPort;
      } catch (err: any) {
        log.error(`Failed to start stream for ${udid}: ${err.message}`);
        return res.status(503).send({
          error: 'Stream not available',
          message: err.message,
        });
      }
    }
  } else {
    // Android auto-start
    const androidStreamService = AndroidStreamService.getInstance();
    const session = androidStreamService.getStreamStatus(udid);
    if (session && session.status === 'running') {
      mjpegPort = session.mjpegPort;
    } else {
      try {
        const result = await androidStreamService.startStream(udid);
        mjpegPort = result.mjpegPort;
      } catch (err: any) {
        return res.status(503).send({ error: 'Android stream failed', message: err.message });
      }
    }
  }

  if (!mjpegPort) {
    return res.status(404).send({
      error: 'MJPEG port not found for device',
      hint: 'For iOS: Use POST /stream/start to begin streaming. For Android: Start an Appium session first.',
    });
  }

  const videoUrl = `http://127.0.0.1:${mjpegPort}`;

  // MjpegProxy will handle connectivity and retries internally
  if (!MJPEG_PROXY_CACHE.has(udid)) {
    MJPEG_PROXY_CACHE.set(udid, new MjpegProxy(videoUrl));
  } else {
    // Check if URL changed and update proxy
    const existingProxy = MJPEG_PROXY_CACHE.get(udid);
    if (existingProxy.mjpegUrl !== videoUrl && existingProxy._mjpegUrl !== videoUrl) {
      MJPEG_PROXY_CACHE.set(udid, new MjpegProxy(videoUrl));
    }
  }

  try {
    const proxy = MJPEG_PROXY_CACHE.get(udid);
    if (proxy) {
      const streamService =
        device.platform === 'ios' || device.platform === 'tvos'
          ? IOSStreamService.getInstance()
          : AndroidStreamService.getInstance();

      // Register this specific browser connection
      streamService.updateViewerCount(udid, 1);

      req.on('close', () => {
        // Clean up when this browser tab/connection closes
        streamService.updateViewerCount(udid, -1);
      });

      proxy.proxyRequest(req, res);
    } else {
      res.status(404).send('Proxy not created');
    }
  } catch (err: any) {
    log.error(`MJPEG proxy error for ${udid}: ${err.message}`);
    res.status(500).send({ error: 'Stream proxy error', message: err.message });
  }
});

/**
 * Interactive Shell Endpoint
 * Executes simple, safe shell commands on the device
 */
router.post('/:udid/shell', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { command } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  if (!command) return res.status(400).send('Command is required');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.executeShell) {
    try {
      const output = await manager.executeShell(udid, command);
      return res.status(200).send({ output });
    } catch (err: any) {
      log.error(`Shell execution failed for ${udid}: ${err.message}`);
      // Return 200 with error property so frontend displays it in terminal
      return res.status(200).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or executeShell not supported');
});

function register(parentRouter: Router) {
  parentRouter.use('/control', router);
}

export default {
  register,
};

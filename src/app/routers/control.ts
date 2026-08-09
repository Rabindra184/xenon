import { Request, Response, Router } from 'express';
import { DeviceStoreFactory } from '../../data-service/device-store';

import { XenonManager } from '../../device-managers';
import { Container } from 'typedi';
import log from '../../logger';
import { InternalHttpClient } from '../../InternalHttpClient';
import { blockDevice, unblockDevice } from '../../data-service/device-service';
import { UniversalMjpegProxy, shouldRecreateMjpegProxy } from '../../helpers/UniversalMjpegProxy';
import IOSStreamService from '../../device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../device-managers/android/AndroidH264StreamService';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { OmniVisionService } from '../../services/omni-vision/OmniVisionService';
import { InspectorService } from '../../services/InspectorService';
import { StreamTicketService } from '../../services/token/StreamTicketService';
import { PluginContext } from '../../PluginContext';
import { resolveStreamType } from './streamType';
import { resolveIosMjpegPort } from './iosStreamPort';
import { resolveAndroidH264 } from './androidH264Config';
import { RecordingStore } from '../../services/recording/recording-store';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';
import { deviceAccessGuard } from '../../middleware/deviceAccessGuard';
import {
  formatManualLock,
  inspectManualLock,
  isManualLock,
} from '../../services/recording/manualLock';
import { decideStreamStartConflict } from './streamStartConflict';
import { SessionOwnerResolver } from '../../services/device-access/SessionOwnerResolver';
import { resolveActor } from '../../services/device-access/actor';
import {
  denyBody,
  isSelfManualLock,
  ownershipUnavailableBody,
} from '../../services/device-access/deviceAccessPolicy';

const router = Router();

/** True when an in-memory iOS/Android (MJPEG or H.264) stream session exists. */
function hasActiveManualStream(udid: string): boolean {
  const ios = Container.get(IOSStreamService).getStreamStatus(udid);
  if (ios) return true;
  const android = Container.get(AndroidStreamService).getStreamStatus(udid);
  if (android) return true;
  return Container.get(AndroidH264StreamService).getMultiplexer(udid) !== undefined;
}

// MEMBER-tier baseline: per-device interaction (tap, swipe, install, etc.) is a Member action
router.use(roleGuard('MEMBER'));

// Every mutation under /control (tap, swipe, install, shell, lock, etc.)
// requires devices scope. Read endpoints (screenshots, page source) stay
// open to any authenticated key.
router.use(mutationScopeGuard(['devices']));

// Ownership: refuse mutations against a device held by another user or by
// another user's Appium session. Mounted here so every current and future
// mutation is covered without per-handler opt-in.
router.use(deviceAccessGuard());

// Cloud metadata endpoints — never proxy to these regardless of caller.
const FORBIDDEN_PROXY_HOSTS = new Set([
  '169.254.169.254', // AWS/Azure/GCP IMDS
  'metadata.google.internal',
  'metadata.goog',
  '100.100.100.200', // Alibaba ECS metadata
  'fd00:ec2::254', // AWS IMDSv6
]);

/**
 * Build a safe proxy URL from a device's reported host. Strips any path,
 * query, or fragment the host string carried, blocks cloud-metadata targets,
 * and refuses non-http(s) schemes. Returns null if the host is unsafe.
 */
function buildProxyUrl(deviceHost: string, req: Request): string | null {
  let parsed: URL;
  try {
    parsed = new URL(deviceHost);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (FORBIDDEN_PROXY_HOSTS.has(parsed.hostname)) return null;

  // Only keep scheme + host + port; discard any attacker-baked path/query/fragment.
  const origin = `${parsed.protocol}//${parsed.host}`;
  // Treat req.originalUrl as a path — reparse to strip any control characters.
  const forwardPath = req.originalUrl.startsWith('/') ? req.originalUrl : `/${req.originalUrl}`;
  return `${origin}${forwardPath}`;
}

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
    const target = buildProxyUrl(device.host, req);
    if (!target) return res.status(400).send({ error: 'Unsafe device host' });
    log.info(`Proxying tap for ${udid} to ${target}`);
    try {
      await InternalHttpClient.post(target, req.body);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      return res.status(err.response?.status || 500).send(err.response?.data || err.message);
    }
  }

  if (manager && manager.tap) {
    try {
      await manager.tap(udid, x, y);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`Manual control Tap failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
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
    const target = buildProxyUrl(device.host, req);
    if (!target) return res.status(400).send({ error: 'Unsafe device host' });
    log.info(`Proxying swipe for ${udid} to ${target}`);
    try {
      await InternalHttpClient.post(target, req.body);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      return res.status(err.response?.status || 500).send(err.response?.data || err.message);
    }
  }

  if (manager && manager.swipe) {
    try {
      await manager.swipe(udid, x, y, endX, endY, duration);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`Manual control Swipe failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
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
    const target = buildProxyUrl(device.host, req);
    if (!target) return res.status(400).send({ error: 'Unsafe device host' });
    log.info(`Proxying typeText for ${udid} to ${target}`);
    try {
      await InternalHttpClient.post(target, req.body);
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
    const target = buildProxyUrl(device.host, req);
    if (!target) return res.status(400).send({ error: 'Unsafe device host' });
    log.info(`Proxying keyevent for ${udid} to ${target}`);
    try {
      await InternalHttpClient.post(target, req.body);
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
    const streamSession = Container.get(AndroidStreamService).getStreamStatus(udid);
    if (streamSession?.status === 'running' && streamSession.latestFrame) {
      log.info(`Manual Control: Using cached stream frame for ${udid} screenshot.`);
      return res.status(200).send({ screenshot: streamSession.latestFrame.toString('base64') });
    }
  }

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.getScreenshot) {
    const base64 = await manager.getScreenshot(udid);

    // CRITICAL: Validate screenshot is not empty before returning success
    if (base64 && base64.length > 100) {
      return res.status(200).send({ screenshot: base64 });
    }

    log.error(
      `Screenshot capture failed for ${udid}: returned empty or invalid data (${base64?.length || 0} bytes)`,
    );
    return res.status(502).send({
      error: 'Screenshot capture failed. Device may be busy or WDA is unresponsive. Try again.',
    });
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
    try {
      await manager.setClipboard(udid, content);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`Manual control setClipboard failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
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
    const target = buildProxyUrl(device.host, req);
    if (!target) return res.status(400).send({ error: 'Unsafe device host' });
    log.info(`Proxying touchAndHold for ${udid} to ${target}`);
    try {
      await InternalHttpClient.post(target, req.body);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      return res.status(err.response?.status || 500).send(err.response?.data || err.message);
    }
  }

  if (manager && manager.touchAndHold) {
    try {
      await manager.touchAndHold(udid, x, y, duration);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`Manual control touchAndHold failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or touchAndHold not supported');
});

router.post('/:udid/lock', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.lock) {
    try {
      await manager.lock(udid);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`Manual control lock failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
  }
  res.status(400).send('Manager not found or lock not supported');
});

router.post('/:udid/unlock', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (manager && manager.unlock) {
    try {
      await manager.unlock(udid);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`Manual control unlock failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
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
    try {
      await manager.installApp(udid, appPath);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`Manual control installApp failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
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
    try {
      await manager.uninstallApp(udid, bundleId);
      return res.status(200).send({ success: true });
    } catch (err: any) {
      log.error(`Manual control uninstallApp failed: ${err.message}`);
      return res.status(500).send({ error: err.message });
    }
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

  // Ownership at stream-start time. A manual lock with no live stream is an
  // orphan to reclaim; a live foreign stream is a conflict we must refuse.
  // Refusing is what stops one user's start from silently rewriting another
  // user's lock (which then locked the original holder out of their own stop).
  const actor = resolveActor(req);
  if (!actor.userId) {
    return res.status(401).json({ success: false, error: 'unauthenticated' });
  }
  // Bind to a local so the non-undefined narrowing survives the awaits below.
  const actorUserId: string = actor.userId;

  const ownerResolver = Container.get(SessionOwnerResolver);
  let sessionOwnerUserId: string | null = null;
  if (device.busy && device.session_id && !isManualLock(device.session_id)) {
    try {
      sessionOwnerUserId = await ownerResolver.ownerOf(device.session_id);
    } catch (e: any) {
      // Same reasoning as deviceAccessGuard: not knowing who owns a live
      // session is exactly the case where we must not guess allow.
      log.error(
        `stream/start: session owner lookup failed for ${device.session_id}: ${e?.message ?? e}`,
      );
      return res.status(503).json(ownershipUnavailableBody());
    }
  }

  const conflict = decideStreamStartConflict({
    udid,
    busy: !!device.busy,
    sessionId: device.session_id,
    hasLiveManualStream: hasActiveManualStream(udid),
    sessionOwnerUserId,
    actorUserId,
    actorApiKeyId: actor.apiKeyId,
    isAdmin: actor.isAdmin,
  });

  if (conflict.action === 'deny') {
    // holderName lookup is cosmetic — a failure here must still deny (never
    // flip to allow) but must not hang the request; fall back to no name.
    let holderName: string | null = null;
    if (conflict.holderId) {
      try {
        holderName = await ownerResolver.displayName(conflict.holderId);
      } catch (e: any) {
        log.warn(
          `stream/start: holder name lookup failed for ${conflict.holderId}: ${e?.message ?? e}`,
        );
      }
    }
    log.warn(
      `Manual Control refused for ${udid}: ${conflict.code} (holder=${conflict.holderId || 'unknown'})`,
    );
    return res.status(409).send(denyBody(conflict.code, conflict.holderId, holderName));
  }

  if (conflict.action === 'reclaim') {
    log.warn(`Reclaiming orphaned manual lock on ${udid} (${device.session_id}) — no live stream.`);
    try {
      await unblockDevice(udid, device.host);
    } catch (e: any) {
      log.warn(`Failed to clear orphaned lock on ${udid}: ${e?.message ?? e}`);
    }
  }

  try {
    const h264Cfg = resolveAndroidH264(
      Container.get(PluginContext).pluginArgs.streaming?.androidH264,
    );
    const flagOn = h264Cfg.enabled;
    // A recording device keeps MJPEG preview so we never run screenrecord and
    // the recording's screencap pipeline against the same device at once.
    const recording = await Container.get(RecordingStore).isRecording(udid);
    const streamType = resolveStreamType(device.platform, flagOn, recording);
    let mjpegPort: number | undefined;

    if (device.platform === 'ios' || device.platform === 'tvos') {
      mjpegPort = (await Container.get(IOSStreamService).startStream(udid)).mjpegPort;
    } else if (streamType === 'h264') {
      // H.264 preview: start the scrcpy/screenrecord service. Do NOT also start
      // the MJPEG screencap loop — one capture pipeline per device.
      await Container.get(AndroidH264StreamService).start(udid, { source: h264Cfg.source });
    } else {
      mjpegPort = (await Container.get(AndroidStreamService).startStream(udid)).mjpegPort;
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
    // Mark device as "Busy" so automation sessions don't pick it up.
    // Lock is keyed on the user, not the credential — see
    // src/services/device-access/deviceAccessPolicy.ts.
    const manualSid = formatManualLock(actorUserId, udid);
    await blockDevice(udid, device.host, manualSid);
    log.info(`Manual Control: Device ${udid} locked for active UI session (${manualSid}).`);

    if (streamType === 'h264') {
      log.info(`H.264 stream started for ${udid}`);
      return res.status(200).send({
        success: true,
        type: 'h264',
        h264Path: `/xenon/api/control/${encodeURIComponent(udid)}/stream/h264`,
      });
    }

    log.info(`Stream started for ${udid} - Port: ${mjpegPort}`);
    // NOTE: do NOT stop/replace the cached MJPEG proxy here. The GET /stream
    // handler already rebinds it only when the upstream port actually changed
    // (`existingProxy.url !== videoUrl`) — the "Android briefly aliased to iOS's
    // 9100" case. Stopping it on every start tore down the live preview mid-
    // recording (the warm-fetch stream/start ran right after the browser
    // connected), flapping the tile back to "Starting Stream…".
    return res.status(200).send({
      success: true,
      type: 'mjpeg',
      mjpegPort,
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
 * Mint a single-use, udid-bound stream ticket for the webview <img> MJPEG
 * path (spec §2.3/§7.1) — a raw <img src> can carry neither auth headers nor
 * the SameSite=strict dashboard cookie, so it authenticates via ?ticket=.
 */
router.post('/:udid/stream/ticket', async (req: Request, res: Response) => {
  // Mint on the USER identity. req.apiKey.id is an ApiKey row id — a different
  // id space — and authMiddleware's redeem branch assigns the ticket's actor
  // straight into req.auth.userId. Minting a key id therefore made that field
  // hold something that is not a user, while every ownership reader added in
  // #216/#217 trusts that it is.
  const actor = resolveActor(req);
  if (!actor.userId) return res.status(401).json({ error: 'unauthenticated' });
  // Carry the two other things `evaluateDeviceAccess` needs alongside the user
  // id. A ticket consumer (the logcat WS) has no Express request to run
  // resolveActor against, and re-deriving them from a User row at redeem time
  // would miss an admin-scoped API key entirely. Signed claims, so the client
  // cannot forge them — see StreamTicketService.
  const ticket = await Container.get(StreamTicketService).mint(req.params.udid, actor.userId, {
    isAdmin: actor.isAdmin,
    apiKeyId: actor.apiKeyId,
  });
  res.json({ ticket, expiresIn: 60 });
});

/**
 * Stop stream endpoint
 */
router.post('/:udid/stream/stop', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  // Multi-user safety: refuse to release a manual lock owned by another user.
  // Admin scope bypasses this so support can clear stuck sessions.
  //
  // Ownership is judged with the SAME primitives as stream/start and the
  // /control mutation guard (resolveActor + isSelfManualLock). Hand-rolling it
  // here is what broke stop: start writes manual_<userId>_<udid>, while this
  // handler used to read `req.apiKey?.id ?? auth.userId` — on the header-pair
  // credential path BOTH are set and they are different id spaces, so the
  // caller who had just started the stream 403'd on their own lock and the
  // capture pipeline was left running (permanently, on iOS).
  const actor = resolveActor(req);
  const lockInfo = inspectManualLock(device.session_id, actor.userId, udid);
  // Admin comes from resolveActor too: it splits scopes on ',' (so a scope
  // literally named `nonadmin` can't grant a bypass) and honours the `admin`
  // scope that scopesForRole() grants a cookie ADMIN — the previous check read
  // req.apiKey.scopes, which is never populated for a cookie session, so a
  // dashboard ADMIN could not use the documented force-release path.
  const isAdmin = actor.isAdmin;
  // One decision, used for both the 403 below and the unblock further down, so
  // the two can never disagree about who is allowed to release the lock.
  const mayRelease =
    isSelfManualLock(device.session_id, udid, actor.userId, actor.apiKeyId) ||
    !!lockInfo?.legacy ||
    isAdmin;
  if (lockInfo && !mayRelease) {
    return res.status(403).json({
      success: false,
      error: 'lock_owned_by_another_user',
      message:
        'This device is being controlled by another user. Ask them to stop, or use an admin key to force-release.',
    });
  }

  try {
    if (device.platform === 'ios' || device.platform === 'tvos') {
      await Container.get(IOSStreamService).stopStream(udid);
    } else {
      await Container.get(AndroidStreamService).stopStream(udid);
      await Container.get(AndroidH264StreamService).stop(udid);
    }

    // Clear and stop MJPEG proxy
    const existingProxy = MJPEG_PROXY_CACHE.get(udid);
    if (existingProxy) {
      existingProxy.stop();
      MJPEG_PROXY_CACHE.delete(udid);
    }

    // Always release an owned/legacy/admin manual lock after stop — even when
    // no in-memory session survived a process restart (orphaned busy flag).
    if (isManualLock(device.session_id) && mayRelease) {
      try {
        await unblockDevice(udid, device.host);
      } catch {
        /* best-effort lock release */
      }
    }

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

  // Advertise which transport the frontend player should use. A recording
  // device keeps MJPEG (one capture pipeline per device).
  const flagOn = resolveAndroidH264(
    Container.get(PluginContext).pluginArgs.streaming?.androidH264,
  ).enabled;
  const recording = await Container.get(RecordingStore).isRecording(udid);
  const type = resolveStreamType(device.platform, flagOn, recording);
  const h264Path =
    type === 'h264' ? `/xenon/api/control/${encodeURIComponent(udid)}/stream/h264` : undefined;

  if (device.platform === 'ios' || device.platform === 'tvos') {
    const iosStreamService = Container.get(IOSStreamService);
    const session = iosStreamService.getStreamStatus(udid);

    if (session) {
      return res.status(200).send({
        udid,
        status: session.status,
        type,
        wdaPort: session.wdaPort,
        mjpegPort: session.mjpegPort,
        startedAt: session.startedAt,
        lastError: session.lastError,
      });
    }
  } else {
    const androidStreamService = Container.get(AndroidStreamService);
    const session = androidStreamService.getStreamStatus(udid);
    if (session) {
      return res.status(200).send({
        udid,
        status: session.status,
        type,
        h264Path,
        mjpegPort: session.mjpegPort,
      });
    }
    // H.264 preview has no MJPEG session — still advertise running so the
    // dashboard doesn't treat a live WebCodecs stream as stopped.
    if (Container.get(AndroidH264StreamService).getMultiplexer(udid)) {
      return res.status(200).send({
        udid,
        status: 'running',
        type,
        h264Path,
        mjpegPort: device.mjpegServerPort,
      });
    }
  }

  return res.status(200).send({
    udid,
    status: 'stopped',
    type,
    h264Path,
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
    const iosStreamService = Container.get(IOSStreamService);

    try {
      // A session marked `running` is only reused when WDA actually answers.
      // WDA dies on-device while the host `runwda` process stays alive
      // (exitCode null), leaving the session 'running' over a dead upstream —
      // previously unrecoverable until the watchdog's hourly tick. See
      // resolveIosMjpegPort.
      mjpegPort = await resolveIosMjpegPort(udid, {
        getSession: (id) => iosStreamService.getStreamStatus(id),
        // Single attempt (retries = 0): a healthy WDA answers in milliseconds,
        // so this costs nothing on the happy path and stays bounded by the
        // 2.5s /status timeout when WDA is dead.
        isWdaHealthy: (wdaPort, id) => iosStreamService.isWDARunning(wdaPort, id, 0),
        startStream: async (id) => {
          log.info(
            `Stream for iOS device ${id} requested (Status: ${
              iosStreamService.getStreamStatus(id)?.status || 'idle'
            })...`,
          );
          return iosStreamService.startStream(id);
        },
      });
    } catch (err: any) {
      log.error(`Failed to start stream for ${udid}: ${err.message}`);
      return res.status(503).send({
        error: 'Stream not available',
        message: err.message,
      });
    }
  } else {
    // Android auto-start. Always go through startStream: it health-checks an
    // existing session before reusing it (decideAndroidStreamReuse) and dedupes
    // concurrent starts. The short-circuit that used to live here — hand back
    // any session marked 'running' — bypassed both, re-introducing the very
    // stale-port bug the service now guards against. Reuse stays just as cheap;
    // the health check is an in-process property read, not a request.
    try {
      const result = await Container.get(AndroidStreamService).startStream(udid);
      mjpegPort = result.mjpegPort;
    } catch (err: any) {
      return res.status(503).send({ error: 'Android stream failed', message: err.message });
    }
  }

  if (!mjpegPort) {
    return res.status(404).send({
      error: 'MJPEG port not found for device',
      hint: 'For iOS: Use POST /stream/start to begin streaming. For Android: Start an Appium session first.',
    });
  }

  const videoUrl = `http://127.0.0.1:${mjpegPort}`;

  // UniversalMjpegProxy will handle connectivity and retries internally.
  // Recreate when there's no cached proxy, the upstream url changed, OR the
  // cached proxy has permanently stopped. That last case is the fix for the iOS
  // preview "503 forever" bug: a proxy that exhausted its retries and called
  // stop() otherwise lingered in the cache and 503'd every request even after
  // WDA recovered on the same port. See shouldRecreateMjpegProxy.
  const existingProxy = MJPEG_PROXY_CACHE.get(udid);
  if (shouldRecreateMjpegProxy(existingProxy, videoUrl)) {
    existingProxy?.stop();
    MJPEG_PROXY_CACHE.set(udid, new UniversalMjpegProxy(videoUrl));
  }

  try {
    const proxy = MJPEG_PROXY_CACHE.get(udid);
    if (proxy) {
      const streamService =
        device.platform === 'ios' || device.platform === 'tvos'
          ? Container.get(IOSStreamService)
          : Container.get(AndroidStreamService);

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

/**
 * Omni-Scan for manual control (No Appium Session)
 */
router.get('/:udid/omni-scan', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (!manager) return res.status(400).send('Manager not found');

  try {
    const omniService = Container.get(OmniVisionService);

    // Create a Mock Driver that OmniVisionService can use
    const mockDriver = {
      sessionId: `manual_${udid}`,
      getScreenshot: async () => {
        if (manager.getScreenshot) {
          return await manager.getScreenshot(udid);
        }
        throw new Error('Screenshot not supported for this device');
      },
      // OmniVision might need page source for some analysis later
      getPageSource: async () => {
        if (manager.getPageSource) {
          return await manager.getPageSource(udid);
        }
        return '';
      },
    };

    const result = await omniService.analyzeScreen(mockDriver);
    return res.status(200).send({ status: 'success', value: result });
  } catch (err: any) {
    log.error(`Manual Omni-Scan failed for ${udid}: ${err.message}`);
    return res.status(500).send({ status: 'error', message: err.message });
  }
});

/**
 * Native-First Inspector Snapshot
 */
router.get('/:udid/inspector/snapshot', async (req: Request, res: Response) => {
  const { udid } = req.params;
  try {
    const inspectorService = Container.get(InspectorService);
    const snapshot = await inspectorService.getSnapshot(udid);
    return res.status(200).send(snapshot);
  } catch (err: any) {
    log.error(`Inspector snapshot failed for ${udid}: ${err.message}`);
    return res.status(500).send({ error: err.message });
  }
});

/**
 * AI Locator test for manual control
 */
router.post('/:udid/test-locator', async (req: Request, res: Response) => {
  const { udid } = req.params;
  const { strategy, selector } = req.body;
  const device = await getDeviceInfo(udid);
  if (!device) return res.status(404).send('Device not found');

  const manager = await getDeviceManagerForPlatform(device.platform);
  if (!manager) return res.status(400).send('Manager not found');

  try {
    const omniService = Container.get(OmniVisionService);

    const mockDriver = {
      sessionId: `manual_${udid}`,
      getScreenshot: async () => {
        if (manager.getScreenshot) {
          return await manager.getScreenshot(udid);
        }
        throw new Error('Screenshot not supported for this device');
      },
    };

    let value: any[] = [];
    if (strategy === '-custom:ai-text') {
      value = await omniService.findByText(mockDriver, selector);
    } else if (strategy === '-custom:ai-icon') {
      const match = await omniService.findByIcon(mockDriver, selector);
      if (match) value = [match];
    } else {
      return res
        .status(400)
        .send({ status: 'error', message: `Unsupported strategy: ${strategy}` });
    }

    return res.status(200).send({ status: 'success', value });
  } catch (err: any) {
    log.error(`Manual test-locator failed for ${udid}: ${err.message}`);
    return res.status(500).send({ status: 'error', message: err.message });
  }
});

function register(parentRouter: Router) {
  parentRouter.use('/control', router);
}

export default {
  register,
};

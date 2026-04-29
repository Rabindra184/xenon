import express from 'express';
import {
  reserveDevice,
  releaseReservation,
  getReservedDevices,
  getDevice,
  isDeviceReserved,
} from '../../data-service/device-service';
import log from '../../logger';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = express.Router();

// MEMBER-tier baseline: reserving devices for yourself is a Member-tier operation
router.use(roleGuard('MEMBER'));

// Reserving / releasing / extending a device hold requires devices scope.
// GET listings remain open to any authenticated key.
router.use(mutationScopeGuard(['devices']));

// Duration options in milliseconds
const DURATION_OPTIONS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
};

/**
 * GET /api/reservation
 * List all currently reserved devices
 */
router.get('/', async (_req, res) => {
  try {
    const reservedDevices = await getReservedDevices();
    res.json({
      success: true,
      reservations: reservedDevices.map((device) => ({
        udid: device.udid,
        host: device.host,
        name: device.name,
        platform: device.platform,
        reservedBy: device.reservedBy,
        reservedUntil: device.reservedUntil,
        reservationReason: device.reservationReason,
        remainingMs: device.reservedUntil ? device.reservedUntil - Date.now() : 0,
      })),
    });
  } catch (error) {
    log.error(`Failed to get reservations: ${error}`);
    res.status(500).json({ success: false, error: 'Failed to get reservations' });
  }
});

/**
 * POST /api/reservation
 * Reserve a device for exclusive use
 * Body: { udid, host, reservedBy, duration, reason? }
 */
router.post('/', async (req, res) => {
  try {
    const { udid, host, reservedBy, duration, reason } = req.body;

    if (!udid || !host || !reservedBy || !duration) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: udid, host, reservedBy, duration',
      });
    }

    // Parse duration
    let durationMs: number;
    if (typeof duration === 'string' && DURATION_OPTIONS[duration]) {
      durationMs = DURATION_OPTIONS[duration];
    } else if (typeof duration === 'number') {
      durationMs = duration;
    } else {
      return res.status(400).json({
        success: false,
        error: `Invalid duration. Use: ${Object.keys(DURATION_OPTIONS).join(
          ', ',
        )} or a number in milliseconds`,
      });
    }

    // Bounds check: refuse negative, zero, NaN, Infinity, and anything over 24h.
    const MIN_DURATION_MS = 60 * 1000; // 1 minute
    const MAX_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
    if (
      !Number.isFinite(durationMs) ||
      durationMs < MIN_DURATION_MS ||
      durationMs > MAX_DURATION_MS
    ) {
      return res.status(400).json({
        success: false,
        error: `duration must be between ${MIN_DURATION_MS}ms (1 minute) and ${MAX_DURATION_MS}ms (24 hours)`,
      });
    }

    // Check if device exists
    const device = await getDevice({ udid: [udid] });
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    // Check if device is already reserved by someone else
    if (isDeviceReserved(device) && device.reservedBy !== reservedBy) {
      return res.status(409).json({
        success: false,
        error: `Device is already reserved by ${device.reservedBy} until ${new Date(
          device.reservedUntil!,
        ).toISOString()}`,
      });
    }

    // Check if device is busy with an Appium session
    if (device.busy && device.session_id) {
      return res.status(409).json({
        success: false,
        error: 'Device is currently busy with an Appium session. Cannot reserve.',
      });
    }

    await reserveDevice(udid, host, reservedBy, durationMs, reason);

    const reservedUntil = Date.now() + durationMs;
    res.json({
      success: true,
      message: `Device ${udid} reserved for ${reservedBy}`,
      reservation: {
        udid,
        host,
        reservedBy,
        reservedUntil,
        reservationReason: reason,
        expiresAt: new Date(reservedUntil).toISOString(),
      },
    });
  } catch (error) {
    log.error(`Failed to reserve device: ${error}`);
    res.status(500).json({ success: false, error: 'Failed to reserve device' });
  }
});

/**
 * DELETE /api/reservation/:udid/:host
 * Release a device reservation
 */
router.delete('/:udid/:host', async (req, res) => {
  try {
    const { udid } = req.params;
    const host = decodeURIComponent(req.params.host);

    const device = await getDevice({ udid: [udid] });
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    if (!isDeviceReserved(device)) {
      return res.status(400).json({ success: false, error: 'Device is not reserved' });
    }

    await releaseReservation(udid, host);

    res.json({
      success: true,
      message: `Reservation released for device ${udid}`,
    });
  } catch (error) {
    log.error(`Failed to release reservation: ${error}`);
    res.status(500).json({ success: false, error: 'Failed to release reservation' });
  }
});

/**
 * POST /api/reservation/:udid/:host/extend
 * Extend an existing reservation
 * Body: { duration }
 */
router.post('/:udid/:host/extend', async (req, res) => {
  try {
    const { udid } = req.params;
    const host = decodeURIComponent(req.params.host);
    const { duration } = req.body;

    const device = await getDevice({ udid: [udid] });
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    if (!isDeviceReserved(device)) {
      return res.status(400).json({ success: false, error: 'Device is not reserved' });
    }

    // Parse duration
    let extensionMs: number;
    if (typeof duration === 'string' && DURATION_OPTIONS[duration]) {
      extensionMs = DURATION_OPTIONS[duration];
    } else if (typeof duration === 'number') {
      extensionMs = duration;
    } else {
      return res.status(400).json({
        success: false,
        error: `Invalid duration. Use: ${Object.keys(DURATION_OPTIONS).join(
          ', ',
        )} or a number in milliseconds`,
      });
    }

    // Extend from current expiry time
    const newExpiry = (device.reservedUntil || Date.now()) + extensionMs;
    await reserveDevice(
      udid,
      host,
      device.reservedBy!,
      newExpiry - Date.now(),
      device.reservationReason,
    );

    res.json({
      success: true,
      message: `Reservation extended for device ${udid}`,
      newExpiresAt: new Date(newExpiry).toISOString(),
    });
  } catch (error) {
    log.error(`Failed to extend reservation: ${error}`);
    res.status(500).json({ success: false, error: 'Failed to extend reservation' });
  }
});

export default router;

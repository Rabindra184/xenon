/**
 * A phone's `healthStatus`, as every reader judges it: allocation
 * (device-service getDevices), a lease's candidates (leaseFilters
 * `leasable`) and the lease sweeper (`memberLossReason`). The health
 * monitor judges a fresh check's result, not a stored row, and keeps its own
 * test (anything but `Healthy` starts a recovery).
 *
 * Xenon writes two values (the device managers' checkHealth). The rule:
 * unset (null, undefined, empty) or `Healthy` is healthy; `Unhealthy` is not,
 * and neither is any other value. A value Xenon doesn't write (a newer
 * node's report, a hand edit) is read as "can't say it's healthy", so the
 * phone is not handed out: fail closed. Through 2.36 allocation refused
 * anything but `Healthy`, while leases took anything but `Unhealthy`, and
 * the sweeper ended a group only on `Unhealthy`.
 */
export type HealthStatus = 'Healthy' | 'Unhealthy';

export const HEALTHY: HealthStatus = 'Healthy';
export const UNHEALTHY: HealthStatus = 'Unhealthy';

/** Whether a phone with this `healthStatus` may be used. */
export function isHealthy(device: { healthStatus?: string | null }): boolean {
  const status = device.healthStatus;
  return status == null || status === '' || status === HEALTHY;
}

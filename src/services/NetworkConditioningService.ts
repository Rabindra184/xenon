import { Service } from 'typedi';
import log from '../logger';
import { IDevice } from '../interfaces/IDevice';

export type NetworkProfile = '4G' | '3G' | 'Edge' | 'Offline' | 'Normal';

export interface NetworkCondition {
    latencyMs: number;
    downloadKbps: number;
    uploadKbps: number;
}

const NETWORK_PROFILES: Record<NetworkProfile, NetworkCondition | null> = {
    'Normal': null,
    '4G': { latencyMs: 20, downloadKbps: 15000, uploadKbps: 7500 },
    '3G': { latencyMs: 100, downloadKbps: 2000, uploadKbps: 1000 },
    'Edge': { latencyMs: 400, downloadKbps: 250, uploadKbps: 150 },
    'Offline': { latencyMs: 0, downloadKbps: 0, uploadKbps: 0 },
};

/**
 * Service to manage network conditioning (Throttling/Latency)
 */
@Service()
export class NetworkConditioningService {
    private log = log.scope('NetworkConditioning');
    private activeConditions: Map<string, NetworkProfile> = new Map();

    /**
     * Applies a network profile to a session/device
     */
    public async applyProfile(sessionId: string, device: IDevice, profile: NetworkProfile) {
        this.log.info(`Applying network profile '${profile}' to session ${sessionId} on device ${device.udid}`);
        this.activeConditions.set(sessionId, profile);

        // Platform specific optimizations
        if (device.platform === 'android') {
            await this.applyAndroidConditioning(device.udid, profile);
        } else if (device.deviceType === 'simulator') {
            await this.applyIOSSimulatorConditioning(device.udid, profile);
        }
    }

    /**
     * Gets the active profile for a session
     */
    public getProfile(sessionId: string): NetworkProfile | undefined {
        return this.activeConditions.get(sessionId);
    }

    /**
     * Resets network conditions for a session
     */
    public async reset(sessionId: string, device: IDevice) {
        if (this.activeConditions.has(sessionId)) {
            this.log.info(`Resetting network conditions for session ${sessionId}`);
            this.activeConditions.delete(sessionId);

            if (device.platform === 'android') {
                await this.applyAndroidConditioning(device.udid, 'Normal');
            } else if (device.deviceType === 'simulator') {
                await this.applyIOSSimulatorConditioning(device.udid, 'Normal');
            }
        }
    }

    private async applyAndroidConditioning(udid: string, profile: NetworkProfile) {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            if (profile === 'Offline') {
                this.log.info(`📱 Android: Disabling data for ${udid}`);
                await execAsync(`adb -s ${udid} shell svc data disable`);
                await execAsync(`adb -s ${udid} shell svc wifi disable`);
            } else if (profile === 'Normal') {
                this.log.info(`📱 Android: Enabling data for ${udid}`);
                await execAsync(`adb -s ${udid} shell svc data enable`);
                await execAsync(`adb -s ${udid} shell svc wifi enable`);
            }
            // Latency is handled by the proxy
        } catch (e: any) {
            this.log.warn(`⚠️ Failed to apply Android conditioning for ${udid}: ${e.message}`);
        }
    }

    private async applyIOSSimulatorConditioning(udid: string, profile: NetworkProfile) {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            // simctl network <device> <status>
            // Profiles: wifi, 3g, edge, etc. (depends on OS version)
            let status = 'none';
            if (profile === '3G') status = '3g';
            if (profile === 'Edge') status = 'edge';
            if (profile === 'Offline') status = 'off';
            if (profile === 'Normal') status = 'none';

            this.log.info(`🍎 iOS Sim: Setting network to ${status} for ${udid}`);
            await execAsync(`xcrun simctl network ${udid} status ${status}`);
        } catch (e: any) {
            this.log.warn(`⚠️ Failed to apply iOS Simulator conditioning for ${udid}: ${e.message}`);
        }
    }

    /**
     * Returns the latency to inject into a command proxy for the given profile
     */
    public getLatency(sessionId: string): number {
        const profile = this.activeConditions.get(sessionId);
        if (!profile) return 0;
        return NETWORK_PROFILES[profile]?.latencyMs || 0;
    }
}

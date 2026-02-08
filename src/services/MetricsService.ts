import { Service } from 'typedi';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { DeviceStoreFactory } from '../data-service/device-store';
import { prisma } from '../prisma';

@Service()
export class MetricsService {
    private readonly CONFIG_ID = 'metrics';

    private async incrementMetric(name: string) {
        try {
            const config = await prisma.webConfig.findUnique({
                where: { name }
            });
            const currentValue = config ? parseInt(config.value) : 0;
            await prisma.webConfig.upsert({
                where: { name },
                update: { value: (currentValue + 1).toString() },
                create: { id: this.CONFIG_ID, name, value: '1' }
            });
        } catch (error) {
            console.error(`[MetricsService] Failed to increment ${name}`, error);
        }
    }

    private async getMetric(name: string): Promise<number> {
        try {
            const config = await prisma.webConfig.findUnique({
                where: { name }
            });
            return config ? parseInt(config.value) : 0;
        } catch (error) {
            return 0;
        }
    }

    public async incrementSessionStart() {
        await this.incrementMetric('metric_session_starts');
    }

    public async incrementSessionSuccess() {
        await this.incrementMetric('metric_session_successes');
    }

    public async incrementSessionFailure() {
        await this.incrementMetric('metric_session_failures');
    }

    public async incrementHealingAttempt() {
        await this.incrementMetric('metric_healing_attempts');
    }

    public async incrementHealingSuccess() {
        await this.incrementMetric('metric_healing_successes');
    }

    public async getMetrics(): Promise<string> {
        const sessions = SESSION_MANAGER.getStats();
        const devices = await DeviceStoreFactory.getStore().getAllDevices();
        const totalDevices = devices.length;
        const busyDevices = devices.filter((d) => d.busy).length;
        const offlineDevices = devices.filter((d) => d.offline).length;

        // Fetch persisted counters
        const [sessionStarts, sessionSuccesses, sessionFailures, healingAttempts, healingSuccesses] = await Promise.all([
            this.getMetric('metric_session_starts'),
            this.getMetric('metric_session_successes'),
            this.getMetric('metric_session_failures'),
            this.getMetric('metric_healing_attempts'),
            this.getMetric('metric_healing_successes'),
        ]);

        const lines = [
            '# HELP xenon_sessions_total Total number of sessions across all time',
            '# TYPE xenon_sessions_total counter',
            `xenon_sessions_total{status="started"} ${sessionStarts}`,
            `xenon_sessions_total{status="success"} ${sessionSuccesses}`,
            `xenon_sessions_total{status="failure"} ${sessionFailures}`,

            '# HELP xenon_sessions_active Current active sessions in the hub',
            '# TYPE xenon_sessions_active gauge',
            `xenon_sessions_active ${sessions.total}`,

            '# HELP xenon_devices_total Total managed devices in the fleet',
            '# TYPE xenon_devices_total gauge',
            `xenon_devices_total ${totalDevices}`,

            '# HELP xenon_devices_busy Current devices in active use',
            '# TYPE xenon_devices_busy gauge',
            `xenon_devices_busy ${busyDevices}`,

            '# HELP xenon_devices_offline Devices currently not reachable',
            '# TYPE xenon_devices_offline gauge',
            `xenon_devices_offline ${offlineDevices}`,

            '# HELP xenon_healing_total AI self-healing operations',
            '# TYPE xenon_healing_total counter',
            `xenon_healing_total{status="attempt"} ${healingAttempts}`,
            `xenon_healing_total{status="success"} ${healingSuccesses}`,
        ];

        return lines.join('\n') + '\n';
    }
}

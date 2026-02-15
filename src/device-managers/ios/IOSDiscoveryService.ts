import Simctl from 'node-simctl';
import { flatten, isEmpty } from 'lodash';
import { utilities as IOSUtils } from 'appium-ios-device';
import { IDevice } from '../../interfaces/IDevice';
import { getFreePort, stripAppiumPrefixes } from '../../helpers';
import log from '../../logger';
import { getUtilizationTime } from '../../device-utils';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { IPluginArgs, DeviceTypeToInclude } from '../../interfaces/IPluginArgs';
import { PluginContext } from '../../PluginContext';
import { Service, Container } from 'typedi';
import Devices from '../cloud/Devices';
import NodeDevices from '../NodeDevices';
import { addNewDevice, removeDevice } from '../../data-service/device-service';
import { IosTracker } from '../iOSTracker';

@Service()
export class IOSDiscoveryService {
    private log = log.scope('IOSDiscovery');

    constructor(private context: PluginContext) { }

    private get pluginArgs() { return this.context.pluginArgs; }
    private get hostPort() { return this.context.port; }
    private get nodeId() { return this.context.nodeId; }

    async getDevices(
        deviceTypes: { iosDeviceType: DeviceTypeToInclude },
        existingDeviceDetails: Array<IDevice>,
    ): Promise<IDevice[]> {
        if (deviceTypes.iosDeviceType === 'real') {
            return flatten(
                await Promise.all([
                    this.getRealDevices(existingDeviceDetails),
                ]),
            );
        } else if (deviceTypes.iosDeviceType === 'simulated') {
            return await this.getSimulators();
        } else {
            return flatten(
                await Promise.all([
                    this.getRealDevices(existingDeviceDetails),
                    this.getSimulators(),
                ]),
            );
        }
    }

    async getConnectedDevices(): Promise<Array<string>> {
        try {
            return await IOSUtils.getConnectedDevices();
        } catch (error) {
            this.log.error(error);
            return [];
        }
    }

    async getRealDevices(existingDeviceDetails: Array<IDevice>): Promise<Array<IDevice>> {
        let deviceState: Array<IDevice> = [];
        if (this.pluginArgs.cloud !== undefined) {
            const cloud = new Devices(this.pluginArgs.cloud, deviceState, 'ios');
            return await cloud.getDevices();
        } else {
            deviceState = await this.fetchLocalIOSDevices(existingDeviceDetails);
        }
        return deviceState.filter((device) => device.realDevice === true);
    }

    async fetchLocalIOSDevices(existingDeviceDetails: IDevice[]): Promise<IDevice[]> {
        const devices = await this.getConnectedDevices();
        const deviceProcessingPromises = devices.map(async (udid: string) => {
            try {
                const existingDevice = existingDeviceDetails.find((device) => device.udid === udid);
                if (existingDevice) {
                    return { ...existingDevice, busy: false, userBlocked: false };
                } else {
                    return await this.getDeviceInfo(udid);
                }
            } catch (e: any) {
                this.log.error(`Failed to initialize iOS device ${udid}: ${e.message}`);
                return null;
            }
        });

        const deviceState = (await Promise.all(deviceProcessingPromises)).filter(
            (d): d is IDevice => d !== null,
        );
        this.trackIOSDevices();
        return deviceState;
    }

    async getDeviceInfo(udid: string): Promise<IDevice> {
        const store = DeviceStoreFactory.getStore();
        const storeDevice = await store.findDevice({ udid });

        let host = this.pluginArgs.remoteMachineProxyIP
            ? String(this.pluginArgs.remoteMachineProxyIP)
            : `http://${this.pluginArgs.bindHostOrIp}:${this.hostPort}`;

        let wdaLocalPort = storeDevice?.wdaLocalPort || await getFreePort();
        let mjpegServerPort = storeDevice?.mjpegServerPort || await getFreePort();
        const totalUtilizationTimeMilliSec = await getUtilizationTime(udid);

        let sdk = 'Unknown';
        let name = 'iPhone';

        try {
            [sdk, name] = await Promise.all([
                IOSUtils.getOSVersion(udid),
                IOSUtils.getDeviceName(udid)
            ]);
        } catch (e: any) {
            this.log.error(`Metadata discovery failed for ${udid}: ${e.message}`);
        }

        return {
            wdaLocalPort,
            mjpegServerPort,
            udid,
            sdk,
            name,
            busy: false,
            realDevice: true,
            deviceType: 'real',
            platform: (name.toLowerCase().includes('tv') ? 'tvos' : 'ios') as 'ios' | 'android' | 'tvos',
            host: host as string,
            totalUtilizationTimeMilliSec,
            sessionStartTime: 0,
            state: storeDevice?.state || 'Unknown',
            userBlocked: storeDevice?.userBlocked || false,
            ...(storeDevice || {}),
        } as IDevice;
    }

    async getSimulators(): Promise<Array<IDevice>> {
        const simulators = await this.fetchLocalSimulators();
        simulators.sort((a, b) => (a.state > b.state ? 1 : -1));

        if (this.pluginArgs.hub !== undefined) {
            const nodeDevices = new NodeDevices(this.pluginArgs.hub);
            await nodeDevices.postDevicesToHub(simulators, 'add');
        }
        return simulators;
    }

    async fetchLocalSimulators(): Promise<IDevice[]> {
        const simctl = new Simctl();
        const list = await simctl.list();

        // Log unavailable runtimes
        list.runtimes.filter((r: any) => !r.isAvailable)
            .forEach((r: any) => this.log.error(`Runtime not available: ${r.name}`));

        const iosSims = flatten(Object.values(await simctl.getDevicesByParsing('iOS') as any));
        const tvosSims = flatten(Object.values(await simctl.getDevicesByParsing('tvOS') as any));

        let simulators = [...(iosSims as IDevice[]), ...(tvosSims as IDevice[])];
        if (this.pluginArgs.bootedSimulators) {
            simulators = simulators.filter((d) => d.state === 'Booted');
        }

        const localPluginArgs = this.pluginArgs;
        if (localPluginArgs.simulators && localPluginArgs.simulators.length > 0) {
            const allowedSimulators = localPluginArgs.simulators;
            simulators = simulators.filter((d) =>
                allowedSimulators.some(s => d.name === s.name && d.sdk === s.sdk)
            );
        }

        return await Promise.all(simulators.map(async (d) => ({
            ...d,
            wdaLocalPort: await getFreePort(),
            mjpegServerPort: await getFreePort(),
            busy: false,
            realDevice: false,
            platform: (d.name?.toLowerCase().includes('tv') ? 'tvos' : 'ios') as 'ios' | 'android' | 'tvos',
            deviceType: 'simulator',
            host: `http://${this.pluginArgs.bindHostOrIp}:${this.hostPort}`,
            totalUtilizationTimeMilliSec: await getUtilizationTime(d.udid),
            sessionStartTime: 0,
        } as IDevice)));
    }

    trackIOSDevices() {
        const tracker = Container.get(IosTracker).getListener();
        tracker.on('attached', async (udid: string) => {
            try {
                const device = { ...(await this.getDeviceInfo(udid)), nodeId: this.nodeId };
                if (this.pluginArgs.hub) {
                    await new NodeDevices(this.pluginArgs.hub).postDevicesToHub([device], 'add');
                }
                await addNewDevice([device], this.pluginArgs.bindHostOrIp);
            } catch (e: any) {
                this.log.error(`Attach failed for ${udid}: ${e.message}`);
            }
        });

        tracker.on('detached', async (udid: string) => {
            const deviceRemoved = [{ udid, host: this.pluginArgs.bindHostOrIp as string }];
            if (this.pluginArgs.hub) {
                await new NodeDevices(this.pluginArgs.hub).postDevicesToHub(deviceRemoved as any, 'remove');
            }
            await removeDevice(deviceRemoved);
        });
    }
}

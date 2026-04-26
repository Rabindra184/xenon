import * as React from 'react';
import { Battery, BatteryLow, BatteryWarning, Thermometer } from 'lucide-react';
import { Pill, PillTone } from '../ui/Pill';
import { IDevice } from '../../interfaces/IDevice';

interface Props {
  device: Pick<IDevice, 'batteryLevel' | 'thermalStatus'>;
}

function batteryTone(level: number): PillTone {
  if (level >= 50) return 'ready';
  if (level >= 20) return 'reserved';
  return 'error';
}

function batteryIcon(level: number): React.ReactNode {
  if (level >= 50) return <Battery size={10} />;
  if (level >= 20) return <BatteryLow size={10} />;
  return <BatteryWarning size={10} />;
}

function thermalTone(status: string): PillTone {
  if (status === 'Normal') return 'ready';
  if (status === 'Critical') return 'error';
  return 'reserved';
}

export const HealthBadges: React.FC<Props> = ({ device }) => {
  const showBattery = typeof device.batteryLevel === 'number';
  const showThermal =
    typeof device.thermalStatus === 'string' &&
    device.thermalStatus.length > 0 &&
    device.thermalStatus !== 'Unknown';

  if (!showBattery && !showThermal) return null;

  return (
    <div className="dc2-health">
      {showBattery && (
        <Pill
          tone={batteryTone(device.batteryLevel as number)}
          title={`Battery ${device.batteryLevel}%`}
        >
          {batteryIcon(device.batteryLevel as number)}
          {device.batteryLevel}%
        </Pill>
      )}
      {showThermal && (
        <Pill
          tone={thermalTone(device.thermalStatus as string)}
          title={`Thermal: ${device.thermalStatus}`}
        >
          <Thermometer size={10} />
          {device.thermalStatus}
        </Pill>
      )}
    </div>
  );
};

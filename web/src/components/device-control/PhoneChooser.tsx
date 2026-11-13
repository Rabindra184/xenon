import * as React from 'react';
import { Link } from 'react-router-dom';
import type { IDevice } from '../../interfaces/IDevice';
import { deviceControlPath } from '../../lib/deviceControlPath';
import { phoneKey } from '../../lib/phone';
import { deviceTitle } from '../device-card/device-card/deviceIdentity';
import { deviceState, STATE_LABEL } from '../device-card/device-card/deviceState';
import { StatusDot } from '../ui/StatusDot';
import './phone-chooser.css';

export const PHONE_CHOOSER_TITLE_ID = 'phone-chooser-title';

interface Props {
  /** The listed phones of one udid, on two or more servers. */
  devices: IDevice[];
  /** The device control tab the link asked for, kept in each phone's link. */
  tab?: string;
}

/**
 * For a device control link without a host whose udid two or more servers
 * have: which phone to open. Opens none until one is chosen.
 */
export function PhoneChooser({ devices, tab }: Props) {
  const udid = devices[0]?.udid ?? '';
  const now = Date.now();
  return (
    <section className="phone-chooser" aria-labelledby={PHONE_CHOOSER_TITLE_ID}>
      <h2 id={PHONE_CHOOSER_TITLE_ID} className="phone-chooser-title">
        Two servers have a phone named {udid}. Choose one.
      </h2>
      <ul className="phone-chooser-list">
        {devices.map((d) => {
          const state = deviceState(d, now);
          return (
            <li key={phoneKey(d)}>
              <Link className="phone-chooser-link" to={deviceControlPath(d, tab)}>
                <span className="phone-chooser-name">{deviceTitle(d)}</span>
                <span className="phone-chooser-host">{d.host}</span>
                <span className="phone-chooser-state">
                  <StatusDot kind={state} /> {STATE_LABEL[state]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

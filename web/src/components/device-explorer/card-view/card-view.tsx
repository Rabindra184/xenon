import React from 'react';
import { IDevice } from '../../../interfaces/IDevice';
import DeviceCard from '../../device-card/device-card/device-card';
import XenonApiService from '../../../api-service';
import './card-view.css';

interface IProps {
  devices: Array<IDevice>;
  reloadDevices: () => void;
}

interface IState {
  teamsMap: Map<string, string>;
}

export default class CardView extends React.Component<IProps, IState> {
  // Prefetch teams once at the explorer level so per-card chips can resolve
  // a team-id -> team-name without firing N parallel requests. Failures are
  // swallowed: the chip falls back to a "Team {id-prefix}" string.
  state: IState = { teamsMap: new Map() };

  componentDidMount() {
    XenonApiService.listTeams()
      .then((rows) => {
        this.setState({ teamsMap: new Map(rows.map((t) => [t.id, t.name])) });
      })
      .catch(() => {
        // Silent failure -> chip falls back to id-slice display.
      });
  }

  render() {
    return (
      <div className="device-explorer-card-container">
        {React.Children.toArray(
          this.props.devices.map((device) => (
            <DeviceCard
              device={device}
              reloadDevices={this.props.reloadDevices}
              teams={this.state.teamsMap}
            />
          )),
        )}
      </div>
    );
  }
}

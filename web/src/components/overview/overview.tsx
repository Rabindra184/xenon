import * as React from 'react';
import './overview.css';

const Overview: React.FC = () => (
  <div className="ov">
    <div className="ov-header">
      <div>
        <div className="ov-crumb">WORKSPACE</div>
        <h1 className="ov-title">Overview</h1>
      </div>
    </div>
    <div className="ov-placeholder">
      Overview widgets land in phase 3 (KPIs, fleet status, activity stream).
    </div>
  </div>
);

export default Overview;

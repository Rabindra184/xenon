---
title: Remote Execution
hide:
  - navigation
---

<div style={{textAlign: 'center'}}>

  <img src="https://raw.githubusercontent.com/xenon-platform/xenon/main/docs/assets/images/remote.jpg" class="center"/>
</div>

### Distributed Event-Driven Grid

Xenon's remote execution is powered by a high-performance **gRPC/NATS** event bus, transforming isolated servers into a unified, reactive mesh.

#### Hub (Central Controller)
The Hub acts as the strategic intelligence layer, orchestrating device allocation and routing commands across the global grid.
- **Unified Registry**: Real-time visibility into all remote nodes.
- **Smart Load Balancing**: Allocates devices based on node health and latency.
- **Failover Recovery**: Automatic session re-routing if a node becomes unresponsive.

#### Node (Hardware Worker)
A remote machine hosting physical devices or simulators, running an Appium server with the Xenon plugin active.
- **Auto-Registration**: Nodes use zero-config discovery to join the grid.
- **High-Fidelity Streaming**: Direct NATS streams for ultra-low latency video and logs.

### Cellular Architecture & Shared State

For global-scale deployments, Xenon supports a **Cellular Architecture** where multiple Hubs share a common state via **PostgreSQL**.

- **Cell Isolation**: Group infrastructure into regional "cells" (e.g., US-West, EU-Central) to minimize device-to-hub latency.
- **State Persistence**: All session history and device lockers are persisted in PostgreSQL, allowing Hubs to be completely stateless and easily scalable.
- **Disaster Recovery**: If a regional cell fails, the global registry allows workers to be immediately re-provisioned to another cell.

To enable this, configure the `databaseProvider` and `databaseUrl` in your `xenon.config.json`.

### Dashboard
* Navigate to the host and port of Hub server from the above example it will be http://localhost:31137/xenon
* Dashboard should have device list based on the hub configuration.
  ![](https://github.com/xenon-platform/xenon/blob/main/assets/demo.gif)

### Test Execution
* Point your Appium test execution URL to the Hub endpoint. 

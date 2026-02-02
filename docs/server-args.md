---
title: Configuration
---

# Configuration & Server Arguments

Xenon is highly configurable to suit single-node, hub-node, or cloud deployments. You can configure Xenon using:

1.  **Configuration File** (Recommended for production)
2.  **Runtime API** (For dynamic updates)
3.  **CLI Arguments** (Good for quick testing)

---

## 1. Using Configuration File

We recommend using an Appium configuration file (`json` or `yaml`) to manage settings.

### Example `xenon-config.yaml`

```yaml
server:
  keepAliveTimeout: 800
  basePath: /wd/hub
  usePlugins:
    - xenon
  plugin:
    xenon:
      # PLATFORM & DEVICES
      platform: both  # options: ios, android, both
      iosDeviceType: both # options: real, simulated, both
      androidDeviceType: both
      
      # INFRASTRUCTURE
      # hub: "http://hub-ip:port" # Uncomment for Node configuration
      maxSessions: 8
      # proxy: 
      #   host: "proxy.example.com"
      #   port: 8080
      
      # FEATURES
      enableDashboard: true
      bootedSimulators: true
      skipChromeDownload: true
      
      # TIMEOUTS (ms)
      deviceAvailabilityTimeoutMs: 180000
      deviceAvailabilityQueryIntervalMs: 10000
      newCommandTimeoutSec: 60
```

To run:
```bash
appium server --config xenon-config.yaml
```

---

## 2. Runtime Configuration (API)

Xenon exposes a REST API to update configuration at runtime. This is useful for adjusting timeouts or concurrency limits without downtime.

**Endpoint**: `PUT /xenon/api/config`

**Example Request**:
```bash
curl -X PUT http://localhost:4723/xenon/api/config \
  -H "Content-Type: application/json" \
  -d '{ "maxSessions": 12, "newCommandTimeoutSec": 120 }'
```

**Response**:
```json
{
  "success": true,
  "config": { ... },
  "restartRequired": false,
  "message": "Configuration updated..."
}
```

> ⚠️ **Restart Required**: Changing these properties via API will **NOT** take effect until a server restart:
> - `hub`
> - `platform`
> - `bindHostOrIp`
> - `proxy`
> - `cloud`
> - `iosDeviceType` / `androidDeviceType`

---

## 3. CLI Arguments Reference

These arguments can be passed via command line flags (e.g., `--plugin-xenon-platform=ios`).

| Configuration Key | CLI Flag | Description | Default | Options |
| ----------------- | -------- | ----------- | ------- | ------- |
| `platform` | `--plugin-xenon-platform` | Platform to run tests against | `both` | `both`,`ios`,`android` |
| `iosDeviceType` | `--plugin-xenon-ios-device-type` | Types of iOS devices to include | `both` | `both`,`simulated`,`real` |
| `androidDeviceType` | `--plugin-xenon-android-device-type` | Types of Android devices to include | `both` | `both`,`simulated`,`real` |
| `skipChromeDownload` | `--plugin-xenon-skip-chrome-download` | Skip automatic chromedriver download | `true` | `true`, `false` |
| `hub` | `--plugin-xenon-hub` | HUB IP address (if running as node) | None | `http://host:port` |
| `maxSessions` | `--plugin-xenon-max-sessions` | Limit concurrent sessions | `8` | Number |
| `enableDashboard` | `--plugin-xenon-enable-dashboard` | Enable the web dashboard | `false` | `true`, `false` |
| `bootedSimulators` | `--plugin-xenon-booted-simulators` | Use already booted simulators | `false` | `true`, `false` |
| `deviceAvailabilityTimeoutMs` | `--plugin-device-availability-timeout-ms` | Wait time for free device (ms) | `300000` | Number |
| `newCommandTimeoutSec` | `--plugin-new-command-timeout-sec` | Auto-release session timeout (sec) | `60` | Number |

### Cloud & Proxy

Xenon also supports `cloud` and `proxy` configurations. See the configuration file example above for structure.

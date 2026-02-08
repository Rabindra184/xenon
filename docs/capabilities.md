---
title: Capabilities
---


Xenon uses the `xe:` prefix for its custom capabilities. `xenon:` and `appium:` are also supported.

### Xenon Capabilities

| Capability Name | Description | Default |
|-----------------|-------------|---------|
| `xe:build` | Build name for grouping sessions in dashboard | - |
| `xe:name` | Session name for identification | - |
| `xe:record_video` | Enable video recording for the session | `true` |
| `xe:screenshot_on_failure` | Capture screenshot when a command fails | `true` |
| `xe:screenshot_on_every_command` | Capture screenshot after every command (slow) | `false` |
| `xe:save_device_logs` | Save device logs (logcat/syslog) to session artifacts | `false` |
| `xe:priority` | Session priority (low/medium/high) for queue management | `medium` |
| `xe:teamId` | Team identifier for quota management | - |
| `xe:network_profile` | Network profile to simulate (`4G`, `3G`, `Edge`, `Offline`) | `Normal` |
| `xe:max_thermal_status` | Maximum allowed thermal status (`Normal`, `Fair`, `Serious`, `Critical`) | - |

> [!TIP]
> **AI Analysis Tip**: For the most accurate AI diagnoses, ensure `xe:screenshot_on_failure` and `xe:save_device_logs` are set to `true`. This provides the multimodal context (visuals + logs) the AI needs to identify the root cause.

### Instant Dashboard & Tracing
Xenon provides real-time observability out of the box:
- **Instant Updates**: The web dashboard uses WebSockets to reflect device and session state changes immediately.
- **Trace correlation**: Every session is assigned a unique OpenTelemetry **Trace ID**, visible in the dashboard metadata.

### Strict Capability Validation

Xenon uses a strict validation system powered by Zod. Every session request is validated against a schema before a device is even considered for allocation. This ensures:
- **Fail-Fast**: Invalid capabilities trigger an immediate 400 error.
- **Data Integrity**: Capabilities are sanitized and normalized to the correct types.
- **Platform Specifics**: Ensuring things like `bundleId` are present for iOS and `appPackage` for Android.

### Device Filtering

| Capability Name                  | Description                                                                                                                                                                                                                                                        |
|----------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `appium:iPhoneOnly`                | Allocate only iPhone simulators for execution when to true. Default value is `false`.                                                                                                                                                                              |
| `appium:iPadOnly`                  | Allocate only iPad simulators for execution when to true. Default value is `false`.                                                                                                                                                                                |
| `appium:deviceAvailabilityTimeout` | When create session requests are more than available connected devices, plugin waits for a certain interval for device availability before it timeout. Default value is `180000` milliseconds.                                                                     |
| `appium:deviceRetryInterval`       | When create session requests are more than available connected devices, plugin polls for device availability in certain intervals. Default value is `10000` milliseconds.                                                                                          |
| `appium:udids`                     | Comma separated list of device udid's to execute tests only on specific devices `appium:udids: device1UDID,device2UDID`                                                                                                                                            |
| `appium:platformName`              | Requests a session for the provided platform name. Valid options are `iOS`, `tvOS`, or `Android`, ex: `'appium:platformName': tvOS`                                                                                                                                 |
| `appium:platformVersion`           | This capability is used to filter devices/simulators based on SDK. Only devices/simulators that are an exact match with the platformVersion would be considered for test run. `appium:platformVersion` is optional argument. ex: `'appium:platformVersion': 16.1.1` |
| `appium:minSDK`                    | This capability is used to filter devices/simulators based on SDK. Devices/Simulators with SDK greater then or equal to minSDK would only be considered for test run. `appium:minSDK` is optional argument. ex: `'appium:minSDK': 15`                              |
| `appium:maxSDK`                    | This capability is used to filter devices/simulators based on SDK. Devices/Simulators with SDK less then or equal to maxSDK would only be considered for test run. `appium:maxSDK` is optional argument. ex: `'appium:maxSDK': 15`                                 |
| `appium:filterByHost`              | This capability is used to filter devices/simulators based on node IP. This will only consider devices from specific node. `host` is optional argument. ex: `'host': '192.168.0.226',`                                                                      |

### Execute Script Commands

Xenon provides a powerful `executeScript` interface using the `xenon:` namespace. This allows test frameworks to communicate runtime metadata and trigger specific actions without requiring new Appium commands.

#### Commands

| Command | Arguments | Description |
|:---|:---|:---|
| `xenon: setSessionStatus` | `{"status": string, "reason": string}` | Sets the session status to `passed` or `failed`. |
| `xenon: setSessionName` | `{"name": string}` or `string` | Updates the session name displayed in the dashboard. |
| `xenon: captureEvidence`| `{"reason": string, "label": string}` or `string` | Captures a manual screenshot and logs it as evidence with an optional label. |
| `xenon: addTag` | `{"tag": string}` or `string` | Adds a searchable tag to the current session. |
| `xenon: debug` | `{"message": string}` or `string` | Appends a custom debug log line to the session dashboard. |

#### Code Examples

**WebdriverIO (v8+)**
```javascript
// Set Status
await driver.executeScript('xenon: setSessionStatus', [{ status: 'passed', reason: 'Verified checkout flow' }]);

// Capture Evidence
await driver.executeScript('xenon: captureEvidence', ['User profile verified']);

// Add Tags
await driver.executeScript('xenon: addTag', ['smoke', 'payment']);
```

**Appium Java Client (v9+)**
```java
// Set Status
driver.executeScript("xenon: setSessionStatus", ImmutableMap.of("status", "failed", "reason", "Element timed out"));

// Set Name
driver.executeScript("xenon: setSessionName", "Regression: Payment Module");
```

---

### API Documentation

For full API documentation, visit the [Swagger UI](/xenon/api-docs) or the raw [OpenAPI Spec](/xenon/api-docs.json) on your running server.
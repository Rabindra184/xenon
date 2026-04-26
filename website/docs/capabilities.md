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
| `xe:interceptor` | Network interceptor config object (`{ enabled, mocks, includeHosts, excludeHosts, ... }`). See [Network Interceptor](./network-interceptor). | - |

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

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

#### Code Examples

<Tabs>
<TabItem value="wdio" label="WebdriverIO" default>

```javascript
// Set Status
await driver.executeScript('xenon: setSessionStatus', [{ 
  status: 'passed', 
  reason: 'Verified checkout flow' 
}]);

// Capture Evidence
await driver.executeScript('xenon: captureEvidence', ['User profile verified']);

// Add Tags
await driver.executeScript('xenon: addTag', ['smoke', 'payment']);
```

</TabItem>
<TabItem value="java" label="Java Client">

```java
// Set Status
driver.executeScript("xenon: setSessionStatus", 
  ImmutableMap.of("status", "failed", "reason", "Element timed out"));

// Set Name
driver.executeScript("xenon: setSessionName", "Regression: Payment Module");
```

</TabItem>
<TabItem value="python" label="Python Client">

```python
# Set Status
driver.execute_script('xenon: setSessionStatus', {
    'status': 'passed',
    'reason': 'Search functionality works'
})

# Add Tags
driver.execute_script('xenon: addTag', 'v2-testing')
```

</TabItem>
</Tabs>



---

### Omni-Interaction (Smart UI Commands)

Xenon exposes **session-scoped plugin endpoints** for smart, resilient UI interaction and UI introspection. These are designed for enterprise pipelines: they return **structured, auditable outputs** and degrade gracefully when OCR/AI cannot confidently act.

#### Invocation

All Omni-Interaction commands can be invoked in two ways:

1. **`executeScript`** (recommended — works out of the box with all Appium clients):

<Tabs>
<TabItem value="java" label="Java Client" default>

```java
// Smart Tap (Text-based)
Map<String, Object> tapArgs = Map.of("text", "Submit", "index", 1, "takeANewScreenShot", true);
Map<String, Object> result = (Map<String, Object>) driver.executeScript("xe:smartTap", tapArgs);

// Smart Tap (Icon-based fallback)
Map<String, Object> iconArgs = Map.of("icon", "back arrow", "takeANewScreenShot", true);
Map<String, Object> iconResult = (Map<String, Object>) driver.executeScript("xe:smartTap", iconArgs);

// Dedicated Visual Tap
Map<String, Object> vizResult = (Map<String, Object>) driver.executeScript("xe:visualTap", Map.of("icon", "search magnifying glass"));
```

</TabItem>
<TabItem value="wdio" label="WebdriverIO">

```javascript
// Smart Tap
const result = await driver.executeScript('xe:smartTap', [{ text: 'Submit', index: 1, takeANewScreenShot: true }]);

// UI Inventory
const items = await driver.executeScript('xe:uiInventory', [{ maxItems: 200, takeANewScreenShot: true }]);
```

</TabItem>
<TabItem value="python" label="Python Client">

```python
# Smart Tap
result = driver.execute_script('xe:smartTap', {'text': 'Submit', 'index': 1, 'takeANewScreenShot': True})

# UI Inventory
items = driver.execute_script('xe:uiInventory', {'maxItems': 200, 'takeANewScreenShot': True})
```

</TabItem>
</Tabs>

2. **REST endpoint** (direct HTTP POST):

#### `smartTap` (OCR-driven tap by visible text)

- **Endpoint**: `POST /session/:sessionId/xenon/smart-tap`
- **Body**:
  - `text` (string, required): visible text to tap
  - `index` (number, optional, 1-based): which match to tap if multiple are found (default `1`)
  - `takeANewScreenShot` (boolean, optional): default `true`

**Response (high level)**:
- `clicked`: boolean
- `message`: string
- `target`: coordinates + rect + confidence (when clicked)

#### `uiInventory` (UI metadata export)

- **Endpoint**: `POST /session/:sessionId/xenon/ui-inventory`
- **Body**:
  - `maxItems` (number, optional): default `200`
  - `takeANewScreenShot` (boolean, optional): default `true`

Returns an array of UI items with stable keys:
- `text`, `color`, `position`, `aligned`, `above`, `below`, `icon`, `icon_color`, `icon_category`

#### Compatibility aliases (Lens-style clients)

If your existing tests already call Lens-style endpoints, Xenon supports aliases that map to the Xenon-native commands:

- `POST /session/:sessionId/plugin/ai-appium-lens/aiClick` → `smartTap`
- `POST /session/:sessionId/plugin/ai-appium-lens/fetchUIElementsMetadataJson` → `uiInventory`

#### Additional `executeScript` commands

| Command | Description |
|:---|:---|
| `xe:smartTap` / `xe:omniClick` | OCR-driven tap by visible text (supports `icon` fallback) |
| `xe:visualTap` | AI-driven tap by visual description (e.g. "back icon") |
| `xe:uiInventory` / `xe:uiScanExport` | Export UI metadata from OCR |
| `xe:analyzeScreen` / `xe:omniScan` | AI screen analysis |
| `xe:assertVisualState` | Natural language visual assertion |

> [!IMPORTANT]
> Use `driver.executeScript()`, not `driver.execute()`. The `execute()` method attempts to encode through Selenium's internal command codec, which doesn't know custom `xe:` commands.

### API Documentation

The plugin server serves an interactive Swagger UI and a raw OpenAPI spec at runtime. Open them on your running server:

```
http://<host>:<port>/xenon/api-docs        # Swagger UI
http://<host>:<port>/xenon/api-docs.json   # OpenAPI 3.0 spec
```
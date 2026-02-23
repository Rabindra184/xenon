---
title: Setup & Requirements
hide:
  - navigation
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Setup & Requirements

Get your Xenon environment ready for autonomous mobile automation. This guide covers hardware prerequisites, software dependencies, and installation steps for both standalone and distributed deployments.

---

## Prerequisites

### Operating System
- **Android Automation**: macOS or Linux (Ubuntu 20.04+ recommended).
- **iOS Automation**: macOS only (required for Xcode and simulator orchestration).

### Software Dependencies
- **Node.js**: LTS version (v18.x or v20.x recommended).
- **Appium**: version 2.0.0 or higher.
- **Java (JDK)**: version 11 or higher (required for Android `/adb`).
- **Drivers**:
  - `appium-uiautomator2-driver` (for Android)
  - `appium-xcuitest-driver` (for iOS)
- **iOS Utilities** (for real device logs):
  - `libimobiledevice` (specifically `idevicesyslog`)
  - `go-ios` (optional high-performance alternative)

---

## Hardware Requirements

Xenon is engineered for high-density labs. Ensure your host machine meets these minimum specs based on your workload:

| Workload | CPU | RAM | Storage |
|----------|-----|-----|---------|
| **Local Dev** (1-2 devices) | 4 Cores | 8 GB | 20 GB (SSD) |
| **High-Density Lab** (8+ devices) | 16+ Cores | 32+ GB | 500 GB (NVMe) |
| **Visual AI / Omni-Vision** | Apple Silicon or discrete GPU | 16+ GB | Additional 5GB for models |

---

## Installation

<Tabs>
<TabItem value="npm" label="NPM (Recommended)" default>

Install the Xenon plugin and the Dashboard directly from the NPM registry:

```bash
# Install Xenon Plugin (Includes Dashboard)
appium plugin install --source=npm @xenon-device-management/xenon
```

</TabItem>
<TabItem value="local" label="Local / Development">

If you are developing Xenon or using a custom build:

```bash
# Build everything (Plugin + Dashboard)
npm run build:all

# Install locally
appium plugin install --source=local /path/to/xenon

# High-velocity dev loop (Auto-rebuilds)
npm run dev
```

</TabItem>
</Tabs>

---

## Activation

The plugin must be explicitly activated when starting the Appium server.

<Tabs>
<TabItem value="cli" label="CLI Arguments" default>

```bash
# Production Ready Start
XENON_AI_PROVIDER=gemini \
XENON_GEMINI_API_KEY=YOUR_GEMINI_API_KEY \
XENON_OLLAMA_MODEL=llava:7b \
XENON_AI_BASE_URL=http://localhost:11434 \
XENON_OTEL_DEBUG=true \
appium server -ka 800 --use-plugins=xenon -pa /wd/hub \
  --plugin-xenon-platform=both \
  --plugin-xenon-max-sessions=8 \
  --plugin-xenon-enable-dashboard \
  --plugin-xenon-booted-simulators \
  --plugin-xenon-ai-provider=gemini \
  --plugin-xenon-ai-model=llava:7b \
  --plugin-xenon-ai-base-url=http://localhost:11434
```

</TabItem>
<TabItem value="config" label="Config File">

Create a `xenon-config.yaml` and pass it to the Appium server. This configuration includes AI, session management, and dashboard settings.

```yaml
server:
  port: 4723
  basePath: /wd/hub
  keepAliveTimeout: 800
  usePlugins:
    - xenon
  plugin:
    xenon:
      platform: both
      maxSessions: 8
      enableDashboard: true
      bootedSimulators: true
      aiProvider: gemini
      aiModel: llava:7b # Optional override
      aiBaseUrl: "http://localhost:11434"
```

Run with:
```bash
appium server --config ./xenon-config.yaml
```

</TabItem>
</Tabs>

---

## Accessing the Dashboard

Once the server is running, the Xenon Dashboard is available at:

`http://localhost:4723/xenon`

From here, you can:
- **Monitor** real-time device health and termals.
- **Triage** failed sessions using AI diagnostics.
- **Control** devices manually via live MJPEG streaming.
- **Configure** maintenance and AI settings.

---

## First Test Run

To verify your setup, run a test with the following minimal capabilities. Xenon will automatically handle device allocation.

<Tabs>
<TabItem value="wdio" label="WebdriverIO" default>

```javascript
const opts = {
  path: '/wd/hub',
  port: 4723,
  capabilities: {
    platformName: "Android",        // or 'iOS'
    "appium:automationName": "UiAutomator2",
    "appium:app": "/path/to/my.apk",
    "xe:record_video": true,        // Enable Xenon recording
    "xe:save_device_logs": true      // Enable for AI diagnostics
  }
};
```

</TabItem>
<TabItem value="java" label="Java">

```java
UiAutomator2Options options = new UiAutomator2Options()
    .setPlatformName("Android")
    .setApp("/path/to/my.apk")
    .setCapability("xe:record_video", true)
    .setCapability("xe:save_device_logs", true);

AndroidDriver driver = new AndroidDriver(new URL("http://127.0.0.1:4723/wd/hub"), options);
```

</TabItem>
</Tabs>

---

## Database Setup (Optional)

By default, Xenon uses a local **SQLite** database (`~/.cache/xenon/xenon.db`). For distributed High-Availability deployments, **PostgreSQL** is recommended.

### PostgreSQL Configuration

```bash
# Via Environment Variables
export XENON_DB_PROVIDER=postgresql
export DATABASE_URL="postgresql://user:password@localhost:5432/xenon"

# Via Appium Arguments
appium server ... --plugin-xenon-database-provider=postgresql --plugin-xenon-database-url="postgresql://user:password@localhost:5432/xenon"
```

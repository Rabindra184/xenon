---
title: Network Conditioning
---

# Network Conditioning

Simulate real-world network conditions during test execution. Test how your app behaves on slow connections, high latency, or complete network loss — without changing your test code.

---

## Network Profiles

| Profile | Latency | Download | Upload | Use Case |
|---------|:-------:|:--------:|:------:|----------|
| **Normal** | 0ms | Unlimited | Unlimited | Default — no throttling |
| **4G** | 20ms | 15 Mbps | 7.5 Mbps | Standard mobile performance |
| **3G** | 100ms | 2 Mbps | 1 Mbps | Slow mobile connections |
| **Edge** | 400ms | 250 Kbps | 150 Kbps | Poor coverage / rural areas |
| **Offline** | — | 0 | 0 | Airplane mode testing |

---

## How It Works

Network conditioning operates at two levels:

### Platform-Level Controls

**Android** — Uses ADB to toggle network radios:
```bash
# Offline: disable both data and wifi
adb -s <udid> shell svc data disable
adb -s <udid> shell svc wifi disable

# Normal: re-enable
adb -s <udid> shell svc data enable
adb -s <udid> shell svc wifi enable
```

**iOS Simulator** — Uses `simctl` network commands:
```bash
# Apply 3G profile
xcrun simctl network <udid> status 3g

# Apply Edge profile
xcrun simctl network <udid> status edge

# Reset to normal
xcrun simctl network <udid> status none
```

:::info
iOS **real devices** do not support programmatic network conditioning. For real device testing, use the proxy-level latency injection (applied automatically).
:::

### Proxy-Level Latency Injection

For cross-platform consistency, Xenon also injects latency at the command proxy level. This adds the profile's `latencyMs` delay to every Appium command, simulating the round-trip overhead of a slow network. This works for all platforms and device types.

---

## Usage

Network conditioning is applied per-session through the Dashboard or API:

### Via Dashboard
1. Open a live session in the Dashboard
2. Select the desired network profile from the control panel
3. The profile applies immediately and resets when the session ends

### Via Execute Script API

```javascript
// Apply 3G conditions to the current session
await driver.executeScript('xenon: setNetworkProfile', [{ profile: '3G' }]);

// Reset to normal
await driver.executeScript('xenon: setNetworkProfile', [{ profile: 'Normal' }]);
```

---

## Session Lifecycle

- Profiles are **scoped to individual sessions** — they don't affect other concurrent sessions
- When a session ends (normally or via timeout), network conditions are **automatically reset** to `Normal`
- Switching profiles mid-session is instant

---
title: Troubleshooting
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';


# Strategic Triage & Troubleshooting

Xenon is designed to be self-healing, but hardware and environment complexities sometimes require manual intervention. This guide leverages Xenon's internal telemetry to help you solve issues faster.

## Autonomous Triage with AI

If a session fails and you are unsure why, the **AI Root-Cause Diagnosis** in the session dashboard is your first line of defense.

:::tip
The AI doesn't just look at errors; it reasons over context. It analyzes screenshots for system dialogs, filters system logs for kernel panics, and compares command sequences to identify race conditions.
:::

#### AI Diagnostic Requirements
If AI analysis is not appearing, ensure the following are configured on your Hub server:
- **API Keys**: `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.
- **Instrumentation**: `xe:record_video` and `xe:save_device_logs` must be enabled.

---

## Common Challenges & Solutions

<Tabs>
<TabItem value="ios" label="iOS / WDA" default>

### WDA Connection Refused
**Symptom**: `Failed to create session: WebDriverAgent failed to start`.

- **Check USB Integrity**: Ensure the device is seen by `cfgutil` or `idevice_id`.
- **Trust Request**: Physical devices may prompt for "Trust this Computer". Xenon attempts to bypass this, but manual confirmation is sometimes required for new hardware.
- **XCode Version**: Ensure your XCode version supports the target iOS version.

:::caution
A high thermal status on iOS devices will cause WDA to become extremely sluggish or crash. Xenon's **HealthMonitor** will automatically de-prioritize these devices.
:::

</TabItem>
<TabItem value="android" label="Android / ADB">

### ADB Device Unauthorized
**Symptom**: Device status is `unauthorized` in the dashboard.

- **Check Debugging**: Ensure "USB Debugging" is enabled and the RSA fingerprint is accepted.
- **Node-Hub Connectivity**: Ensure the Node can reach the Hub's HTTP/Socket.IO port (default `:4723`).

</TabItem>
</Tabs>


---

## Session Lifecycle Notes

:::info
**Auto-Release Policy**: If there is no activity (no commands received) on a session for more than **60 seconds**, Xenon will automatically release the device to the available pool to prevent resource starvation.
:::

#### Performance Impact
Running with `xe:screenshot_on_every_command` set to `true` will significantly increase execution time. We recommend using this only for local debugging/triage, not for high-scale CI runs.
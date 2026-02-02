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

### API Documentation

For full API documentation, visit the [Swagger UI](/docs/api-docs) or the raw [OpenAPI Spec](/docs/api-docs.json) on your running server.
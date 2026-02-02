# Xenon Roadmap: Intelligent Mobile Infrastructure Platform

This roadmap defines the evolution of **Xenon** into a **World-Class, Autonomous Mobile Infrastructure**. 

This plan is strictly limited to features that are **100% feasible** within the Appium Plugin architecture, utilizing existing drivers (UIAutomator2, XCUITest) and host-level native integrations.

---

## 🏛 Vision
To build the most resilient, intelligent, and developer-centric mobile laboratory, where infrastructure "heals" itself and failures are diagnosed automatically by AI.

---

## � Current Status Dashboard

| Category | Feature | Status |
|----------|---------|--------|
| Session Recording | Video capture | ✅ Complete |
| Session Recording | Screenshot on failure | ✅ Complete |
| Session Recording | Screenshot on every command | ✅ Complete |
| Profiling | Android CPU/Memory | ✅ Complete |
| Profiling | iOS Instruments trace | ✅ Complete |
| Device Control | Live streaming | ✅ Complete |
| Device Control | Remote touch interaction | ✅ Complete |
| Dashboard | Session history | ✅ Complete |
| Dashboard | Build grouping | ✅ Complete |
| Health Monitoring | Battery/Storage Metrics | ✅ Complete |
| Health Monitoring | Autonomous Recovery | ✅ Complete |
| Device Management | Hardware Tagging | ✅ Complete |

---

## 🎯 User Pain Points & High-Impact Features

### Priority 1: Flaky Test Detection & Retry Intelligence
> *"Why did this test pass yesterday but fail today on the same device?"*

**User Story**: As a QA Lead, I want to identify tests that fail intermittently so I can quarantine them.

- [ ] Track pass/fail ratio per test name across sessions
- [ ] Auto-detect tests with <80% pass rate
- [ ] "Flakiness Score" badge on session cards
- [ ] **Smart retry**: Only retry on transient errors (element not found vs actual bug)
- [ ] Quarantine recommendations in dashboard

**Effort**: Medium (2 weeks)

---

### Priority 2: Device Health Monitoring & Auto-Recovery
> *"My tests failed because the device was in a bad state, not because of my code"*

**User Story**: As a DevOps Engineer, I want devices to self-heal so infrastructure doesn't become a bottleneck.

- [ ] Pre-session health check (battery >20%, storage >500MB, WiFi connected)
- [ ] Auto-restart unresponsive devices via ADB/idevice
- [ ] "Device Reliability Score" based on failure history
- [ ] Temperature/thermal monitoring via `dumpsys battery`
- [ ] Auto-blacklist devices with >3 consecutive session failures
- [ ] Slack/webhook alert when device goes unhealthy

**Effort**: Medium (2-3 weeks)

---

### Priority 3: Queue Visibility & ETA
> *"I submitted my test 10 minutes ago, where is it?"*

**User Story**: As a Developer, I want to see my position in the queue so I can plan my time.

- [ ] Real-time queue position: "Your test is #5 in queue"
- [ ] ETA calculation based on average session duration
- [ ] Queue visualization in dashboard (who's waiting for what)
- [ ] Priority lanes for critical tests (`xe:priority: high`)
- [ ] Notification when device becomes available

**Effort**: Low (1 week)

---

### Priority 4: Failure Analysis & Error Categorization
> *"Don't just tell me it failed, tell me WHY"*

**User Story**: As a Test Automation Engineer, I want failures categorized so I can triage faster.

- [ ] Auto-categorize errors: App Crash vs Element Not Found vs Timeout vs Permission Dialog
- [ ] Extract crash logs from Logcat/Syslog automatically
- [ ] Link to symbolicated crash reports
- [ ] Screenshot diff: What changed between pass/fail runs
- [ ] Highlight "blocking element" when element not clickable

**Effort**: High (3-4 weeks)

---

### Priority 5: Integration Ecosystem
> *"I need this to work with my existing CI/CD"*

**User Story**: As a DevOps Engineer, I want webhooks so I can integrate with my alerting systems.

- [ ] Slack notifications: Session complete, failure, device offline
- [ ] Microsoft Teams webhook support
- [ ] Generic webhook for custom integrations
- [ ] Jira integration: Auto-create bug with video + logs attached
- [ ] Grafana-compatible metrics endpoint (Prometheus format)
- [ ] GitHub Actions status check integration

**Effort**: Medium (2 weeks)

---

## 🏗️ Phase 1: High-Availability & State Elasticity (Confident)
*Focus: Scaling beyond a single Mac Mini and handling crashes gracefully.*

### 1. Redis/Persistent State Migration
- **Technicality**: Move device availability and session locks from `internal memory` to **Redis**.
- **Impact**: Enables multiple Hubs to run in parallel and ensures that if a server restarts, precisely the same state is recovered without "Ghost" devices.

### 2. Stateless Core Architecture
- **Technicality**: Externalize all session logs and videos to **S3/Object Storage** instead of local disk.
- **Impact**: Server nodes become "disposable workers." If a node fails, session data is preserved globally.

### 3. TTL "Lease" Management
- **Technicality**: Every device marked `busy` gets a Redis TTL of 120s. Proactively refreshed by any Appium command.
- **Impact**: If a test script crashes and fails to call `quit()`, the device unblocks itself automatically.

---

## 🔐 Phase 1.5: Security & Compliance (Non-Negotiable)
*Focus: Identity, Permissions, and Data Protection.*

### 1. Enterprise Identity (OIDC/SAML)
- **Technicality**: Integration with Okta/Azure AD/GitHub.
- **Impact**: Control who can access the dashboard and reserve devices.

### 2. RBAC (Role-Based Access Control)
- **Technicality**: Permissions for `Maintainer`, `Viewer`, and `QA`. Only Maintainers can manually block/reset hardware.
- **Impact**: Protects infrastructure from accidental configuration changes.

### 3. PII Masking (CV-Based)
- **Technicality**: Lightweight computer vision in the video stream to automatically detect and blur credit card/password fields.
- **Impact**: SOC2/GDPR compliance for FinTech and Healthcare customers.

---

## 👥 Phase 2: Team-Centric Capabilities (Confident)
*Focus: Multi-tenant resource sharing.*

### 1. Exclusive Device Reservation
- **Technicality**: Implementation of a 'Manual Mode' lock that overrides the Appium session allocation logic.
- **Impact**: Developers can "park" a difficult-to-catch bug on a specific device for hours without CI jobs stealing it.

### 2. Team-Based Isolation (Quota Management)
- **Technicality**: Filter `allocateDeviceForSession` calls based on a `xe:teamId` capability.
- **Impact**: Ensures "Team A" (iOS Devs) always has at least 3 devices available, even if "Team B" (QA) is running a massive regression.

### 3. Real-time Notifications (Slack/Teams Webhooks)
- **Technicality**: Implement a generic `NotificationService` that triggers on critical lifecycle events (Session Failed, Device Offline, Maintenance Required).
- **Integration**: Support for Slack and Microsoft Teams incoming webhooks via the dashboard configuration.
- **Impact**: Instant visibility for infrastructure owners and developers into test failures and hardware issues.

### 4. Enterprise App Repository 2.0
- **Technicality**: Advanced management of `.ipa`, `.apk`, and `.app` binaries with version history and automatic metadata extraction (Package ID, Version, Min SDK).
- **Impact**: One-click installation to any device directly from the UI, simplifying manual QA and sanity checks.

---

## ⚡ Phase 2.5: Hyper-Scale Single-Node Mastery (200+ Devices)
*Focus: Ensuring stability when a single host manages extreme hardware loads.*

### 1. USB Bus & Thermal Watchdog (The "200-Device Safety Net")
- **Technicality**: Use `system_profiler` (macOS) or `lsusb` (Linux) to map USB tree power consumption and detect bus-level resets.
- **Impact**: Prevents "Cascading Failures" where one faulty device or cable causes an entire USB hub (20+ devices) to drop offline.

### 2. Event Loop Optimization
- **Technicality**: Profile the Appium process. Offload video processing (FFMPEG) to sub-processes with strict affinity/priority.
- **Impact**: Prevents the UI from lagging when 20+ sessions are recording high-resolution video simultaneously.

### 3. Persistent SQLite Transition
- **Technicality**: Replace `lokijs` with an optimized **SQLite (Prisma)** implementation for local state.
- **Impact**: Handles 200+ concurrent writes/reads without the "Single-Threaded JSON Flush" penalty of LokiJS.
- **Status**: ✅ Complete


---

## � Phase 3: Developer Experience Enhancements
*Focus: Making the daily workflow frictionless.*

### 1. Local Development Mode ("Reserve Device")
> *"I just want to debug my test on a specific device without the queue"*

- [ ] "Reserve device for X hours" button in UI
- [ ] Direct ADB/USB passthrough mode
- [ ] Skip queue for local development sessions
- [ ] Hot-reload test changes without re-queuing
- [ ] WebSocket-based live log streaming to terminal

### 2. Test Artifacts Search & Discovery
> *"I know this test failed last week, but I can't find the video"*

- [ ] Full-text search across session logs
- [ ] Filter by: error type, device, date range, status, test name
- [ ] Bookmark/star important sessions
- [ ] Share session link with colleagues (public/private toggle)
- [ ] Export session data as JSON/CSV

### 3. Session Comparison View
> *"What changed between the passing and failing run?"*

- [ ] Side-by-side session diff view
- [ ] Highlight command differences
- [ ] Screenshot timeline comparison
- [ ] Log diff with syntax highlighting
- [ ] "Compare to last passing session" quick action

---

## �🛠 Phase 4: Extreme Debugging IQ (Expert Mode)
*Focus: Closing the gap between "Local USB" and "Remote Farm" debugging.*

### 1. The Interactive Shell (ADB/XCUI Console) (✅ Complete)
- **Technicality**: Use a WebSocket bridge to pipe `adb shell` and `xcrun simctl` commands from the UI to the Node.
- **Impact**: Run shell commands, mock GPS, or toggle system settings directly from the browser.

### 2. Network Fidelity Proxy
- **Technicality**: Middleware integration using `appium-base-driver` proxies or host-level `tc` commands to simulate 2G/3G/4G/Edge.
- **Impact**: Reproduce "Condition-specific" bugs (like timeouts or cache failures) deterministically.

### 3. Accessibility Testing Integration
- [ ] Auto-scan for a11y issues during test execution
- [ ] Color contrast violation detection
- [ ] Missing contentDescription/accessibilityLabel warnings
- [ ] TalkBack/VoiceOver simulation mode
- [ ] A11y score per session

### 4. Visual Regression Testing
- [ ] Baseline screenshot capture and storage
- [ ] Pixel-by-pixel diff highlighting
- [ ] Approve/reject visual changes workflow
- [ ] Integration with Percy/Applitools (optional)
- [ ] "Visual diff" tab in session details

---

## 📊 Phase 5: Analytics & Executive Insights
*Focus: Data to justify infrastructure investment.*

### 1. Executive Dashboard
> *"Show me the health of our test automation in 30 seconds"*

- [ ] Tests run today/week/month
- [ ] Pass rate trend charts
- [ ] Most failing tests (flaky vs real bugs)
- [ ] Device utilization rate (%)
- [ ] Average wait time in queue
- [ ] "Infrastructure Health" score

### 2. Cost Optimization Insights
> *"Are we using our devices efficiently?"*

- [ ] Device idle time report
- [ ] Peak usage hours heatmap
- [ ] Recommendations: "Add 2 Android devices, reduce 1 iOS"
- [ ] "X devices were idle for 6+ hours" alerts
- [ ] ROI calculator: Cost per test run

### 3. Mean Time Between Failures (MTBF) Analytics
- [ ] Track MTBF for each physical device
- [ ] USB cable failure detection
- [ ] "Bad batch" device identification
- [ ] Replacement recommendation reports
- [ ] Hardware budget justification data

---

## 🤖 Phase 6: World-Class Autonomous Intelligence (The Elite Tier)
*Focus: Features that set this product apart from all open-source alternatives.*

### 1. AI Root-Cause Analysis (Post-Mortem Agent)
- **Feasibility (100%)**: Appium Plugin intercepts the `deleteSession` event. We collect: `syslog`, `appium context`, `failure screenshot`, and `last 5 commands`.
- **Impact**: Instead of "ElementNotFound", the UI shows: *"Failure likely caused by a System Alert (Camera Permission) blocking the 'Login' button. Suggest adding a permission handler."*

### 2. Self-Healing Test Orchestration (HYMT Integration)
- **Feasibility (100%)**: The Appium Plugin intercepts `findElement` failures in real-time using the `handle` method. 
- **The Intelligence Stack**:
    - **Visual (Florence-2 / SAM)**: Use **Microsoft Florence-2** for high-speed visual grounding (finding coordinates from text descriptions) and **Meta SAM** for element segmentation.
    - **Semantic (Phi-3 / Phi-4)**: Use **Microsoft Phi-series** Small Language Models (SLMs) to analyze XML UI trees and perform "Fuzzy Mapping" of locator changes without external API costs.
- **Workflow**: If a primary locator fails, the SLM compares the old DOM with the current state while the Vision model confirms the physical location on the screen.
- **Impact**: Tests "heal" automatically during execution, reducing maintenance overhead by up to 80% with **zero license fees**.

### 3. "Sentry" Predictive Health (Hardware Self-Healing)
- **Feasibility (100%)**: Node sidecar runs periodic background checks on USB data transfer speeds and battery temperature using `ios-deploy` and `adb shell dumpsys battery`.
- **Impact**: Proactively marks a device as `Maintenance` if the cable is failing or the phone is overheating, preventing 100% of "Environment-related" test failures.

### 4. Privacy-First Monitoring (PII Masking)
- **Technicality**: Integrate lightweight Computer Vision (CV) logic in the video sidecar to automatically blur sensitive fields (Passwords, Credit Cards) in dashboard views and recordings.
- **Impact**: Out-of-the-box compliance with **GDPR/SOC2** regulations, making it safe for FinTech and Healthcare teams.

### 5. Zero-Config Visual Anchoring
- **Feasibility (100%)**: Automatically capture screenshots on every click/type command and store them as a sequence.
- **Impact**: Visual "Time Travel" through a test run with automatic DOM-diffing to highlight layout shifts between app versions.

---

## 🌍 Phase 7: Distributed Mesh Architecture
- **Goal**: Move from Hub-Node HTTP polling to a **gRPC/NATS Event Stream**.
- **Result**: Ultra-low latency video and log streaming that feels like the device is plugged directly into your laptop, regardless of where the hardware is geographically located.

---

## 🏆 Feature Priority Matrix

| Priority | Feature | Impact | Effort | Status |
|----------|---------|--------|--------|--------|
| P0 | Video Recording | High | Done | ✅ |
| P0 | Screenshot Capture | High | Done | ✅ |
| P0 | iOS Profiling | High | Done | ✅ |
| P0 | Android Profiling | High | Done | ✅ |
| P1 | Device Health Monitoring | Critical | 2 weeks | � |
| P1 | Flaky Test Detection | Critical | 2 weeks | 🔲 |
| P1 | Queue Visibility | High | 1 week | ✅ |
| P2 | Error Categorization | High | 3 weeks | ✅ |
| P2 | Slack/Webhook Integration | High | 2 weeks | ✅ |
| P2 | Session Search | Medium | 1 week | ✅ |
| P3 | Executive Dashboard | Medium | 2 weeks | 🔲 |
| P3 | Device Reservation | Medium | 1 week | 🔲 |
| P3 | Visual Regression | Medium | 3 weeks | 🔲 |
| P4 | AI Root Cause Analysis | Differentiator | 4 weeks | 🔲 |
| P4 | Self-Healing Locators | Differentiator | 6 weeks | 🔲 |

---

## �🚧 Immediate "Principal" Action Items

### In Progress 🚧
7. [ ] **Distributed Messaging**: POC for gRPC/NATS device event stream.
8. [ ] **S3 Adapter**: Support for uploading session videos to cloud storage.

### Completed ✅
1. [x] **Zombie Session Recovery**: Marking old sessions as Interrupted on boot.
2. [x] **WDA Optimization**: Skip build process if pre-signed IPA is available.
3. [x] **iOS Profiling Fix**: Stop profiling before session deletion.
4. [x] **Screenshot Normalization**: Fixed capability detection for all prefixes and casing.
5. [x] **Enterprise ProfilingView**: Lucide icons, peak stats, sample count.
6. [x] **Persistent SQLite Transition**: Replaced LokiJS with Prisma/SQLite for high-density performance.


### Next Up 📋
9.  [x] **Queue Position API**: Endpoint to return position and ETA.
10. [x] **Error Classification**: Categorize failures by type (crash/timeout/element/permission).
11. [x] **Webhook Service**: Generic webhook dispatch on session events.
12. [ ] **Auth Middleware**: Initial implementation of API key authentication.

---

## 💡 Critiques & Known Gaps

| Issue | Description | Priority |
|-------|-------------|----------|
| Session History is Flat | Hard to find sessions from 2 weeks ago | Medium |
| No Test-Level Grouping | Sessions exist, but no "test run" abstraction | Medium |
| Profiling is Passive | Can see data but no thresholds/alerts | Low |
| No Comparison View | Can't diff two sessions side by side | Medium |
| Device Filters are Basic | Can't filter by "devices that ran my test before" | Low |

---

*Last Updated: 2026-01-30*
*Maintainer: Xenon Team*
*Platform: Xenon - Intelligent Mobile Infrastructure*

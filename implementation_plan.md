# Implementation Plan: Device Control & Real-time Streaming

This plan outlines the steps to implement GADS-like device control and real-time streaming features into the Appium Xenon plugin.

## Phase 1: Backend Enhancements (Appium Plugin) ✅ COMPLETED

### 1. Data Model & Interfaces
- [x] Add `screenWidth`, `screenHeight` to `IDevice` interface in `src/interfaces/IDevice.ts`.
- [x] Add interaction methods to `IDeviceManager` interface.

### 2. Android Device Manager (`src/device-managers/AndroidDeviceManager.ts`)
- [x] Implement `getScreenSize()` using `adb shell wm size`.
- [x] Implement interaction methods: `tap`, `swipe`, `typeText`, `pressKey`.
- [x] Implement app management: `installApp`, `uninstallApp`.
- [x] Implement `getScreenshot()` and clipboard methods.

### 3. iOS Device Manager (`src/device-managers/IOSDeviceManager.ts`)
- [x] Add placeholder methods for iOS interactions (WDA will handle actual calls).

### 4. API Extensions (`src/app/routers/control.ts`)
- [x] Create a new router for device control.
- [x] Implement endpoints:
    - `POST /api/control/:udid/tap`
    - `POST /api/control/:udid/swipe`
    - `POST /api/control/:udid/text`
    - `POST /api/control/:udid/keyevent`
    - `GET /api/control/:udid/clipboard`
    - `POST /api/control/:udid/clipboard`
    - `GET /api/control/:udid/screenshot`
- [x] Register router in `src/app/index.ts`.

## Phase 2: Frontend Enhancements (React Web App) ✅ COMPLETED

### 1. API Service Update (`web/src/api-service/index.ts`)
- [x] Add methods for the new control endpoints.

### 2. Device Control Component (`web/src/components/device-control/`)
- [x] `device-control.tsx`: Main container with stream view and canvas.
- [x] `device-control.css`: Styling for the control interface.
- [x] Interaction canvas for capturing mouse events and translating to device coordinates.
- [x] Control toolbar with buttons for Home, Back, Swipe, Screenshot, Clipboard, etc.

### 3. Integration
- [x] Add "Control" button to `DeviceCard.tsx`.
- [x] Create modal overlay for device control.
- [x] Update frontend `IDevice` interface with `screenWidth`, `screenHeight`, `mjpegServerPort`.

## Phase 3: Polish & Advanced Features (TODO)
- [ ] High-quality screenshots (using Appium's native command).
- [ ] WebRTC support for lower latency streaming.
- [ ] Keyboard input passthrough (capture and send each key press).
- [x] App installation/uninstallation UI.
- [x] Touch and hold gestures.

## Phase 4: Independent iOS MJPEG Streaming ✅ COMPLETED

### Problem Solved
Previously, MJPEG streaming for iOS devices only worked when an active Appium session was running. 
This phase implements independent streaming (like GADS) that works without requiring an Appium session.

### Implementation
- [x] Created `IOSStreamService` - A singleton service that manages WDA and MJPEG streaming independently.
- [x] Added support for starting WDA using:
  - go-ios (preferred, simpler approach)
  - xcodebuild (fallback for development environments)
  - iproxy (alternative approach)
- [x] Added new API endpoints for stream management:
  - `POST /api/control/:udid/stream/start` - Start WDA and MJPEG streaming
  - `POST /api/control/:udid/stream/stop` - Stop streaming
  - `GET /api/control/:udid/stream/status` - Get stream status
- [x] Enhanced `/api/control/:udid/stream` endpoint to auto-start streaming if not running.

### Requirements for iOS Streaming
1. **WebDriverAgent.ipa** must be installed on the device
2. **go-ios** should be available (auto-downloaded to `~/.cache/appium-xenon/goIOS/`)
3. Device must have Developer Mode enabled (iOS 16+)
4. Device should be paired/trusted

## Files Modified/Created

### Backend (src/)
- `src/interfaces/IDevice.ts` - Added screenWidth, screenHeight
- `src/interfaces/IDeviceManager.ts` - Added interaction methods
- `src/device-managers/AndroidDeviceManager.ts` - Implemented getScreenSize, tap, swipe, etc.
- `src/device-managers/IOSDeviceManager.ts` - Added placeholder interaction methods
- `src/device-managers/ios/IOSStreamService.ts` - **NEW** Independent iOS streaming service
- `src/app/routers/control.ts` - New router for control endpoints + stream management
- `src/app/index.ts` - Registered ControlRouter

### Frontend (web/src/)
- `web/src/interfaces/IDevice.ts` - Added screenWidth, screenHeight, mjpegServerPort
- `web/src/api-service/index.ts` - Added control API methods
- `web/src/components/device-control/device-control.tsx` - New control component
- `web/src/components/device-control/device-control.css` - New styling
- `web/src/components/device-card/device-card/device-card.tsx` - Added Control button
- `web/src/components/device-card/device-card/device-card.css` - Added Control button styles


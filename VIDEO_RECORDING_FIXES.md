# Video Recording Flow - Fixes and Debugging Guide

## Summary of Changes

### 1. Fixed Duplicate Video Recording Logic (EVENT-MANAGER.TS)

**Problem**: Video was being stopped in `beforeSessionCommand` for the `deleteSession` command, and then `onSessionStoped()` tried to stop it again. This caused `isVideoRecordingInProgress()` to return `false` when `onSessionStoped()` checked.

**Solution**: Removed the duplicate video recording stop logic from `beforeSessionCommand`. Now video recording is exclusively handled in `onSessionStoped()`, which is called after the appium `deleteSession` completes.

**Code Changed**:

```typescript
// BEFORE - Duplicate handling
switch (commandName) {
  case 'deleteSession':
    if (session.isVideoRecordingInProgress()) {
      const videoBase64 = await session.stopVideoRecording();
      // ... save video
    }
    break;
}

// AFTER - Video handled in onSessionStoped instead
switch (commandName) {
  case 'deleteSession':
    // Video recording is handled in onSessionStoped() called after deleteSession
    break;
}
```

### 2. Enhanced Logging in Event Manager (EVENT-MANAGER.TS)

Added comprehensive logging throughout the video recording flow to help diagnose where failures occur:

**In `onSessionStarted()`**:

- ✅ Log when video recording starts successfully
- ⚠️ Log warning if video recording fails to start

**In `onSessionStoped()`**:

- 🟢 Log when onSessionStoped is called
- Log whether session found in SESSION_MANAGER
- Log whether video recording is in progress
- ✅ Log when video is successfully saved
- ⚠️ Log warning if video returns empty
- ❌ Log error if saving fails
- ℹ️ Log info when video recording wasn't in progress

### 3. Added Error Handling to Video Recording Start (EVENT-MANAGER.TS)

**Problem**: If `startVideoRecording()` throws an error, it fails silently.

**Solution**: Added try-catch around `startVideoRecording()` to log failures.

### 4. Made Video Recording Enabled by Default (CAPABILITY-MANAGER.TS)

**Problem**: Video recording had to be explicitly enabled on every test.

**Solution**: Modified `getDeviceFarmCapabilities()` to set `record_video: true` as the default value. Users can now:

- Omit the capability to get video recording by default
- Set `record_video: false` to explicitly disable it

**Code Changed**:

```typescript
export function getDeviceFarmCapabilities(caps: ISessionCapability) {
  const capabilities = _.merge(xenonOptions, individualCapabilities);

  // Set video recording to true by default if not explicitly set to false
  if (!(DEVICE_FARM_CAPABILITIES.VIDEO_RECORDING in capabilities)) {
    capabilities[DEVICE_FARM_CAPABILITIES.VIDEO_RECORDING] = true;
  }

  return capabilities;
}
```

**Problem**: If `startVideoRecording()` throws an error, it fails silently.

**Solution**: Added try-catch around `startVideoRecording()` to log failures.

## Expected Flow After Fixes

```
1. Session created with record_video=true capability
   ↓
2. onSessionStarted() called
   ├─ prepareDirectory() creates session directories
   ├─ startVideoRecording() called (with try-catch)
   │  └─ Sets isVideoAvailable = true on success
   └─ Session stored in DB with has_live_video flag
   ↓
3. Session executes test commands
   ↓
4. Session completes, deleteSession() called
   ├─ beforeSessionCommand('deleteSession') called
   │  └─ Does nothing for deleteSession now (video handled in onSessionStoped)
   ├─ next() - calls appium's deleteSession
   └─ onSessionStoped() called
      ├─ Check if session in SESSION_MANAGER
      ├─ Check if isVideoRecordingInProgress() true
      ├─ stopVideoRecording() - get base64 video data
      ├─ saveVideoRecording() - write to disk
      ├─ updateSessionDetails() - save path to DB
      ├─ Set session status to SUCCESS
      └─ Set endTime
   ↓
5. Frontend detects isSessionCompleted (endTime != null)
   ├─ Shows recorded video if video_recording field is populated
   └─ Displays live video URL if hasLiveVideo during session
```

## Verifying the Fix

### 1. Check Server Logs for Video Recording Messages

When running the server, look for logs containing:

- `✅ Video recording started for session [ID]`
- `🟢 onSessionStoped called for session [ID]`
- `✅ Video saved at [PATH] for session [ID]`
- `✅ Session [ID] updated successfully`

### 2. Verify Database Entry

After session completes, check the Session record:

```
SELECT id, title, status, video_recording, endTime FROM Session
WHERE id = '[SESSION_ID]' LIMIT 1;
```

Should show:

- `status` = 'success'
- `video_recording` = path like 'session-id/video/session-id.mp4'
- `endTime` = timestamp when session ended

### 3. Check Frontend Display

After refreshing dashboard:

- If session is completed (endTime set) AND video_recording populated
- Should see recorded video display (iframe or image preview)
- Should NOT see "Video recording was not enabled" message

## Troubleshooting

### Issue: "Video recording was not enabled" still shows

**Check**:

1. Note: Video recording is now **enabled by default**. If this message appears, something went wrong.
2. Did `startVideoRecording()` succeed? (check logs for ✅ or ⚠️ messages)
3. Did the remote/local device support video recording?
4. Is `video_recording` field empty in database?
5. If you want to disable video recording, set `record_video: false` in capabilities

### Issue: Video recording started but not saved

**Check**:

1. Did `stopVideoRecording()` return base64 data? (check for ⚠️ "Video recording returned empty")
2. Did `saveVideoRecording()` write file to disk? (check sessionAssetsPath)
3. Did `updateSessionDetails()` succeed? (check for ❌ errors in logs)

### Issue: Session status not updating to SUCCESS

**Check**:

1. Is `onSessionStoped()` being called? (check for 🟢 logs)
2. Is session found in database? (check for ⚠️ "not found in database")
3. Are there permission issues updating the database?

## Files Modified

1. **src/CapabilityManager.ts**

   - Modified `getDeviceFarmCapabilities()` to set `record_video: true` by default
   - Video recording is now enabled for all sessions unless explicitly disabled

2. **src/dashboard/event-manager.ts**

   - Removed duplicate video stop logic from `beforeSessionCommand`
   - Added error handling and logging to `startVideoRecording()`
   - Enhanced logging in `onSessionStoped()`

3. **src/sessions/RemoteSession.ts**

   - No changes needed (already properly implements video recording)

4. **Web UI** (already working)
   - Correctly displays video_recording field when populated
   - Already checks isSessionCompleted before showing recorded video

## Usage Examples

### Enable Video Recording (Default Behavior)

```javascript
const capabilities = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:app': '/path/to/app.ipa',
  // Video recording is automatically enabled by default
  // No need to add record_video: true
};
```

### Disable Video Recording

```javascript
const capabilities = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:app': '/path/to/app.ipa',
  record_video: false, // Explicitly disable video recording
};
```

### Customize Video Resolution

```javascript
const capabilities = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:app': '/path/to/app.ipa',
  // Video recording enabled by default, customize resolution
  video_resolution: '1920x1080',
};
```

## Next Steps to Validate

1. Run a test session - video recording will be enabled by default
2. Check server logs for the enhanced logging messages:
   - `✅ Video recording started for session [ID]`
   - `✅ Video saved at [PATH] for session [ID]`
3. Query database to verify video_recording field is populated
4. Refresh frontend dashboard and verify video displays
5. If you need to disable video recording, set `record_video: false` in capabilities
6. If video doesn't display, use server logs to identify which step failed

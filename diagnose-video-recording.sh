#!/bin/bash

# Simple diagnostic to check if video recording is working

set -e

echo "🔍 Diagnostic: Video Recording Flow Check"
echo "==========================================="

# 1. Check if startVideoRecording is being called during onSessionStarted
echo ""
echo "✅ Step 1: Checking onSessionStarted implementation..."
grep -A5 "VIDEO_RECORDING" src/dashboard/event-manager.ts | grep -E "startVideoRecording|VIDEO_RECORDING"

# 2. Check if stopVideoRecording is being called during onSessionStoped
echo ""
echo "✅ Step 2: Checking onSessionStoped implementation..."
grep -B2 -A8 "stopVideoRecording" src/dashboard/event-manager.ts | head -20

# 3. Check if saveVideoRecording is properly implemented
echo ""
echo "✅ Step 3: Checking saveVideoRecording implementation..."
grep -A5 "function saveVideoRecording" src/dashboard/asset-manager.ts

# 4. Check if video_recording field exists in the database schema
echo ""
echo "✅ Step 4: Checking database schema..."
grep "video_recording" prisma/schema.prisma

# 5. Check if updateSessionDetails is working
echo ""
echo "✅ Step 5: Checking updateSessionDetails implementation..."
grep -A3 "function updateSessionDetails" src/dashboard/services/session-service.ts

# 6. Check session lifecycle flow
echo ""
echo "✅ Step 6: Checking session lifecycle flow..."
echo ""
echo "Flow should be:"
echo "1. Session created with record_video=true"
echo "2. onSessionStarted() called -> startVideoRecording() called"
echo "3. Session executes commands"
echo "4. deleteSession() called"
echo "5. beforeSessionCommand('deleteSession') called (should NOT stop video anymore)"
echo "6. next() called (appium deleteSession)"
echo "7. onSessionStoped() called -> stopVideoRecording() -> saveVideoRecording() -> updateSessionDetails()"
echo ""

echo "🎬 Video Recording Diagnostic Complete"

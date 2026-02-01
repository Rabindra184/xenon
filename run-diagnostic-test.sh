#!/bin/bash

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Video Recording Diagnostic Test${NC}"
echo -e "${BLUE}========================================${NC}"

# Step 1: Build the project
echo -e "\n${YELLOW}1. Building project...${NC}"
npm run build > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Build failed${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Build successful${NC}"

# Step 2: Build web
echo -e "\n${YELLOW}2. Building web...${NC}"
npm run build-web > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo -e "${YELLOW}⚠️ Web build may have had issues, continuing anyway...${NC}"
fi

# Step 3: Start server
echo -e "\n${YELLOW}3. Starting server in background...${NC}"
npm run run-server > /tmp/server.log 2>&1 &
SERVER_PID=$!
echo -e "${GREEN}✅ Server started (PID: $SERVER_PID)${NC}"

# Step 4: Wait for server to start
echo -e "\n${YELLOW}4. Waiting 15 seconds for server to start...${NC}"
sleep 15

# Step 5: Check if server is running
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo -e "${RED}❌ Server died${NC}"
  echo -e "\n${BLUE}Server logs:${NC}"
  cat /tmp/server.log
  exit 1
fi
echo -e "${GREEN}✅ Server is running${NC}"

# Step 6: Show the logs so far
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Server Logs (capturing video recording activity)${NC}"
echo -e "${BLUE}========================================${NC}"
grep -E "CapabilityManager|Video recording|onSessionStoped|startVideoRecording|stopVideoRecording" /tmp/server.log || echo "No logs yet..."

# Step 7: Instructions for user
echo -e "\n${YELLOW}5. Run a test now with record_video capability...${NC}"
echo -e "\nExample capability to use:"
echo -e "const capabilities = {"
echo -e "  platformName: 'iOS',"
echo -e "  'appium:automationName': 'XCUITest',"
echo -e "  'appium:app': '/path/to/app',"
echo -e "};"
echo -e "\nVideo recording is enabled by default!"

# Step 8: Monitor logs in real time
echo -e "\n${YELLOW}6. Monitoring server logs for video recording activity...${NC}"
echo -e "${YELLOW}Waiting for session activity (this will auto-stop in 60 seconds)...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop monitoring earlier${NC}\n"

# Monitor logs for 60 seconds
tail -f /tmp/server.log 2>/dev/null | grep -E "CapabilityManager|Video recording|onSessionStoped|startVideoRecording|stopVideoRecording|✅|⚠️|❌|📹" &
TAIL_PID=$!
sleep 60
kill $TAIL_PID 2>/dev/null

# Step 9: Stop server
echo -e "\n${YELLOW}Stopping server...${NC}"
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
echo -e "${GREEN}✅ Server stopped${NC}"

# Step 10: Show full logs related to video recording
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}All Video Recording Related Logs${NC}"
echo -e "${BLUE}========================================${NC}"
grep -E "CapabilityManager|Video recording|onSessionStoped|startVideoRecording|stopVideoRecording|✅|⚠️|❌|📹" /tmp/server.log | tail -50

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}Diagnostic test complete!${NC}"
echo -e "${BLUE}========================================${NC}"

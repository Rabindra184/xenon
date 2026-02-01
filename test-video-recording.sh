#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Video Recording Diagnostic Test${NC}"
echo -e "${BLUE}========================================${NC}"

# Start server in background
echo -e "\n${YELLOW}1. Starting Appium Xenon server...${NC}"
npm run run-server > /tmp/server.log 2>&1 &
SERVER_PID=$!
echo -e "${GREEN}✅ Server started (PID: $SERVER_PID)${NC}"

# Wait for server to be ready
echo -e "\n${YELLOW}2. Waiting for server to be ready (30 seconds)...${NC}"
sleep 30

# Check if server is running
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo -e "${RED}❌ Server failed to start${NC}"
  cat /tmp/server.log
  exit 1
fi
echo -e "${GREEN}✅ Server is running${NC}"

# Run the video recording test
echo -e "\n${YELLOW}3. Running video recording test...${NC}"
npm test -- --grep "Video Recording Test" 2>&1 | tee /tmp/test.log
TEST_RESULT=$?

if [ $TEST_RESULT -ne 0 ]; then
  echo -e "${YELLOW}ℹ️ Test run completed (may have failed due to device not available)${NC}"
else
  echo -e "${GREEN}✅ Test completed${NC}"
fi

# Wait a bit for database to be updated
echo -e "\n${YELLOW}4. Waiting for database to be updated (5 seconds)...${NC}"
sleep 5

# Check server logs for video recording status
echo -e "\n${YELLOW}5. Checking server logs for video recording activities...${NC}"
echo -e "\n${BLUE}--- Video Recording Logs (onSessionStoped) ---${NC}"
grep -E "onSessionStoped|Video|Session.*found|not in progress|✅|⚠️|❌|ℹ️" /tmp/server.log | tail -30

# Query the database to check if video_recording was populated
echo -e "\n${YELLOW}6. Checking database for video_recording field...${NC}"
echo -e "\n${BLUE}--- Recent Sessions ---${NC}"
npx prisma db execute --stdin << 'EOF'
SELECT id, title, status, video_recording, endTime FROM Session ORDER BY createdAt DESC LIMIT 5;
EOF

# Stop the server
echo -e "\n${YELLOW}7. Stopping server...${NC}"
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
echo -e "${GREEN}✅ Server stopped${NC}"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Diagnostic Test Complete${NC}"
echo -e "${BLUE}========================================${NC}"

#!/bin/bash

# Xenon: Master Enterprise Setup Script (macOS)
# Version: 1.0.0
# Author: Xenon Principal Architect

set -e

# Colors for output
RED='\033[0-31m'
GREEN='\033[0-32m'
BLUE='\033[0-34m'
YELLOW='\033[1-33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏗️  Xenon: Master Enterprise Setup (macOS)${NC}"
echo -e "${BLUE}========================================${NC}"

# 1. Check Homebrew
if ! command -v brew &> /dev/null; then
    echo -e "${RED}❌ Homebrew is not installed.${NC} Please install it from https://brew.sh/"
    exit 1
fi
echo -e "${GREEN}✅ Homebrew detected.${NC}"

# 2. Native Dependencies
echo -e "${YELLOW}🔍 Verifying native binaries...${NC}"

DEPS=("ffmpeg" "go-ios" "node" "appium")

for dep in "${DEPS[@]}"; do
    if ! command -v "$dep" &> /dev/null; then
        echo -e "${YELLOW}⚠️  $dep is missing.${NC} Installing via brew/npm..."
        if [ "$dep" == "ffmpeg" ]; then
            brew install ffmpeg --with-videotoolbox
        elif [ "$dep" == "go-ios" ]; then
            brew install go-ios
        elif [ "$dep" == "appium" ]; then
            npm install -g appium
        fi
    else
        echo -e "${GREEN}✅ $dep detected.${NC}"
    fi
done

# 3. Node.js Version Check
NODE_VER=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version is $NODE_VER. Version 18+ is required.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js v$NODE_VER is compatible.${NC}"

# 4. Prepare Operational environment
echo -e "${YELLOW}📂 Preparing log directories...${NC}"
mkdir -p ../logs
mkdir -p ../lib/src/public

# 5. Build Assets
echo -e "${YELLOW}🛠️  Building Xenon core and frontend...${NC}"
cd ..
npm run build-web-and-plugin

# 6. PM2 Integration
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}⚠️  PM2 is missing.${NC} Installing globally..."
    npm install -g pm2
fi
echo -e "${GREEN}✅ PM2 detected.${NC}"

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}🚀 Setup Complete!${NC}"
echo -e "To start Xenon in headless mode, run:"
echo -e "${YELLOW}pm2 start deployment/ecosystem.config.js${NC}"
echo -e "Use ${YELLOW}pm2 logs xenon-hub${NC} to monitor activity."

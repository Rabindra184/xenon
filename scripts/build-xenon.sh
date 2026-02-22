#!/bin/bash
set -e

# Xenon Build & Asset Sync
# Rebuilds the frontend and copies artifacts to the plugin delivery directory.

echo "🚀 Starting Xenon Production Build..."

# 1. Install & Build Web Frontend
cd web
echo "📦 Installing web dependencies..."
npm install
echo "🏗 Building web dashboard..."
npm run build
cd ..

# 2. Sync Artifacts
echo "🔄 Syncing build artifacts..."
rm -rf src/public
mkdir -p src/public

# Using absolute-ish path for robustness in CI
if [ -d "web/build" ]; then
  cp -R web/build/* src/public/
  echo "✅ Xenon build complete."
else
  echo "❌ Error: web/build directory not found. Frontend build failed?"
  exit 1
fi

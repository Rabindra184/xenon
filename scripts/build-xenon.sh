#!/bin/bash
# Xenon Build & Asset Sync
# Rebuilds the frontend and copies artifacts to the plugin delivery directory.

echo "🚀 Starting Xenon Production Build..."
cd web
npm install
npm run build
cd ..
rm -rf src/public
mkdir -p src/public
cp -R web/build/* src/public/
echo "✅ Xenon build complete."

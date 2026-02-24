const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Robust Prisma Client Generator (v1.1.8)
 * 
 * This script runs 'prisma generate' with extreme diagnostics.
 * It ensures the custom output directory exists and won't crash npm install.
 */
function generate() {
    const rootDir = path.resolve(__dirname, '..');
    const outputDir = path.resolve(rootDir, 'src/generated/client');

    console.log('📦 [Xenon] Initializing Prisma generation...');
    console.log(`📂 [Xenon] Root: ${rootDir}`);
    console.log(`📂 [Xenon] Target: ${outputDir}`);

    // Ensure output directory exists
    if (!fs.existsSync(path.resolve(rootDir, 'src/generated'))) {
        fs.mkdirSync(path.resolve(rootDir, 'src/generated'), { recursive: true });
    }

    try {
        // Find prisma CLI
        let prismaBin = path.resolve(rootDir, 'node_modules/.bin/prisma');
        if (!fs.existsSync(prismaBin)) {
            console.log('ℹ️ [Xenon] Prisma binary not found in node_modules, checking global/npx...');
            prismaBin = 'npx prisma';
        }

        const command = `${prismaBin} generate`;
        console.log(`🚀 [Xenon] Executing: ${command}`);

        execSync(command, {
            stdio: 'inherit',
            cwd: rootDir,
            env: { ...process.env, PRISMA_SKIP_POSTINSTALL_GENERATE: 'true' }
        });

        console.log('✅ [Xenon] Prisma client generated in src/generated/client.');
    } catch (error) {
        console.error('⚠️ [Xenon] Prisma generation encountered an issue.');
        console.error('⚠️ [Xenon] This is expected in some Appium/NPM environments.');
        console.error('⚠️ [Xenon] Error:', error.message);

        // Always exit 0 to prevent npm install failure
        process.exit(0);
    }
}

generate();

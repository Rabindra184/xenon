const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Robust Prisma Client Generator
 * 
 * This script runs 'prisma generate' but ensures that it doesn't 
 * crash the npm install process if it fails.
 */
function generate() {
    console.log('📦 [Xenon] Running Prisma client generation...');

    try {
        // Determine the path to prisma CLI
        let prismaBin = path.resolve(__dirname, '../node_modules/.bin/prisma');
        if (!fs.existsSync(prismaBin)) {
            prismaBin = 'npx prisma'; // Fallback to npx
        }

        const command = `${prismaBin} generate`;
        console.log(`🚀 [Xenon] Executing: ${command}`);

        execSync(command, {
            stdio: 'inherit',
            cwd: path.resolve(__dirname, '..')
        });

        console.log('✅ [Xenon] Prisma client generated successfully.');
    } catch (error) {
        console.error('⚠️ [Xenon] Prisma client generation failed.');
        console.error('⚠️ [Xenon] This is usually fine during installation; the client will be verified at runtime.');
        console.error('⚠️ [Xenon] Error detail:', error.message);

        // Crucial: Exit with 0 so npm install proceeds
        process.exit(0);
    }
}

generate();

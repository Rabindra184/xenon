const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { normalizeDirToLf } = require('./lib/normalize-eol');

/**
 * Robust Prisma Client Generator (v1.1.9)
 * 
 * This script runs 'prisma generate' and ensures the output is placed
 * where both source code and compiled code (lib) can find it.
 */
function generate() {
    const rootDir = path.resolve(__dirname, '..');
    const srcOutputDir = path.resolve(rootDir, 'src/generated/client');
    const libOutputDir = path.resolve(rootDir, 'lib/src/generated/client');

    console.log('📦 [Xenon] Initializing Prisma generation...');
    console.log(`📂 [Xenon] Root: ${rootDir}`);

    // Ensure src/generated exists (Prisma will create 'client' subfolder)
    if (!fs.existsSync(path.dirname(srcOutputDir))) {
        fs.mkdirSync(path.dirname(srcOutputDir), { recursive: true });
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

        // Normalize generated text to LF before anything else copies it.
        // @prisma/client ships some runtime *.d.ts with CRLF, so a raw generate
        // leaves the committed (LF) client dirty on every build and fails
        // check-client-freshness.js. Native query-engine .node binaries are
        // skipped by the normalizer.
        const normalizedCount = normalizeDirToLf(srcOutputDir);
        if (normalizedCount > 0) {
            console.log(`🧹 [Xenon] Normalized ${normalizedCount} generated file(s) to LF.`);
        }

        // CRITICAL: If we are in an installed environment (lib exists),
        // we must copy the generated client to lib/src/generated/client 
        // because the compiled code imports from there.
        if (fs.existsSync(path.resolve(rootDir, 'lib'))) {
            console.log('📂 [Xenon] Detected "lib" directory. Syncing generated client...');

            if (!fs.existsSync(path.dirname(libOutputDir))) {
                fs.mkdirSync(path.dirname(libOutputDir), { recursive: true });
            }

            // Simple recursive copy
            copyRecursiveSync(srcOutputDir, libOutputDir);
            console.log('✅ [Xenon] Prisma client synced to lib/src/generated/client.');
        }

    } catch (error) {
        console.error('⚠️ [Xenon] Prisma generation encountered an issue.');
        console.error('⚠️ [Xenon] This is expected in some restricted environments.');
        console.error('⚠️ [Xenon] Error:', error.message);

        // Always exit 0 to prevent npm install failure
        process.exit(0);
    }
}

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

generate();

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { normalizeDirToLf } = require('./lib/normalize-eol');
const { syncDirectory, verifyGeneratedClient } = require('./lib/sync-dir');

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

            // Replaces the destination rather than overwriting file by file.
            // The regenerated client is a different size from the one the
            // tarball shipped, so a per-file copy can leave remnants of the
            // version it replaced — see scripts/lib/sync-dir.js.
            syncDirectory(srcOutputDir, libOutputDir);
            console.log('✅ [Xenon] Prisma client synced to lib/src/generated/client.');
        }

        // The plugin cannot start without this, and a damaged client is valid
        // JavaScript that only fails when required — so it is loaded here,
        // while the install is still on screen, rather than discovered later
        // as "Could not load plugin 'xenon'" with an unrelated-looking
        // TypeError.
        const verifyTarget = fs.existsSync(path.resolve(rootDir, 'lib'))
            ? libOutputDir
            : srcOutputDir;
        const verdict = verifyGeneratedClient(verifyTarget);
        if (!verdict.ok) {
            console.error('');
            console.error('❌ [Xenon] The generated Prisma client is present but cannot be loaded.');
            console.error(`❌ [Xenon] ${verifyTarget}`);
            console.error(`❌ [Xenon] ${verdict.error}`);
            console.error('❌ [Xenon] Xenon will fail to start. Reinstall the plugin into a clean');
            console.error('❌ [Xenon] directory to rebuild it:');
            console.error('❌ [Xenon]   appium plugin uninstall xenon');
            console.error('❌ [Xenon]   rm -rf "$APPIUM_HOME/node_modules/@xenon-device-management"');
            console.error('❌ [Xenon]   appium plugin install --source=npm @xenon-device-management/xenon');
            console.error('');
        }

    } catch (error) {
        console.error('⚠️ [Xenon] Prisma generation encountered an issue.');
        console.error('⚠️ [Xenon] This is expected in some restricted environments.');
        console.error('⚠️ [Xenon] Error:', error.message);

        // Always exit 0 to prevent npm install failure
        process.exit(0);
    }
}

generate();

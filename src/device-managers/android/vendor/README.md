# scrcpy-server Vendored Jar

This directory contains the vendored `scrcpy-server` jar used for direct H.264 streaming on Android devices.

## Pinned Version

- **Version**: `2.7`
- **SHA256**: `a23c5659f36c260f105c022d27bcb3eafffa26070e7baa9eda66d01377a1adba`
- **Source URL**: `https://github.com/Genymobile/scrcpy/releases/download/v2.7/scrcpy-server-v2.7`
- **File**: `scrcpy-server-2.7.jar`

> **Why 2.7 and not 3.x/4.x:** scrcpy **3.x** aborts on init (`stack corruption
> detected (-fstack-protector)`) on some devices — reproduced on a Samsung Galaxy
> S9+ (Exynos, Android 10) — which forced a fallback to the slower screenrecord/MJPEG
> path. scrcpy **2.7** is stable across the lab's mix (verified on Pixel 5 **and**
> Galaxy S9+). All of Xenon's launch args are present in the 2.7 server (dex-verified),
> so no arg changes are needed. Re-evaluate 3.x/4.x only after confirming the
> stack-corruption regression is fixed across the device fleet.

## Bump Procedure

To update the scrcpy-server version:

1. Download the new `scrcpy-server-v<newver>` jar from the [official scrcpy GitHub releases](https://github.com/Genymobile/scrcpy/releases)
2. Verify the SHA256 against the official `SHA256SUMS.txt` file
3. Rename to `scrcpy-server-<newver>.jar` and place in this directory
4. Update `SCRCPY_SERVER_VERSION` constant in `src/device-managers/android/scrcpyVersion.ts`
5. Re-run `test/unit/scrcpy-version.spec.ts` to verify the jar location is resolved correctly
6. Re-run `test/unit/scrcpy-server-session.spec.ts` (Task 2 tests) to validate compatibility
7. Re-run the on-device spike (Task 8) to validate end-to-end streaming behavior

## Future Bump Candidates

scrcpy 3.x/4.x are newer but currently **regressed** for us: 3.x aborts on init on
some Exynos/older-Android devices (see the "Why 2.7" note above). Only move off 2.7
once a newer version is confirmed stable on the full device fleet (esp. Exynos Samsung).

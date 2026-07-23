# scrcpy-server Vendored Jar

This directory contains the vendored `scrcpy-server` jar used for direct H.264 streaming on Android devices.

## Pinned Version

- **Version**: `3.3.4` (latest scrcpy 3.x)
- **SHA256**: `8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e`
- **Source URL**: `https://github.com/Genymobile/scrcpy/releases/download/v3.3.4/scrcpy-server-v3.3.4`
- **File**: `scrcpy-server-3.3.4.jar`

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

Scrcpy 4.0 and 4.1 are available as future upgrade targets. Version 3.3.4 was chosen as the latest stable 3.x release for this initial implementation.

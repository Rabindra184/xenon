/**
 * The pinned go-ios release, and the binary Xenon ships from it.
 *
 * Why the pin matters: go-ios **v1.0.134** does not keep the iOS 17+/26 XCTest
 * session alive. WebDriverAgent launched via `runwda` is terminated by the OS a
 * few minutes later, while the host-side `runwda` process stays alive with
 * `exitCode === null` and logs nothing — so it presents as a WDA "hang" that
 * nothing detects. Measured on iOS 26.5.2 against an identical WDA 11.4.1
 * build (issue #187):
 *
 *   go-ios v1.0.134  -> WDA died at 2m51s
 *   xcodebuild        -> WDA alive at 11m+   (i.e. not WDA's fault)
 *   go-ios v1.2.1     -> WDA alive at 12m+
 *
 * scripts/fetch-go-ios.js takes the binary out of this release's npm tarball
 * when Xenon is built, and checks it against GO_IOS_SHA256 before it ships.
 * Xenon Control reads GO_IOS_VERSION from the compiled file as text, so it
 * stays a literal on a line of its own.
 */

/** The go-ios release Xenon ships. Do not lower below v1.2.1 — see above. */
export const GO_IOS_VERSION = 'v1.2.1';

/** The npm release of that version, which fetch-go-ios.js packs. */
export const GO_IOS_PACKAGE_SPEC = 'go-ios@1.2.1';

/** The Mac binary's entry in that release's tarball, a universal x86_64 + arm64 build. */
export const GO_IOS_PACKAGE_ENTRY = 'package/dist/go-ios-darwin-arm64_darwin_arm64/ios';

/** The SHA-256 of that binary (44,504,402 bytes); any other fails the build. */
export const GO_IOS_SHA256 = 'b8a279520a875c62d281a7a9e23fe187401ab1c4af1eb328e329ce6e364d8611';

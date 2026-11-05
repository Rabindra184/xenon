# Vendored go-ios

`ios` is go-ios, the tool Xenon runs for everything it does with a real
iPhone: the live preview and WebDriverAgent (`runwda`), the phone's tunnel,
its device log, CPU and memory, screenshots, installs and app lists. Every
caller finds it through `goIosBinaryPath()` (`../../goIosBinary.ts`).

## Why vendor it

Through 2.17 go-ios was installed by hand: `lib/src/scripts/install-go-ios.js`
(the README's step 2, or Xenon Control's Set up) downloaded it into
`~/.cache/xenon/goIOS`, once and again after every upgrade. When that was
missed, an iPhone's preview was unavailable and every session on it was
refused; after an upgrade that moved the pin, the old go-ios kept running.

npm's own `go-ios` package isn't a dependency either. Its install script copies
`ios` into npm's global `bin` folder, over any `ios` already on the PATH, and
fails the install when that folder isn't writable. Its tarball also holds every
platform's build, 58 MB, for the one file Xenon needs.

## Provenance

- **Source**: `go-ios@1.2.1` on npm, entry
  `package/dist/go-ios-darwin-arm64_darwin_arm64/ios`, copied byte for byte.
  The `darwin-amd64` folder holds the same file.
- **Upstream**: danielpaulus/go-ios v1.2.1 (MIT License), in
  `LICENSE-go-ios.txt`.
- **File**: `ios`, 44,504,402 bytes, a universal x86_64 + arm64 Mac binary
  - SHA256: `b8a279520a875c62d281a7a9e23fe187401ab1c4af1eb328e329ce6e364d8611`
  - The same file Xenon 2.17's installer put at `~/.cache/xenon/goIOS/ios`.

## How it gets here

The binary itself is not committed (it is gitignored): 44 MB per version would
stay in the history for good. `scripts/fetch-go-ios.js` runs in
`npm run build`, after `tsc -b`, and does nothing if the `ios` here already has
the pinned SHA-256. Otherwise it:

1. runs `npm pack go-ios@1.2.1` into a temporary folder here. npm checks the
   tarball against the registry's integrity, uses your registry, mirror and
   proxy settings, and runs none of the package's scripts;
2. extracts that one entry;
3. checks its SHA-256 against `GO_IOS_SHA256` (`src/scripts/goIosVersion.ts`);
4. makes it executable (0755) and renames it into place.

Any failure (the registry can't be reached, the entry is missing, the hash
differs) fails the build and leaves nothing behind. The first build downloads
58 MB, which npm keeps in its cache.

`build:copy` removes the old binary in `lib/`, then copies this folder into
`lib/` with `cp -p`, keeping the mode. Copying over the old file would keep its
inode, and macOS caches a binary's code signature per vnode, so after a pin
bump the new go-ios could be killed at launch. `lib/` is what the npm package
ships. Before a release, `prepublishOnly` runs
`node scripts/fetch-go-ios.js --check-package`: the copy in `lib/` must be
there, executable and the pinned one, and `npm pack` must list it with an
executable mode. Nothing is downloaded at run time.

## Bump procedure

1. Check the release is on npm (`npm view go-ios versions`). A release that is
   on GitHub but not yet on npm can't be pinned until npm has it.
2. In `src/scripts/goIosVersion.ts`, change `GO_IOS_VERSION`,
   `GO_IOS_PACKAGE_SPEC`, `GO_IOS_PACKAGE_ENTRY` if the tarball's layout
   changed, and `GO_IOS_SHA256`. To read them, `npm pack go-ios@<version>` in
   a scratch folder, list it (`tar -tzf`), extract the Mac binary and take its
   `shasum -a 256`. The build fails until the hash matches.
3. Replace `LICENSE-go-ios.txt` if it changed:
   `gh api 'repos/danielpaulus/go-ios/contents/LICENSE?ref=v<version>' --jq .content | base64 -d`.
4. Update the version, entry, size and SHA256 under Provenance above.
5. Update the specs that expect the version in a message:
   `test/unit/install-go-ios.spec.ts` and `test/unit/go-ios-binary.spec.ts`.
6. `npm run build` fetches the new binary. Then check on a lab iPhone that
   WebDriverAgent stays up past 10 minutes (#187): go-ios v1.0.134 let it die
   within three.

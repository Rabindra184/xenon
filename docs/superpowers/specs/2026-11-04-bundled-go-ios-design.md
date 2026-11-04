# Bundled go-ios

**Date:** 2026-11-04
**Status:** Design approved in conversation; written spec awaiting review
**Scope:** the plugin (`src/`, `scripts/`, `package.json`), Xenon Control
(`mac-app/`), README, website docs and CLAUDE.md.

## Context

Xenon 2.17.1 was installed on another Mac. Opening an iPhone in device
control showed "stream unavailable", and the log said
`Failed to start stream: Last error: go-ios not available`.

Xenon runs go-ios for everything it does with a real iPhone: the live preview
and WebDriverAgent (`runwda`), the per-phone tunnel, the device log, CPU and
memory, screenshots, installs and app lists. Every one of those finds it at
one path, `goIosBinaryPath()` = `~/.cache/xenon/goIOS/ios`
(`src/device-managers/ios/goIosBinary.ts`). Nothing in the server puts it
there. A person has to run `lib/src/scripts/install-go-ios.js` (README step
2), or Xenon Control's Set up runs it, once and again after every upgrade.

When that step is missed:

- the stream fails at `IOSStreamService.startStream` (`isGoIOSAvailable()`
  is false);
- every session on an iPhone is refused as unhealthy, because its
  WebDriverAgent never starts (`IOSDeviceManager.readyForSession`);
- after an upgrade that moves the pin, the old go-ios keeps running. go-ios
  1.0.134 let WebDriverAgent die within minutes (#187), which is why the pin
  exists.

The installer itself has gaps: it doesn't check what it downloads, doesn't
wait for the unzip (it polls for the file), takes no proxy, and installs into
the home folder of whoever ran it, which may not be the server's.

## Goals

1. A Mac that installs or upgrades Xenon runs iPhones with no other step.
2. The go-ios a Xenon release runs is the one it pins, checked by SHA-256
   when the release is built.
3. Nothing is downloaded at run time.
4. Installing Xenon runs no script of go-ios's and writes nothing outside the
   plugin's own folder.

## Non-goals

- A Mac-only package that spares Linux and Android-only installs the 44 MB.
  It would need a second package to publish (an `optionalDependency` with
  `os: ["darwin"]`).
- Moving go-ios past v1.2.1.
- Deleting `~/.cache/xenon/goIOS`. An older Xenon on the same Mac may still
  use it.
- go-ios on Linux. iPhones need a Mac (XCUITest), and the installer's Linux
  download had no user.

## Why not a dependency on the `go-ios` npm package

go-ios publishes to npm, 1.2.1 included. Its tarball holds the same universal
Mac binary Xenon runs today, byte for byte (SHA-256
`b8a279520a875c62d281a7a9e23fe187401ab1c4af1eb328e329ce6e364d8611`, the same
in `dist/go-ios-darwin-arm64_darwin_arm64/ios`,
`dist/go-ios-darwin-amd64_darwin_amd64/ios` and `~/.cache/xenon/goIOS/ios`),
stored with mode 0755. As a dependency of Xenon it would be wrong:

- **Its install script writes outside Xenon.** `postinstall.js` copies `ios`
  into npm's global `bin` folder (`$npm_config_prefix/bin`). npm 10 and 11,
  the default with Node 20 and 22, run it during `appium plugin install`:
  every lab Mac gets an `ios` on its PATH, over any `ios` already there, and
  the Xenon install fails when that folder isn't writable (the script exits 1
  on the rename's error). Under pnpm it throws (go-ios#813, open). npm 12
  skips it. Read from the script; not run here.
- **156 MB unpacked, 58 MB to download**: Linux and Windows builds, and the
  Mac binary twice. Xenon needs the one 44 MB file.
- **No API to call.** The package's `index.js` doesn't load in 1.2.1 (an ES
  `export` in a CommonJS file, and a `darwin-fat` folder the tarball doesn't
  have), so Xenon would depend on its internal `dist/` names anyway.
- **npm has lagged GitHub** (go-ios#683: npm at 1.0.188 while GitHub was at
  1.0.202). Today both are at 1.3.2.

So Xenon takes the binary from that npm tarball when it is built, and ships
it.

## Design

### 1. Where the binary comes from (build)

The pin stays in `src/scripts/goIosVersion.ts`, compiled to
`lib/src/scripts/goIosVersion.js`, which Xenon Control reads as text for
`GO_IOS_VERSION`. It gains:

- `GO_IOS_PACKAGE_SPEC`: `go-ios@1.2.1`.
- `GO_IOS_PACKAGE_ENTRY`: `package/dist/go-ios-darwin-arm64_darwin_arm64/ios`,
  the universal binary's entry in that tarball.
- `GO_IOS_SHA256`: the binary's SHA-256, above.

`goIOSDownloadUrl` and `needsGoIOSInstall` go, with the download. The
decision to keep or fetch moves to the build script's own module
(`scripts/lib/go-ios-bundle.js`), the only thing that makes it, which takes
`npm pack` and `tar` as an injected function so it is tested without a
network.

`scripts/fetch-go-ios.js` runs in `npm run build` after `tsc -b`, reading the
pin from the compiled `goIosVersion.js`, and before `build:copy`:

1. If `src/device-managers/ios/vendor/go-ios/ios` exists and its SHA-256 is
   the pin, there is nothing to do.
2. Otherwise, in a temporary folder beside it (one filesystem, so the last
   step is one rename):
   - `npm pack go-ios@1.2.1 --pack-destination <tmp> --json`. npm checks the
     tarball against the registry's `integrity`, uses the developer's
     registry, mirror and proxy settings, and runs none of the package's
     scripts.
   - `tar -xzf` of that one entry only.
   - The SHA-256 must be the pin.
   - `chmod 0755`, then rename into place. The temporary folder is removed
     however the step ends.
3. Any failure (the registry can't be reached, the entry is missing, the hash
   differs) exits non-zero, naming what to check, and fails the build.

The binary is gitignored (`/src/device-managers/ios/vendor/go-ios/ios`): 44
MB per version would stay in the history for good. Committed beside it, as
the OCR data's folder does: go-ios's MIT licence (`LICENSE-go-ios.txt`, from
the go-ios repository at v1.2.1) and a `README.md` saying where the binary
comes from and how it is checked.

`build:copy` copies the folder to `lib/src/device-managers/ios/vendor/go-ios/`
with `cp -p`, keeping the mode.

The first build downloads 58 MB (npm keeps a copy in its cache) and briefly
holds another 44 MB.

### 2. How Xenon finds it (run time)

- `goIosBinaryPath()` returns `path.join(__dirname, 'vendor', 'go-ios',
  'ios')`. Every go-ios caller already goes through it (`IOSStreamService`,
  `IOSTunnels`, `IOSLogStreamService`, `WDAClient`,
  `SessionMetricsService`), so no caller changes. From `src/` under ts-node
  it is the fetched copy; from `lib/` the shipped one.
- `legacyGoIosBinaryPath()` is the old `~/.cache/xenon/goIOS/ios`, used only
  by the startup cleanup.
- `isGoIOSAvailable()` is false:
  - off macOS (the binary is a Mac build; on Linux it would fail to run
    rather than be reported missing);
  - when the file is missing;
  - when it isn't executable and one `chmod 0755` doesn't make it so.

  Its warning names the path and says to reinstall the plugin.
- On a Mac whose `platform` is `ios` or `both`, startup logs one line after
  the cleanup: `go-ios v1.2.1 (comes with Xenon): <path>`, or that warning.
  No hash at run time: the build checked it, and anyone who can change the
  plugin's folder can change the check too.
- go-ios runs with the same arguments, environment and working directory as
  today. Nothing it writes depends on where its binary is.

### 3. Startup cleanup

At start Xenon kills every go-ios left from an earlier run by its binary's
path (`reapAllOrphanTunnels`: `pgrep -f` / `pkill -9 -f`).

- **At start, both paths**: the bundled one, and the legacy one for go-ios
  left by a run from before the upgrade. The legacy path is kept until 3.0.
- **At shutdown, the bundled path only.** At shutdown there is nothing of
  this server's at the legacy path, only an older Xenon's.
- **The pattern is escaped.** `pgrep -f` takes a regular expression, and the
  bundled path sits under `APPIUM_HOME`, which can hold `+`, `(` or `[`.
- **Side effect:** two servers on one Mac with different `APPIUM_HOME`s no
  longer kill each other's go-ios when one starts. Two that share one still
  do, as today, and a new server's start still kills an older Xenon's go-ios
  at the legacy path, as today.

### 4. The old installer

`lib/src/scripts/install-go-ios.js` stays where it is and downloads nothing.
It says whether this Xenon's go-ios is there: exit 0 with "go-ios v1.2.1
comes with this Xenon (<path>). Nothing to install.", exit 1 with the missing
or not-executable message, which names the path and ends "Reinstall the
plugin." (`goIosStateMessage`). Off macOS it exits 0: there is nothing to
install there. The README's old command and older Xenon Control versions' Set
up still succeed.

`download` and `unzipper` were used only by it and leave `dependencies`, as
does any other package only it used.

### 5. Publishing

`prepublishOnly` (`npm run build:all` in the publish job) then runs
`node scripts/fetch-go-ios.js --check-package`. Publishing stops unless:

- `lib/src/device-managers/ios/vendor/go-ios/ios` is there, executable, and
  matches the pin;
- `npm pack --dry-run --json --ignore-scripts --foreground-scripts=false`
  lists it with an executable mode. An entry npm lists without a mode fails
  the check: npm's own listing is what is being judged.

`--ignore-scripts` skips `prepack` and `postpack`, but under npm 10 `npm
pack` still runs Xenon's own `prepare` (`prisma generate`; pacote 18 doesn't
read the flag for it), so the check repeats that generate in the publish job.
`npm pack` runs scripts in the foreground unless told otherwise, and
`prepare`'s output would then come before the JSON on stdout:
`--foreground-scripts=false` keeps it out.

The package grows by about 44.5 MB unpacked (101 MB to about 146 MB) and
about 16 MB to download.

### 6. Xenon Control

A plugin ships go-ios when its folder has
`lib/src/device-managers/ios/vendor/go-ios/LICENSE-go-ios.txt`. The licence,
not the binary, is the marker, so a missing binary reads as a broken install,
not an old one.

- **Set up** (`planGoIosStep`, new input `bundled`): a Xenon that ships
  go-ios needs no go-ios step (`not-needed`). An older one runs the installer
  as today.
- **The iPhone support check** (`checkGoIos`, `assessIphoneSupport` with a
  `source: 'bundled' | 'cache'` input):
  - bundled and executable: ok, "Ready for iPhones (go-ios v1.2.1)";
  - bundled but missing or not executable: warn, code `incomplete`, "This
    Xenon install is incomplete", with "iPhones won't work with this install.
    Reinstall Xenon for this profile." Setup's iPhone support row for that
    code says "This Xenon install is missing iPhone support. Reinstall Xenon
    for this profile." and offers Check again, never Set up: Set up updates
    an installed Xenon rather than reinstalling it, so it can't repair this,
    and the row would never change;
  - an older Xenon: today's cache rules, unchanged;
  - an Android-only profile: not needed, unchanged.
- Released with this Xenon release. An older Xenon Control on the new Xenon
  still sets up (the old installer succeeds), but its check reads the cache
  and says "Not installed yet" on a Mac that has none. The release notes say
  to update Xenon Control.

### 7. Docs

- README: the iOS requirements row, the quick start's go-ios paragraph
  (removed), the troubleshooting row, the upgrade note.
- Website: `installation`, `quick-start`, `troubleshooting`, `upgrading`,
  `xenon-control`, `devices` and `architecture`. `device-control` and
  `cpu-and-memory` only say what go-ios does, and stay.
- Release notes: an entry in `CHANGELOG.md`, which the site's
  `release-notes` page is generated from (`website/scripts/generate.mjs`),
  headed Unreleased until the release commit names the version.
- CLAUDE.md: where go-ios is, the startup cleanup's two paths, and how to
  move the pin.

## Moving the pin later

Change `GO_IOS_VERSION`, `GO_IOS_PACKAGE_SPEC`, `GO_IOS_PACKAGE_ENTRY` if the
tarball's layout changed, `GO_IOS_SHA256` and, if it changed, the licence.
Update the vendor folder's README (its Provenance) and the specs that expect
the version in a message: `test/unit/install-go-ios.spec.ts` and
`test/unit/go-ios-binary.spec.ts`. The folder's README has the steps. The
build fails until the hash matches. Then check on a lab iPhone that
WebDriverAgent stays up past 10 minutes (#187). A release that is on GitHub
but not yet on npm can't be pinned until npm has it.

## Risks

| Risk | Covered by |
|---|---|
| npm drops the executable bit | The publish check; at run time, one `chmod` and a warning |
| A later tarball moves the binary (its `index.js` already expects `darwin-fat`) | The entry is part of the pin; a missing entry fails the build |
| npm lags GitHub | The pin waits for npm |
| Older Xenon Control reports iPhones not set up | Released together; release notes |
| 44 MB more for every install, Linux included | Accepted (non-goal) |
| A new server's start kills an older Xenon's go-ios on the same Mac | Same as today |
| macOS blocks the binary | Files npm writes carry no quarantine attribute, as with today's download; checked live |

## Testing

**Unit**

- `goIosVersion`: the pin's shape (version, spec, entry, a 64-hex SHA-256);
  `goIosFetchPlan` keeps a matching file and fetches a missing or different
  one.
- `fetch-go-ios.js`: with `npm pack` and `tar` stubbed, a wrong hash or a
  missing entry fails and leaves nothing in place; a good one is renamed in
  at 0755; a matching file runs neither.
- `goIosBinary`: the bundled path is beside the module; the legacy path is
  under the home folder.
- `tunnelProcess` / `IOSStreamService`: patterns are escaped; start reaps
  both paths, shutdown the bundled one. `process.kill` and the exec are
  stubbed (CLAUDE.md).
- `isGoIOSAvailable`: false off macOS, false when missing, `chmod` tried
  once when not executable.
- `install-go-ios.js`: exit 0 and 1, with their messages.
- `mac-app`: `planGoIosStep` with `bundled`; `assessIphoneSupport`'s
  bundled outcomes, the cache outcomes unchanged.

**Build**

- From an empty vendor folder `npm run build` fetches and checks the binary;
  a second build fetches nothing; a wrong `GO_IOS_SHA256` fails the build.
- `npm run build:all && node scripts/fetch-go-ios.js --check-package` passes,
  and fails on a copy in `lib/` that isn't executable.

**Live** (needs free disk: the pack, a scratch `APPIUM_HOME`, about 1 GB)

- Pack Xenon. Install the tarball into a scratch `APPIUM_HOME` with Appium's
  npm 10, and again with npm 12: the binary is executable, and no `ios`
  appears in npm's global `bin`.
- Move `~/.cache/xenon/goIOS` aside and start that server: the iPhone's
  preview streams, a session on it starts and runs, and its Device logs and
  CPU and memory are recorded (both use go-ios).
- Start a go-ios from the legacy path, restart the server: the start kills
  it.
- Xenon Control on an iPhone profile: Set up shows no go-ios step, and the
  check says Ready for iPhones.

## Rollout

A minor release (2.18.0) and a Xenon Control release together. The release
notes say:

- iPhones need no separate go-ios step any more;
- `~/.cache/xenon/goIOS` can be deleted once no older Xenon on that Mac uses
  it;
- update Xenon Control.

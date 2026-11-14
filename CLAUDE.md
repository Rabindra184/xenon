# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Xenon

Xenon is an enterprise-grade Appium 3.x plugin for mobile device lab orchestration. It intercepts Appium commands, provides AI-powered self-healing for broken test selectors, manages device lifecycle, streams live device video, and exposes a real-time React dashboard.

## Commands

### Development
```bash
npm run dev          # Migrate DB + build + install plugin + start server (full dev loop)
npm run server       # Start Appium server with Xenon plugin (skip rebuild)
npm run build        # Compile TypeScript + fetch the pinned go-ios + copy public assets to lib/
npm run build:all    # Build plugin AND frontend dashboard
npm run build:xenon  # Build only the React frontend (web/)
```

### Testing
```bash
npm test                  # Same as test:all: the unit and integration tests, no devices
npm run test:all          # Run the unit and integration tests for both platforms (no real devices)
npm run test:e2e          # End-to-end plugin tests (300s timeout)
npm run test:android      # Android integration tests (real device)
npm run test:ios          # iOS integration tests (real device)
npm run test:coverage     # Generate NYC coverage report
```

`npm test` was plain `mocha` through 2.28. With `.mocharc.js`'s `recursive`, it loaded every file under `test/`, helpers and `test/e2e` included, and it crashed at load (`_a.getMetadata is not a function`) before any test ran. It now runs `test:all`. A bare `npx mocha` with no files still selects all of `test/`. Don't add `spec` to `.mocharc.js` to fix that: Mocha 10 adds a config `spec` on top of the files you name, so every `npx mocha <file>` would run the whole tree.

Run a single test file (`.mocharc.js` already wires up `ts-node/register`, and turns off Node's own TypeScript type stripping on Node >= 22.18 so ts-node stays in charge):
```bash
npx mocha test/unit/your-test.spec.ts
```

Run a single test by name (mocha grep):
```bash
npx mocha test/unit/recording-orchestrator.spec.ts -g "happy path"
```

Tests that import `CommandInterceptor` or anything that pulls in `SessionManager` need `import 'reflect-metadata'` at the top — TypeDI Container.get is invoked at module-load time and will throw `_a.getMetadata is not a function` without it.

`npm run test:all` runs the whole unit suite in one process and should be green on Node 20 and 22. It points `DATABASE_URL` at a freshly migrated scratch file (`test/setup/scratch-default-database.js`), so specs that write in passing never reach `~/.cache/xenon/xenon.db`; a plain `npx mocha <file>` doesn't load it. Every spec must also pass on its own (`npx mocha <file>`). Most breakage here came from a spec that only worked because another one ran first:

- Import what you use (`reflect-metadata`, `chai.should()`). Don't rely on another spec having loaded it.
- Never declare `before`/`beforeEach`/`after`/`afterEach` at the top of a file. Mocha attaches those to the root suite, so they run around every test in the process. Put them inside your `describe`. Register `ARTIFACT_STORE` with `useArtifactStore()` from `test/helpers/artifact-store.ts`, which restores what was there before.
- Stub `process.kill` in any test that can reach it. `ProcessRegistry` signals process groups, and an unstubbed fake pid 1 meant `kill(-1)`, which killed every process the user owned.

`test:all` also runs every spec in `test/integration/` except the real-device
ones (`androidDevices.spec.ts`, and `ios/`, which its glob doesn't reach; those
are `test:android` and `test:ios`). Through 2.14.0 it ran `test/unit/**` only, and
specs there went red unseen: `bug-report-route` from April, `forgot-password`
from #265, `team-visibility-control` from #377. A spec added there runs in the
full suite, so it must be hermetic, alone and in the full run:

- A scratch database: `useScratchDatabase()`, first in the describe. With
  `{ wholeSuite: true }` its stubs last the whole suite, so `before` can seed
  and nothing needs deleting, for a suite that doesn't stub `prisma` itself.
  Its `after` runs before yours, so an `after` of yours must not touch
  `prisma`: by then it is the real database again.
- The device store a test means. `test:all` sets NODE_ENV=test, so the factory
  hands out Loki stores there and Prisma ones to `npx mocha <file>`.
  `usePrismaStores()` (the server's, in the scratch database) or
  `useLokiStores()` pins what it hands out from then on. A module that took
  its store when it was imported (`grid.ts`) keeps that one. Loki is one
  collection for the whole process, so a spec that writes phones to it
  removes them in `after`.
- Fixture phones carrying this server's node id (`useOwnNodeId()`). A row with
  neither this server's node id nor one of its hosts is another server's
  phone, and `/control` sends its requests on to that host, which on a
  developer's machine is often their own server.
- `request` from `test/helpers/loopbackRequest`, never supertest's default
  export.
- A stand-in `SessionDeviceLogs` in any spec that creates a session on a node
  through Xenon's plugin. A node records the device log of every session its
  hub creates, and the real service reaches this machine's adb (the lab's
  adb server, on a developer's machine) for the fixture phone. Specs of what
  a hub collects from a node share `useHubAndNode()`
  (`test/helpers/hub-node-pair.ts`).

### Code Quality
```bash
npm run lint      # ESLint with auto-fix
npm run format    # Prettier formatting (src/, web/, test/)
```

### Database
```bash
npm run db:migrate    # Bring the database up to date (the startup rule below) + prisma generate
npm run db:generate   # Create a new Prisma migration after schema change
```

### Schema
```bash
npm run build:schema  # Regenerate TypeScript types from schema.json
```

## Architecture

### Plugin Layer (`src/`)

`XenonPlugin` (extends Appium's `BasePlugin`) is the entry point. It:
- Intercepts every Appium command via `CommandInterceptor`
- Manages device discovery through `AndroidDeviceManager` and `IOSDeviceManager`
- Starts an Express + Socket.io server at `/xenon/`

### Command Interception Flow (`src/interceptors/CommandInterceptor.ts`)

Every Appium command from `XenonPlugin.handle()` lands in `CommandInterceptor.handleInContext()`, except Xenon's own calls to the session (a `/wd-internal` loopback, see "Per-command auth"), which `handle` passes straight to `next()`. The order matters — same-named features compete and have to run in the right sequence:

1. **Session bookkeeping** — `updateCmdExecutedTime`, `sessionContext.run()` for AsyncLocalStorage log attribution. The command runs inside `runAsSessionCommand` (`src/sessions/commandsInFlight.ts`): while it runs the idle sweeper leaves the session's phone alone, and when it ends, either way, the session's idle clock is touched again, so the new-command timeout counts from its end, as Appium's own timer does. Through 2.36 the clock was touched only when a command started, and a command longer than the timeout (a heal reaching the AI tiers, a large install) had its phone freed, its span ended and its session stopped while the driver still ran it. A hub's gateway does the same for each command it forwards.
2. **`execute` script router** — strips `xenon:` / `xe:` (and legacy `plugin:`) prefixes and dispatches to `AICommandService`, `InterceptorService`, or `AutowaitService`. This is how dashboard / SDK clients call Xenon-specific features without new endpoints.
3. **OmniVision proactive search** — when `findElement` is called with strategy `-custom:ai-icon` or `-custom:ai-text`, route to `OmniVisionService` instead of the underlying driver. Returns virtual element IDs (`omni_*`). A `findElement` that matches nothing throws W3C `no such element` and is never healed (through 2.14 it was `unknown error`, and the tiers then ran on it).
4. **Virtual element shortcut** — element commands (`click`, `getText`, etc.) targeting an ID prefixed with `omni_`, `healed_ocr`, or `healed_visual` get served from `OmniVisionService.getVirtualElement()` (coordinate-based actions via W3C Actions API). They never reach the real driver. The element id is `elementIdOf`'s: Appium passes `setValue` as (text, elementId), the others as (elementId, ...); through 2.14 a setValue's text was read as its element, so it never reached a virtual element and autowait polled `elementEnabled(<the text>)`. `getText` answers the text OCR read, and refuses (`unsupported operation`) for an element AI vision found. `setValue` taps the element, then types into `driver.active()` (the focused field), refusing before the tap when the driver has no `active`. Any other command naming a virtual element Xenon holds is refused, not sent to the driver. Each virtual element belongs to the session whose test got its id (`OmniVisionService.remember`, by the interceptor's finds and heals, and the session's own `xenon/test-locator` route): another session's id answers `no such element`, as one that has gone does. A find keeps nothing by itself, so device control's locator test and `smartTap` leave nothing behind. A session's elements, and its autowait settings, are dropped however it ends (`forgetSessionMemory`, `src/sessions/sessionMemory.ts`: the test's delete, `onUnexpectedShutdown`, the idle release, `OrphanSweeper`, a shutdown's drain), and at most 1,000 per session and 10,000 in all are kept, the oldest going first. Through 2.14 every element stayed until the server restarted, and autowait settings were cleared only by the interceptor's `deleteSession` branch, which never runs: XenonPlugin answers `deleteSession` (and `createSession`) itself, so Appium never hands those to `handle`.
5. **Autowait pre-checks** (`src/services/autowait/`) — when `pluginArgs.autowait.enabled`:
   - `findElement` / `findElements` get wrapped in a poll loop (timeout / interval) so transient `NoSuchElement` errors retry before healing fires.
   - `click` / `setValue` / `clear` get a pre-action `elementEnabled` poll. Skippable per-command via `excludeEnabledCheck`.
   - Per-session overrides via `xenon: setAutowaitProperties` (or legacy `plugin: setWaitPluginProperties`) execute scripts. Cleared on `deleteSession`.
6. **`next()`** — actually run the underlying Appium driver command.
7. **Post-command hooks** — the dashboard's record of the command, only where `enableDashboard` records the session; and, on every session while self-healing is on, selector learning after a found `findElement` (`learnFromFind` → `triggerLearning` writes etalons for novel selectors so future failures heal cheaply).
8. **Catch-and-heal** — if `next()` throws `NoSuchElement` for `findElement`/`findElements` and the self-healing switch is on (`SelfHealingSwitch.isEnabled`, see "Plugin options, environment variables and the dashboard's settings"), hand off to `HealingOrchestrator.attemptHealing()`. Visual-tier results return coordinates; the interceptor registers a virtual element there and returns it, and the test's own click taps it. Nothing acts on the screen during the find: through 2.14 the interceptor tapped the spot then, so the click tapped it twice. A heal of a command a hub forwarded goes back to the hub on the answer (`reportHeal`, see "Hub-Node Topology"); any other is recorded here.

The "autowait first, healing second" ordering is deliberate: most "broken" findElements are slow renders, not bad selectors, so a cheap retry beats a 6-tier healing escalation that may end at an LLM call.

### 6-Tier Self-Healing (`src/services/healing/`)

When `findElement` fails, `HealingOrchestrator` tries six escalating strategies:
0. **Resilio** — `ResilioTreeHealingProvider` recovers via stored etalon signatures (cheapest, runs first)
1. **Native** — `FuzzyXmlHealingProvider` retry with original selector
2. **Fuzzy XML** — Dice-coefficient matching against stored Etalon XML signatures
3. **OCR** — Tesseract.js text-based location
4. **Visual AI** — `OmniVisionService` screenshot analysis
5. **LLM** — Gemini/OpenAI/Claude API call with page source context

Etalon signatures (element fingerprints) are stored in SQLite and reused across sessions for fast recovery without repeating AI calls.

**Learning** (`learnFromFind`, `triggerLearning`): after a `findElement`
finds its element, the interceptor reads the element in the background
(the attributes its driver has, rect, tag, page source) and stores its
fingerprint, once per selector, strategy and platform per server database
(and once more per process for a fingerprint stored without a path or without
identity, `relearnt`), one selector at a time per session. It runs on
every session this server drives while self-healing is on, nodes included,
except a session that turned its own healing off (`healingTiers: []`).
Through 2.14 it ran only behind the dashboard's record (`isHub &&
enableDashboard && SESSION_MANAGER.isValidSession`), so a server with
`enableDashboard` off, the default, and every node learnt nothing, and a
broken selector there went on past Fuzzy XML to OCR and the AI tiers. A
node's fingerprints are in the node's own database, where its healing reads
them. On an iPhone the background page source occupies WDA, so it can delay
the test's next command, once per new selector.

**Each platform's fingerprint is its own** (`fingerprintKey.ts`). A
fingerprint is stored under `fp1|<android|ios>|<strategy>|<selector>` in
`LocatorEtalon.selector` (the schema is unchanged: that column stays the
unique key, and a unique constraint added there would stop a lab that starts
with `db push`). Every reader and writer goes through `HealEtalonService`
with the session's `platformName` and the find's strategy: learning, the
heal-written fingerprint, Resilio, Fuzzy XML, the fingerprint read and
Selector Health's `etalonAge`.

- **What a session reads** (`chooseFingerprint`): its own key, else the row
  under the bare selector (every row written through 2.36) only when that
  row's type is the session's platform's (`typeFamilyOf`: an Android class,
  or an `XCUIElementType*` other than `Any`) and it was learnt under the same
  strategy. A legacy row typed `XCUIElementTypeAny` or by a description says
  no platform and is read by neither; learning replaces it.
- **Complete** (no learning) means complete for the session's own platform.
- A session whose platform is neither (no `platformName`, Windows) reads and
  writes the bare selector, as before.
- `relearnt` is keyed by the stored key and marked only once the fingerprint
  learnt again was saved (`saveSignature` answers whether it was), so a
  relearn whose save failed is tried at the next find.
- Through 2.36 fingerprints were keyed by selector text alone. A
  cross-platform suite using one accessibility id on both apps shared a row:
  Android learnt it first (`android.widget.Button`), iPhone sessions took it
  as complete and learnt nothing, and Fuzzy XML's type gate refused every
  iPhone element against it, so healing went on to OCR and the AI tiers. Each
  save also replaced the row's strategy with its own, and `relearnt` was
  marked before the attempt, so a failed relearn waited for a restart.

**What a fingerprint must say** (`fingerprintIdentity.ts`): which element
it is, not only where it was. Fuzzy XML weighs position above everything else
(5.0, against 1 for the type and up to 2 for each attribute), so a fingerprint
that holds only a rect and a type heals to whatever element of that type sits
at that spot.

- **Learning reads attributes** with the driver's `getAttribute(name,
  elementId)`. Through 2.14 it called `getElementAttribute`, which neither
  UiAutomator2 nor XCUITest has. Every read failed quietly, so every learnt
  fingerprint held only rect and type.
- **It asks each driver only what it has** (`attributesToLearn`): on Android
  `resource-id`, `content-desc`, `text` and `hint`; on iOS `name` and `label`.
  UiAutomator2 throws for `id` and `label`, and WebDriverAgent for anything
  but its own.
- **The type** (`learnElementType`, `elementType.ts`): on Android
  `getAttribute('class')`, on iOS `getName` (WebDriverAgent answers the
  element type), each with its own platform's fallback. Never UiAutomator2's
  `getName`: it is the element's `content-desc`, or null. Through 2.20 every
  driver was asked `getName`, with `XCUIElementTypeAny` as the fallback, so an
  Android fingerprint was typed that (which Fuzzy XML's type gate takes for
  any type) or by its description (no element has that tag: no path was
  learnt, and the gate refused every candidate). A stored type no page source
  has (`typeLooksLearnt`) is learnt again, once per process.
- **Only values that say something** (`meaningful`): UiAutomator2's
  `getAttribute` is `String(value)`, so an unset attribute comes back as the
  string `"null"`. That isn't kept, and never counts as identity.
- **A fingerprint with no identity** (no meaningful
  `FINGERPRINT_IDENTITY_ATTRIBUTES`) isn't used by Fuzzy XML, which then
  matches as with no fingerprint. It is learnt again on the next find that
  works, once per process (`relearnt`).
- **Position can't heal over a contradicting identifier**
  (`contradictsIdentifier`):
  - The identifier is an Android `resource-id`, compared without its package
    (`resourceIdName`), or an iOS accessibility identifier (`name` when it
    differs from the label).
  - When the candidate has another identifier, or none where the fingerprint
    has one, and none of its texts (text, label, `content-desc`) reads the
    same as the fingerprint's, it scores 0. On iOS an element without an
    identifier has its label as its name, so both platforms behave alike.
  - Identifiers are the same only with the same words (`sameIdentifier`,
    split at camelCase and at anything but a letter, mark or digit, in any
    script): `btn-pay`, `pay_btn` and `payBtn` are one. Any other pair goes
    to the text. An id that gains words is as often another element
    (`pay_later`, `undo_delete`) as a rename (`checkout_pay`), and letters
    can't tell `follow` from `unfollow`.
  - Texts must read the same (`sameText`: case, punctuation and spacing
    aside, NFC, combining marks kept, so Hindi दें and दो differ). Letter
    likeness can't tell "Log in" from "Log out".
  - Only the veto compares ids without the package. The score still compares
    whole ids, so an id of the same app earns a share of its weight. Without
    that, a heal-written Android fingerprint (no position: its rect is
    `bounds`) whose id was renamed but kept its text stops at exactly 0.5 and
    doesn't heal.
  - What still heals by position:
    - a renamed label at the same spot with no identifier ("Orders" →
      "Deliveries");
    - a renamed id that kept its text or description, whatever its new
      words;
    - a renamed text that kept its id;
    - any element where neither side has an identifier.
- **Fingerprints don't keep `value`**: on a text field it is what the test
  typed.

**A session's tiers** (`xe:options.healingTiers`) are numbered by the
providers' order, not by the list above: 1 Resilio, 2 Fuzzy XML, 3 OCR, 4
Visual AI, 5 LLM. Native has no number; the original selector always runs
first. They are a privacy control: of the healing tiers, only 4 and 5 send the
screenshot and page source to the AI provider, so a session leaves them out to
keep healing from sending its screen. Failure analysis of a failed session is
a separate feature and doesn't read them.

- **Read from the session's driver** (`driver.caps`, which Appium hands the
  plugin with every command), in the interceptor's catch-and-heal. Through
  2.14 they were read from `SESSION_MANAGER`, which holds a local session
  only with the dashboard on or a video recorded (`record_video` defaults to
  on). A session with `record_video: false` on a server with the dashboard
  off, a node's for its hub included, ran every tier.
- **The rule** (`coerceHealingTiersCap`, `healingTiersFromCaps`): not set,
  every tier. A list of tier numbers 1 to 5, exactly those, and `[]` none
  (nothing is collected, no screenshot taken). Anything else (`"1,2"`,
  `["1","2"]`, `[1, 6]`, an `xe:options` that isn't an object, ...) fails
  closed for the AI tiers: tiers 1, 2 and 3 only, with a warning once per
  session (keyed by its driver in a `WeakSet`). Through 2.14 `[]`, or a
  value that wasn't a list or had no numbers in it, ran every tier; a list
  that held some numbers ran those and skipped the rest (`[1, 6]` ran tier 1,
  `[6]` none).
- A per-command option belongs on the driver too, never in
  `SESSION_MANAGER`. Options used once at session start (the network
  capture, a network profile, video) are read from the request's caps there.

- **Resilio's path** (`resilioPath.ts`, `LocatorEtalon.path`). The element's
  path from the root of the page source, learnt with the fingerprint
  (`triggerLearning`) and after a heal. Learning takes the element with the
  most of the attributes read off it, among those sharing an identity
  attribute or the whole rect (the page source is read after the find
  answered, so a size alone names nothing); a tie learns none. The page
  source is parsed as XML; each node keeps what resiliotree compares, not its
  subtree, tagged `format: 'page-source-1'`. A fingerprint stored without a
  path is learnt again once per process.
- **Resilio answers only when sure.** A score of 0.8 or more, 0.05 ahead of
  the next *element* (resiliotree scores an element once per leaf below it,
  so a list row comes back several times at one score). An element that kept
  its id scores ~0.99 wherever it moved; a renamed or missing one ~0.55 with
  a neighbour a few hundredths behind. It also declines an element whose
  text, description, label, name or value contradicts what an XPath
  selector states (`contradictsSelector`): a changed text weighs little in a
  path, so a dialog's OK that now reads Delete would score ~0.99. And it
  tries only locators that select that element alone in the page source
  (`locatorsSelectingOnly`), since a driver answers the first match. What it
  declines goes to Fuzzy XML. Through 2.14 the database dropped the path, so
  Resilio never ran; its paths came from resiliotree's HTML parse (lowercase
  tags, no driver matches them), and it took the nearest element however
  far.
- **OCR** reads the screenshot with Omni-Vision's OCR and matcher
  (`OmniVisionService.findTextInScreenshot`, `ocrTextMatch.ts`): a phrase
  across neighbouring words, over 60% confidence, the first in reading
  order. Through 2.14 it took the first word containing, or contained in,
  the text, from a Tesseract call that read no word boxes.

**OCR's language data ships with the plugin** (`src/services/ocr/`). Every
worker (Omni-Vision's, which the OCR tier uses too) comes from `createOcrWorker()`:
`langPath` is the vendored `eng.traineddata.gz` (copied into `lib/` by
`build:copy`), `cacheMethod: 'none'`. Through 2.14 tesseract.js downloaded it
from cdn.jsdelivr.net and cached it in the working directory, so an offline
server's first OCR call never finished, and every later one waited on its lock.
`createOcrWorker` checks the file's SHA-256 first: given data it can't load,
tesseract.js 7 throws from its own message handler, and `src/index.ts` exits on
an uncaught exception. A start that fails anyway is remembered for a minute
(`OCR_START_RETRY_MS`): tesseract.js hands back no worker then, so its thread
can't be ended. A worker whose parameters (`createOcrWorker`'s second
argument, Omni-Vision's sparse-text mode) can't be set is ended and remembered
the same way. Each read has `OCR_RECOGNIZE_TIMEOUT_MS` (30 s, as an AI call):
past it the read fails (`OcrTimeoutError`), its worker is ended, the lock is
freed and the next read starts a fresh worker. Through 2.36 a read had no
limit, so one that never finished hung every OCR caller, the OCR healing tier
inside a findElement included, and a worker whose parameters failed was
leaked, one per call. Never call `Tesseract.createWorker`/`recognize` directly.

### AI providers and failure analysis (`src/services/AIService.ts`, `src/dashboard/services/failure-analysis-service.ts`)

- **The settings in force now.** The AI engine page changes the provider and
  models while the server runs (`POST /config` writes `config`).
  `isEnabled()` and every call set the provider up again when those settings
  changed (`initializeProvider`), and only then. Through 2.14 `isEnabled()`
  answered for the provider set up last. Failure analysis and the LLM and
  visual healing tiers ask it first, so choosing a configured provider after
  starting with a keyless one turned none of them on, and choosing a keyless
  one left the old provider answering.
- **A rate limit is a failed call**, for every provider: `AIRateLimitedError`
  (status 429), which the circuit breaker counts. No analysis is saved, the
  visual assertion and screen description say the provider is rate-limited,
  and Test connection fails. Through 2.14 Gemini answered a 429 with the text
  `CONNECTION_OK_RATE_LIMITED`: it was saved as the analysis, and the breaker
  counted it as a success. Gemini's is judged by `status` alone: its message
  holds the URL and the provider's text, where "429" can be a token count. A
  call the open breaker holds back is `AIProviderPausedError`, a
  `CircuitOpenError` whose message is for testers.
- **The breaker** (`src/services/CircuitBreaker.ts`) opens after 5 counted
  failures in a row (`isTransientFailure`: 5xx, 429, network errors, time-outs;
  a 4xx is the request's fault and isn't counted) for 60 s. Then it lets one
  call through, the probe, and holds back every other (`AIProviderPausedError`)
  until the probe settles it: a success closes it, any failure, a 4xx
  included, opens it for another 60 s. A probe that hasn't come back in 60 s
  gives way to a new one; a call let through before it opened doesn't settle
  it. It is keyed `ai:<provider>:<model>` by the model the provider calls
  (`LLMProvider.model`: the provider's own model, else `aiModel`, else its
  default). Through 2.36 a half-open breaker let every caller through, a
  probe's 4xx left it half-open, and the key took `<provider>Model ||
  'default'`, so every model chosen by `aiModel` alone shared one breaker.
- **A failed session's analysis runs after the session has ended.**
  `onSessionStopped` saves the category (rules, `categorizeSessionFailure`)
  and starts `explainSessionFailure` without waiting for it. Every way a
  session ends waits for `onSessionStopped`: the client's quit, a hub's
  DELETE, a timeout, a shutdown. The OpenAI and Anthropic SDKs wait up to
  10 minutes a try, with two retries, so a quit outlasted the client's own
  timeout. The analysis has its own limit, `FAILURE_ANALYSIS_TIMEOUT_MS`
  (2 minutes, see below). Only an answer is saved: no provider, a rate
  limit, a time-out or a failed call writes nothing and leaves an earlier
  analysis. "Timed out" is never saved as text, since `ai_analysis` is shown
  as the analysis on the session page, in the copied report and in bug
  reports. Nothing else limits how many run,
  so at most `MAX_CONCURRENT_FAILURE_ANALYSES` (4) do and the rest wait,
  holding only their session id. A session's second end (a crash, then the
  client's delete) starts none: its row already has an `endTime` (see "A
  session's first ending stands").
- **Every AI call has a time limit**, retries included: `AI_CALL_TIMEOUT_MS`
  (30 s) unless the caller gives its own (failure analysis, 2 minutes). Most
  calls are made while a test command runs: the LLM and visual healing tiers
  inside a failing findElement (so it answers within two limits), the visual
  assertion and screen description inside an execute script, an ai-icon find,
  and Test connection. The request is cancelled (`AbortSignal`, passed to each
  SDK) and the call fails with `AITimeoutError`, which the breaker counts.
  Through 2.14 only Ollama had one, and a provider that didn't answer held the
  command past the client's own timeout.
- **Redaction before every call** (`aiRedaction`, `src/services/ai/aiRedaction.ts`,
  applied in `callProvider`, the one place every call goes through). Text is
  redacted by built-in sets (`emails`, `phoneNumbers` in `+` form,
  `cardNumbers` that pass Luhn, `secrets`) and the lab's own rules, in
  Appium's `log-filters` format (`helpers/secureValueRules.ts`, shared with
  the token log filter check). `screenshots: withhold` sends none: the LLM
  tier and failure analysis run on text, `visualFind` answers null (or
  throws with `throwOnError`), `assertVisual` and `describeScreen` throw
  `AIScreenshotWithheld`. An option that can't be read fails closed
  (`AIRedactionInvalid` on every call, before the breaker). Unset, nothing
  changes. `/capabilities` reports `features.aiRedaction` (names, a count, the
  screenshot policy, `valid`). No dashboard editor yet. Through 2.23 every
  call went as it was (Xenon Test's ENH-05).
- **Tests never reach a provider.** `test/helpers/fake-ai-provider.ts`
  answers the SDKs at `fetch` and axios, so a 429 is the SDK's own error.

### Selector Health (`src/services/selector-health/`, `web/src/components/selector-health/`)

The page that lists the selectors tests could only find with healing. A
list with a side panel; the view (tab, period, search, filters, sort, page,
open selector) lives in the address.

- **List** (`GET /healing/selectors`, `selectorList.ts`). "To fix" groups
  the period's heal rows by (strategy, selector) in the database
  (`groupBy`), so no heal is left uncounted (the old hotspot scan stopped at
  5,000 rows), and leaves out selectors being verified, fixed or muted. The
  other tabs start from `SelectorState` rows of that status, so a fixed
  selector that stopped healing stays listed. Counts follow the period, not
  the search or filters. Search compares text in JavaScript: `%` and `_`
  are plain text. A page past the end answers the last page.
- **Panel** (`GET /healing/selectors/detail`, `selectorDetail.ts`), always by
  strategy and value. A heal recorded with no strategy is strategy `''`
  everywhere (`tupleWhere` matches null and `''`). It reads each heal's own
  fields and each session once: attaching the session to every heal took
  most of a second for a selector healed 50,000 times in a year. Counting
  with `aggregate`/`groupBy` instead was measured slower for a member,
  because every query re-checks which sessions they may see for every heal.
- **Who sees what.** A selector is visible to a caller who can see at least
  one session where it healed, at any time (`access.ts`, by
  `visibleSessionWhere`); an admin or auth-disabled caller sees all. Hidden
  answers `404 { error: 'not_found', message: 'Selector not found' }`, as an
  unknown one. Status and activity stay one lab-wide row per selector.
- **Actions** (`POST /healing/selector/state`): members and admins, with the
  `sessions` scope, on visible selectors. Each status change writes a
  `SelectorEvent` (who, what, optional mute reason) in the same transaction
  (`SelectorStateService`, `SelectorVerificationJob`). The person is
  `resolveActor(req).userId`: a dashboard user has no API key, so the old
  `*_by_api_key` columns were empty for every dashboard action.
- **Broke again.** A heal of a selector being verified or fixed sends it
  back to "To fix" from the heal write path (`onHealRecorded`,
  fire-and-forget). The verification job also looks, on every run, for a
  heal since `fixed_at` on each such selector and makes the same change, so
  a failed call can't leave it fixed. Through 2.10 the job counted only clean
  builds, and promoted a selector with three of them however often it
  healed in others.
  Every heal is sent, a heal recorded with no strategy as strategy `''`;
  through 2.36 the event manager skipped those, so such a selector went
  back to "To fix" only at the job's next run.
- **Statuses** (`selectorStatus.ts`, `SelectorStatus`): `active` (To fix),
  `pending` (Verifying), `resolved` (Fixed), `muted`, in a plain string
  column. Only `pending` and `resolved` carry a fix (`fixed_at`, and
  `resolved_at` once verified); mute, unmute, cancel and a heal clear it
  (`NO_FIX`). Unmute and cancel share one rule (`keepsRowWhenActive`): the
  row stays, `active`, only if the selector broke again before, else it is
  deleted. `stateView` shows a fix only for `pending` and `resolved`.
  Through 2.36 mute kept the fix and unmute's rule counted it while
  cancel's didn't, so an unmuted selector was "To fix" and "fixed by"
  someone at once.
- **No status write undoes a change made meanwhile.** Each is
  conditional on the state it expects, and its `SelectorEvent` and live
  event happen only when it changed a row:
  - the job promotes, and writes progress, only where the row is still
    `pending` under the `fixed_at` it read (`updateMany` on id, status and
    `fixed_at`), so a mute, a cancellation, a heal or a second "mark fixed"
    made during its run stands;
  - a heal's change is one `updateMany` where the status is `pending` or
    `resolved`, so two heals of one selector at once (two shards) count one
    regression and one `broke_again`, and a mute made in between stays;
  - mark fixed, unmute and cancel (`SelectorStateService`) read the row,
    then write only where its status and `regression_count` are still what
    they read (`asRead`; mark fixed creates the row when it read none). A
    write that changes nothing, or a create that meets another (P2002),
    starts the change again from a fresh read (`retrying`, at most 3
    times, then `409`). So a mute landing during mark fixed answers `409
    muted`, a heal landing during a cancel answers `409 active` and keeps
    its regression, and an unmute another unmute beat returns the row as
    it is. Mute alone stays an unconditional upsert: it is allowed from
    every status.

  Through 2.36 all of them wrote by id or key alone, from what they had
  read before: a selector muted during a run came back verified with
  `muted_at` still set, one marked fixed again was verified on its previous
  fix's builds, two heals counted two regressions, a mute during mark fixed
  ended `pending` with `muted_at` set, and a cancel deleted the regression
  a heal had just counted.
- **One verification run at a time** (`SelectorVerificationJob.run`): a run
  asked for while one is going gets that run's promise. Through 2.36 a run
  slower than the cron's 15 minutes overlapped the next.
- **A clean build** is one where the selector was found without healing: a
  find of it that didn't fail (`is_error`) and didn't answer an empty list,
  and no heal of it. Through 2.14 a find that failed outright counted, so a
  selector never found again was verified as fixed.
- **Summary** adds `timeSpentMs` (the healed commands' recorded durations)
  and `trend` (heals and AI heals per day, in the browser's `tz`).
- **No cost.** The fixed per-heal prices (`TIER_COST_USD`) priced an LLM heal
  the same on a local model as on a paid one, and charged for local OCR.
  `estCostUsd` is gone from every answer and the digest.
- **Fingerprint read** (`GET /healing/fingerprint`, `fingerprintRead.ts`):
  whether this server has a fingerprint for a selector, when learnt, type,
  `hasPath`, `hasIdentity` and the identity attribute names, never their
  values. Visible to an admin, or to a member when a session they may see
  ran a find of the selector (`canSeeSelectorFinds`: Selector Health's rule
  without `is_healed`, since fingerprints come from finds); anything else,
  no fingerprint, or another strategy's is `404` as an unknown selector. Read
  through `HealEtalonService.listSignatures`, so either store. It describes
  the fingerprint written most recently and names its `platform` (`android`,
  `ios`, or null for a pre-2.37 row whose type says none); `platforms` lists
  each platform's, newest first. A hub answers for its own phones only (Xenon
  Test's ENH-14).
- **Live events** (`selector_*`) reach a member only for a selector they
  may see, by the same rule (see "Live events are team-scoped at emit
  time"); admins get all of them.
- **Wording** is for testers: no internal terms on screen
  (`selector-health-page.test.tsx` checks).

### Session Lifecycle (`src/services/SessionLifecycleService.ts`)

There is no session state machine: no enum or transition function holds a
session's phase. Each phase is recorded where the code that reaches it writes:

- **Requested:** a `PendingSession` row, written by `prepareSession` and
  removed once the session exists (`finalizeSession`), when allocation fails
  or by `releaseAllocation`; leftovers are swept by `cleanPendingSessions`.
- **Allocated:** the phone's Device row, this server's claim (`claimedAt`,
  then `claimSessionId`; see "Busy on a hub").
- **Running:** Appium's umbrella for a local session, `SESSION_MANAGER`
  (a local session only with the dashboard on or a video recorded; every
  remote and cloud session on a hub), and a `Session` row with `status`
  `running` (a free string), written only where the dashboard records the
  session or by `recordRoutedSession`. `onSessionStarted` broadcasts it.
- **Finished:** the row's `endTime`, its `status` (`success`, `failed`,
  `unmarked`, `timeout`) and `failure_reason`, written by `onSessionStopped`,
  which also broadcasts it; the claim's release; removal from
  `SESSION_MANAGER`. A session with no row leaves no record of its end.

Through 2.36 this file described a `requested → allocated → running →
finished` state machine whose every transition was persisted and broadcast.
Local, remote (hub-node) and cloud sessions share `XenonSession`'s interface
(`LocalSession`, `RemoteSession`).

Creates for a platform queue on one lock (`commandsQueueGuard`, `ios-lock` /
`android-lock` / `default-lock`), held across `allocateDeviceForSession`'s
whole wait: first come first served, each create with its full
`deviceAvailabilityTimeoutMs` from the head of the queue. A lease-bound session
allocates nothing and skips the queue; behind it, it waited up to that long per
create ahead of it. A wait that times out marks itself abandoned, so an attempt
still running releases the claim it takes instead of leaving it pending.

**A client's delete** (`deleteSession`, also a hub's DELETE and the
heartbeat's end) does the same, in the same order, under that lock: the
phone's network put back, then (for a session in `SESSION_MANAGER` not already
stopping) its ports given back and its video stopped and archived, then the
phone released by the session's claim; only then the driver's own delete
(30 s limit), `onSessionStopped` and the `finally` work. A failed video or
port step is logged and the phone still released. Through 2.36 the phone was
released first, so the next session could be given it while this one's video
was still being written.

**When Appium ends a session itself** (its new-command timeout, a crashed
driver), the plugin's `onUnexpectedShutdown` is the only ending it gets. It
hands the session to `SessionLifecycleService.endSessionAppiumEnded`, under the
delete's lock, on every server (hub, standalone, node): the phone's network is
put back, the ports given back and the video stopped and archived (before the
phone is released, since the phone may be the next session's once free), the
phone released by the session's claim, the end recorded (where the dashboard
records sessions, or wherever `SESSION_MANAGER` held it, as `deleteSession`
does), and the session taken out of `SESSION_MANAGER` last. Through 2.36:

- It stayed in `SESSION_MANAGER`, so the heartbeat kept probing it, found the
  driver gone and six ticks later ended it again with `deleteSession`. That
  rewrote the row's reason from Appium's to "Session terminal failure",
  analysed it a second time, released the ports of whatever session had the
  phone by then, and kept writing heartbeats to the ended row.
- A node posted the hub's admin `/unblock` (which needs a `host` and only
  toggles `userBlocked`, so it always answered 400), and its own row kept the
  dead session's claim until its idle sweep. It now releases its own phone.
  The hub's claim on that phone is the hub's: its heartbeat on the
  `RemoteSession` asks the node, hears the session is gone, and ends it with
  `deleteSession` after six ticks (about 3 minutes at the default 30 s).
- The video's ffmpeg was stopped only on a hub (or standalone server) with the
  dashboard on.
- With no session id, every row with the phone's udid was freed, a node's twin
  on a hub included. Now only this server's own row (`findOwnDevice`).

**A session's first ending stands** (`onSessionStopped`). A row with an
`endTime` has ended: a later ending (the heartbeat after Appium's end, a
client's delete after a crash) changes neither its status nor its reason, and
starts no second analysis or webhook. A verdict the test set while running
(`xenon: setSessionStatus`) writes no `endTime`, so the ending still applies
to it. `OrphanSweeper` claims its rows with status and reason only and leaves
the `endTime` to `onSessionStopped`, or its sessions would count as ended
before their analysis and webhook.

**The heartbeat** (`SessionHeartbeatService`) probes every session in
`SESSION_MANAGER` each `sessionHeartbeatIntervalMs` and ends one whose probe
fails six times in a row (`deleteSession`).

- **One cycle at a time.** A tick that finds the last cycle running skips its
  probes. A `RemoteSession`'s probe can take seconds on a slow node.
- **Stamped on every tick**, before any probe and whether or not a cycle runs:
  one write of `last_heartbeat_at`, `heartbeat_pid` and `heartbeat_host` for
  every held session. The stamp says this process is alive and holds the
  session; health is the probe's to decide.
- **Probed side by side**, at most `HEARTBEAT_PROBE_CONCURRENCY` (8) at once.
- **`OrphanSweeper` leaves a session `SESSION_MANAGER` holds alone**: it is
  for sessions a dead process left, and the heartbeat ends the held ones
  through the lifecycle.

Through 2.36 cycles had no guard and probed one session at a time, stamping
each after its probe. A cycle that outlasted the interval overlapped the next:
failures counted twice (a session was ended in half the time) and two cycles
could end one session. A slow node made every later session's stamp late, so
`OrphanSweeper` (cutoff 3 intervals) failed healthy sessions on healthy nodes,
and its write left them in `SESSION_MANAGER`, the test running on a phone
listed free. `XenonSession.healthState` was written and read nowhere, and is
gone.

### Hub-Node Topology

A Xenon hub instance can orchestrate remote Xenon node instances. Each has its
own database; a node reports its phones to the hub over HTTP (`NodeDevices.ts`,
`POST /xenon/api/register`). Sessions on a node's phone go **through the hub
only**, because the hub owns team rules, reservations and blocks for node
phones, and enforces auth. A node with auth enabled refuses any create without
the hub's verified create token (`assertCreateCameFromHub` in `prepareSession`,
so it holds on the plugin's no-gateway path too): `session not created`,
"Create sessions through the hub", naming the hub. A node with auth disabled
checks no credential, the hub's token included, so a direct create there looks
like the hub's and still works, as it did (local development against one
node). Appium 3 only, every 3.x.

**The session gateway** (`src/gateway/`, placed by `registerSessionGateway` in
`src/app/registerCommandAuth.ts`, wired by `gatewayOptionsFor` in
`defaultGateway.ts`) stands in front of Appium's routes, spliced with
`insertBeforeRoutes` on both Express shapes. It replaced
`registerProxyMiddlware`, which on Express 5 landed after the routes, so no
command ever reached a node. Three adjacent layers:

1. `xenonInternalCalls` (path-less): Xenon's own `<basePath>/wd-internal/...`
   calls. See Per-command auth below.
2. `xenonSessionCreate` at `<basePath>/session` (`sessionCreate.ts`): `POST`
   of exactly that path. See "Creating a session" below.
3. `xenonSessionGateway` at `<basePath>/session/:sessionId` (mounted, so its
   path matching is the router's own, letter case included): per-command auth
   once for local and remote sessions alike, then on a hub:
   - **Where a session runs** is `SessionLocator` (`sessionLocator.ts`):
     `SESSION_MANAGER` first, then the open Session row and its phone's row. It
     is never a routing table of its own. Every session a hub routes to a node
     or cloud is registered in `SESSION_MANAGER`, whatever the dashboard and
     video settings. A remote session whose phone is this server's own (a
     local one from before a restart) is never sent back to this server, and a
     request carrying a hub token is never forwarded again.
   - **Forwarding** (`forwardToNode.ts`) sends the command under the node's
     own base path, drops the client's credentials and cookies, adds the hub
     token, and streams the node's status, headers and body back. No retry: a
     WebDriver command isn't safe to repeat. Appium's umbrella never sees a
     remote session's command, so a pure hub needs no driver for the node's
     routes. The dashboard's before/after command hooks run for registered
     remote sessions when the hub's dashboard is on.
   - **DELETE `<basePath>/session/<id>`** runs
     `SessionLifecycleService.deleteSession` with the forward as its driver
     step, so the node's video is archived while the session exists, then the
     phone is unblocked, the dashboard closed and `SESSION_MANAGER` cleaned.
     DELETE of a sub-resource (`/cookie`) is an ordinary command.
   - Network-conditioning latency is added for local sessions only; the node
     adds it for its own.

**Base paths may differ.** A phone's `host` is only the node's origin, so each
server answers `GET /xenon/api/webdriver` (`{ basePath }`, no login) and the
hub's `NodeBasePathResolver` asks before creating or routing a session (60 s
cache; a node that doesn't answer is assumed to share the hub's base path).

**Creating a session** happens in the gateway, before Appium's route. Every
Xenon server does it this way, a standalone one included. The create layer
takes the credentials out, checks them, validates the capabilities, writes
the pending-session row and allocates the phone
(`SessionLifecycleService.prepareSession`). Then it depends on the phone:

- **Another server's phone** (a node's, or a cloud provider's): the session
  is created there (`completeRemoteSession`) and the hub answers the client
  itself, as Appium answers a new session. Appium's umbrella driver never
  sees it. When it used to (the plugin answering the create without calling
  `next()`), Appium >= 2.15 promoted the plugin to a session it didn't have
  and threw in `generateDriverLogPrefix(undefined)`, answering 500 while the
  node kept the session. Base-driver 10.2.1 fixed the throw, but the umbrella
  still kept the promoted plugin for ever. That is why nothing depends on
  Appium's fix, and why the `updateLogPrefix = null` stopgap is gone.
- **This server's own phone**: the allocation goes to
  `XenonPlugin.createSession` through the request's `AsyncLocalStorage`
  context (`createHandoff.ts`), so it isn't allocated twice. The plugin takes
  it (`completeLocalSession`) and calls `next()`. From then on the plugin
  releases the phone if the create fails, including when Appium finds no
  driver or refuses the capabilities, since in Appium 3 both happen inside
  `next()`. If the request ends without the plugin taking it (another plugin
  refused the create first, or the client left), the gateway gives the phone
  back on the response's `close`. A client that leaves while its phone is
  still being found gets it released when it turns up, and Appium never runs.
- **A local create Xenon can't finish is undone** (`finishCreate`,
  `undoLocalCreate`). Once `next()` has created the driver's session, any
  throw while Xenon registers it (the row write, the session's network)
  ends the driver's session through the umbrella (`driver.deleteSession`,
  no plugins), puts the phone's network back, closes a row the dashboard
  wrote (no webhook), forgets the owner and the session's memory, stops its
  samplers, gives back its ports and releases its claim by session id or
  pending `claimedAt`, never one another session holds. The client gets
  `session not created` with the reason. So does a create whose pending
  claim was taken meanwhile (`ClaimLost`: `claimDeviceForSession` false,
  after `PENDING_CLAIM_TIMEOUT_MS`, a first WebDriverAgent build): the phone
  stays the other session's. Through 2.36 that create ran on anyway, two
  sessions on one phone, and a throw left the session half registered (the
  driver's session running, its claim held, its owner recorded). A remote
  create is not undone this way: a hub has no driver for the node's session.
- Refusals are answered as Appium answers the same error thrown from the
  plugin (`getResponseForW3CError`). A body without a `capabilities` object
  goes straight to Appium, as before.
- If the create layer isn't installed, the plugin allocates for itself
  (`createSession(..., { localOnly: true })`, with a warning). It refuses and
  releases another server's phone rather than answer for Appium.

**What a node is sent** (`capsForNode`, `nodeCreateCaps.ts`) stands on its
own, whatever the node's auth settings. It carries no credentials and no
lease id: the hub resolved the lease in its own database. The phone the hub
allocated is pinned as `alwaysMatch['appium:udid']`, with no other
`appium:udid` and no `appium:udids`. A lease-bound allocation never wrote the
udid into the caps, and a `udids` list would let the node pick another
phone. Before this the hub put the client's credentials back
(`capsWithCredentials`) for the node to re-check. It couldn't: the node's
database doesn't have the hub's keys, leases or teams.

**The hub's tokens** (`hubSessionToken.ts`), sent as `x-xenon-hub-token`.
Auth is enforced at the hub. All four are RS256 JWTs from the hub's
`JwtKeyService`, verified by the node against the hub's
`/xenon/api/auth/jwks.json`. `/auth/token` mints none of their audiences. A
cloud provider never gets one.

- **A session's** (audience `xenon-node`, claim `sid`, 5 minutes, reused
  until a minute before expiry) goes with every hub call about a session:
  forwarded commands, and `RemoteSession`'s own screenshot, source,
  recording and heartbeat calls. A node with per-command auth on accepts it
  in place of credentials. A forged, expired or other session's token gets
  the unknown-session answer, and a JWKS that can't be fetched is `503`.
- **A create's** (audience `xenon-node-create`, 2 minutes, fresh per create)
  names the owner the hub verified (`sub`, absent for an unattributed
  create), the phone (`udid`) and its node (`host`, the phone row's host).
  It has its own audience, not a claim on the session token. That way jose
  refuses the other kind before any claim is read, so neither kind can open
  what the other does. On a node with auth enabled it is the session's
  credential:
  - it attributes the session (the node's `XenonSession.userId`);
  - it passes `XENON_REQUIRE_SESSION_TOKEN`;
  - the client's own credentials are neither checked nor needed;
  - the session is unscoped, since the hub applied the team rule.

  The node may allocate only that phone, on itself. Caps that name another
  phone are refused before allocation. An allocated phone that is another
  node's (an emulator's udid repeats across machines) is refused and released.
  A forged, expired, already used or session token is refused (`400 invalid
  argument`, "session rejected"), and a JWKS that can't be fetched is `503`.
  With auth disabled on the node the token isn't checked, as no credential
  is. The token is single-use: each has its own `jti`, which the node's
  verifier keeps in a `SingleUseLedger` until it expires. A token with no
  `jti` (from an older hub) is accepted without that check.

- **A lease's port call's** (audience `xenon-node-ports`, 1 minute, fresh
  per call; `portsTokenFor`). It goes with each `POST /ports/allocate`,
  `extend` and `release` the hub sends a node for a lease of the node's phone
  (`PortAllocatorClient`, `credentialHeaders`), naming the phone (`udid`) and
  its node (`host`). On a node `authMiddleware` takes it only on those three
  routes, for a `host` of the node's own, as kind `hub-ports` (role ADMIN,
  scope `devices`, nothing more), and the ports router refuses a body about
  another phone (`holdsPhone`, `403 hub_token_phone_mismatch`). Through 2.20
  the hub sent only its node-pair credentials, which a node with sign-in on
  checks against its own database and refused: no lease of such a node's
  phone ever worked (ENH-08). The hub still sends the pair when set, for a
  node on 2.20 or earlier. `features.leasing.nodePhones` is then false only
  when the hub can't sign (`HubSessionTokenIssuer.canSign`, JwtKeyService's
  `ready`) and has no pair.
- **A device-control call's** (audience `xenon-node-control`, 1 minute,
  fresh per call). It goes with each `/control` action the hub forwards on
  a node's phone (see "Device control on another server's phone" below).
  Forwarded actions used to go with no credential, so an auth-enabled node
  refused every one (its CSRF check, then its login). The token names the
  hub user (`sub`),
  whether they are an admin (`adm`), the phone (`udid`) and its node
  (`host`), and is sent as `x-xenon-hub-token`. The hub's own guards
  (role, team, ownership) have run by then.
  - On a node, `authMiddleware` accepts it only for `/control/<udid>/...` on
    the phone it names, whose `host` is one of the node's own
    (`localDeviceHosts`). It sets `req.auth` to kind `hub-control`: that
    user, `ADMIN` or `MEMBER` with `scopesForRole`, and `teamIds`
    undefined, since the hub applied the team rule.
  - The node's ownership guard then judges that user against the session's
    owner (`LiveSessionOwners`).
  - Anywhere else the header is no credential. A bad token is `401`, and a
    JWKS that can't be fetched is `503`.
  - `csrfMiddleware` passes the header like the key pair: a browser can't set
    it cross-origin. A server that isn't a node ignores the token, and a
    cloud provider never gets one.

**A create is sent once.** `forwardSessionRequest` posts it with
`retry: false` (`InternalRequestConfig`) and `REMOTE_CREATE_TIMEOUT_MS` (8 min,
two under `PENDING_CLAIM_TIMEOUT_MS`, so the idle sweeper can't free a phone
whose create the hub is still waiting for). `InternalHttpClient` otherwise
retries a request on a 5xx or its 30 s timeout, and a slow first UiAutomator2
install then started a second session on the node, holding the phone with
nobody to end it. A create that outlasts the 8 minutes, or whose answer is
lost, can still leave its session on the node until the node's own
new-command timeout.

**A node that keeps failing creates** (`src/data-service/CircuitBreaker.ts`,
per host). Three failed creates on a node take its phones out of allocation
(`isOpen`, in device-service's `getDevices`) for a minute. Then the next phone
allocated there takes the one trial (`beginTrial`, in `allocateDeviceForSession`
under the allocation lock) and the node is held back from every other create
until that session reports: `recordSuccess` closes it, `recordFailure` opens it
for another minute. A trial that hasn't reported in a minute gives way to a new
one. Reading it changes nothing. Through 2.36 `isOpen` turned it half-open on
whichever device listing read it first, and a half-open node was offered to
every create.

**A hub restart** leaves node sessions running. At boot a hub clears only its
own phones (`devicesClearedAtBoot`); its nodes' rows stay, so
`recoverActiveSessions` rebuilds their `RemoteSession`s (under each node's own
base path) and the gateway routes them again. Before the gateway every row was
wiped at boot, so every remote session was marked failed on restart.
That needs the session's own row, which names its phone and owner. The
dashboard's row (`onSessionStarted`) is written only with the dashboard on,
and never for a cloud session, so a session the hub routes to a node or a
cloud otherwise gets a minimal one (`recordRoutedSession`: phone, node,
capabilities, `api_key_id`, `user_id`; no profiling, logs or event). The
dashboard setting still decides alone whether a local session has a row.
Until then a dashboard-off hub lost every node session on restart: its
commands went to the hub's own Appium. Recovery also restores the session's
owner (`apiKeyId`, `userId`) from the row, and stamps the row's heartbeat
with this process (`adoptHeartbeat`). The row still carried the old
process's heartbeat, so after an outage longer than 3 heartbeat intervals
(~90 s) the orphan sweep, at boot and on every interval, took every
recovered session for an orphan: it failed the session and freed its phone
while the node kept it. From then on the heartbeat keeps the row fresh and
ends the session if its node no longer has it. A
graceful shutdown (SIGTERM) drains only the hub's own local sessions
(`ShutdownCoordinator`); until 2.1 it also finalized node and cloud sessions,
releasing the phone and closing the row on the hub while the node kept the
session running, unreachable, until its idle timeout.

**Device control on another server's phone**
(`src/app/routers/nodePhoneControl.ts`). `control.ts`'s handlers act with
this server's own adb and go-ios. A gate mounted after the team and ownership
guards decides every `/control` request for a phone whose row is another
server's (`isOtherServersPhone`: its `nodeId`, else its exact host), before
any handler runs:

- `NODE_FORWARDED_CONTROL` (tap, swipe, text, keyevent, touchAndHold,
  screenshot, clipboard read and write, lock, unlock, display, uninstall,
  apps, logs, shell, inspector/snapshot, `upload-install`, and the live
  preview's stream/start, stream/status, stream/leave, stream/stop and
  `GET stream`) goes to the phone's node once, with the control token and
  none of the caller's headers, and without a `ticket` query parameter. An
  upload (a multipart body) is streamed on as it came: the route's own
  parser runs after the gate, so nothing on this server reads it. The
  node's status, headers and body are relayed unchanged. An unreachable node
  is `502 node_unreachable`, and one that hasn't started answering in 60 s
  (15 min for an install, `NODE_INSTALL_TIMEOUT_MS`: the node answers when
  the install is done) is `504 node_timeout`. Once it has, the answer runs
  as long as it runs: the MJPEG `GET stream` lasts as long as its viewer.
- `ANSWERED_HERE` runs here. `appium-session`: the session is routed
  through this server. `stream/ticket`: the viewer's ticket is this
  server's, minted after its team check.
- `ANSWERED_HERE_FOR_NODES` runs here for a node's phone, and does the rest
  through the node. `install-repository-app`: the app is in this server's
  library and checked against the caller's teams here (`canSeeApp`), then
  sent to the node's `upload-install` as a multipart upload streamed from
  disk (`installFileOnNode`). `omni-scan` and `test-locator`: Omni-Vision
  runs here, with this server's AI settings, on the node's screenshot
  (`screenshotFromNode`). A node's own `upload-install` received no file
  until #387, so an install on a 2.2 or older node fails there.
- Everything else is `501 not_available_through_hub`, naming the node, and
  the dashboard toasts that message: `install` (a path on one machine). A
  new `/control` action is refused for another server's phone until it is
  added to a list.
- A cloud provider's phone gets `501 not_available_for_cloud_phone` for
  all but `appium-session` and `stream/ticket`, and nothing is sent to the
  provider. Before this, the five forwarded actions went to the provider's
  host, typed text included.

The node runs the live preview by its own rules, with the hub's user from
the control token. It takes the preview hold on its own row, refuses a
second user, counts viewers (one hub connection per viewer, so its counts
stay true) and releases the phone when nobody watches. The hub keeps none of
that, and its ownership guard leaves a phone busy only by the node's report
to the node (`heldHere`, see "Device access guard"). Two things are the
hub's own:

- **Busy at once.** After the node answers a forwarded stream/start with a
  2xx, the hub sets `nodeBusy` and `busy` on its row, and `nodeHold` to the
  caller's hold (`markNodeBusy`, both stores). The node's report says the
  same only up to `sendNodeDevicesToHubIntervalMs` later, and until then
  the hub could allocate the phone to a session the node would refuse. A
  report carries no time, so one the node sent before the preview started
  can land after it: while the hub's note lasts (`nodeBusyNotes.ts`, in
  memory) a report of "free" writes what the node observes and leaves
  `nodeBusy`, `nodeHold` and `busy` as they are. The note ends when the
  node has caught up, its report saying "busy" (written as usual,
  `nodeBusyConfirmed`), or when a forwarded stream/stop the node accepted
  ends it. Five minutes (`NODE_BUSY_NOTE_MAX_MS`, or two of the hub's
  `sendNodeDevicesToHubIntervalMs` if longer) is only an upper bound for a
  node that never says busy; until then such a phone waits on the hub,
  which never sends a session to a phone the node holds. Through 2.36 the
  stale report cleared them. (The note's first version, #624, ended after
  two report intervals whatever the node had said, so a report held up in
  retries longer than that still freed the phone.) After the note, the next
  report replaces `nodeBusy` and `nodeHold` as usual.
- **Who holds it** (`nodeHold`, a `report` column). The node's report is
  its own row, `session_id` included; the hub keeps a preview hold from it
  (`manual_<user>_<udid>`, `nodeHoldOf` in `deviceClaims.ts`) apart from its
  own `session_id`, and a session the node runs is not a hold. Nodes of any
  2.x version send it. The dashboard reads `session_id`, else `nodeHold`
  (`web/src/lib/deviceHold.ts` `holdOf`), so the picker, the device cards
  and a reload's tile restore treat a node phone's preview like a local
  one. It is shown, never judged: access stays the node's, so a value up to
  one report stale changes a label and nothing else.
- **Named refusals.** A node's 409 (`device_held_by_another_user`,
  `device_in_use_by_session`) names the holder by id only, since its
  database has no rows for the hub's users. The gate fills in the name
  (`SessionOwnerResolver.displayName`, denyBody's wording) before relaying
  it, and passes anything else on unchanged.
- **The sockets** (`src/app/ws/nodeSocketRelay.ts`). The H.264 and logcat
  WebSockets redeem the hub's ticket, and logcat runs the hub's ownership
  check. For another server's phone `openNodeSocket` then asks the node for
  a ticket of its own (`POST stream/ticket` with the control token) and
  opens the same socket there, logcat's `levels` and `process` included.
  `relaySocket` passes messages both ways unchanged and the node's close
  code and reason to the viewer; a dropped node connection is `1011`. The
  node keeps its multiplexer, replay, drop markers and idle release.
  - The node's socket is handed over paused and resumed once the relay
    listens: the node sends H.264's config packet and logcat's replay the
    moment it opens, and a message with no listener is lost. That made the
    preview never decode.
  - While 4 MB sent to the viewer are unwritten, reading from the node
    pauses. The node then sees a slow viewer and applies its own rule
    (dropped H.264 frames, logcat's visible "lines dropped" record). The
    hub never drops or buffers without bound.
  - A cloud phone or a node that refuses the ticket closes the viewer with
    `1008`, which stops the logs pane with the reason. A node that can't be
    reached is `1011`, and the players retry.

**Recording a node's phone** runs on the hub, from the node's stream. See
"Recording Subsystem" below. While the hub records it, the gate refuses that
phone's `stream/stop` with `409 device_recording`, as `/control` refuses one
for its own phones being recorded. The node doesn't know about the hub's
recording, and stopping its stream would cut the recording short.

Through 2.1 only the five input actions were forwarded. The rest ran on the
hub against a phone it doesn't have: they failed, or with hub and node on
one machine, worked on the hub's own adb by accident. Spec fixtures that
stand for this server's phones carry its node id (`useOwnNodeId`,
`test/helpers/own-node-id.ts`).

**Busy on a hub** (`src/data-service/deviceClaims.ts`). A node's phone is
busy on the hub for one of two reasons, each in its own columns so neither
erases the other: the hub's **claim** (`claimedAt` when allocation took it,
`claimSessionId` once the session exists; a claim with no session id yet is
*pending*) and the node's **report** (`nodeBusy`). `busy` is claim OR report.
Every write that can clear `busy` is one conditional update, never a
read-then-write:

- A node's report (`POST /xenon/api/register?type=add`, the
  `nodeReport` path) writes only what the node observes
  (`pickNodeReportFields`) plus `nodeBusy`. Team, tags, reservation, block,
  `session_id` and the claim are the hub's and are never taken from it. A
  report of "free" clears `busy` only where nothing of the hub's holds the
  phone (`UNHELD`: no claim, and no hold such as a preview or recording in
  `session_id`; and no live lease, `activeLeaseOn`), so a report sent before
  the hub's claim can't undo it.
- A release names the claim it ends (`ClaimRef`: a session id, or a pending
  claim's `claimedAt`), so a stale release for an ended session can't free a
  phone another session has claimed since. It clears `busy` only where the
  phone is then `UNHELD`, so a node still reporting it busy keeps it busy.
- A pending claim isn't idle at the new-command timeout; the idle sweeper
  frees it only after `PENDING_CLAIM_TIMEOUT_MS` (10 min).
- Nor is a session with a command running (`hasCommandInFlight`), nor a
  manual hold (a preview, a recording: `manual_...` in `session_id`, no
  claim), which has no idle clock: its own paths end it (the preview's
  leave, `previewHold.ts`'s idle release, the recording's end). The
  reconciler (`DeviceReconciler`) skips a manual hold too. A session's clock
  is touched through its claim (`touchSession`, `claimWhere`), so a hold in
  `session_id` beside the claim doesn't hide it. Through 2.36 a hold that
  inherited an earlier lease's clock or `sessionStartTime` was freed within
  one sweep while someone watched or recorded the phone.
- Stale cleanup keys a node's phones on its `nodeId`: they stay while any
  host of that node answers (an iPhone filed under an unprobeable
  `remoteMachineProxyIP` included) and go with the node. A hub's own sync
  never prunes a row carrying another node's id (`isOwnDevice`: by `nodeId`,
  else by exact host). A row the hub holds (a claim, or a hold in
  `session_id`) stays through missed probes for `HELD_ROW_GRACE_MS`
  (`PENDING_CLAIM_TIMEOUT_MS`, from the first miss of that claim, in
  memory), so the session's own heartbeat or idle timeout ends it and its
  release finds the claim; the row goes at the next miss after that, or when
  the grace runs out. Through 2.36 it went at the first miss, and the row the
  node's next report recreated had no claim: the session's release found
  nothing, and a hold of the hub's was gone.
- The idle sweeper (`unblockCandidateDevices`) takes a phone an admin
  blocked while a session's claim is on it: a block is maintenance, not a
  hold, and the release leaves `userBlocked` set. A blocked busy phone with
  no session is left alone. Through 2.36 every blocked phone was skipped, so
  a session on a phone blocked mid-run never timed out.
- **A start never waits long on another server** (`syncDevicesAtBoot`).
  Appium opens its port only once every plugin's `updateServer` has
  finished, and `InternalHttpClient` gives a host that drops packets four
  30 s tries. Through 2.17 that kept the port closed for two minutes:
  - a hub's boot stale check reached a node gone, or the hub's own phones
    under its old DHCP address (`nodeId` is new each start, so they look
    like another server's);
  - a node's first report reached a hub that didn't answer.

  Now the stale check at a start asks each host once, for at most 5 s
  (`BOOT_PROBE`), and still finishes before the port opens: allocation has
  no liveness check, so a free row of a dead server would be handed to a
  session, sent there and left waiting. A node's first report goes in the
  background. The 30 s check keeps the client's retries: it deletes a row
  the hub doesn't hold on one failed probe, and a busy node must not lose its
  phones to a short limit. A server slower than 5 s at a hub's start has its phones dropped
  until its next report (`sendNodeDevicesToHubIntervalMs`).
- A node's request to forget phones (`POST /register`, `type=remove` for
  one phone by udid, `type=unregister&host=` when it shuts down) goes through
  `removeNodeDevices`: only that node's rows, by the `nodeId` it sends (a
  node now sends it on both), else by exact host, and never one of the hub's
  own (`isOwnDevice`). A `remove` with no udid, or no host and no id, takes
  nothing. The store used to match a host that isn't a URL as a substring and
  a host-less remove by udid alone, so an older node's bare IP deleted every
  row on that machine, the hub's own included. `removeDevices(filter,
  { exactHost: true })` turns the substring match off.
- The health monitor (`HealthMonitorService`) checks only this server's own
  phones, by the same `isOwnDevice`. It used to run the hub's adb against
  every row: each node phone came back unhealthy, was written over the node's
  report and "recovered", and a busy one whose session the hub didn't hold in
  memory was reclaimed. A node checks its own.
- **Is a session still running here?** `isSessionLiveHere`
  (`src/sessions/sessionLiveness.ts`): SESSION_MANAGER, or Appium's umbrella
  (read without a command). `DeviceReconciler` and the health monitor's
  zombie reclaim ask it, for the row's `session_id` and its claim. Never
  SESSION_MANAGER alone: a local session is there only with the dashboard on
  or its video recorded. Through 2.36 both asked SESSION_MANAGER, so on a
  default server (dashboard off) a session with `xe:record_video: false` lost
  its phone 60-120 s into the test. The reconciler also leaves preview and
  recording holds (`manual_...`) to their own release paths, and the zombie
  reclaim releases by the dead session's claim (`releaseSessionDevice`), or
  clears `busy` only where nothing holds the phone, never with a plain
  `busy: false` write.
- So does the readiness check before a session (`readyForSession`, in
  `allocateDeviceForSession`): only this server's own phones, by
  `isOwnDevice`. For an iPhone it asks WebDriverAgent on 127.0.0.1 and, on no
  answer, starts this server's go-ios stream. Through 2.15 a hub ran it on its
  nodes' iPhones: with the node on another machine the session was refused as
  unhealthy, and with both on one Mac the hub started a WebDriverAgent of its
  own on the node's iPhone. The node checks the phone when it allocates it.
  A session on a leased phone is checked the same way (`assertReadyForSession`,
  once the lease is authorized; a refusal leaves the phone the lease's).
  Through 2.19 the lease branch returned before the check, so a leased
  iPhone's session got the stream's WebDriverAgent only if someone was
  previewing the phone, and the driver otherwise built its own with xcodebuild.
- Discovery reuses a row only when it is its own: same udid and the exact
  host its discovery files the phone under (`androidDeviceHost`,
  `iosRealDeviceHost`, `iosSimulatorHost`). That holds for Android, iOS
  phones (the sync, an attach's `getDeviceInfo`) and simulators. A node on
  the same Mac sees the same iPhone and simulators; until 2.1 iOS matched by
  udid alone and took the node's row, host, ports and busy state included.
- The stream services (`IOSStreamService`, `AndroidStreamService`,
  `AndroidH264StreamService`, `previewHold.ts`) find a phone's row the same
  way: `findOwnDevice(udid)` (`src/device-managers/ownDeviceRow.ts`) looks up
  the udid under each of this server's own hosts (`localDeviceHosts`), never
  by udid alone. They used to take the node's row for a shared udid, so they
  could release the node's preview hold or read the node's session as the
  phone's.

A server with no nodes never sets `nodeBusy`, so its `busy` is its claim, as
before. A lease still locks with `busy` alone (allocation also skips a phone
an active or waiting lease has: its member rows), and a manual hold still
writes `session_id`. Ending a lease clears `busy` by the same rule, one
conditional update where `UNHELD` (`releaseLeaseLock`, both stores), so it
never frees a phone a session or a hold still has, and clears the lease's
`lastCmdExecutedAt` and `sessionStartTime` with it (through 2.36 they
stayed, for the next hold to inherit).

**A manual hold is written and ended conditionally**
(`takeManualHold` / `releaseManualHold`, both stores; `blockDevice` and
`releaseManualHold` in `device-service.ts`).

- **Written** only where the phone has no claim, pending or not, and
  nothing in `session_id` but a manual hold (`isHoldable`), in one update
  conditional on the row it judged. A session's phone stays the session's,
  and its preview runs under the session's lock. `blockDevice` says whether
  the hold took. The hold carries no idle clock.
- **Ended** for that hold only (or any manual hold when the caller doesn't
  know whose: a recording's end): `session_id` cleared where it is that
  hold, a claim beside it untouched, then `busy` cleared where `UNHELD` and
  no live lease holds the phone. Every preview stop and leave, the Android
  idle release, the iOS stream's stop, a stream/start's reclaim and a
  recording's end use it.
- Through 2.36 the hold was read then written (over a pending claim, or
  beside a claim taken in between), and every release went through
  `unblockDevice` (`forceRelease`), which wrote the claim away and `busy:
  false` whatever held the phone.

**`maxSessions`** (`allocateDeviceForSession`, `countsTowardMaxSessions` in
`deviceClaims.ts`) limits Appium sessions, so it counts the phones running one
or being given one: this server's claim (pending or with its session id), an
Appium session's id in `session_id`, and a node's phone the node reports busy
unless `nodeHold` says it is a preview. A live preview or recording
(`manual_...`) and a lease with no session on it (or a phone held for a
waiting lease) keep a phone busy without using a slot; a session started on a
leased phone claims it, so it counts, though a lease-bound create is never
held back itself (it returns before the check).
The check is `>=`: through 2.13 it was `===` over every busy phone, so once the
count was past the limit (three previews, an idle lease) nothing was held back.
The count, the phone choice and its claim run under one in-process lock
(`ALLOCATION_LOCK`), or parallel creates that all read "one slot left" would all
claim and run past the limit. A value below 1 is no limit (`sessionCap`).

Because `busy` is a lease's only lock, the readers that decide who may use a
phone ask the lease table itself (a live lease's member rows: active and not
past `expiresAt`, or waiting and not past `waitUntil`;
`src/services/lease/activeLeases.ts`), not `busy`:

- **Allocation** skips leased phones (`findAndLockDevice`), and offers it every
  unreserved candidate as exact `udid@host` keys (`LockOptions.only`), so a
  leased first candidate can't stall the create and a reserved twin on another
  host can't be locked in a candidate's place.
- **The ownership guard** treats a live lease's creator (the key, or any
  credential of the user behind it: `SessionOwnerResolver.leaseHolderOf`) as
  the phone's holder (Device access guard, below), and so does the logcat
  ticket authorizer. It also checks `stream/start` for the lease alone
  (`LEASE_CHECKED_MUTATIONS`), before the handler and before a hub forwards
  the call to a node, which knows nothing of the hub's leases; the handler
  then lets the holder preview a phone busy only by their lease.
- **Recordings** (`BusyPrecheck`) refuse a leased phone to anyone but its
  holder (reason `leased`).

Three writers keep `busy` for a lease:

- **The idle sweeper** (`releaseBlockedDevices`) skips a leased phone with no
  session or hold on it; the lease's heartbeats and expiry time it out
  (`LeaseOrphanSweeper`). A lease writes `lastCmdExecutedAt` when taken, so the
  sweeper used to free the phone a new-command timeout later, before a slow
  first session had started. If it can't read the leases it skips the tick.
  A lease-bound session itself is swept at its own `appium:newCommandTimeout`,
  which allocation records on the row as it does for an allocated phone.
- **A session's release** (`releaseClaimOn`, `keepLeaseLock`) hands a leased
  phone back to its lease: `busy` (and `lastCmdExecutedAt`) are written again,
  then the lease is checked once more and the write undone with
  `releaseLeaseLock` if the lease ended in between.
- **The lease queue's pass** (`relockLeasedPhones`, first in
  `LeaseQueue.serveQueue`, under `ALLOCATION_LOCK`) writes `busy` again on
  every phone a live lease holds or leases that shows free and that nothing
  else holds (`isUnheld`, not offline), with `keepLeaseLock`'s write, re-check
  and undo. That is also how a held or leased phone is locked again after a
  restart (see "Group leases").

Other writes still clear `busy` without asking: a node's report on a hub
(`addNodeReport`, where `UNHELD`), `forceRelease` (`unblockDevice`, now only
for a busy row nothing names: the idle sweeper's phone with no session on
record, the plugin's shutdown with no session id) and session recovery. A
leased phone can then list as free until the queue's next pass (at most 5 s),
but the readers above still hold it to the lease.

**Heals on a node's phone** (`src/gateway/healReport.ts`). A forwarded find
heals in the node's interceptor, and the node keeps no record of the hub's
session. So the node's gateway (only a node's: on a hub or a standalone
server the hub token header proves nothing, and a client could send one to
keep its heals out of the record) runs a hub's command inside
`runReportingHeals`, and the interceptor puts the heal on the answer
(`x-xenon-heal`, base64url JSON) instead of recording it. The hub takes the
header off before relaying (`takeHealReport`), never forwards a client's,
and records the heal with the command, through the dashboard's hooks, so
only with the hub's dashboard on, as for a local session. A heal too long
for the header (8 KB; the hub's parser refuses 16 KB of headers) goes
unrecorded rather than fail the command. The context holds the answer only
until it closes: work the command started keeps the context, not the answer. The hub's log also takes a
forwarded find's strategy and selector from its W3C body, so node finds
count for verification. Through 2.14 the heal was recorded nowhere and the
find was logged as found. A node learns fingerprints for its own phones'
sessions, in its own database (see "6-Tier Self-Healing").

**Not supported:** BiDi and session WebSockets through the hub; the
`webSocketUrl` a session returns points at the node, so nodes must not sit on
untrusted networks.

### Device Streaming (`src/device-managers/{ios,android}/*StreamService.ts`)

Independent of Appium sessions, each platform has a stream service that brings up an MJPEG feed for live preview / recording:

- **iOS**: `IOSStreamService` starts the phone's own go-ios tunnel (iOS 17+, `IOSTunnels`, see below), launches WebDriverAgent via `runwda`, and forwards local ports `wdaPort:8100` and `mjpegPort:9100` with `iproxy`. WDA's MJPEG server is enabled via `/appium/settings`. Stream sessions are tracked in `this.sessions` with a watchdog that idles out streams after 10 min of zero viewers (unless the device is busy with an Appium session).
- **Android**: `AndroidStreamService` uses ADB + a built-in capture pipeline (MJPEG). A faster, flagged **H.264 live-preview** path also exists — see "Android H.264 live preview (scrcpy)" below.
  - **A stop overtakes a start.** `stopStream` bumps the phone's start epoch and forgets the
    start in flight (`SingleFlight.forget`); the start checks the epoch after each await, gives
    back what it holds (its server, port lease, entry) and fails with
    `AndroidStreamStartSuperseded`, and the next `startStream` is a new start. The capture loop
    and frame writers run while their session is the phone's entry and not `ended`, never on
    `status` alone. Through 2.36 a stop during the up-to-5 s first-frame wait left the start to
    set the detached session `running`: its capture loop took screenshots for ever against a
    closed server, and the start returned that dead port and wrote it to the Device row.
  - **Viewers are counted on the stream they joined.** GET `/control/:udid/stream` takes
    `addViewer(udid)`'s leave, bound to that entry (as `H264Multiplexer.addClient` does). Through
    2.36 it counted by udid, so a viewer of a stream that was restarted uncounted the new stream's
    viewer on leaving, and the idle release stopped a stream someone still watched. An iPhone's
    viewer is counted the same way (`IOSStreamService.addViewer`); through 2.36
    `updateViewerCount(udid, ±1)` counted it by udid.
  - **An iPhone stream's hourly lease refresh** (`refreshStreamLeases`) extends its WDA and MJPEG
    port rows only while they are still this phone's (`PortAllocator.touch(port, ttl, udid)`).
    Through 2.36 they were touched by port alone, so a port reaped and handed to another phone
    had its new owner's expiry moved.

**Where go-ios comes from** (`src/device-managers/ios/goIosBinary.ts`,
`scripts/fetch-go-ios.js`). Every go-ios command Xenon runs (`runwda`,
`tunnel`, `ostrace`, `syslog`, `sysmontap`, `screenshot`, `install`, `apps`,
`info`) uses `goIosBinaryPath()`: `vendor/go-ios/ios` beside that module, so
`lib/src/device-managers/ios/vendor/go-ios/ios` in the package and the
fetched `src/` copy under ts-node. Nothing is downloaded at run time. Through
2.17 it was `~/.cache/xenon/goIOS/ios`, put there by hand:
`lib/src/scripts/install-go-ios.js` (the README's step 2, or Xenon Control's
Set up), once and again after every upgrade. Missed, an iPhone's preview
failed (`go-ios not available`) and every session on it was refused as
unhealthy; after an upgrade that moved the pin, the old go-ios kept running.

- **Not a dependency.** npm's `go-ios` package has a `postinstall` that
  copies `ios` into npm's global `bin`, over any `ios` on the PATH, and exits
  1 where that folder isn't writable (read from the script, not run); npm 10
  and 11 run it during `appium plugin install`. Its tarball also holds every
  platform's build, 58 MB, for the one 44 MB file.
- **The build takes it** (`npm run build`, after `tsc -b`, the pin read from
  the compiled `goIosVersion.js`; logic in `scripts/lib/go-ios-bundle.js`).
  `npm pack <GO_IOS_PACKAGE_SPEC>` into a temporary folder beside the target
  (npm checks the registry's integrity, uses the developer's registry and
  proxy, runs none of the package's scripts), `tar -xzf` of
  `GO_IOS_PACKAGE_ENTRY` alone, its SHA-256 must be `GO_IOS_SHA256`, `chmod
  0755`, one rename into `src/device-managers/ios/vendor/go-ios/ios`
  (gitignored: 44 MB a version would stay in the history). A binary already
  there with the pinned hash is kept, so later builds fetch nothing. Any
  failure fails the build and leaves nothing in place. `build:copy` removes the
  old `lib/` binary, then copies the folder (binary, `LICENSE-go-ios.txt`,
  `README.md`) to `lib/` with `cp -p`, keeping the mode. The copy must be a new
  file: `cp` over an existing one keeps its inode, and macOS caches a binary's
  code signature per vnode, so after a pin bump the new go-ios could be killed
  at launch ("Killed: 9").
- **Whether it can run** (`checkGoIosBinary`, behind `isGoIOSAvailable()`):
  not off macOS, not when the file is missing, and not when it isn't
  executable and one `chmod 0755` can't make it so. `goIosStateMessage` names
  the path and says "Reinstall the plugin." (off macOS, that iPhones need a
  Mac). On a Mac with `platform` `ios` or
  `both`, the start logs `go-ios v1.2.1 (comes with Xenon): <path>`, or that
  warning (`goIosStartupReport`). No hash at run time: the build checked it.
- **The reap matches by path** (`reapAllOrphanTunnels`, `pgrep -f` / `pkill
  -9 -f`). `goIosProcessPattern` ERE-escapes the path and single-quotes it:
  the bundled one sits under `APPIUM_HOME`, which can hold `+`, `(` or `[`.
  At start (`reapOrphanTunnels({ includeLegacy: true })`) it reaps the bundled
  path and `legacyGoIosBinaryPath()`, the old cache copy a run from before the
  upgrade may have left running; at shutdown the bundled one only. The legacy
  path stays until 3.0. So two servers with different `APPIUM_HOME`s no
  longer reap each other's go-ios; two sharing one still do.
- **The old installer** is now a check, kept so the README's old command and
  older Xenon Control versions' Set up still succeed: exit 0 "go-ios v1.2.1
  comes with this Xenon (<path>). Nothing to install.", exit 1 with the
  missing or not-executable message. `download` left the dependencies.
- **Xenon Control** takes `lib/src/device-managers/ios/vendor/go-ios/LICENSE-go-ios.txt`
  as the sign that a plugin ships go-ios (`GO_IOS_BUNDLE_MARKER`): Set up then
  has no go-ios step, and the iPhone support check reads the bundled binary.
  The licence and not the binary, so a missing binary reads as a broken
  install (`incomplete`, "Reinstall Xenon for this profile.", with a "How to
  reinstall" link to `xenon-control#when-iphone-support-is-missing`, never Set
  up, which updates rather than reinstalls), never as an older Xenon. Moving or renaming the folder breaks that.
- **Publishing.** `prepublishOnly` is `npm run build:all && node
  scripts/fetch-go-ios.js --check-package`: the copy in `lib/` must be there,
  executable by all and the pinned hash, and `npm pack --dry-run --json
  --ignore-scripts --foreground-scripts=false` must list it with an
  executable mode (an entry listed without one fails). Under npm 10 that pack
  still runs Xenon's own `prepare` (`prisma generate`), so the publish job
  generates the client twice; `--foreground-scripts=false` keeps its output
  out of the JSON.
- **Moving the pin.** The steps are in
  `src/device-managers/ios/vendor/go-ios/README.md`: `GO_IOS_VERSION` (a
  literal `export const`, which Xenon Control reads from the compiled file as
  text), `GO_IOS_PACKAGE_SPEC`, `GO_IOS_PACKAGE_ENTRY` and `GO_IOS_SHA256` in
  `src/scripts/goIosVersion.ts`, the licence, and the two specs that expect
  the version in a message (`test/unit/install-go-ios.spec.ts`,
  `test/unit/go-ios-binary.spec.ts`). The build fails until the hash matches.
  Then check on a lab iPhone that WDA stays up past 10 minutes (#187). A
  release on GitHub but not yet on npm can't be pinned.

**An iPhone session's WebDriverAgent** (`SessionLifecycleService.handleLocalWDAProvisioning`,
`IOSStreamService.provisionWda`). With a signed WebDriverAgent in the app
library (`getWDAApp`), a session that finds no stream running starts one
(`startStream`) and points the driver at its WDA; with one running it reuses
it. Through 2.21 that cost about 9 s per session (Xenon Test's ENH-15):

- **The install** is skipped while this server process last installed the
  same build on that phone (`installedWda`, keyed `wdaArtifactKey`: app id
  and md5). If runwda then finds no WebDriverAgent (`WdaNotInstalled`), the
  start runs once more with the install. The record is in memory: the first
  start after a restart installs.
- **No fixed wait:** `startStream` returns once WDA answers `/status` and its
  MJPEG port listens, asked every `WDA_READY_POLL_MS` (250). Through 2.21 a
  2 s sleep followed in provisioning, and readiness was asked every second.
- **`keepIosStreamBetweenSessions`** (off by default): a session's end
  (`stopIdleStreamForDevice`) leaves a real iPhone's running stream for the
  next session (`keepForNextSession`, which restarts its idle clock) instead
  of stopping it, and the idle watchdog stops it after `IOS_IDLE_STOP_MS`.
- **Measured** (iPhone 17 Pro Max, dashboard on, two sessions back to back):
  2.21.0 11.3 s and 9.7 s; with the install skip 11.4 s and 6.2 s; with
  the option on too 10.8 s and 2.5 s. Dropping the 2 s wait showed no gain
  of its own.
- **Only sessions in `SESSION_MANAGER` stop their stream** at the end:
  `stopIdleStreamForDevice` runs in `onSessionStopped`'s branch for them. A
  local session is there with the dashboard on or a video recorded
  (`record_video` defaults to on). With both off the stream already outlived
  the session through 2.21 (a second session started in 0.6 s), as with
  the option on, but without the idle clock restarted.

**A go-ios tunnel per iPhone** (`src/device-managers/ios/IOSTunnels.ts`). On
iOS 17+ the go-ios commands Xenon runs against a phone (`runwda`, `ostrace`,
`syslog`, `screenshot`) reach it through a go-ios tunnel. Each phone gets
its own: `tunnel start --udid <phone> --userspace --tunnel-info-port <P>`, a
per-device agent on a pair of ports leased from the `tunnel` range
(12100–12199, `PortAllocator.acquirePair`). P is its tunnel-info API, and
go-ios derives P + 1 for the phone's traffic.

- **Finding it.** A command finds its phone's tunnel through
  `GO_IOS_AGENT_PORT` (`IOSTunnels.envFor`). A phone with no tunnel gets the
  plain environment.
- **Starting it.** A start waits up to 20 s for `GET :P/tunnel/<udid>` to
  answer 200, then goes on with a warning. A tunnel that exits before then
  fails the start.
- **One start at a time per phone** (`starts`, a `SingleFlight` over the
  version read, the lease and the spawn). A stream start, a screenshot and
  the metrics sampler asking at once share one tunnel, and each makes its
  own claim, so a stream joining a screenshot's start owns the tunnel.
  Through 2.36 each passed the "running?" check before the first had leased
  its ports, so each started a tunnel; the one set last won, and the
  others' go-ios ran on untracked with their ports leased.
- **Its ports.** The pair belongs to the tunnel, which gives it back when it
  stops. A session ending on the phone leaves it (`releaseForUdid` skips the
  `tunnel` purpose), since the phone's stream and tunnel can outlive it.
- **Losing it.** go-ios does not end an agent when its phone is unplugged.
  The agent drops the phone's tunnel, and on the replug starts a new one on
  its next traffic port, P + 2, then P + 3: the next phone's leased pair.
  So `IOSTunnels.checkTunnels` (every 5 s) stops a tunnel whose agent
  answers 404 for its phone after it was ready, or names a traffic port
  other than P + 1, and gives its ports back. A start refuses a tunnel that
  comes up on another port the same way. The phone's next start gets a new
  pair. A tunnel whose process exits (a crash) gives its ports back too.
- **Who drives it.** The stream's start and stop. At boot, Xenon reaps go-ios
  and then drops every `tunnel` lease. The reap kills every process running
  the bundled go-ios binary or the legacy `~/.cache/xenon/goIOS/ios`, matched
  by path (a shutdown's reap the bundled one only: see "Where go-ios comes
  from"). This server's own are among them, so it runs as soon as the
  database is ready, before device detection starts
  (`ServerManager.reapLeftoverGoIos`). Run last, it killed the `ios info`
  call detection makes in the background for each plugged-in iPhone.
- **Why.** Through 2.7 every tunnel took go-ios's default ports, 60105 and
  60106. A second iPhone's stream kill -9'd whatever listened there, which was
  the first iPhone's live tunnel, so only one iOS 17+ iPhone per Mac could
  stream. Nothing is killed by port any more.

**go-ios tunnels and Appium sessions.** The xcuitest driver never uses
go-ios. But an Appium session allocated while a stream runs drives the
stream's WDA (`iOSCapabilities` sets `webDriverAgentUrl`), and on iOS 17+
that WDA reaches the phone through the phone's tunnel. So that session
depends on the stream's WDA, forwarder and tunnel. Three rules follow:

- `cleanupOrphanTunnels` (the phone's own tunnel through `IOSTunnels.stop`,
  then a reap of that phone's untracked go-ios processes) never runs while an
  Appium session holds the phone
  (`heldByAppiumSession`: busy, non-manual `session_id`), or when its row
  can't be read. The sweep waits for the next stop or start after the
  session; a restart reaps every go-ios process at boot.
- A viewer's stop (`stream/stop`, `stream/leave`, via
  `stopStream(udid, { forViewer: true })`) stops nothing while an Appium
  session holds the phone and the stream launched its own WDA, or is still
  starting (the start isn't cancelled: the session may be waiting on it).
  The session's teardown (`stopIdleStreamForDevice`) or the idle watchdog
  stops it later. Shutdown still stops it.
- A start never restarts a running stream whose WDA doesn't answer while an
  Appium session holds the phone, as the watchdog's heal already skips a busy
  device. `startStream` throws `StreamRestartRefused`, naming the session,
  and leaves the stream as it was (not marked `error`, no cooldown). A restart
  would kill the WDA and tunnel the session may be driving, or launch a
  second WDA over the session's own. A WDA that is only slow to answer
  `/status`, during a long command, used to be killed this way when someone
  opened the preview. With no session on the phone, a restart still recovers
  a dead WDA.

**An iPhone stream's starts, restarts and stops** (`IOSStreamService`):

- **A stop is the end of use; a restart isn't.** `stopStream` (the viewer's
  stop or leave, the idle sweep, a session's teardown, shutdown) ends the
  stream and releases the phone's preview or recording hold. A restart (a
  retry or the watchdog finding WDA dead) and the teardown before a start
  only dispose of the stream (`disposeStream`: processes, tunnel, orphan
  sweep, ports) and keep the hold, as Android's `disposeSession` does.
  Through 2.36 both ran `stopStream`, so a tile's retry released the hold of
  a viewer still watching and nothing wrote it back.
- **A stop cancels a start still running.** Every stop moves the phone's
  start generation on; a start checks it after each wait, and once it isn't
  its own, ends what it spawned, gives back the ports it leased and throws
  `StreamStartCancelled`: no `error` record, no cooldown. stream/start then
  answers `409 stream_stopped` and writes no hold, nor does it write one when
  the stream is no longer running by the time it would. Through 2.36 a stop
  deleted the entry and the start went on with its own copy: its iproxy and
  runwda ran on unowned, and stream/start wrote the hold a leave had just
  released (leaving an iPhone preview within ~10 s of opening it).
- **One start at a time per phone.** Concurrent starts share one run
  (`startFlight`, keyed by udid and generation), which alone decides whether
  a running stream whose WDA died restarts, so two retries restart it once
  and a retry during a restart joins it. A start asked for after a stop runs
  on its own, but only once the cancelled start and the stop have finished
  (`pendingWork`), so neither can end what it starts. Through 2.36 the
  restart check ran outside the single flight, and a retry during a restart
  was refused by the cooldown the restart had just set.
- **A failed start ends what it started**: its forwarders and runwda, its
  tunnel (unless an Appium session may use it) and its port leases. Its
  entry stays, status `error`, only as the record for `stream/status` and the
  start cooldown, and stream/start's conflict check doesn't count it as a
  live stream, so another user's leftover hold beside it is reclaimed.
  Through 2.36 the processes and leases stayed until the phone's next start.
- **The hourly watchdog heals.** It checks the cooldown, then calls
  `startStream`, which records the attempt when it restarts. Through 2.36 it
  recorded the attempt first, so the start found its own cooldown and
  refused: the heal never ran. It still skips a busy phone (a preview hold
  included) and never restarts under an Appium session.

**WDA names no phone.** `/status` has `os`, `ios.ip`, `build` and `device`
(the form factor); `/wda/device/info`'s `uuid` is `identifierForVendor`, not
the UDID. So `isWDARunning(port, retries)` says whether *a* WDA answers,
never whose, and takes no udid. A caller relies on knowing the port is the
phone's: its own stream's lease, or the Device row's `wdaLocalPort` while an
Appium session holds that phone (the attach branch). So Xenon reaches WDA
only on those ports on 127.0.0.1, never at a network address. Through 2.9,
`WDAClient` and the stream watchdog fell back to `<device ip>:8100`. go-ios
never reports an iPhone's address, so for iPhones that never ran. A
simulator's address is this Mac's own, though, where 8100 can be an iPhone's
WDA forward.

**A simulator's WDA is the driver's.** Xenon runs WDA only on an iPhone (the
stream's go-ios `runwda`). On a simulator the XCUITest driver builds,
installs and launches it on the session's `wdaLocalPort` (`iOSCapabilities`)
once Appium creates the session, as plain Appium does, and boots a shut-down
simulator itself. Its MJPEG server listens on this Mac at the session's
`mjpegServerPort`. So for a simulator:

- `readyForSession` asks nothing. From 1.0.0 through 2.15 it required WDA
  to answer on every iOS device, before the driver had run, and "recovered"
  a simulator by rebooting it, which starts no WDA. A session on a simulator
  whose WDA wasn't already up was refused ("Device <udid> is unhealthy and
  could not be autonomously recovered").
- `iOSCapabilities` never hands it a stream's WDA (`webDriverAgentUrl`). A
  stream entry for a simulator is at most a preview's attach to an earlier
  session's WDA, which this session's driver neither started nor can
  restart.
- The session video is read from the session's `mjpegServerPort`
  (`LocalSession.startVideoRecording`), never through `IOSStreamService`.
  Its iproxy forwarded nothing on a simulator, so no video was written.
- No performance recording is stopped at the end (`finalizeCleanup`). Xenon
  starts one only on an iPhone, the driver refuses a stop on a simulator
  without relaxed security, and the refused stop counted as a failed command
  of the session, so every simulator session ended failed.
- **Its live preview is its running test's picture**
  (`IOSStreamService.startSimulatorStream`, `isIosSimulator`: an Android
  emulator's `realDevice` is false too).
  - An entry pointing at the ports the session's driver runs WDA on
    (`AppiumUmbrella.driverOptions`), with no process and no port lease.
    Never the row's ports, and never a session `endSimulatorPreviews` has
    ended: during a teardown the row still names the session, and an entry
    registered then would outlive it.
  - Ended however the session ends (`forgetSessionMemory` →
    `endSimulatorPreviews`). `stream/start` writes no preview hold for a
    simulator: its test holds it, and a hold written as the test ends would
    hold a free simulator.
  - With no test running a start throws `SimulatorPreviewNeedsTest`:
    `stream/start` answers `409 simulator_needs_test`, and `stream/status`
    gives `lastError` and `reason`. A Live devices tile shows the reason at
    once (from its first status, or the liveness poll that sees the test
    end) and tries again when a test starts. Device control follows the
    simulator's tests (start, the next one, the end) without calling
    `stream/start`, which refuses a member another user's test. A phone in
    a test can't be opened or added, so both are there first.
  - Through 2.15 a simulator went through the iPhone's start: with no test
    it failed and left its iproxy forwards on the simulator's leased ports,
    where the next test's WDA couldn't start; with a test the tile read a
    forward that carries nothing.

`UniversalMjpegProxy` (`src/helpers/UniversalMjpegProxy.ts`) multiplexes a single upstream MJPEG to many browser clients. It speaks both standard HTTP MJPEG and a raw-socket fallback for WDA's headerless variant, drops lagging clients (>4 MB kernel backlog) to prevent OOM, and uses bounded retries with exponential backoff (max 10 attempts, 500ms→10s).

- **One upstream, and none when nobody watches.** Its state is explicit (`idle | connecting |
  connected | backoff | stopped`, `sourceState`) and changes only in `transition`: a source is
  opened only from `idle` (or by the backoff's one timer), and viewers arriving while it connects
  or backs off wait for it. A viewer's leave is registered before the connect wait, and every
  leave goes through `removeClient`, waiting viewers included; the source goes when the last one
  does, and a source that answers with nobody left is let go at once. A source's callbacks are
  ignored once it was let go (`sourceGeneration`), the raw fallback replaces the HTTP attempt
  synchronously, and the HTTP source has its own connection (`agent: false`).
- Through 2.36 each viewer arriving while it wasn't connected started another upstream, the
  backoff timer one more, and only the last could be stopped. A viewer that hung up during the
  connect wait was added once the source answered, then pruned without stopping the source: an
  upstream ran with nobody watching, which on Android is a viewer of the phone's MJPEG server
  (screencap at full rate, the preview hold never released).

The browser-facing URL is always `/xenon/api/control/:udid/stream` (proxy URL). Hitting it auto-starts the underlying stream service if the device is iOS — the GET handler dedupes concurrent starts via `IOSStreamService.startPromises`.

#### Android H.264 live preview (scrcpy) — flagged, MJPEG fallback

The MJPEG path above tops out at ~1 fps on Android (per-frame `screencap`). When
`pluginArgs.streaming.androidH264` is on (**default OFF**), Android live *preview*
(not recording — see the phase-1 coexistence rule) uses a continuous, hardware-encoded
H.264 stream instead. The flag is a union: `true` → scrcpy (default source);
`{ source: 'scrcpy' | 'screenrecord' }` → pick the source explicitly (`resolveAndroidH264`
in `src/app/routers/androidH264Config.ts` normalizes all three shapes to
`{ enabled, source }`). iOS is untouched.

Pipeline (source-agnostic downstream): capture producer → `H264NalParser` (Annex-B →
config/key/delta packets) → `H264Multiplexer` (one upstream → many clients, config +
keyframe-gated join, GOP replay for late joiners) → authenticated WebSocket
`/xenon/api/control/:udid/stream/h264?ticket=` → `WsH264Player` (WebCodecs
`VideoDecoder` → `<canvas>`).

- **scrcpy source** (`ScrcpyServerSession`, `src/device-managers/android/ScrcpyServerSession.ts`):
  pushes the vendored `scrcpy-server-<ver>.jar` (`vendor/`, pinned by `SCRCPY_SERVER_VERSION`
  in `scrcpyVersion.ts`) with the resolved adb (never a bare `adb`), starts it via
  `app_process` in raw-stream mode (all three `send_*_meta=false` → pure Annex-B), and
  connects over `adb forward` + `localabstract:scrcpy`. **`adb forward` accepts the local
  TCP immediately — before the device socket is bound — so `connectWithRetry` treats a
  connection as real only when the first byte (scrcpy's `send_dummy_byte` readiness byte)
  arrives; a close/error before any byte retries.** No time cap, forced initial keyframe →
  near-instant first frame.
- **screenrecord source** (`openScreenrecordCapture` in `AndroidH264StreamService`): the
  prior 1.9.x path, kept as a code-level rollback. `adb screenrecord --output-format=h264`
  with a ~3-min cap (auto-restart) and a several-second cold start on a static screen.

Selection: `resolveStreamType(platform, flagOn, recording, clientCanPlayH264)` (`streamType.ts`) — Android +
flag on + not recording + a page that can play it → `h264`, else `mjpeg`. **One capture per Android
device where it can be**, so a page says what it shows: `stream/start` takes `{ player: 'mjpeg' }`,
and `XenonApiService.startStream` sends it by itself in a browser with no WebCodecs (exposed only on
https and localhost, so plain `http://hub:4723` has none).

- **Who sends it.** Device control, for an Appium session's own video and when its H.264 player
  fails or shows no frame in 30 s. A Live devices tile (`DeviceTile`'s `fallBackToMjpeg`), when its
  player fails, shows no frame in the connect window (`CONNECT_TIMEOUT_MS`), or gets no ticket.
  Neither opens an `<img>` until that start has answered, and a tile opens none before it knows
  which player it shows: an `<img>` is a `GET /stream`, which starts the screencap loop. Through
  2.13 both did, beside scrcpy, and a tile's scrcpy capture ran on until the H.264 service's idle
  stop, 10 minutes later. The tile sets its state in a fixed order because a socket's close calls
  `onFatal` outside React 17's batching, so each update renders alone.
- **A tile's connect window** (`CONNECT_TIMEOUT_MS`) runs only while it is `connecting` with a
  player open. Switching to the H.264 player sets `connecting` first: after a recording the MJPEG
  `<img>` had made the tile `live`, and through 2.36 it stayed so, showing Live over a black canvas,
  taking taps, with no window to replace a socket that sent nothing. While neither player is open
  (the status on mount, a fallback waiting for its `stream/start`) nothing is counted; through 2.36
  a slow answer spent the MJPEG retries and ended on "Connection failed". A request that never
  answers is given up after `PENDING_ANSWER_LIMIT_MS` (125 s, just above the server's 120 s start
  cap): the status and ticket fetches are aborted, a start's late answer is dropped, and the tile
  shows "Connection failed" with Retry. A failure reason fetched
  before a Retry, or a fallback still waiting when a refusal comes, is dropped.
- **Device control's own stream** follows the tile's rules: a live MJPEG `<img>` asks
  `stream/status` (`useStreamLiveness`, not for an Appium session's video) and reopens a stream
  that ended; a start run again (a back/forward-cache restore) starts its loaded, failed and retry
  state over; an image error's 2 s reopen is cleared with the page; and the start's end opens no
  `<img>` while a fallback waits for its `stream/start` (`fallbackPending`). Through 2.36 the page
  froze on a stream that ended, kept a failed state after a restore, and could open the `<img>`
  beside the H.264 capture.
- **What the server does** (`AndroidH264StreamService.endWhenUnwatched`). It never cuts H.264 under
  a viewer still playing it: another tile, tab or admin may be. It ends the H.264 capture before
  the screencap one starts if nobody watches it, else the moment the last viewer's socket closes
  (the multiplexer's `onEmpty`), never after the idle wait. Until then both captures run. A capture
  still starting is left to the viewer it is for, and the watchdog's next look (`sweep`, every
  60 s) ends it if that viewer never comes. A page falling back never stops or leaves the stream.
  A recording still ends H.264 at once (`ensureMjpegForRecording`, and `stream/start` for a phone
  being recorded).
- **A stop during a start** (`H264StartSuperseded`). The session is in the map before the first
  await, so a stop finds it; whatever `openCapture` returns afterwards is killed, the start fails,
  and the next start is a new one (`SingleFlight.forget`). A capture's exit handlers act on their
  own session (`CaptureOwner`, passed to `openCapture`), never the phone's current one. Through
  2.36 `stop()` killed a capture still undefined, `openCapture` then assigned it to the detached
  session, and scrcpy (no time cap) ran until the process exited; a scrcpy crash stopped whatever
  capture was current, and an orphaned screenrecord restarted itself while a newer one ran.
- **Never beside a recording, whoever starts it** (`H264RefusedWhileRecording`). `start()` asks
  `RecordingStore.isRecording` for this server's own row (`phoneIsRecording`). Through 2.36 only
  `stream/start` asked, and the WebSocket's auto-start (a page opening `/stream/h264` straight
  from a ticket) started H.264 beside a recording's screencap. The socket answers that `1011`, and
  the player falls back through `stream/start`, which chooses MJPEG.
- **A capture stopped under its viewers** (a recording starting, `stream/stop`): `stop()` closes
  their sockets with `1012` "stream ended" (`H264Multiplexer.close`, `STREAM_ENDED`); a hub's relay
  passes it on. Through 2.13 they stayed open with no frames, and the picture froze on its last
  frame. `WsH264Player` reports it as `onFatal({ streamEnded: true })`, and the tile and device
  control then open the `<img>` without a `stream/start`: no H.264 capture is left to end, and a
  start would take back a hold a stop had just released. Every other failure is `streamEnded:
  false` and asks first.
- **On a hub**, a node's phone's `stream/start` is forwarded with its body, so the node decides. A
  node on 2.13 or older ignores `player`: it answers `h264`, keeps its H.264 capture, and the
  tile's `<img>` starts the screencap one beside it until the node's idle stop. Upgrade the nodes.

`control.ts` `stream/start` starts the H.264
service; a scrcpy start failure throws and the handler returns HTTP 500 (it does *not*
downgrade the response to `mjpeg`). The effective MJPEG fallback is **player-level**:
`WsH264Player`'s `onFatal` swaps a failed/dying H.264 stream to the MJPEG `<img>` (the same
`stream-retry` path iOS uses), so a scrcpy-incapable device still ends up on MJPEG.

### Recording Subsystem (`src/services/recording/`)

Live recordings are independent of Appium "session video" — the mosaic page can record any device that has an active stream service.

- `RecordingOrchestrator.start({ phones, actorId })` spawns one ffmpeg per device (writing per-device mp4) and, for ≥2 devices, a single composite ffmpeg that scales+pads each MJPEG input into a uniform cell and stacks them with `hstack`/`xstack`. Composite output is at `compositeOutputPath(groupId)` = `${recordingsAssetsPath}/_groups/<id>/composite.mp4`.
- `BusyPrecheck` does an atomic multi-UDID check before any side effect, so a partial group is never created.
- **One capture per phone, also while one starts** (`starting`, `reservePhones`). The row `isRecording` reads is written only after the hold, the source port (up to 90 s for a node's relay) and a Session lookup, so start and add-device reserve each phone in memory before the busy check, until their start is over. A phone another start holds is refused like one recording (`recording_other_group`). Through 2.36 two quick starts of one phone both recorded it.
- **A recorded phone is `udid@host` everywhere** (`RecordedPhone`): the busy check, the source (a node's phone by its own row's host), holds, `isRecording`, the group's maps and `stream/stop`'s "being recorded" check. The route resolves each `udids` entry with `findPhone` (see "Phone identity"), all or nothing; a phone named twice is `400 duplicate_phone`. Through 2.33 every one of them went by udid, and an observer recording refused a same-named phone (`shared_udid`).
- `ConcurrencyGate` enforces a server-wide `maxConcurrentRecordings` cap.
- `ProofBundleService` streams a zip with manifest, README, per-device `video.mp4`/`bookmarks.json`/`annotations.json`/`device.json`, and the composite mp4 if present.
- **A composite that ends on its own** (a stream gone for good, ffmpeg crashed) is reported: `VideoPipelineService` calls the composite's `onExit` only for an exit `stopComposite` didn't ask for (it drops the handle before awaiting, as `stopRecording` does), and the orchestrator logs it, counts a composite failure and writes `composite-ended.json` beside the composite (`readCompositeEnded`). The phones' own recordings go on. The proof bundle still carries the composite, and its manifest (`composite.endedEarly`, `exitCode`, `endedAt`) and README say it stops early. The group's stop still remuxes it. The summaries' `hasComposite` and the active list's `compositeEnabled` ask `hasCompositeFile` (a file with something in it, as the download does). Through 2.36 the exit only dropped the handle, nobody heard of it, the file was left fragmented, and an empty composite was offered and then refused.
- `recoverOnBoot()` marks any orphan `RECORDING` rows from a previous process as `FAILED` with `fail_reason=server_restart` and releases their manual blocks (only where the phone still holds that recording's own: see observer groups below, and only where this call ended the row).
- **A recording ends once** (`RecordingStore.finalize`, `writeEnd`). `finalize` is a transition, `RECORDING` to `STOPPED`/`FAILED` (`updateMany where { id, status: 'RECORDING' }`), and answers whether it won. Only the ending that won lets go of the phone and records metrics; one that lost (a stop holding an old read of its group, after the source ended) reports the row as it stands. Through 2.36 it was an update by id: the second ending overwrote the first's end, duration and reason, and let go of the phone twice.
- **A finalize write that fails** is tried three times (`finalizeRetryDelaysMs`, 250 ms and 1 s apart). If all fail, the row still says `RECORDING`, so the recording keeps its gate slot and its phone's hold (its capture has stopped), and its decided end, `ended_at` included, waits in `unfinished`: written again every 30 s (`unfinishedRetryMs`), by the next stop of its group (which reports it as `RECORDING` and doesn't announce it stopped), or at the next start by `recoverOnBoot`. Through 2.36 the error was logged and the slot, observer marker and hold all went, while the row stayed `RECORDING`: the busy check, `stream/stop` and the leave path refused the phone until a restart.
- **`fail_reason`** is a code (`RecordingEndReason`: `source_ended`, `session_ended`, `server_restart`, `empty_or_corrupt_mp4`, `ffmpeg_stop_failed`, `spawn_failed`, `group_not_recording`); a capture that threw keeps its message after the code (`spawn_failed: no stream`, `failReasonFromError`). Through 2.36 those were the bare message. The failures metric's label is the code alone. `DISCARDED` is read as failed but has never been written; it isn't a status Xenon writes (`RecordingStatus`).
- **add-device** (`addDevice`) is refused with `409 group_not_recording` for a group with no row still recording, or one a stop is closing, checked again once the added phone's row exists (its source port can take a while). Its ffmpeg gets the same `onExit` as a group's first phones. Through 2.36 a phone could be added to a group stopped the day before, and an added phone whose source ended stayed `RECORDING` until a Stop or a restart. An added phone isn't in the group's composite.
- **When a recording ends, its phone leaves like a preview** (`leaveDeviceFn`, the router's `previewLeaves`). After a 3 s grace, which also lets the recording's own ffmpeg connection drop, the preview is stopped and the hold released, unless someone watches the phone or another recording reads it.
  - Never decide by whether the phone's stream runs: a recording starts the stream itself when none runs (`ensureMjpegForRecording`).
  - Through 2.6 it did decide that way, and kept a phone nobody watched held until the stream's idle watchdog, ten minutes later.
  - A node's phone has no stream here; its hold goes at once.
  - **A start cancels a check already running** (`LeaveScheduler`'s
    per-phone epoch, bumped by every `cancel`): the check looks again right
    before it stops anything. Through 2.36 `cancel` only cleared the timer,
    so a reload whose `stream/start` landed just after the grace, while the
    old page's check awaited the viewer count or the recording lookup, had
    its stream stopped and its hold released.
- **Another server's phone** (a node's, on a hub) is read from a loopback relay instead of a local stream service (`nodeRecordingSource.ts`, the orchestrator's `nodeSourceFn`).
  - Every connection to the relay gets the node's `GET /control/<udid>/stream`, signed afresh with the control token for the recording's user. ffmpeg reconnects on any hiccup, and the token lasts a minute.
  - ffmpeg's arguments, the composite, the proof bundle and the marks are unchanged: the relay is just another loopback MJPEG port, like this server's own phones'.
  - The node counts the relay's connections as viewers, so its idle release leaves the stream running.
  - The relay closes when its recording is finalized, after the group's composite has stopped.
  - A cloud provider's phone is refused, and a node that refuses the stream ends that phone's recording.
  - The busy precheck reads a node phone's preview hold from `nodeHold`, so the holder may record the phone they're previewing.
- **Observer groups** (ENH-06): `POST /recordings` with `sessionIds` instead of `udids` records the phones the caller's own running sessions are on (`observerSessions.ts`; reported as `features.recording.observer` and `observer-recording`). It takes `sessions` or `devices` (`recordingsScope.ts`), so a member's own token will do. A write on its group takes `sessions` only for the user who started it (`observerGroupStarter`) or an admin; anyone else needs `devices`, so a member's token can't stop or mark another user's group. A `udids` group keeps `devices`, and so does an observer group after a restart or once 1,000 newer observer groups have started (the orchestrator remembers groups and starters in memory, bounded). Through 2.32 a recording refused every phone in a session (`automation`), so a test couldn't get one video of its phones.
  - A session's phone is the row its claim names (`holdsClaim`), so it needs no Session row. Not the caller's (owner by `SessionOwnerResolver.ownerOf`, or `resolveActor`'s admin), ended, ownerless or on a hidden phone: `404 not_found` for the whole request, as an unknown udid. A cloud phone is `409`, reason `cloud_phone`. A failed owner or team lookup is `503 ownership_unavailable`, never a start.
  - **No hold:** nothing is written to the phone's row or released at the end (no `blockDeviceFn`, `tryUnblock` or preview leave), so the test's claim is untouched. `findBusy` lets the phone through, after the other-recording and lease rules, only where its claim names the session the caller named for it and no other user's hold is on it (`session_id`, or `nodeHold` on a hub: `manual_other`).
  - **The group stops when its first session ends**, every phone and the composite (`stop`, each row `STOPPED`, `fail_reason: 'session_ended'`): `forgetSessionMemory` calls `sessionEnded`, which every ending reaches, and every 10 s (`OBSERVER_CHECK_MS`) each phone's claim must still name its session. The composite reads streams that outlive the session, so stopping one phone would go on filming the next test.
  - An ending during the start is noted on the pending start (`pendingObserverStarts`) and one before it in `endedEarly`; either stops the group as soon as it is built, so the `202` may already say `STOPPED`.
  - `Recording.session_id` is written only where the Session row exists (a foreign key); the session id is kept in memory for the ending either way.
  - `recoverOnBoot` releases a leftover recording's phone only while it still holds that recording's own hold (`stillHoldsOwnHold`): an observer recording's phone holds its session's claim, which on a hub can outlive the restart.
  - `add-device` on an observer group is `409 observer_group`: its phones are the sessions it started with.

`VideoPipelineService` is hardware-accelerated (`h264_videotoolbox` on Mac, `libx264` elsewhere) and writes fragmented mp4 (`frag_keyframe+empty_moov+default_base_moof`) for instant playback / crash resiliency.

### Session performance (`src/services/metrics/`)

CPU and memory every 2 s for each session on this server's own phones,
charted in the session page's Performance panel. Through 2.9 the Android
profiler ran only with an `appPackage`, read `top -m 20` (an idle app never
appears there) and saved nothing; iOS had only the Instruments trace download.

- `SessionMetricsService` starts a sampler in `EventManager.onSessionStarted`,
  after the session's row is written (the samples point at it), and stops it
  however the session ends (`deleteSession`, `onUnexpectedShutdown`,
  `stopSessionForShutdown`, `onSessionStopped`), in memory or not. It
  writes every 10 s (`SessionMetric`), keeps the newest 900 samples while
  writes fail, and never fails a session: five failures in a row stop that
  session's sampler. `sessionMetrics: false` turns it off.
- **Android** (`AndroidMetricsSampler`): one `adb shell` call per sample
  through the resolved adb, reading `/proc/stat`, `/proc/meminfo`, and the
  app's `/proc/<pid>/stat` and `VmRSS`. CPU comes from the change since the
  previous sample, as a share of the whole device; a new pid shows no app CPU
  for one sample, never a spike. The app is `appPackage` if it is a package
  name (it goes into a shell command; anything else is ignored), else the
  foreground app, re-read every 10 s.
- **iPhone** (`IOSMetricsSampler`): `ios sysmontap` through the phone's tunnel
  (`IOSTunnels.borrow`, asked again every 30 s), tracked in `ProcessRegistry`
  for the session. go-ios 1.2.1 gives device CPU only: `cpu_total_load` is
  summed over cores and divided by `enabled_cpus`.
- `GET /session/:id/metrics` (`metricsBody.ts`) says what the platform can
  record (`series`) beside the samples and, for a running session, whether
  this server samples it (`recording`: sampling, stopped after giving up, or
  off). The panel says "isn't recorded" rather than "Collecting…" for one it
  doesn't.
- **A node's phones** (`NodeMetricsStore`, `NodeMetricsCollector`). A node
  samples its own phones for the sessions its hub creates, whatever its
  dashboard setting (`finalizeSession`), and holds the figures in memory: it
  has no Session row for them. The newest 900 per session; what the hub has
  collected is dropped; an ended session is kept 10 minutes. A session no hub
  has asked about `UNCLAIMED_MS` (2 minutes) after its start stops being
  sampled, its figures dropped (`off`), as for its device log; once asked, it
  is sampled to the end (`SessionMetricsService.dropUnclaimed`). Through 2.36
  a node whose hub never asked (its dashboard off, the default) ran an `adb
  shell` every 2 s for every hub session and held up to 900 samples each. The
  node serves
  them at `GET /xenon/api/node/sessions/:id/metrics?after=` (beside the
  session-status route, ahead of the login, the same token rule). The hub
  asks every 10 s through the session's `RemoteSession`, in place of a phone
  sampler, so its buffer, writes and `recordingState` are the local ones,
  and asks once more when the session ends. After a hub restart it resumes
  from the newest sample it stored. An older node answers without
  `x-xenon-node-metrics`: its sessions say "isn't recorded", logged once per
  node, asked again after 10 minutes. Both sides need this release.
- The charts are SVG (`line-chart.tsx`), at most 600 points per line, in
  role-token colours.

### Logcat Streaming (`src/services/logcat/`, `src/device-managers/android/Logcat*`)

Android only. The Debug Logs tab streams a continuous `adb logcat` over a
WebSocket. It replaced a 3-second `logcat -d -t 500` poll that appended without
dedup, so the 1000-line buffer held roughly the same 500 lines twice.

Pipeline: one `adb logcat -v threadtime -T 2000` child per device →
`parseThreadtimeLine` (pure) → `PackageResolver` fills `pkg` at emit time →
`LogcatMultiplexer` fans out → authenticated WS `/xenon/api/control/:udid/logcat?ticket=`
→ `useLogcatStream` → `LogcatView`. Modelled on the H.264 stack so it reuses
those lifecycle lessons; `attachLogcatWs` mounts beside `attachH264Ws`.

Things that are load-bearing and were each a real bug first:

- **`-T` on the spawn.** Without it logcat replays the device's whole ring
  buffer before reaching live output — measured 94-minute-stale records at
  ~84/sec, overrunning both buffers with history under a green LIVE pill.
  Bound to `REPLAY_BUFFER_SIZE` so a first viewer sees the same window a late
  joiner gets from the multiplexer.
- **Dropped records are visible.** When a client can't keep up the mux emits a
  synthetic `W/xenon  "N lines dropped (slow client)"` in its place, coalescing
  a run of drops into one record. The drop counter is **per client** — sharing
  it inverts who gets warned. Synthetic records also bypass the client filter,
  so a `level:E` view can't hide the marker.
- **The client buffer resets on reconnect, except after 1012.** The server
  replays to any joining client and the mux outlives a disconnect by 30s, so a
  reconnect inside that window re-appends the replay — the original duplicate
  bug. But 1012 means the upstream died and `LogcatStreamService` drops the
  session *before* closing the mux, so that reconnect gets an empty replay and
  clearing would blank the pane. Close code decides.
- **A reset is a new generation** (`useLogcatStream`'s `generation`, in one
  state with `records` so the two render together). The replay gives lines the
  client had a new `seq`, so a Logs recording that spanned a reconnect saved
  them twice, and on iOS a level edit (a reconnect) did the same; the pause
  pill jumped by the replay. On a new generation both skip the replayed copy
  of what they had, matched by content (`replayOverlap.ts` `afterReplay`: the
  newest 32 lines line for line, as `NodeDeviceLogsCollector` does; on iOS only
  lines the new filter sends, `sourceWants`). The recording takes nothing until
  the replay reaches its lines, more lines than a replay holds arrive, 3 s
  pass, or it stops; then every line is new, so none is lost. A socket a run
  replaced (a filter change) no longer reports: its late close marked the new
  one disconnected and decided its reset, and its lines reached the new
  buffer. Through 2.36 neither held.
- **Ownership, not just a ticket.** Logcat carries auth tokens, deep-link URLs
  and PII, so it is an ownership-checked read: the WS evaluates
  `evaluateDeviceAccess` at **connect** time, and `logs` is in
  `OWNERSHIP_CHECKED_READS` so the REST dump of the same bytes can't be used to
  walk around it. The ticket carries the minting caller's `isAdmin` and
  `apiKeyId` as signed claims so the WS reaches the same verdict `/control`
  does — a `User.role` lookup would miss admin-scoped API keys.
- **`PackageResolver` never blocks or drops a line.** Negative cache (a PID
  absent from `ps` is marked unknown, not re-queried per line), two clocks
  (`attemptedAt` throttles retries, `loadedAt` alone drives freshness so a
  failing `ps` can't extend it), and no timeout of its own — the timeout
  belongs with the process spawn, in `LogcatStreamService`. Use exactly
  `ps -A -o PID,NAME`; plain `ps -A` returns nine columns, parses to zero rows,
  and every label silently vanishes.

Sizing lives in one place per constant: `IDLE_TIMEOUT_MS` 30s, `IDLE_POLL_MS`
2s, `REPLAY_BUFFER_SIZE` 2000, client buffer 5000, `DEFAULT_TTL_MS` 10s,
`PS_TIMEOUT_MS` 5s.

**A session's Device logs** (`SessionDeviceLogs`, `deviceLogBook.ts`). The
session page's Device logs for a session on this server's own Android phone
come from this stream, not from a dump per command (an iPhone's or a
simulator's: below). Through 2.14 each command
ran `logcat -d -t 500`, kept the last 100 lines and skipped as many as the
previous dump had given, so nothing was saved after the first command.

- The session is a client of the phone's mux from `onSessionStarted` (once
  the row exists) to the top of `onSessionStopped`, which every ending
  reaches. It never stops or restarts the stream: the Logs viewer may share
  it, and while the session listens the idle stop leaves it running.
- Lines count from `WINDOW_SLACK_MS` before the phone was allocated
  (`XenonSession.allocatedAt`), so the `-T`/replay history is cut by time.
  logcat prints the phone's local time with no zone, so one `date` on the
  phone (`parseDeviceClock`) gives the zone shift and clock skew. Without it,
  a phone in another zone than the server cut hours off. A row's `timestamp`
  is the line's moment on this server's clock, so it lines up with the
  commands (the lab S9+ ran 2.8 s slow); its text keeps the phone's time.
- A stream that ends mid-session is opened again, with a note in the log;
  its history is cut at the newest line seen, by time and, at that
  millisecond, by content.
- `DEVICE_LOG_LINE_LIMIT` (10,000) lines, then errors only up to
  `DEVICE_LOG_ERROR_LIMIT` (2,000) more, each step noted in the log.
- Rows are logcat's threadtime text, since the dashboard reads the level from
  the text (`log-derive.ts`), and are written with `createMany`, each
  `createdAt` a millisecond after the one before. The API reads by
  `createdAt`, and a stack trace's lines share a millisecond: SQLite returns
  ties in insert order, Postgres in any.
- A node's phone is recorded by the node and collected by the hub: see "A
  node's phones" below.
- `xe:save_device_logs` (`saveDeviceLogs`, also in `xe:options`) is a switch
  on by default, like `xe:record_video`: `false` (or any value but
  `true`/`"true"`) starts no recorder, for any platform, and `noteOff` writes
  one row saying so. Through 2.15 it was parsed and read nowhere, documented
  as off by default.

**An iPhone's or simulator's Device logs** (`iosDriverLog.ts`) come from the
XCUITest driver's own capture, `driver.logs.syslog` (`LocalSession.deviceLog`),
not from the device page's `go-ios ostrace` stream: that one has no
simulators, needs the phone's go-ios tunnel on iOS 17+, serves one reader per
phone (a second `ostrace` silences both), and carries about 335 lines/s at its
levels. The driver captures a real iPhone's syslog or a simulator's
`simctl log stream --style compact` from early in the create, unless
`appium:skipLogCapture` (then there are none).

- **Never take the driver's lines.** Its buffer (newest 10,000) is emptied by
  `getLogs()`, which is what a test's own `getLog('syslog')` reads. The
  session listens to the log's `output` event, and reads the lines already
  there (the create's) from the buffer without emptying it
  (`bufferedDriverLog`, the driver's own internals, guarded), in one
  synchronous step so no line comes twice or not at all.
- A row is the line as printed, stamped with the time it reached the server.
  The dashboard reads `<Error>`/`<Fault>` (an iPhone) and the compact `E`/`F`
  type (a simulator) from the text.
- **Only the app's lines** (`IosAppLines`), for a session whose driver names
  its app (`LocalSession.appUnderTest`, the driver's `opts.bundleId`). A phone
  logs hundreds of lines a second: an iPhone 14 Plus (iOS 26.5) sent about
  53,000 in a one-minute session, which filled the 10,000-line limit during the
  create. In Edge's own process (110 lines/s), its own code wrote 5 lines in
  8,839; the rest was Apple's frameworks. Kept:
  - in the app's process: its own code (no sender, or the app's own binary)
    and every error and fault;
  - `runningboardd` and `SpringBoard` lines that name the bundle id (about
    twenty other daemons repeat each state change, 3,000 lines in 78 s);
  - lines from elsewhere naming the app's pid or executable (`Shop[4127]`,
    `[Shop]`, `corpse[4127]`), i.e. crash reports and memory kills;
  - every fault.

  The pid comes from `app<bundle(…)>:pid` and `pid: N bundleID: X` lines, and
  the executable from that pid's lines. The create's buffered lines are read
  once to learn them before any is filtered. A headerless line follows the
  line before it. A session with no bundle id keeps every line. The tab's
  first row says what was kept. Measured with Edge, switching apps 12 times
  in 75 s: 106 rows/s, the app-manager lines being most of it.
- Through 2.15 the per-command path saved nothing for a simulator
  (`extractLogs('syslog')` without the driver's log container always threw),
  lost lines on an iPhone (a buffer emptied on every read, then deduplicated
  by index against the previous batch's length) and never stopped the
  iPhone's own syslog service.

**A node's phones** (`NodeDeviceLogStore`, `NodeDeviceLogsCollector`,
`nodeDeviceLogs.ts`). The hub has no adb or driver for a node's phone, and
the node has no Session row for a session its hub created. So the node records it and the
hub collects the lines, as for CPU and memory (see "Session performance").
Through 2.15 such a session's Device logs were empty, and its failure
analysis was sent no device log.

- **On the node.** `registerSession` starts `SessionDeviceLogs` for each
  hub session on its own phone, whatever its dashboard setting, from the
  node's own allocation time, with the same book and limit (an iPhone's
  from its driver's log, as on a standalone server), unless the
  session turned it off (`xe:save_device_logs`, which the hub forwards):
  the node then answers `off`. The rows go to
  `NodeDeviceLogStore` in memory, each numbered (`seq`), instead of `Log`.
  The node's cap is what keeps a hub from being sent more than a session on
  its own phone keeps.
- **Unclaimed.** A hub with its dashboard off (the default) or an older hub
  never asks. A session no hub has asked about `UNCLAIMED_MS` (2 minutes)
  after its start stops being recorded, its rows dropped (`off`). Once asked,
  it records to the end. A session that ends first keeps its rows for the
  hub's last ask.
- **Ending.** It stops wherever the node's metrics stop: `deleteSession`'s
  `finally` (before the "still in memory?" check), `onUnexpectedShutdown`,
  `stopSessionForShutdown`. An ended session's rows are kept 10 minutes.
- **The route.** `GET /xenon/api/node/sessions/<id>/device-logs?after=<seq>`
  (`nodeSessionDeviceLogs.ts`), with the session-status route's rule
  (`answerForHub`) and `x-xenon-node-device-logs`. It drops the rows at or
  before `after` and answers at most `NODE_DEVICE_LOG_PAGE` (2,000), with
  `more`.
- **On the hub.** `appliesTo(device, source)` takes a node's phone (Android,
  iPhone or simulator) whose session is a `RemoteSession`, never a cloud
  provider's.
  `onSessionStarted` passes the session. The collector asks at once (which
  claims the session on the node), then every 10 s, again at once while the
  node says `more`, and once more at the end, unless its last two asks
  failed (one is a busy node, often at the end of a test). Each answer's
  rows are written before the next ask, which drops them on the node, each
  `createdAt` a millisecond after the one before; their `timestamp` is the
  node's clock. `deleteSession`'s `finally` stops it before
  `onSessionStopped`, and a second ending's stop waits for the first's, so
  the failure analysis reads the last lines. An older node is logged once
  and asked again after 10 minutes (`OlderNodes`, shared with metrics in
  `gateway/nodeAsk.ts`).
- **After a hub restart** (`recoverActiveSessions`, the dashboard on) it goes
  on with `resume`: new rows after the newest `DEVICE` row's `createdAt`.
  The node still holds the last page the hub received (it drops rows only
  when the next ask names them), so the first answer's rows are skipped up
  to where they match the newest 32 stored, line for line: logcat often
  prints one line twice in a millisecond, so one line can't say which copy
  the hub has. Rows received and not yet written when the hub died are
  lost: one write's worth.

### WebSocket upgrades (`src/app/ws/upgradeRouter.ts`)

Xenon's WebSockets share Appium's http.Server with Appium's own. Xenon has
H.264 (`/xenon/api/control/:udid/stream/h264`), logcat (`.../logcat`) and
socket.io (`/socket.io/`). Appium has BiDi (`<basePath>/bidi[/<id>]`) and
whatever drivers add (`/ws/session/<id>/...`). The upgrade router gives each
upgrade exactly one handler. Before it, which side worked depended on the
Node version:

- **Node >= 22.21 / 24.9:** Appium's `upgrade` listener (base-driver
  `configureHttp`, added before any plugin) ran first and `socket.destroy()`ed
  every path it had no handler for, Xenon's included. H.264 fell back to MJPEG
  and socket.io to polling.
- **Node < 22.21 (the lab's 22.19, all of Node 20):** Appium takes upgrades in
  an Express middleware, which Node reaches only while the server has no
  `upgrade` listener. Xenon's listeners were always there, so BiDi and driver
  sockets got no answer. On a hub, engine.io's listener ended them after 1 s.

How it works:

- **It wraps `emit('upgrade')`**, as the session guard does. An upgrade to a
  Xenon route goes to that route alone, and no listener sees it. Everything
  else is emitted unchanged, through the guard, to the listeners.
  `registerRoutes` installs it right after the guard.
- **On Node < 22.21 it adds the listener Appium would have added**
  (`appiumUpgradeListener`). The test is base-driver's own: the server has no
  `shouldUpgradeCallback`. That listener is also what makes an old Node emit
  `upgrade` at all. It ports base-driver's `tryHandleWebSocketUpgrade` over
  the public `webSocketsMapping`, and destroys what matches nothing. The port
  handles literal and `:param` patterns, the only kinds Appium and drivers
  register, and `upgrade-router.spec.ts` checks it against Appium's own
  function case by case. A pattern in other path-to-regexp syntax is skipped,
  with one warning.
- **socket.io is adopted.** engine.io attaches by adding its own `upgrade`
  listener, which would also see every other upgrade and end it after 1 s.
  `adopt` takes the listener it added off the server and calls it only for
  `/socket.io/`, using engine.io's own test (a prefix of the raw URL).
- **A new WebSocket goes through `upgradeRouterFor(server).add(...)`**, never
  `server.on('upgrade')`. A listener sees every upgrade. On Node < 22.21 its
  presence alone hides every upgrade from Appium's Express middleware.
- **A throw is contained.** An exception out of an `upgrade` listener ends
  the process. Xenon's path parsers throw on a malformed `%` escape in a udid.
  So does Appium's own dispatch for one in a BiDi session id, because
  path-to-regexp decodes parameters. The router catches either, destroys the
  socket and logs.
- **Limit on Node < 22.21:** any `upgrade` listener makes Node treat every
  `Connection: Upgrade` request as an upgrade. A non-WebSocket one
  (`Upgrade: h2c`) is destroyed rather than served as plain HTTP. It hung
  before this change. Node >= 22.21 serves it as HTTP, because Appium's callback
  only claims `websocket`.

### Plugin options, environment variables and the dashboard's settings

Where one setting can come from more than one place, the order is the same
everywhere: **the dashboard (where it has a page) over the plugin option over
the environment variable over the default**. A setting that does nothing is a
bug, so a new option is read somewhere, with a test that the option reaches it.

- **Dashboard over option** (`src/services/settings/labSettings.ts`). The health
  check, build cleanup and AI self-healing settings are saved by `POST /config` into `WebConfig`,
  one row per setting with the setting's name as its `id` (the primary key; every
  row used to be written as `id: 'global'`, so only one setting could ever be
  saved and a second save was a 500: `web-config-service.spec.ts`).
  `effectiveSettings(startup, saved)` is the one rule: a saved value that can
  work, else the startup option, else schema.json's default. `CleanupService`
  reads it at each run (so no restart), `setupCronCleanupBuilds` for the
  schedule, and the `POST /config` handler replaces the running cleanup timer
  when the schedule changes. `HealthMonitorService` polls the same `WebConfig`
  every minute. `GET /config` sends the effective values and `defaults` (from
  schema.json), so the Settings and Maintenance pages carry no numbers of
  their own. Cleanup fields are validated before they are stored: a retention
  window of 0 would purge everything. The pages send only the fields the person
  changed, as a field sent is saved as the lab's own and hides a later change to
  the server's configuration.
- **The self-healing switch** (`SelfHealingSwitch`,
  `src/services/settings/SelfHealingSwitch.ts`) is the Settings page's "AI
  self-healing" toggle, `enableSelfHealing`: a setting like the others
  (`WebConfigService`'s `SETTINGS`, `effectiveSettings`, `GET /config` with its
  `defaults`, a non-boolean is `400 invalid_setting`). Through 2.13 it was in
  none of them: `POST /config` dropped it, `GET /config` never sent it so the
  page always showed Enabled, and the interceptor read the startup options. The
  interceptor runs on every command, so it never reads the database: the switch
  keeps the *saved* value in memory, loaded once at boot
  (`ServerManager.updateServer`, after the database is ready and before routes)
  and replaced by `POST /config` as it saves, and `isEnabled(pluginArgs)`
  combines it with the options the interceptor was given by the same rule as
  `effectiveSettings` (`selfHealingEnabled`). Both interceptor sites use it:
  the catch-and-heal hand-off and the selector learning after a found
  element. Its saved value is `not-loaded` (before the boot's load), `failed`
  or `loaded` (with nothing saved, or a value). A boot that can't read it
  uses the startup option without the AI tiers (`withholdsAiTiers`: the
  interceptor hands the healing `withoutAiTiers(tiers)`, so tiers 4 and 5
  never run and a session's own list keeps its other tiers), warns once, and
  reads it again every 30 s (`SELF_HEALING_RELOAD_MS`) until it can or `POST
  /config` saves one. A lab may have saved healing off to keep its screens
  from the AI provider; through 2.36 such a boot ran every tier until the next
  restart. Once loaded it does not poll: a second server sharing the database
  sees a change at its next restart. It belongs to the server it is saved on, so a
  hub's switch doesn't reach a node's sessions (the node's interceptor runs
  them). `xe:options.healingTiers` only limits the tiers a session may use (see
  "6-Tier Self-Healing"): no session capability turns healing on where the
  switch has it off.
- **The AI engine page** (`AiEngineSettings`,
  `src/services/settings/aiEngineSettings.ts`): `aiProvider`, `aiModel`,
  `aiBaseUrl` and the four per-provider models are `WebConfig` rows like the
  others, refused with `400 invalid_setting` when they couldn't work. Every AI
  call reads `config`, so the service writes the values in effect into it:
  loaded at boot after `syncDatabaseAndAIConfig` (it keeps what `config` held
  then as the startup values, which an empty saved value goes back to) and
  after each `POST /config`. A boot that can't read them keeps the startup
  values, warns once, and reads them again every 30 s (`AI_ENGINE_RELOAD_MS`)
  until it can; what `POST /config` saves meanwhile applies at once and wins
  over that read. Through 2.36 they weren't read again before the next
  restart. Through 2.14 that route wrote `config` directly and
  saved nothing, so a restart undid the page's choice. A started-with provider
  Xenon doesn't know is kept, never replaced by another (AIService then has no
  provider). Keys are never saved or sent, and `GET /config` masks a user name,
  password or query value in the base URL (`maskedBaseUrl`). The page's
  Temperature, Max tokens and Top P never reached a provider and are gone. The
  saved values reach every AI call, the healing tiers' and failure analysis's
  included, at its next call: `AIService.isEnabled()` re-reads `config` (see
  "AI providers and failure analysis").
- **Option over environment variable** (`recordingConfigFrom` in `src/config.ts`,
  `ServerManager.applyRecordingOptions`; JSON logging in `XenonPlugin`'s
  constructor). Appium fills every default schema.json declares, so an option
  with a default can never be told from a choice and an environment variable
  could never win. `maxConcurrentRecordings` and `enableJsonLogging` therefore
  have **no `default` in schema.json** (their descriptions give it); give one
  back and `XENON_MAX_CONCURRENT_RECORDINGS` / `XENON_JSON_LOGGING` stop working.
  `ConcurrencyGate` reads the cap at each admission, not when it is built.
- **`DefaultPluginArgs`** is generated from the template in
  `scripts/generate-types-from-schema.js`, a second copy of schema.json's
  defaults. `default-plugin-args.spec.ts` fails if they disagree: it said
  86400000 ms for the health check while the server ran 300000.
- **`enableDashboard`** doesn't decide whether the dashboard is served: `/xenon`
  (pages and REST) is mounted on every server, and socket.io on every hub,
  whatever it says. It decides how much a hub (or standalone server)
  records. On, every session gets its full record: `onSessionStarted`'s row
  and performance sampling, the interceptor's post-command hooks (command
  logs, screenshots, the heals Selector Health lists) and the gateway's
  dashboard hooks for node sessions. Selector learning isn't part of the
  record: it runs either way (see "6-Tier Self-Healing"). Off, a local session has
  no row at all, so no failure analysis and no `session_failed` webhook,
  while a session routed to a node or cloud provider still gets
  `recordRoutedSession`'s minimal row. Video is recorded either way
  (`record_video` defaults to true); a local session's file is then written
  and never linked. A node's own value records nothing for its hub's
  sessions. "Dashboard on/off" elsewhere in this file means this setting.
- **`emulators`** are booted at startup (`ServerManager.bootEmulators`) with
  each entry's launch options, for `platform: both` too; they are not an
  allow-list and discovery never filters on them. A boot that fails is logged,
  never fatal.
- **`appium:iPhoneOnly` / `iPadOnly`** become `appleFamily` on the device
  filter, applied by both stores through `appleFamilyOf`
  (`src/data-service/appleFamily.ts`): model, then form factor, then name. A
  real phone's name is whatever its owner typed, so the name is the last
  resort.

### Process shutdown (`src/index.ts`)

`cleanup()` runs on SIGINT/SIGTERM and is **not reliable on SIGTERM**: Appium's
own handler closes the HTTP server and exits the process before Phase 2
(per-service cleanups) or Phase 3 (`ProcessRegistry.terminateAll`) run — the
log reaches "Shutdown signal received" and Appium's "Received SIGTERM", then
the process is gone without ever logging "sanitized".

So long-lived sidecars are also killed synchronously from a `process.on('exit')`
hook, the last hook that always runs. It forbids async work, which is why each
service exposes a separate `killAllSync()` rather than an await inside
`cleanup()` — `kill()` is a syscall and is safe there. Covered:
`LogcatStreamService`, `AndroidH264StreamService`, and `ProcessRegistry`
(go-ios, WDA, iproxy, ffmpeg). `ProcessRegistry.killAllSync` goes straight to
SIGKILL and targets the process **group**, since 'exit' gives no later tick in
which to observe a graceful wait.

**Do not fix this by registering a stream service with `ProcessRegistry`.** That
registry is also keyed by udid and session, so its children would then be killed
by `terminateForUdid` / `terminateForSession` — ending a session would tear down
a live preview meant to outlive it.

`AndroidStreamService` is deliberately uncovered: its MJPEG capture spawns a
short-lived `adb exec-out screencap` per frame rather than holding a long-lived
child.

### Telemetry (`src/services/TracingService.ts`)

OpenTelemetry runs on a hub or a standalone server (`ServerManager` calls
`initialize`; a node doesn't). Each signal is on when its URL is set
(`OTEL_EXPORTER_OTLP_ENDPOINT` is the full trace URL, then `..._LOGS_ENDPOINT`
and `..._METRICS_ENDPOINT`), off with `OTEL_<KIND>_ENABLED=false`, all off with
`OTEL_SDK_DISABLED=true`. `XENON_OTEL_DEBUG` adds console exporters.

- **The NodeSDK gets Xenon's log processors and metric readers, or none.**
  A NodeSDK that isn't handed them builds its own from the standard `OTEL_*`
  variables and registers them globally first, so Xenon's were refused.
  Through 2.15, with tracing on, logs went out as protobuf through the SDK's
  exporter, metrics went to the trace URL + `/v1/metrics` whatever
  `OTEL_METRICS_ENABLED` said, and the debug console exporters printed
  nothing. Handed none for logs, it still registers a logger provider that
  exports nothing. `tracing-export-routing.spec.ts` checks where each signal
  goes, against a probe collector (`test/helpers/otlp-probe.ts`).
- **A session's span ends once, however the session ends**
  (`endSessionSpan`): `deleteSession`, `onUnexpectedShutdown`, the idle
  release, `OrphanSweeper`, `stopSessionForShutdown`, and a create that
  fails after the span started. The second call finds nothing. Through 2.15
  only `onUnexpectedShutdown` with the dashboard on ended it, so every other
  session's span stayed in memory, unexported, and its commands had no
  parent. `deleteSession` ends it in a `finally` after `onSessionStopped`,
  which returns the status it decided: a test's own delete gives none, and
  a session with a failed command is failed only there. Through 2.30 the
  span ended before, so every session a test ended itself ended OK.
- **A command's span** starts and ends in `CommandInterceptor.handle`. A
  command that throws records the error and ends ERROR; a find that healed
  returns an element, so it ends OK. Through 2.15 every one ended OK. It is
  ended by the span object (`endCommandSpan`), never looked up by
  `<sessionId>:<command>`: two same-named commands at once share that key.
- **A test's trace is joined** (`src/services/tracing/inboundTrace.ts`,
  ENH-03). The gateway runs each create and each command inside the W3C
  context of its `traceparent` header (`runWithInboundTrace`, beside the
  sensitive marker). The session span is a child of `xe:options.traceparent`
  when it can be read, else of the create's header; a command sent with
  its own is a child of that, linked to its session span. A context the
  test didn't sample exports nothing. The command log's ids come from the
  command (`commandTraceIds`, through `sessionContext`), never from
  `<sessionId>:<command>`, and keep the joined trace id with export off,
  since Xenon Test reads them there. A span id is kept only for a span that
  is exported. `features.traceContext`, flag `trace-context`.
- **A command a hub forwards has the hub's span** (`forwardedCommandSpan.ts`,
  in `createHubRouting.forward`, ENH-04). A node exports nothing, and
  CommandInterceptor never sees a remote session's commands on the hub, so
  through 2.29 a node session's commands had no spans. The span is
  `startCommandSpan`'s (the command's own context, else the session's),
  named by `routeToCommandName`, with `xenon.forwarded_to` (an origin: a
  cloud URL carries a key), the status, the WebDriver error and the node's
  heal. The node is sent it as `traceparent`, only when it is recorded (an
  unsampled or unexported one leaves the client's headers as they came). The
  forward runs in `sessionContext`, so the command log's row gets its ids. No
  span for the DELETE or a `/wd-internal` call, as locally. No arguments: the
  node has them. `features.traceContext.forwardedCommands`, flag
  `node-command-spans`.
- **Shutdown** (`shutdownWithin(3_000)`, in `index.ts`'s cleanup right after
  the drain, since on SIGTERM Appium exits before Phase 2) ends the spans of
  sessions still running elsewhere (a node's, a cloud provider's) with
  `xenon.session.stop_reason`, flushes the span processors (their own
  shutdown doesn't wait for the exports they started), then stops the
  exporters. Nothing called it through 2.15.
- **Specs** that initialize one reset the OTel globals first
  (`resetOtelGlobals`): the API keeps the first registration for the life
  of the process and refuses the rest, so a leftover provider decides what
  every later spec exports.

### Outbound proxies (`src/helpers/outboundProxy.ts`)

Every call one Xenon server makes to another (a hub's to its nodes, a node's
to its hub) or to a cloud provider, and the rest of Xenon's internal calls,
take one rule, `outboundProxyFor`, whichever client makes them:

1. None for a host `no_proxy` / `NO_PROXY` names (`*`, the host name, or a
   `.suffix` of it; an entry with a port matches nothing), as axios reads it.
2. The `proxy` plugin option when set, for http and https alike, except for
   a loopback host (`localhost`, 127.x, ::1), which a proxy elsewhere can't
   reach. `{ host, port, protocol, auth: { username, password } }` becomes a
   URL (`proxyOptionUrl`); one with no host is ignored, with a warning.
3. Else the environment's proxy for the URL's scheme by axios 0.27's rule
   (`envProxyFor`): `<scheme>_proxy`, else `<SCHEME>_PROXY` (ws and wss count
   as http and https).

- Through 2.15 the option reached one call, the create a hub sends to a node
  or a cloud provider (and ignored `NO_PROXY` there). That session's
  commands, screenshots and heartbeats, device control, the sockets and a
  node's calls to its hub took the environment's proxy, or none.
- Where it is applied: `InternalHttpClient` sets every request's proxy in a
  request interceptor (`axiosProxyConfig`; a request that sets its own
  `proxy` keeps it), which covers the create, a node's phone reports, port
  allocation, node status and health probes. `RemoteSession`'s calls and the
  base-path lookup (`nodeWebDriverUrl`) are raw axios and add
  `axiosProxyConfig` themselves, unless the call set its own `proxy`:
  `LocalSession`'s call to `/wd-internal` sets `proxy: false`, since it
  carries the per-process secret. `proxyAgentFor` (absolute form for http, a
  CONNECT tunnel for https) serves `sendToNode` (forwarded commands, device
  control, the recording relay, socket tickets), a node's JWKS fetch and its
  socket.io polling. `socketProxyAgentFor` (always CONNECT) serves the H.264
  and logcat relay sockets and socket.io's WebSocket upgrade.
- **The tunnel checks the server behind it as the caller asked**
  (`TunnelAgent`). HttpsProxyAgent's own options are for the connection to
  the proxy, and axios doesn't pass `rejectUnauthorized` on, so through 2.15
  `tlsRejectUnauthorized` never reached a node or cloud provider behind a
  proxy.
- **A proxy that refuses the tunnel is tried around**, so nothing that went
  direct through 2.15 stops working: a stock Squid allows CONNECT to port
  443 only. The relay socket then goes straight to the node
  (`connectToNode`, logged once per node), and socket.io stays on polling.
- **Timeouts cover the proxy's answer.** A request's own timeout starts once
  it has a socket, which a proxy agent hands it only after the proxy
  answers, so the relay socket (`openSocket`) and the JWKS lookup
  (`withinTime`) each have an outer timer.
- Not covered: webhooks, Ollama and the AI providers' SDKs, the ChromeDriver
  download and OpenTelemetry export. The axios ones take the environment's
  proxy by axios's own lookup; the rest take none.
- `outbound-proxy.spec.ts` sends each kind of call through a fake proxy
  (`test/helpers/fake-http-proxy.ts`, which can map test host names such as
  `node.test` to 127.0.0.1) and compares it with axios; `proxy-option.spec.ts`
  does the same with the option set.

### Webhooks (`src/services/NotificationService.ts`, `webhookEvents.ts`)

`webhookEvents.ts` is the one documented payload per event (`WEBHOOK_EVENTS`:
`when`, `variables`, `sample`). The built-in Slack text, the generic
`{ event, payload }` body and a custom `{{name}}` template all read those names, and
"Send test" delivers the chosen event's `sample()`. The dashboard's template chips come
from `web/src/components/webhook-settings/webhookEventVariables.json`, which
`webhook-payloads.spec.ts` keeps equal to the server's list. A `session_failed` payload is
built from the Session row (`sessionFailedPayload`), never the row itself: it has the
capabilities, the creating keys and the AI analysis. `renderTemplate` fills a template that is
JSON as written string by string (a failure reason with a quote can't break it) and anything
else as text.

`session_failed` is sent from `EventManager.onSessionStopped`, where a session's final status is
decided, so every end reaches it: the client's delete, an inactivity timeout, a driver crash
(`onUnexpectedShutdown`), a heartbeat timeout (`OrphanSweeper`).
`NotificationService.notifySessionFailed` sends it once per session id (in memory, bounded),
since a session can end twice. A shutdown drain passes `{ notify: false }`, and the boot-time
sweeps of sessions a crash orphaned write the row directly, so neither is sent. It needs the
session's row, so a local session with the dashboard off sends none. Through 2.13 it was sent
from the client's delete only, and as the raw row, which the Slack text and the dashboard's
chips read as `undefined`.

**Session lifecycle and heal events** (ENH-07): `session_started` (once the row is written:
`onSessionStarted`, `recordRoutedSession`), `session_stopped` (every outcome, beside
`session_failed` in `onSessionStopped`, with its `notify` rule) and `healing_event` (each heal,
where `afterSessionCommand` writes its row, so a node's heals too). All three are sent with
`announce` (`NotificationService.ts`), in the background: no session start, end or healed find
waits for a webhook. `session_started` and `session_stopped` are once per session (`firstFor`).
Every post has `WEBHOOK_TIMEOUT_MS` (10 s); through 2.30 a webhook that never answered left the
request open for ever. Flag `lifecycle-webhooks`.

A session Appium ends by itself (`onUnexpectedShutdown`) gets Appium's cause as its failure
reason (`unexpectedShutdownReason`, `src/services/session/shutdownReason.ts`): for an idle
session, "New Command Timeout of N seconds expired...", which the failure analysis files as
`TIMEOUT`. Only a cause with no message gets "Driver shut down unexpectedly". Through 2.14 every
such session got that fixed text, which no pattern matches, so an idle session on a hub's own
phones was filed `UNKNOWN`, and its `session_failed` webhook said the driver had crashed.

### Failure categories (`src/dashboard/services/failureCategories.ts`)

A failed session's `failure_category` comes from `FAILURE_RULES`, run by
`categorizeSessionFailure` when the session ends as failed. The rules' texts
are those the installed drivers, Appium and Xenon send, plus a few a test may
report in its own words (marked). `failure-categorization.spec.ts` holds real
messages for every category, each with where it comes from. Through 2.15 the
rules were guesses, and a hub's recorded stack traces were matched too.

- **What is read.** Only each failed command's W3C code and message
  (`commandErrorOf`), never its stack trace or title. Every UiAutomator2
  error a hub records carries netty's `IdleStateHandler` in its stack, and
  every stack names its driver. Codes are only on the rows a hub records for
  a node's sessions; this server's own rows hold the message alone
  (CommandInterceptor), so every category needs phrases too.
- **The ending failure decides alone.** The failure reason, read with the
  newest failed command when the reason was taken from it (for a session on
  a node's phone the reason is that command's bare code). A reason no rule
  matches is `UNKNOWN`: an earlier failure the test recovered from, or a find
  it expected to fail, never decides. Only a session with no reason is read
  from its failed commands, newest first.
- **Xenon's own messages first** (`xenonOwnCategory`), by how they start:
  autowait's and OmniVision's quote the test's selector, which can hold any
  rule's phrase.
- **How rules match.** Codes match whole, phrases anywhere, ignoring case,
  in rule order. A reason Xenon writes whole ("Hub shutdown") is a code, so
  a phrase inside a selector can't match it. No bare "timeout" or "EMFILE":
  the first matched autowait misses, a hung helper and heartbeat reasons,
  the second the locator "systemFileList".
- **Retired categories.** `WDA_FAILURE` and `XENON_COMMAND_FAILURE` are no
  longer written. Sessions filed through 2.15 keep them, and their runbooks
  stay.
- **Known gap.** An Android app that crashes outright gives the test no
  error of its own, so its session is filed `ELEMENT_NOT_FOUND` or
  `STALE_ELEMENT`. Its crash report is in the session's Device logs, which
  the rules don't read.

Every category a row can hold needs a runbook
(`web/src/components/runbooks/runbook-content.ts`) that quotes one of its
rule's texts, and the API reference lists them all (`failure-categories.spec.ts`).

### Typed text and sensitive commands (`src/dashboard/commandPrivacy.ts`)

The command log (`SessionLog.body`, read by the session page and bug
reports) keeps each command's request, and the command's span keeps its
arguments (`xenon.command.args`, `spanArgs` in CommandInterceptor). Through
2.20 both kept the text a test typed, a password included. Two markers, both
applied in `commandLogFields` and `spanArgs`:

- **`X-Appium-Is-Sensitive: true`** on a command (Appium's own test,
  `isSensitiveHeaderValue`, which already hides its body in Appium's log).
  The session gateway runs a marked request inside a context
  (`gateway/sensitiveCommand.ts`, like `internalCall.ts`), so the plugin's
  `handle`, which never sees the request, and a hub's dashboard hooks both
  know. Such a command keeps no arguments and no answer (a failure keeps its
  W3C error code, which failure categories read), no selector capture and
  no screenshot. A hub forwards the header to the node.
- **Masked input:** `xe:options.maskInput` (`MASK_INPUT` in
  getXenonCapabilities; `maskInputOfCaps` from `driver.caps` for spans) or
  the server's `maskInput` option, either one (`inputMasked`): the text of
  `INPUT_COMMANDS` and `TYPING_SCRIPT_FIELDS` is `[masked]`, the rest kept.

**Appium's log and tokens** (`services/logging/tokenLogFilter.ts`). Appium
logs every request body before plugins run. A plugin can't add rules to
Appium's logger (it may load its own copy of `@appium/logger`), so Xenon
reads the server's parsed `logFilters` from the CLI args, applies them as
Appium's SecureValuesPreprocessor does to a sample create, and reports
`features.tokenLogFilter` in `/capabilities`; with sign-in on and no such
rule it warns at start. Xenon Control writes the rules from 0.3.0.

### Network Interception (`src/services/interceptor/`, `InterceptorService.ts`)

Android-only in v1. A session turns capture on with its interceptor capability (`xe:interceptor.enabled`, `xe:options.interceptor`, the flat `interceptorEnabled`, ...). The server's `interceptor` option is the default for a session that doesn't say: the session wins field by field (`enabled`, `bufferSize`, `captureBodies`; mocks and host filters are the session's only), in `resolveInterceptorOptions`. `getXenonCapabilities` leaves an unset field `undefined` for that reason. Through 2.13 the server option was never read. Once enabled, an MITM proxy captures requests/responses (capped by `bufferSize`), and `xenon: addMock` / `removeMock` / `clearMocks` / `getRequests` / `getMocks` / `exportHar` execute scripts manipulate per-session state. HAR export is the canonical way to ship captured traffic to clients. Each captured request also goes live to the dashboard (`interceptor_request`), whole, to admins only (`adminOnly`), and never into the event log (see "Live events are team-scoped at emit time"); through 2.15 the live capture events reached every dashboard that saw the phone. The `/interceptor` routes are Admin-only; the session page's Network panel says so to a Member rather than "no capture". A session's own `xenon: getRequests` is not limited: the test owns its session. But the command log (`SessionLog`, read through `session_log` and bug reports by everyone who can see the session) keeps a network-capture script's name and whether it worked, never its arguments or its answer (`commandLogFields`, over `NETWORK_CAPTURE_SCRIPTS`, the list CommandInterceptor routes by, so the two can't drift); a failed call keeps its error. CommandInterceptor answers these scripts before its hooks, so a local session logs one only when it throws. Through 2.15 a hub with its dashboard on logged every command it forwarded to a node whole, a test's `xenon: exportHar` included, and failure analysis sent the last commands' answers to the AI provider. A new script that answers from the capture goes in `NETWORK_CAPTURE_SCRIPTS`; a hub hides by its own copy. Mocks given in the session's capabilities (`xe:interceptor.mocks`) stay visible with the capabilities, as written by the test.

**The CA** (`CertManager`, `<cacheDir>/interceptor-ca`). Its serial is 16 random bytes, positive and minimally encoded (`caSerialNumber`): node-forge writes the hex as the INTEGER's bytes unchanged. Through 2.15 it was `Date.now()` in hex padded to 16 digits, always two leading zero bytes, which OpenSSL 3 (Node's included), Go and BoringSSL refuse. `ensure()` replaces a stored CA that Node's `X509Certificate` can't load, or whose key isn't the cert's (`checkPrivateKey`). Each file is written to a temporary name and renamed, key first. Through 2.36 cert then key were written in place, and a crash between them left a mismatched pair that `ensure()` kept. The Android file name is `subjectHashOld` (openssl's `-subject_hash_old`: MD5 of the subject's DER, first four bytes little-endian), computed in JS. It used to run `openssl` and fall back to a SHA-1 of the PEM, which names nothing; with the bad serial an OpenSSL 3 `openssl` couldn't load the CA, so the fallback always ran there.

### A session's phone network (`src/services/network/`)

A network profile (`xe:network_profile`: `Offline` turns Wi-Fi and mobile data off) and the interceptor (the phone's global `http_proxy`) change the whole phone. Only the server that drives the phone makes them (a `LOCAL` session in `applyPostSessionLogic`); a hub used to run its own adb against its nodes' phones too.

- **Put back however the session ends.** `PhoneNetworkRestore.restoreSession(sessionId)` is called by every ending, before the phone is released: `deleteSession`, the plugin's `onUnexpectedShutdown` (Appium's new-command timeout), the idle sweep (`releaseBlockedDevices`), `OrphanSweeper`, `stopSessionForShutdown`, and `ShutdownCoordinator.drain` (`restoreAll`). It is keyed by session id, so it works without `SESSION_MANAGER`, which holds a local session only with the dashboard or video on. Through 2.13 only `deleteSession` did it, and only for sessions in `SESSION_MANAGER`: a timed-out `Offline` phone stayed offline and an intercepted one kept a proxy to a dead port, and its capture was never saved.
- **Once.** The two services take a session's state before awaiting anything, and a second ending waits for the first one's restore (`inflight`).
- **Ended means ended.** `restoreSession` first marks the session ended in the network service (`NetworkConditioningService.markEnded`), whether or not it had a profile, so a `xenon: setNetworkProfile` still on its way changes nothing. Through 2.36 only `reset` marked it, which runs only for a session with a profile: a late `Offline` for a session that ended without one turned the radios off, nothing reset it, and `restoreLeftovers` skipped its row as a live session's, so the phone stayed offline until a restart.
- **A capture that fails to start leaves nothing.** `InterceptorService.start` registers the capture as starting before awaiting anything (`hasCapture`, `sessionIds`; `isActive` stays "requests readable"), so an ending meanwhile waits for the start and stops it. A step that throws undoes the ones before it: the phone's proxy (`PhoneProxy.release`, when this start pointed it first), the MITM proxy, the `adb reverse` and the port lease (`PortAllocator.release`). Through 2.36 a throw after the lease (the adb call that sets the proxy, typically) left all of them, the proxy listening on every interface, with no state to stop. A shaping relay's start (`startRelay`) undoes the same way, the relay and the shared forward proxy included; through 2.36 it left the PhoneProxy entry and its ledger record. `PhoneProxy.pointAt` that fails to move an entry another user pointed first (capture, then a relay, or the reverse) takes its in-memory and ledger change back, so the record keeps naming the setting the phone has, without the failed port's reverse, which its caller removes.
- **Put back what was there.** `Offline` reads `wifi_on` / `mobile_data` first and turns back on only what was on (unknown: on). `Normal` reads them too, turns on what isn't known to be on, and writes down what was off (ledger part `radiosOn`), which the end turns off again, after Offline's undo. Through 2.36 `Normal` turned both on and recorded nothing, so a phone kept off Wi-Fi on purpose left the session on it. The interceptor reads the phone's own `http_proxy` and puts it back rather than writing `:0` over a lab proxy. 4G, 3G and Edge change nothing on the radios at the end. iPhones and simulators get the delay only (`xcrun simctl` has no `network` subcommand in Xcode 26), logged once.
- **A crash.** Each change is written down before it is made (`PhoneNetworkLedger`: `WebConfig` rows `phone-network:<sessionId>` in this server's own database, so a hub and a node on one Mac don't undo each other's). At boot `cleanUpAtBoot` undoes what the ledger holds, then clears a proxy on this server's own Android phones that points at this machine (127.0.0.1, 10.0.2.2, its IPv4s) on a `proxy`-range port where nothing answers. A proxy anywhere else, or at a live port, is left alone. Every change is logged. A phone that can't be reached keeps its record: it is put back before its next session here (`restoreLeftovers({ udid })`) or at the next boot, and dropped after a week (`LEFTOVER_MAX_AGE_MS`).
- **Ledger rows carry a version** (`v: 1`, `LEDGER_VERSION`). A row with no `v` is 2.36's or earlier, read as before; one without `v` that isn't a record is still dropped. A row with another version, or a `v: 1` row naming a part this release doesn't know (a downgrade), is kept as it is, logged once, never undone in part (settling would rewrite it without the part), and dropped only after a week. Through 2.36 rows had no version and `list()` deleted every row it couldn't parse.
- **One change at a time per phone** (`withPhoneNetworkLock`): apply, restore and the boot clean-up never interleave on one phone. Not reentrant.
- **adb** is the resolved one (`adbForPhone`: `AndroidDeviceManager.getAdbForDevice`, `adbExec`, no shell).
- **Changed during a session** (`xenon: setNetworkProfile`, ENH-20). One
  path, `setProfile`, serves the start and the command: Offline turns the
  radios off once (recording what was on), leaving it turns that back on;
  Normal turns both on (recording what was off). On an Android emulator this server drives
  (`emulatorConsolePort`: not a real phone, no `adbRemoteHost`, serial
  `emulator-<port>`), 4G, 3G and Edge also shape its traffic through the
  console (`EmulatorConsole`, TCP 127.0.0.1:<port>; `adb emu` answers
  nothing on current adb). The prior shape is read and written to the
  ledger (`emulatorShape`) before the first change and put back at the end
  and at boot. Measured: a TCP request ~45 ms -> ~2 s at 500 ms / 20 kbps;
  ICMP isn't shaped. The answer (`ProfileOutcome`) says what took effect:
  `shaped`, `radios` or `none`. `features.networkProfiles`, flag
  `network-profile-mid-session`. `NetworkConditioningService` used to `exec('adb -s …')`, which needs `adb` on the server's PATH.
- **A real phone's traffic** (ENH-20 part 2): the first 4G/3G/Edge starts a
  `ShapingRelay` on a `proxy`-range port (leased as `<udid>:shaping`, apart
  from capture's lease), `adb reverse`d to the phone, with `http_proxy`
  pointed at it. It pipes bytes unread through a per-phone `LinkShaper` (a
  token bucket per direction, half the latency each way) to the capture
  proxy, else the shared loopback `ForwardProxy`. Later profiles only
  `setLimits`; Normal keeps it running unlimited. `PhoneProxy` is the one
  owner of `http_proxy` for capture and shaping (ledger `reversePorts`; a
  2.31 row's `reversePort` is still read); the profile service calls it with
  `lockHeld`. Capture now starts before the profile. Proxy-aware traffic
  only: no UDP, DNS or proxy-ignoring apps. `features.networkProfiles.proxyShaped`,
  flag `real-phone-shaping`.

### Identity & Manual Locks

Authentication: every `/xenon/api` request is gated by `authMiddleware` (`src/middleware/authMiddleware.ts`), which accepts either the (`x-xenon-access-key`, `x-xenon-token`) header pair or the `xenon_dashboard_session` cookie — a `UserSession` id and nothing else. A cookie that isn't one falls through to the ticket paths, never to an API key. It also accepts a hub-issued RS256 JWT as `Authorization: Bearer` (audience `xenon-rest`, minted by `POST /auth/token`, validated against the hub's JWKS) — the same middleware, a third credential path with a live user lookup so REST revocation is instant. A dashboard socket takes the same changes as they are saved, and closes when REST stops taking its bearer token (see "A socket's identity follows its user"). The token's `scopes` claim is fixed at mint, so `verifyBearerCredential` drops `admin` from it once the user is a MEMBER (REST and per-command auth both read it). It always sets `req.auth = { kind, userId, role, scopes, teamIds, rateLimit, … }`; `req.apiKey = { id, scopes, teamId, rateLimit }` is additionally set on the API-key paths only, never for cookie user-sessions. Through 2.18 the cookie also took a raw API token, checked without its access key, unaffected by sign-out and renewed on every request, and `POST /auth/dashboard-session` put a SUPER_ADMIN's token there. That route is gone (an unknown route's `404`): making a sign-in session from a token instead would raise the token to its owner's role, and nothing called it. `scopeGuard(['devices'])` and `mutationScopeGuard(['devices'])` (mutations only — GETs always pass) enforce scope-based access on routers like `/control`.

**The sign-in limit** (`loginRateLimiter.ts`, on `POST /auth/login` and
`/auth/forgot-password`) counts attempts per caller address: Express's `req.ip`,
which reads `X-Forwarded-For` only as far as the app's `trust proxy` setting
allows. That is the `trustProxy` option, else `XENON_TRUST_PROXY`, else unset
(`src/app/trustProxy.ts`, set on Appium's app in `ServerManager.updateServer`
before any route): Express's own values, `true`, a hop count or addresses,
subnets and `loopback`/`linklocal`/`uniquelocal`. A value Express can't use is
ignored with a warning. Unset, `req.ip` is the socket's address, so behind a
reverse proxy every sign-in shares the proxy's count; set it there. A limiter keeps
at most `MAX_LOGIN_BUCKETS` (10,000) addresses, dropping expired ones once a
window and then the oldest. Through 2.36 the key was the first entry of the
client's own `X-Forwarded-For`, so a new value with each attempt was never
limited, and every value added a bucket that stayed until it came back.

`scopesForRole` maps a **cookie** session's role to its scopes: ADMIN/SUPER_ADMIN
get `admin,devices,sessions,read`, MEMBER gets `devices,sessions,read`. MEMBER
carries `devices` deliberately — `/control` declares per-device interaction a
Member action via `roleGuard('MEMBER')`, and without the scope
`mutationScopeGuard` 403'd every member on the line below, making device control
admin-only. Since admins bypass the ownership guard, that combination meant no
dashboard user could ever be told a device was held by someone else. API keys
carry their own explicit scopes and are unaffected by this map.

**Changes that race.** Two account changes are made so that only one of two
sent at once can pass:

- **A password reset link is spent before the password changes**
  (`PasswordResetService.claim`, one conditional `updateMany`: unused,
  unexpired, its user Active). Of two `/reset-password` calls with one link,
  one changes the password and the other gets the invalid-link `404`. An
  Inactive user's link is refused the same way, at `/reset-password/check`
  too. A password write that fails after the claim leaves the link spent.
  Through 2.36 the link was marked used after the password changed, by an
  unconditional write, so both calls changed it and the last one won; an
  Inactive user's link still worked.
- **The last active SUPER_ADMIN stays** (`UserService.keepingASuperAdmin`).
  A demotion, deactivation or delete counts the other active super-admins
  (`assertNotLastSuperAdmin`) in the transaction that makes the change,
  Serializable, tried again on Postgres's `P2034`; `LastSuperAdminError` is
  the router's `400`. Through 2.36 the router counted, then changed, outside
  any transaction, so two changes to the last two left none.

`prisma.$transaction` is a stubbable function (`prismaTransactions` in
`src/prisma.ts`), and `useScratchDatabase` routes it to the scratch file. Through
2.36 it went to the server's client, so a transaction in a spec on a scratch
database read and wrote the developer's own database.

When the dashboard takes a soft lock on a device for live preview or recording, the `device.session_id` is written as `manual_<userId>_<udid>` (encoded by `formatManualLock` in `src/services/recording/manualLock.ts`), never over a claim or a session's id, and released hold by hold (see "A manual hold is written and ended conditionally"). All readers — `BusyPrecheck`, the `/stream/stop` route, the picker UI — call `inspectManualLock(blockId, actorId, udid)` to distinguish *self* from *another user* from *legacy `manual_<udid>`*. Locks owned by a different user can only be force-released by an admin-scope key.

**Ownership is keyed on the user (`req.auth.userId`), never the credential.**
`req.apiKey` is never populated for cookie sessions, so a credential-keyed lock
denies users their own devices and can never match a session's owner. Every
writer and reader of the lock uses `resolveActor(req)` +
`isSelfManualLock(...)`; the only tolerance is that a lock matching the caller's
*current* `apiKey.id` also counts as self, absorbing locks written before 1.13.0.
Getting this half-right is what made a user's own `stream/stop` return 403 on
their own device — migrate every reader and writer together or none.

### Device access guard (`src/middleware/deviceAccessGuard.ts`)

Mounted once on the `/control` router, after `roleGuard` and
`mutationScopeGuard`. Refuses a request against a device held by another user,
or running another user's Appium session. Your own Appium session stays
interactive, so "watch the test I started" works.

- **Scope is chosen by HTTP method, not a path list** — every non-GET is guarded
  minus `UNGUARDED_CONTROL_MUTATIONS` (`stream/start`, `stream/stop`,
  `stream/ticket`, each with a stated reason). That is what makes an endpoint
  added later protected by default; the hole this closed existed because
  ownership had to be remembered in ~20 handlers and was remembered in none.
- **Reads stay open** so the mosaic picker and monitoring can look at a busy
  device — except `OWNERSHIP_CHECKED_READS` (currently just `clipboard`, which
  returns whatever the holder last copied). Keep that list short.
- `evaluateDeviceAccess` (`src/services/device-access/deviceAccessPolicy.ts`) is
  pure: admin → allow; **leased** (a live SDK lease, busy or not) → allow the
  lease holder (the key that created it, or any credential of the user behind
  it: `SessionOwnerResolver.leaseHolderOf`) and the owner of a session running
  on it, deny anyone else (`device_held_by_another_user`, with a message saying
  it is leased); not busy → allow; manual lock self or legacy → allow;
  foreign → deny; otherwise compare the Appium session's owner
  (`Session.api_key_id → ApiKey.userId`, memoized positive-only by
  `SessionOwnerResolver`). An unattributable session **denies** — fail closed.
  "Busy" there is `heldHere` (`deviceClaims.ts`), not the `busy` column, in
  this guard and the logcat socket's authorizer alike. A hub's row for a
  node's phone that is busy only by the node's report (`nodeBusy`, no claim,
  nothing in `session_id`) has no holder on record here, and failing closed
  on it refused every non-admin, the node preview's own holder included.
  That phone is the node's to judge: its guard knows the holder and runs on
  every call the hub forwards.
- Denials are `409` with `device_held_by_another_user` /
  `device_in_use_by_session`, a message naming the holder, and a `warn` log. If
  ownership cannot be determined at all (store or resolver throws) it is `503
  device_ownership_unavailable` — never a silent allow, because the handler runs
  its own device lookup and would otherwise skip the check entirely.
- `stream/start` has its own decision (`src/app/routers/streamStartConflict.ts`)
  because "busy" differs at start time: an orphaned manual lock with no live
  stream is reclaimed rather than refused.

**Team guard** (`src/middleware/deviceTeamGuard.ts`) runs just before it. Teams
are a device boundary: a member may use a shared-pool phone (`teamId` null) or
one of their teams' phones, nothing else. The rule is `isDeviceVisible`
(`src/services/device-access/deviceVisibility.ts`), and its only input is
`req.auth.teamIds`: `undefined` means admin or auth disabled, never
`resolveActor().isAdmin`, so the guard and the device list always agree.
Every method and action is checked, with no exception list.

- **A hidden phone looks unknown on every request.** The guard answers nothing
  itself: it swaps the udid in `req.url` for `HIDDEN_DEVICE_UDID`, which no
  lookup ever resolves, and calls `next()`. Every later layer then gives its
  unknown-udid answer with the same number of lookups: the ownership guard,
  each handler's own 404 body, and Express's 404 and automatic OPTIONS reply
  for requests no route handles. `req.originalUrl` is untouched, so an answer
  that echoes the path echoes the real one, never the placeholder. Express 4
  doesn't restore `req.url` when a router falls through, so `register()`
  mounts `restoreHiddenDeviceUrl` after the router, at the parent, to put it
  back; never as a trailing `router.use`, where a later route would get the
  real hidden udid. Layers after `/control` should still read
  `req.originalUrl` when they need the requested path.
  `test/integration/team-visibility-control.spec.ts` (in `test:all`) reads the
  routes from the router's own stack and holds all of them, plus unrouted
  actions, the wrong method and OPTIONS, to identical answers, for a hidden
  phone on this server and one on a node. That is also why `stream/ticket`
  and `inspector/snapshot` 404 an unknown udid.
- **It runs first** because the ownership guard's 409 names the holder, which
  would confirm the phone exists and say who has it.
- **One lookup for both guards.** Both parse the udid and `?host=` and look the
  device up through `src/middleware/controlDevice.ts`, memoized on
  `res.locals`, so a member's request costs one query across the two. The
  hub's gate and the handlers read that same row.
- **Tickets are team-checked only when minted.** `GET /control/:udid/stream?ticket=`
  authenticates by ticket with `teamIds: undefined`, so the team guard passes
  it. The H.264 and logcat WebSockets redeem tickets outside Express and never
  reach the guard at all. What covers all three is that minting a ticket
  (`POST stream/ticket`) is team-checked. A second route that accepts tickets,
  or a second way to mint one, needs its own team check. A ticket also carries
  the minted row's host as a signed claim, and every redeemer resolves the
  phone by udid and that host (the MJPEG route through the guards'
  `requestTarget`, the sockets through `ticketPhone`), so an unscoped ticket never
  reaches another server's phone of the same udid, which may be another
  team's. A ticket request never chooses its phone: a `?host=` other than the
  claim, or an ambiguous udid on a ticket minted without a host, is no phone.
- Reservations apply the same rule, and so do SDK leases: `LeaseService.create`
  matches with the caller's `callerTeamIds`, never a team list from the
  client's `filters`.
- So do Appium sessions. A credentialed session (key pair or session token)
  is allocated phones, and resolves uploaded apps, by REST's `computeTeamIds`
  for its owner: a member's teams, narrowed by the key's or token's own team,
  unscoped for an ADMIN or SUPER_ADMIN owner or an admin-scoped key. The owner
  is looked up once per session (`leaseAccessFor`, memoized) and shared with
  the lease check. Until 1.30 a key saw only its own team binding, so a
  member's ordinary key never reached their team's phones, and a session
  token saw every team's. A session with no credentials stays unscoped.

**Phone identity** (`findPhone`, `controlDevice.ts`). A Device row is keyed
by udid and host, and an emulator's udid repeats across servers
(`emulator-5554` on a hub and on its node). So a phone is named by udid and,
where needed, host: `?host=` on `/control`, `{ udid, host }` in
`POST /recordings` and `add-device` (these through `findPhone`), and `host`
on `PUT /device/:udid/team` (`phonesOfUdid` in `grid.ts`, which also reads
saved phones). With a host, that exact row (the string the device list
reports, not normalised) among the rows the caller can see; without one, the
one visible row, none (the unknown answer), or, for two or more,
`409 ambiguous_phone` with the visible rows' hosts, sorted. A hidden row is
never returned or named. Through 2.33 `/control` and recordings took the
first row of the udid, so a tap or a recording could reach the other
server's phone, and the team route moved every row of the udid.

- **Recordings.** A recording's visibility is its own phone's
  (`phoneRowsOf`, `device-service.ts`: the udid's row on the recording's
  host, else the udid's only row), never the other same-named phone's team,
  and the owner's fallback for a phone with no row asks the same. A group's
  zips name a udid two of its phones share `<udid>@<host>`. Every recording
  answer (start, `add-device`, `stop`, `/recordings/active`, the group's
  `summary.phones[]`) gives `host` beside `udid`. The library takes `?host=`
  with `?udid=`, and its phone facets are one per udid unless two Device rows
  have that udid now: then one per phone, named with its host (a phone whose
  server changed address stays one facet). `video.mp4?udid=` takes `host`; a
  udid two of the group's visible recordings share, asked without one, is
  `409 ambiguous_phone`. `blockDevice` reads the phone's current hold by udid
  and host.
- **Unchanged** for a lab where every udid is on one server. On a hub a
  node's phone is forwarded without `host`: a udid is unique among one
  server's own phones. Reported as `features.phoneIdentity` and `phone-host`.
- **The dashboard sends `host` everywhere** (`web/src/lib/phone.ts`). A
  phone it holds is a `PhoneRef` (`{ udid, host }`, `host` required, so the
  type checker finds a call that forgets it), keyed by `phoneKey`
  (`udid@host`) in sets, maps, React keys, drag data
  (`application/x-xenon-phone`) and the Live devices store; `phoneDomId` for
  element ids. Every `/control` request, `XenonApiService`'s and the raw
  `stream/status`, `stream/leave` (the beacon too), `stream/ticket` and MJPEG
  URLs, goes through `controlPath`/`controlUrl` (udid percent-encoded,
  `?host=`); the team change sends `host` in its body, recordings send
  `{ udid, host }` entries. `serverLabel` and `udidRepeats` name a server only
  where a listed udid repeats (Teams settings, the Apps page's install menu,
  the busy message). Screenshots in IndexedDB are stored with `host`; a
  phone's are those with its host plus older ones with none.
  - **Device control's address** carries `?host=`
    (`deviceControlPath`, `web/src/lib/deviceControlPath.ts`): cards, the
    table, the overview, the command palette and the tab switch.
    `pickControlPhone` decides a link: a host names that phone or none
    ("device not found"); a link without one opens the udid's only phone,
    and the Devices page then pins its host in the address (replaced, so a
    second server's phone turning up later can't swap the open page for the
    chooser), and for two or more shows `PhoneChooser`, a link per phone,
    opening none.
  - The `ambiguous_phone` toast (`isAmbiguousPhoneBody`) and Live devices'
    `startRefusesTile` stay, for a request that somehow names no host.
  - A recording start's `409` is told apart by `error`: `device_busy` names
    the busy phones (with the server where the udid repeats),
    `concurrency_cap` the cap, anything else shows its `message`. Through
    2.34 every 409 that wasn't `device_busy` read as "cap reached
    (undefined/undefined)".
- **Live events** are delivered by the exact phone (see "Live events are
  team-scoped at emit time"), and the events that carry a udid carry its
  host: `session_started`'s `device_host`, `healing_event`'s `deviceHost`,
  `host` on recording events and device events. Reported as
  `features.phoneIdentity.events` and `phone-host-events`.
- Appium sessions by `appium:udid` are out of scope: either phone may be
  allocated.

**Session data follows the session's phone**
(`src/services/device-access/sessionVisibility.ts`). `canSeeSession` decides one
session: admin, or a visible phone, or, when the phone has no Device row
(unplugged), the session's owner. `visibleSessionWhere` is the same rule as a
Prisma `where`, so a list's `take` and a count are the caller's. Combine it
under `AND`, never by spreading, or one `OR` overwrites the other.

- `isValidSession` guards every `/session/:sessionId/*` route with it, and a
  hidden session gets the unknown-id body byte for byte. Bug reports, the
  session list, its summary (`/session-summary`), builds and the healing
  reads use it too.
- Session files (`<sessionId>/<kind>/<file>` under `sessionAssetsPath`) are
  served only by `GET /session/:sessionId/asset/:kind/:file`, for
  `screenshots`, `video` and `performance`. Never serve that folder with
  `express.static` or any mount outside `apiRouter`: it also holds interceptor
  captures and, by default, every recording. Until 1.29.1,
  `/xenon/session-recordings` served it with no login at all.

**Uploaded apps have a team** (`App.teamId`, null = shared), and follow the
device rule on it: `canSeeApp` / `visibleAppWhere`
(`src/services/device-access/appVisibility.ts`). The list, download, delete
and `/control/:udid/install-repository-app` give a hidden app the unknown-id
answer. `PUT /apps/:id/team` and delete are admin-only. `TeamService.delete`
refuses a team that still owns apps, since `onDelete: SetNull` would share
them with everyone.

- **Who uploads** (ENH-16, `memberUploadTeam` in `apps.ts`). Scope `apps` or
  `devices`; `apps` alone controls no phone and starts no session, for a CI
  step that uploads builds. An admin (`teamIds` undefined) uploads into any
  team or the shared pool. A member uploads into one of their teams (the only
  one when `teamId` is absent); the shared pool is refused, and a team that
  isn't theirs gets the same `403 not_your_team` as one that doesn't exist.
  Through 2.26 uploading was admin-only, so a CI upload key was an admin's.
- **Duplicates** (`uploadApp`). Bytes an app the uploader can see holds return
  that app, in its own team. Bytes only invisible apps hold get a row and a
  file of their own in the uploader's team: returning the other team's app
  would show it, refusing would say it exists. So there is one app per file
  per team, and a move into a team (or the shared pool) that has the file is
  `409 conflict` (`AppAlreadyInTeam`). AppService keeps that under a lock per
  md5, not with a unique index: adding one over `[md5, teamId]` makes
  `prisma db push`, which a database without migration history starts with,
  refuse without `--accept-data-loss`, so the server wouldn't start. A
  schema change that adds a unique constraint has that problem in general.
  `GET /apps?md5=` answers the visible apps with that file.
- **Identity** (`appIdentity.ts`): an APK by adb (`versionCode` is
  `buildNumber`), an `.ipa` or zipped `.app` from its own top-level
  Info.plist (binary or XML, at most 1 MB), never a nested framework's. One
  that can't be read is stored without it. `features.ciAppStore`, flag
  `ci-app-store`.

- **`xenon://<id>`** names a library app too (`parseXenonAppRef`,
  `appCapability.ts`): the id after the scheme when it is one, and any bare
  value without `/` or `\` as before. Every app the API answers carries
  `appUrl` (`xenon://<id>`). `GET /apps` filters by `md5`, `packageName`,
  `platform` and `latest=true` (the newest visible match, a one-element
  array) through `findApps`; a filter given twice or with a bad value is 400.
- A session naming an app by id resolves it with the same `sessionTeamIds`
  its phone is allocated with. A hidden app is left in the caps untouched,
  exactly as an unknown id is.
- The driver downloads the app with no credentials, so it gets
  `?ticket=` from `AppDownloadTicketService`: audience `xenon-app-download`
  (never a stream ticket, nor the reverse), bound to one app id, single-use,
  10 minutes. `authMiddleware` accepts it only on `GET /apps/:id/download`
  and answers every ticket failure `401 invalid ticket`. It is minted just
  before `next()` / the node forward and Xenon never writes it to the pending
  row, the Session row or its own logs: the stored caps keep the plain URL.
  Appium's `[HTTP]` request log and the driver's "Using downloadable app"
  line do print it, as they print stream tickets; by then it is spent, or
  dies within 10 minutes. With auth disabled there is no ticket.
- **One transfer per build per host** (ENH-19). Appium caches downloads by
  the whole URL, ticket included, so through 2.25 every session with auth on
  downloaded its build again.
  - This server's own phones' drivers get the library's file itself
    (`driverAppSource`): no download, no ticket. A file that isn't here gets
    the ticketed URL, as before.
  - A hub tells a node which app it sends (`xe:options.hubApp`: id, md5,
    size, extension; `capsForNode` drops a client's own). The node takes it
    only on a create its hub's token vouched for, or with auth off
    (`hubAppFor`). `NodeAppCache` fetches a build once with that session's
    ticket into `<cacheDir>/app-cache/<hub>-<id>-<md5><ext>`, checks size
    and md5, renames it into place, and keeps the 10 most recently used. A
    later create's driver gets the file and its ticket goes unused; a fetch
    that fails, or bytes that aren't what the hub described, fail the create.
    An older node ignores `hubApp` and downloads as before.
  - The caps the driver reads hold the file for `next()` only; what is kept
    is the plain URL. `features.appReuse`, flag `app-reuse`.
- Both ticket kinds share `SingleUseLedger` for replay: a `jti` is kept until
  the token's `exp` plus `verify()`'s 60 s tolerance.

### Session attribution

A session's owner is resolved by `SessionOwnerResolver.ownerOf`, which prefers
`Session.user_id` and falls back to `Session.api_key_id → ApiKey.userId` for
rows written before 1.13.1. Two columns because two id spaces: `api_key_id` is
the `ApiKey` row that created the session, `user_id` is the human.

A live session this server drives is looked up in memory first
(`LiveSessionOwners`, `src/services/device-access/LiveSessionOwners.ts`):
`finalizeSession` records its owner and its end forgets it (`deleteSession`,
`onUnexpectedShutdown`, shutdown). A node writes no Session row for a session
the hub created, so until then its `/control` guard, logcat WebSocket and
session listing found no owner and, failing closed, refused the phone to
everyone but admins, the owner the hub's create token named included. The
same went for any server with the dashboard off.

`resolveSessionIdentity` (`src/services/session/sessionIdentity.ts`, pure)
derives both from whichever credential `createSession` presented:

| Credential | `api_key_id` | `user_id` |
|---|---|---|
| `xe:options.{accessKey,token}` pair | ApiKey row id | `ApiKey.userId`, while that user is ACTIVE |
| `xe:options.sessionToken` (JWT `sub`, minted with `sessions`) | null | the token's subject, while that user is ACTIVE |
| on a node, the hub's create token (`x-xenon-hub-token`, `sub`) | null | the owner the hub verified |
| neither | null | null |
| `authDisabled` | null | null — every caller is a synthetic SUPER_ADMIN |

**`xe:options` is Xenon's capability namespace.** Credentials, the lease and
Xenon's other options (`healingTiers`, `interceptor`, `team`, ...) all live
there. `xenon:options` is still read as an alias; when a session sends both,
`xe:options` wins field by field. That rule lives in one place,
`xenonOptionsOf` / `xenonOptionsIn` (`src/services/session/xenonOptions.ts`),
and every reader goes through it — don't read either namespace directly.
`df:options` (from appium-device-farm) is **not read at all**: a session that
sends only `df:options` is treated exactly like one with no credentials.

The team a key-pair session asks for is `xe:options.team` (or `teamId`),
read by `extractTeamCap`. The flat caps older clients send (`xenon:team`,
`xe:teamId`, ...) still work, and the options field wins over them.

**Credentials never reach the driver or storage.** `prepareSession` (the
first step of every create, run by the session gateway) calls
`takeSessionCredentials` (`src/services/session/sessionCredentials.ts`)
first: it reads `accessKey`, `token`, `sessionToken` and `leaseToken`, then
deletes those four fields from both namespaces in alwaysMatch and every
firstMatch entry, in place, before the pending-session row, allocation, the
driver, the Session row or any log sees the caps. Everything else, `leaseId`
included, stays. They never leave the server they were sent to. A hub
forwarding a create to its node sends `capsForNode` and its own create token
instead (see Hub-Node Topology). A cloud provider gets neither.

**Credentials are checked as REST checks them.** The pair goes through
`verifyKeyPairCredential` and the session token through
`verifySessionTokenCredential` (`src/middleware/verifyCredential.ts`): a live
key or signature, and an owner who exists and is ACTIVE, looked up now.
Through 2.14 the pair was checked against the key alone and the token against
its signature alone, so an Inactive or deleted user kept creating sessions as
themselves. The owner found there is the one lookup the session's teams and
lease use.

**Attribution is decoupled from enforcement.** A session token is read for
identity whenever one is present, whether or not
`XENON_REQUIRE_SESSION_TOKEN` is on, and verified once for both (memoized in
`authorizeSessionRequest`). Three outcomes:

- A token that doesn't check out (wrong signature, audience or lifetime, not a
  JWT, or a deleted or Inactive user) is *ignored*, never rejected: it counts
  as no credentials, and `assertSessionTokenGate`
  (`src/services/sessionTokenGate.ts`) decides whether such a session is
  admitted. A wrong key pair is treated the same way.
- A token that checks out without the `sessions` scope is refused whatever the
  gate, as a key pair without `sessions` is. Tokens minted by 2.14 or earlier
  carry no `scopes` claim and are refused. `POST /auth/token` mints a session
  token only with the `appium:use` grant.
- A check that could not run (database or signing key unavailable,
  `isWrongSessionToken` false) refuses the create, as a key whose owner
  can't be looked up does.

**Operational note:** a session created with **no** credentials is still
admitted (`SessionLifecycleService` warns, it does not reject) and stays
unattributable, so the fail-closed rule denies everyone non-admin on that
device — including the engineer who started the run. If your clients cannot
pass `xe:options.accessKey` + `xe:options.token`, have them present an
`xe:options.sessionToken` instead (minted by `POST /xenon/api/auth/token` with
`audience: 'xenon-mcp'`, by a credential with the `sessions` scope), or
enforce credentials with `XENON_REQUIRE_SESSION_TOKEN`. The same holds for a
session created with the credentials of a user who is Inactive or deleted.

**Per-command auth** (`XENON_REQUIRE_COMMAND_AUTH`, off by default, never with
auth disabled; `src/middleware/commandAuth.ts`). Without it only createSession
checks credentials, and any later `<basePath>/session/:id/...` request is
authorized by the session id alone. With it on, every request under
`<basePath>/session/:sessionId` (all methods; `POST <basePath>/session` is not
under it) must carry the credentials REST accepts, the `x-xenon-*` pair or a
Bearer JWT (`xenon-rest`/`xenon-mcp`), verified by the helpers authMiddleware
uses (`verifyCredential.ts`). The caller must be the session's owner
(`SessionOwnerResolver.ownerOf`) or an override admin by `canOverrideLease`'s
rule; a Bearer token is judged by its `scopes` claim like a key, so an ADMIN's
ordinary key can't mint an override. A refusal is WebDriver's unknown-session
answer (404 `invalid session id`, empty `stacktrace`), so nobody can tell a
session they may not use from a missing one. An ownerless session is refused
to all but override admins. A failed lookup is `503 unknown error`, never an
allow. Verified identities are cached 30 s by SHA-256 of the secret; revocation
is not pushed, it takes up to 30 s (`commandCaller.ts` says why).

- **Basic auth is the key pair from a hub URL** (`basicCredential.ts`).
  `http://ACCESS_KEY:TOKEN@host/wd/hub` reaches Xenon as `Authorization:
  Basic base64(key:token)`, checked by `verifyKeyPairCredential`. Per
  command (`readPresentedCredential`) it is one more source of the pair,
  after the `x-xenon-*` headers; an unreadable one is `unreadable`, refused
  as invalid. On a create the gateway's create layer takes the header off
  the request and hands it to `prepareSession`, where it is read only when
  `xe:options` has no pair (the first present decides). Unlike a wrong
  `xe:options` pair, which is ignored, a Basic credential that can't be
  read or doesn't verify throws `BasicCredentialRefused`, answered `401`
  with `WWW-Authenticate`: a client that put a key in its hub URL meant it
  to be used. The decoded values are never logged or echoed.
- **It must run before Appium's routes.** Appium adds them before any plugin's
  `updateServer`, so a plain `app.use` never sees a command.
  `insertBeforeRoutes` splices the layer ahead of the first route, on
  `app._router` (Express 4) or `app.router` (Express 5, what Appium 3 runs).
  If it can't, the server refuses to start while the setting is on. It runs
  inside the session gateway (see Hub-Node Topology), so it is checked once,
  before a hub forwards anything to a node.
- **`/wd-internal` needs the per-process secret** (`src/gateway/internalCall.ts`).
  Xenon's own loopback calls (`LocalSession`'s HTTP fallbacks for page source,
  screen recording and perf recording) go to
  `<basePath>/wd-internal/session/<id>/...` with `x-xenon-internal`, a secret
  made once per process, never through an HTTP proxy. The path-less
  internal-call layer, ahead of the session layer, accepts a call only with
  both: it strips `/wd-internal`, removes the header, and marks the request so
  the session layer skips per-command auth. Without the secret, or with any
  other spelling of the marker, the request is left as it came and gets
  Appium's unknown-route answer, byte for byte (every request the layer leaves
  alone goes on through one `next()` call site, because Appium's 404 carries a
  stack trace). The path alone used to be the marker, which would have been a
  way around this check.
- **A `/wd-internal` call is never one of the test's commands.** The layer runs
  the rest of an accepted call's request in an `AsyncLocalStorage` context
  (`isInsideInternalCall`), since the plugin's `handle`, deep inside Appium's
  route, is never given the request. `CommandInterceptor.handle` then passes
  it straight to the driver: no command log, no idle-clock touch, no span, no
  healing. A hub forwarding one (`createHubRouting`) skips the dashboard's
  hooks and `touch` the same way. Through 2.16 the marker was on the request
  only. The dashboard recorded the call as the session's own, and
  `onSessionStopped` fails a session with any failed command: a performance
  recording's start or stop the driver refused (an iPhone whose recording
  never started; through 2.15, every simulator session, until #503 stopped
  Xenon stopping one there) failed a session whose commands had all passed,
  with failure analysis and a `session_failed` webhook, and a page source read
  over the loopback showed as a `getPageSource` the test never sent. The
  context also holds in what the driver starts during the call and runs later
  (its new-command timer), so read it only where a command enters the plugin. `internal-calls-session-record.spec.ts` runs the fallbacks through
  Appium's own server, umbrella and plugin.
- **A local session's heartbeat doesn't use HTTP.** `LocalSession.checkHealth`
  asks the in-process umbrella (`sessionExists`). Any command sent to the
  session, `timeouts` included, restarts the driver's new-command timeout and
  Xenon's idle clock, so a 30 s probe would keep an abandoned session and its
  phone alive for ever.
- **Neither does a hub's heartbeat on a node's session.** `RemoteSession`
  asks the node's `GET /xenon/api/node/sessions/<id>`
  (`src/gateway/nodeSessionStatus.ts`), which reads the node's umbrella
  (`AppiumUmbrella`, noted by `XenonPlugin.createSession`, the one place a
  plugin is handed it) and runs no command: `200 { value: { sessionId,
  exists } }`. Only a node mounts it, ahead of the login. It asks what a
  command to the session asks: with per-command auth on it needs the hub's
  session token for that session and answers anyone else with the
  unknown-session body (`503` when the JWKS can't be fetched); with it off,
  nothing, so a hub that can't sign doesn't see its node sessions as gone. Every
  answer carries `x-xenon-node-sessions`, so an older node (a 404 or a 401
  from its login, without the header) is recognised: the hub falls back to
  the old `GET .../timeouts` probe for it, logs that once per node
  (`NodeSessionProbeSupport`) and asks again after 10 minutes. A cloud
  session keeps the WebDriver probe.
  The heartbeat (`SessionHeartbeatService`) ends a session after six failed
  probes in a row (~3 minutes), except on a `200 { exists: false }`, the
  node's own word that it no longer has the session (`gone` on the health
  result): that ends it at the first answer, so the hub frees its claim on
  the phone at once. A failed request, a timeout, a refused token and an
  older node's WebDriver probe are still counted. Through 2.36 the node's
  answer was counted too.
  The node's `GET /xenon/api/node/sessions/<id>/metrics` (the hub's
  collection of a session's CPU and memory, `nodeSessionMetrics.ts`) and
  `.../device-logs` (its device log lines, `nodeSessionDeviceLogs.ts`) share
  this route's rule, through one check (`answerForHub`), and answer with
  `x-xenon-node-metrics` and `x-xenon-node-device-logs`.
- **The session listing is filtered** (`sessionListingFilter.ts`).
  `GET <basePath>/appium/sessions` is Appium 3's only listing route (no
  `GET /sessions`; Appium also gates it behind the `session_discovery`
  insecure feature). The same credentials are read: an override admin gets
  Appium's list untouched, a verified caller only the sessions they own,
  anyone else `{"value":[]}`, which is what an idle server answers. It wraps
  `res.json` and removes entries; Appium still builds the list. Owners are
  looked up when the list is answered, with one `SessionOwnerResolver.ownersOf`
  query for all listed ids (ownerOf's rule, shared cache). They can't be
  precomputed before `next()`: `xenon: setSessionStatus` changes a live
  session's status, so there is no reliable "live" filter. Error answers pass
  through. A failed credential check or owner lookup is 503.
- **Session WebSockets are guarded** (`sessionUpgradeGuard.ts`).
  `<basePath>/bidi/<id>` and drivers' `/ws/session/<id>/...` (with or without
  the base path) need the owner's or an override admin's credentials, in the
  same headers. A refusal is a bare `404` written on the raw socket, which is
  then closed, identical whether the session exists or not. A failed check is
  a `503`. The umbrella `<basePath>/bidi`, Xenon's ticketed `/xenon/...`
  sockets and socket.io are never touched. Appium takes upgrades one of two
  ways. On Node >= 22.21 / 24.9 it uses an `upgrade` listener, added before
  `updateServer`. On older Node it uses an Express middleware, which Node
  reaches only while the server has no `upgrade` listener. The check is
  async, so the guard wraps `httpServer.emit` for `upgrade`. It holds a
  session upgrade back from every listener until it's allowed, then
  re-emits it unchanged. It also puts a middleware at index 0 of the Express
  stack (`insertAtStart`). Session ids are read the way Appium reads them:
  WHATWG-normalised pathname, case-insensitive, plus BiDi's second read of
  the raw URL, each decoded too. The caller must own every one.
- **Which handler an upgrade reaches is the upgrade router's job** (see
  "WebSocket upgrades" below). It sits in front of the guard's `emit`
  wrapper and passes it everything that isn't Xenon's, so the guard stands
  in front of Appium's listener on every Node. Because the router always
  keeps an `upgrade` listener, Node < 22.21 no longer hands any upgrade to
  Express, and the guard's Express middleware is a backstop that isn't
  reached.
- Enable it on the hub, where the owners are on record. A node with it on
  accepts the hub's session token in place of credentials (see Hub-Node
  Topology), and refuses everything else, since its own database knows no
  owners for hub-created sessions.

Device leases: programmatic clients (SDK, MCP tools) claim devices via
`POST /xenon/api/sdk/leases` (`src/services/lease/LeaseService.ts`) — token-bound
claims with TTL + heartbeat, swept by `LeaseOrphanSweeper` (every 30 s: a lease
ends after three missed heartbeats or at `expiresAt`, whichever comes first;
either way it is marked `expired` and its port leases deleted. Heartbeat,
extend and `authorizeSessionUse` already refuse a lease past `expiresAt`).
A lease has 1 to 8 phones (members; see "Group leases" below), and may wait
for them in a queue.

**How a lease ends** (`leaseStatus.ts`). `Lease.status` is a `LeaseStatus`:
`waiting → active → released | expired | ended`, and `waiting → expired`.
Every terminal write also sets `endReason` (`LeaseEndReason`, `endedData`):
`client_released` (a `DELETE`, waiting or active), `wait_ran_out`,
`missed_heartbeats`, `past_end`, `unreadable_request` (a waiter whose stored
request no pass can read, given up when its client next asks), or
`member_lost: <member, why>` (`ended`). Through 2.36 only `ended` had one,
and `expired` alone meant any of four things. The API is unchanged: the
statuses are the same, and only an `ended` group's `410` carries `reason`,
in words without the code (`goneReason`).

- **Live** is one rule (`liveLeaseWhere`, `waitingWhere`): active and not past
  `expiresAt`, or waiting and not past `waitUntil`, where a `waitUntil` of
  null waits for ever. The queue, `activeLeaseOn` / `activeLeasesByDevice`
  and allocation's `leasedDeviceKeys` agree on it. Through 2.36 the readers
  held such a waiter not live while the queue served it.
- **An end is written only while the lease is as it was judged.** The
  sweeper ends a lease for missed heartbeats only while its
  `lastHeartbeatAt` is the one it read, and an active lease for either
  reason only while its `expiresAt` is too; a waiter likewise through
  `giveUp`'s `lastHeartbeatAt`. `extend` writes only while the lease is
  active with the `expiresAt` it worked from (not past), else reads again; a
  heartbeat only while not past `expiresAt`. Through 2.36 each write checked
  the status alone: a heartbeat landing during a sweep got 200 and the lease
  was expired anyway, and an extend could revive a lapsed lease or shorten
  another extend's end.
- **A waiter whose client went away isn't granted.** A pass gives up every
  waiter the sweeper would (`endGoneWaiters`: wait ran out, or three missed
  heartbeats), and never serves one quiet that long; `positionOf` doesn't
  count it. A grant sets `lastHeartbeatAt`. Through 2.36 such a waiter could
  be granted and reaped as "missed heartbeats" by the next sweep.
- **A lease locks the exact phone** (`lockExactPhone`): `findAndLockDevice`
  with `only: {udid@host}`. Through 2.36 the queue and granter passed the
  host as `filterByHost`, a substring match in the Prisma store, so a twin
  udid on `http://a:47230` could be locked for `http://a:4723`, then set free
  unconditionally.

Ending a lease, by a reap or its holder's release, takes off only the lease's
lock (`releaseLeaseLock`): `busy` is cleared only where the phone is `UNHELD`
(see "Busy on a hub"). A session created on the lease claims the phone, so a
session that outlives its lease keeps it, and its own release frees it. Until
2.1 the reap wrote `busy: false` outright and handed such a phone to a second
session mid-run.

**`filters.excludeTags`** (`leaseFilters.ts`, `memberMatches`): no phone
carrying any of those tags. Applied with `deviceName` wherever a lease's
phones are picked (create's up-front check, the queue's candidates), never by
the stores (`clientFilters` strips it). Not a list of non-empty strings is
`400` (`excludeTagsProblem`). Xenon Test's ENH-10; its `priority` half isn't
built.

**`filters.host`** (`leaseFilters.ts`, `hostMatches` in `memberMatches`): only
the phone whose row's `host` equals it, string for string, as `/control`
matches it; never a substring. A hub and its node can each report one udid
(`emulator-5554`). Applied wherever a lease's phones are picked, never by the
stores: neither store's `getDevices` reads `host`, so `clientFilters` removes
it and `memberMatches` applies it exactly. Anything but a non-empty string is
`400`, "filters.host must be a server's host" (`hostProblem`; `members[i].` in
a group). `/sdk/version` `lease-host`, `features.leasing.host`.

**Extending a lease** (`LeaseService.extend`) makes it last at least
`durationMs` from now and never shortens it; it stops 24 hours after the
lease was created. A heartbeat proves the client is alive and moves no end:
`expiresAt` is the lease's hard limit. The lease's driver ports are reserved
on the phone's server (`POST /ports/allocate`, in that server's database) for
its first duration plus 5 minutes, after which that server reaps the rows and
can hand the numbers out again. So when the end moves, extend asks that server
to hold them until the new end (`POST /ports/extend`, `holdPortsUntil`),
without waiting for it: a server that is slow, down or from 2.18 or earlier
(404) leaves the ports ending as before, and the extend still answers.
Through 2.18 extend set the end to now + `durationMs`, so a shorter duration
than the time left cut the lease short, and its ports always ended with its
first duration.

**Which ports a lease gets** (`PortAllocatorService`, `leasePortPicker`):
the first of `LEASE_PORT_RANGE` (13100–13999) that no reservation holds and
nothing on the machine listens on (`isPortFree`, the probe `PortAllocator`
uses), clearing the range's expired rows first; a row written meanwhile is
skipped. Through 2.20 they were `get-port`'s OS-assigned ports, from the
ephemeral range every other program uses too: between a lease's reservation
and its session Android Studio took one, and the session failed with "cannot
bind listener: Address already in use". Ordinary sessions still take their
ports from `get-port` (`XenonCapabilityManager`), and use them at once.

**A session gives back only its own ports** (`PortAllocator`,
`createPortOwner`). The ports an iOS session leases for itself
(`iOSCapabilities`: WebDriverAgent and MJPEG, when the phone's row has none)
are rows keyed by their owner in `leasedToUdid`, not by the udid: by the
create's claim (`create:<udid>@<host>@<claimedAt>`) until registerSession
holds the phone, then by the session (`session:<id>`, `adoptForSession`),
and always new ports, never a row the phone already holds. A failed create
deletes its `create:` rows (`releaseAllocation`, `handleSessionFailure`), and
a session's end its `session:` rows (`releaseForSession`, in
`finalizeCleanup` and in `forgetSessionMemory`, which every ending reaches).
A capture's stop deletes its own proxy port (`release(port, udid)`).
`touch` extends only a row of the phone's own: with a udid, that udid's, and
never a lease's (`leaseId`) or a session's. Through 2.36 every session end
and capture stop deleted every row leased to the phone (`releaseForUdid`):
an SDK lease's reserved ports, which the lease picker then gave the next
lease while the first one's session held them, and a preview's stream ports
when the stream outlived the session. IOSStreamService's hourly `touch`
still passes no udid.

**Ending a lease frees its ports where they are.** Release and the sweeper
delete this server's rows by `leaseId`. A node's phone's rows are in the
node's database (the hub sends `leaseId` with the reservation, and the node
writes it, but the hub can't delete rows there), so when that delete didn't
take every port the lease holds, the
phone's server is asked to free them (`POST /ports/release`, by udid and port
number, `PhoneServerPorts.free`), without waiting for it. Through 2.19 a
node's lease ports stayed reserved after the lease ended, until their own
expiry. `PhoneServerPorts` (`src/services/lease/phoneServerPorts.ts`) holds
both calls to the phone's server, extend's and release's.

**Group leases** (`members`, `waitMs`; the design is
`docs/superpowers/specs/2026-11-07-group-leases-design.md`). A request sends
`filters` (one member) or `members` (1 to 8, each with its own filters), and
gets every phone or none: one token, one heartbeat, one `expiresAt` for the
group. Through 2.19 a lease was one phone and the SDK asked for a run's phones
in parallel, keeping what it got: two runs of two phones with two free could
each hold one and wait out their timeouts, and a large group had no turn
against single leases.

- **Member rows are the one source** of which phones a lease has
  (`LeaseMember`: `leaseId`, `index`, `udid`, `host`, ports, capability bag,
  `heldAt`). A member of a `waiting` lease is a phone held for it, of an
  `active` one a leased phone. Every reader asks them (`activeLeases.ts`:
  allocation's `findAndLockDevice`, `leaseHolderOf`, `BusyPrecheck`, the idle
  sweeper, `keepLeaseLock`), so plain sessions, previews and recordings skip
  held phones as they skip leased ones, and a held phone is the waiting
  lease's holder's at the ownership guard (refused to others as "held for a
  waiting lease"). The `Lease` row's device columns are member 0's, for the
  single-phone answer and code that knows one phone; a lease from before
  groups gets member 0 written from them at boot (`backfillLeaseMembers`).
- **The queue** (`LeaseQueue`): `waiting` rows inside `waitUntil`, by
  `createdAt`, ties by id; one server's queue (two hubs on one database
  aren't supported for leases). A pass runs on a create, on `kick()` (a
  release, a waiter giving up), on every `phoneFreed()` (`leaseQueueKick.ts`:
  a session's release, a forced release, a phone added, a node reporting one
  free, a sweep that let a phone go) and every 5 s as a backstop, always under
  `ALLOCATION_LOCK`, so a grant and a session never pick one phone. Only the
  head holds: it takes a maximum matching (`memberMatch.ts`) of its members to
  the free phones plus its holds, is granted on a full match, else holds that
  matching's phones (locked with `busy`, written with `heldAt`) and nothing
  else. Every later request, `waitMs: 0` ones included (`tryNow` serves the
  queue first, then counts as its last), is granted only if it fills
  completely from free phones the head neither holds nor matched, and never
  holds. So no two waiters hold halves of each other's set, and among leases
  it is first come, first served. Each request sees only its stored
  `callerTeamIds`. Plain sessions keep `commandsQueueGuard` and stay outside
  it. A pass first gives up each waiter past its `waitUntil` or three missed
  heartbeats (`endGoneWaiters`, `giveUp`'s work under the pass's lock), so
  its holds go to the next head then rather than at the sweeper's next look.
- **A grant is all or none** (`LeaseGranter`): it locks each phone the lease
  doesn't hold yet, reserves every member's ports on its phone's own server,
  then activates the lease with its member rows in one write, deleting any
  row outside indexes 0..n-1 (a move's temporary negative index included;
  through 2.36 only those past the end, so a leftover became member -3). A failure rolls
  back what that grant took (its reserved ports, here and on the phone's
  server, and its locks); a waiter keeps the phones it already held and
  waits on, and a `waitMs: 0` request answers `503 device_unhealthy`. The
  reservation is sent once with a 10 s limit (`once`: the pass holds
  `ALLOCATION_LOCK`, and the client's four 30 s tries would stall every
  session's allocation), and a phone whose reservation failed is skipped by
  passes for 60 s (`SKIP_FAILED_PHONE_MS`), so a broken node can't make them
  loop. A failure to reach the phone's server at all (`isTransportFailure`:
  a timeout, a refused or reset connection, a name that doesn't resolve, a
  5xx) skips every phone on that `host`; a 4xx skips only the phone it was
  about. And a hold of the lock tries at most one grant that fails on its
  ports (`reservationFailures`, `LeaseQueue.reservationFailed`): the rest of
  the pass grants nothing, a `waitMs: 0` request after it tries none (`409`
  busy when it could have been filled), and the next pass goes on without the
  skipped server. Otherwise each failed reservation costs a 10 s timeout and
  the next phone is tried, so a dead node holds the lock, and every session
  create waiting on it, for a minute or more.
- **A server's own phones need no credentials** (`ownPorts.ts`). The port
  client (`PortAllocatorClient`) reserves, extends and frees a phone filed
  under one of this server's own hosts (`isThisServersHost`:
  `localDeviceHosts`, exact) with `PortAllocatorService` in process, and the
  default credential provider gives such a host none. Another server's phone
  is reserved over HTTP with the hub's ports token (see "The hub's tokens"),
  plus `XENON_HUB_ACCESS_KEY` / `XENON_HUB_TOKEN` when set; with sign-in on,
  no key to sign with and no pair, the provider's `reaches` is false, the queue
  leaves the phone out of its candidates, and `create` refuses a member only
  such phones could fill before anything is tried or queued
  (`LabMisconfigured`, `500 lab_misconfigured`, no `retryAfterMs`).
  `GET /capabilities` reports it as `features.leasing.nodePhones`. Through
  2.20 an own phone went over HTTP to this server's own `/ports/allocate`,
  so with sign-in on every lease, a single server's included, needed the
  pair, and without it answered `503 device_unhealthy`, which clients retry.
- **The sweeper** also ends waiters: past `waitUntil` or three missed
  heartbeats, `expired`, holds let go (`LeaseQueue.giveUp`); a held phone that
  is lost is dropped and the lease keeps waiting (`dropHold`). An active group
  (more than one member) whose phone is lost (row gone, `Unhealthy`, blocked
  by an admin: `memberLossReason`) is `ended` with `endReason` ("member_lost:
  member 1 (udid) disconnected"), every member released; heartbeat and `GET`
  answer `410` with the words after `member_lost: ` as `reason`. A missing row counts only when the previous sweep
  of this process missed it too, since a hub clears its own rows at boot, and
  so does an `Unhealthy` phone, since one health check can be wrong; a block
  counts at once. A single lease keeps its phone through a disconnect, as
  before groups. Sessions on the other members aren't ended.
- **The health monitor** (`HealthMonitorService`) treats a busy phone a live
  lease holds or leases (`activeLeasesByDevice`, read once a run) with no
  session on it as the idle phone it is: no zombie reclaim, and its health
  checked as if it weren't busy. Taken for a zombie, its `busy` was cleared
  and an idle iPhone (WDA stopped) read `Unhealthy`, which ended its group at
  the next sweep. A run that can't read the leases leaves busy phones alone.
- **Shutdown** stops the queue first (`LeaseQueue.stop()` at the top of
  `index.ts`'s `cleanup()`), so the drain's releases start no pass. Not in the
  `'exit'` hook: its timers are unref'd and die with the process.
- **A restart** keeps `waiting` and `active` rows and their members: the
  queue's order and every hold survive. A pass keeps a hold whose phone has no
  row yet as it is, and no grant waits on less. Once the phone is found again,
  free on record, the next pass locks it again (`relockLeasedPhones`, first in
  `LeaseQueue.serveQueue`, under the allocation lock): every phone of a live
  lease that shows `busy: false` and that nothing else holds (`isUnheld`, not
  offline) is written busy, then the lease is checked again and the write
  undone with `releaseLeaseLock` if it ended in between, `keepLeaseLock`'s
  pattern. The same undoes an admin's Unblock on a leased or held phone
  within a pass. A node's report of "free" never clears it (`addNodeReport`
  asks `activeLeaseOn` first, both stores); through 2.20 it did, and on a hub
  each report cleared `busy` until the next pass set it again, with a "locked
  again for lease" line every few seconds.
- **Sessions** name their member (`xe:options.leaseMember`, in each member's
  `appiumCapabilities`, not a secret, kept in the stored caps). A group
  session without it is refused with `name the lease member:
  xe:options.leaseMember` (`LeaseMemberRequired`, only after the proof); a
  single lease needs none. The session's row records `Session.lease_id`, so a
  group's sessions can be found together. Every lease refusal there is a
  `SessionNotCreatedError` (`session not created`); through 2.20 they were
  plain Errors, which Appium answered as `unknown error`.
- **The device list** (`grid.ts`, `withLeaseStates`) gives each listed phone
  `leaseState` (`held` / `leased`) and `leaseHolder` (`you` / `other`, by
  `isLeaseHolder`, the ownership guard's rule; never who), one lease read per
  listing, after the team filter. The card reads "Held for a waiting lease" /
  "Leased", counts either as busy, and disables Control on another user's
  lease ("Leased by another user"), except for admins, as the server refuses
  it.
- **The API**: `202` waiting (token, `position`, `waitUntil`), `GET
  /sdk/leases/:id?waitMs=` (at most 25 s, a long-poll on `onChange`, counts
  as a heartbeat), heartbeat while waiting, `DELETE` to give up, `extend` on
  a waiter `409 lease_waiting`, `/sdk/version` `lease-groups` and
  `lease-queue`. `waitMs: 0`, the default, is the single try every lease
  made through 2.19.

Leases are resolved at
allocation via the `xe:options.leaseId` capability. A lease id is not a
secret, so the session must also prove it holds the lease
(`LeaseService.authorizeSessionUse`): the lease token as
`xe:options.leaseToken`, the creating credential, or an override
(`canOverrideLease`, which follows `resolveActor`: a SUPER_ADMIN, or an
`admin`-scoped credential; for a session token, whose scopes are fixed at
mint, on the user's role now, so an ADMIN's token also needs the role to
still be ADMIN). The phone must also be
visible to the caller's REST teams. Every refusal is one message from one
throw site in `allocateDeviceForSession`. `createSession` strips the token,
with the session's other credentials, before anything else reads the
capabilities; the lease-create response's `appiumCapabilities` carry
`xe:options.{leaseId,leaseToken}`, and the persisted `capabilityBag` never
holds the token. Prefer leases over
manual locks for anything non-interactive. Hub-issued JWTs: `POST /auth/token`
mints RS256 tokens (`JwtKeyService`), `authMiddleware` accepts them as
`Authorization: Bearer`, JWKS at `/auth/jwks.json`; single-use stream tickets
(`?ticket=`) authenticate the webview MJPEG path.

The frontend identity probe is `GET /xenon/api/auth/me` which returns `{ userId, scopes, teamId }`. The mosaic view fetches it on mount and uses it for the `manual_self`/`manual_other` distinction in the device picker.

**The dashboard's sign-in state** (`web/src/auth/auth-context.tsx`) is one
`AuthStatus`: `checking`, `signedIn(me)`, `signedOut` or `unreachable(error)`.
`useAuth()` still gives `me` and `loading` from it, plus `status`.

- Only `signedOut` (a 401 from `/auth/me`) sends a person to sign in
  (`RouteGuard`, with `reason=expired` when the browser had a session).
- `unreachable` (a network error or any other status: a restart, a proxy's
  502) shows "Can't reach the Xenon server" with Try now. The provider asks
  again by itself, 1 s, 2 s, 4 s ... up to 30 s apart (`retryDelayMs`), and
  the page opens once the server answers.
- `refresh()` never rejects. Each check is numbered when sent, and an answer
  is applied only if no later-sent check has been applied, so the mount's
  check and the sign-in page's `await refresh()` can't land out of order.
- A refused socket's check applies `signedIn` or `signedOut`, and changes
  nothing when the server can't be reached.
- Through 2.36 any failure but a 401 left `me` null, and the guard sent
  signed-in people to "Your session has expired".

### Mosaic / Live Devices UI (`web/src/components/mosaic/`)

Multi-device live preview + group recording surface. Uses a custom `useReducer` store (`recording-group-store.ts`) for tile/layout/recording state. Click-to-toggle from the picker; drag-and-drop into specific cells; per-tile interaction (tap/swipe/long-press translated via WDA `screenWidth/screenHeight`) and keyboard input (typed chars → `/control/:udid/text`, Backspace/Enter → `/keyevent`). Tile state survives a refresh via mount-time rehydration that finds devices with `session_id=manual_<myUserId>_*` and an active stream service.

- **The recording phase is the one record** (`recordingPhase`: `idle`,
  `starting`, `recording`, `stopping`). Read it through `isRecording` (recording
  or stopping) and `gridCanChange` (idle only), never by comparing phases at a
  call site.
- `gridCanChange` decides every change to the grid: the reducer's `ADD_TILE`
  and `REMOVE_TILE`, the device list (`pickerToggle`), a tile's ×, Restore,
  the idle watch and its release. A tile's × sends `stream/leave` only when
  the tile comes off.
- **A failed Stop** asks `GET /recordings/active`. If the group still runs, or
  that can't be read, `STOP_FAILED` goes back to `recording` and Stop stays,
  with a banner; only a group that has ended goes to idle.
- **The load's rehydrate merges** (`MERGE_TILES`): it adds the tiles it finds
  and keeps tiles added meanwhile, never puts back one removed since the page
  loaded, and always adds a running recording's phones.
- Through 2.36 a stored `recording` flag, false while starting, sat beside the
  phase: a device-list click during a start sent `stream/leave` for a phone the
  start had named, an add then got no recording, a failed Stop showed idle
  while the server kept recording, and the rehydrate's `SET_TILES` dropped
  tiles added while it ran.

### Data Layer (`src/data-service/`)

- **PrismaStore** — SQLite via Prisma ORM (models: Build, Session, SessionLog, Log, Profiling, App, Device)
- **Schema at startup** (`src/scripts/run-migrations.ts`, and `npm run
  db:migrate`): the database chooses the command, never `databaseProvider`.
  `prisma migrate deploy` for a database whose `_prisma_migrations` history
  matches its tables, `prisma db push` for every other: a new one, one made
  by `db push` (the default always made those), one whose tables differ from
  its recorded migrations, or one with a failed migration recorded. Before
  deploying missing migrations it builds the applied ones in a scratch
  directory and diffs them against the tables (`migrate diff
  --from-migrations`). `--accept-data-loss` goes only to a database with no
  history: on one with a history, what differs may be a table added by hand
  or the half-finished copy a failed migration left. `db push` without the
  flag refuses to drop a table or column that holds data (an index, an empty
  table or an empty column it drops without asking), so the start stops.
  `schemaSyncFailure` takes the plan and prints commands with this server's
  paths: a backup (`VACUUM INTO` through `prisma db execute`), `db push
  --accept-data-loss` to let what Prisma lists go, and, for tables that
  differ with no failed migration recorded, `migrate deploy` on a copy before
  the file. It never sends `migrate deploy` to the file outright: that fails
  on tables ahead of the history (P3018, recording the migration as failed)
  and at once on a failed migration (P3009). A P3018 at a start says what to
  check (a change already there, or rows the migration can't take) and
  promises nothing.
  Through 2.15.0 `postgresql` chose `migrate deploy`, which refuses a
  non-empty database with no history (P3005), so a Xenon Control profile set
  to postgresql couldn't start. The default chose `db push`, which moved
  migrate-deploy databases past their history, and a later `migrate deploy`
  then failed on an applied migration (P3018) and recorded it as failed.
  `run-migrations-database.spec.ts` runs the real CLI on each kind.
  2.16.0 also repaired histories at startup (#493, #502): it recorded
  migrations applied or rolled back with `migrate resolve` and tried
  migrations on a `<db>.xenon-trial-<pid>` copy. Reviews kept finding
  migrations recorded that never ran, so 2.16.1 removed it (#509); a
  database 2.16.0 touched may carry a history it rewrote, and a start killed
  mid-trial may have left a trial copy beside it. A redesign starts from a
  spec, before any release ships a migration that drops data.
- **SessionLog** holds every command of every session, so every read of it
  goes through an index: `(session_id, createdAt)` for a session's commands
  (the session page, the failed-command check at each session end, cleanup),
  `(is_healed, createdAt)` for the heals of a period, and
  `(original_strategy, original_selector, createdAt)` for one selector's.
  Through 2.10 only the last existed: the "To fix" list took 2.5 s on a
  million commands and each session lookup read the whole table.
- **Log** (a session's device and debug lines, hundreds a session) and
  **Profiling** (written before 2.10 only) are read by session on every
  session page and deleted by session in cleanup: `(session_id, log_type,
  createdAt)` and `(session_id, timestamp)`. Through 2.10 neither had an
  index, and cleaning up a build of 100 sessions took 97 s on 2.5 million
  log lines (4 s now).
- `session-log-indexes.spec.ts` runs the Selector Health and session reads,
  and cleanup's deletes, and fails on any step SQLite plans as a scan of
  these tables (`EXPLAIN QUERY PLAN`, via
  `useScratchDatabase({ captureQueries: true })`). A new read by session
  belongs in it.
- **DeviceStore** — in-memory device cache synchronized with the database
- **A phone's health** (`src/data-service/deviceHealth.ts`, `isHealthy`):
  unset or `Healthy` is healthy; `Unhealthy`, and any value Xenon doesn't
  write (a newer node's report, a hand edit), is not, so the phone isn't
  handed out. Allocation (`getDevices`), a lease's candidates (`leasable`)
  and the lease sweeper (`memberLossReason`) all read it. Through 2.36
  allocation refused anything but `Healthy` while leases took and kept
  anything but `Unhealthy`. The health monitor judges a fresh check's result
  with its own test.
- **`Device.offline`** is never written true: a phone that goes offline is
  deleted. Readers honour true and take NULL as not offline (the Prisma lock
  and filter use `NOT_OFFLINE`, false or NULL). Through 2.36 the lock asked
  `offline: false`, which NULL never matches, so a row written without the
  column could never be allocated. `owningSessionId` and `lockedAt` are
  unused columns: nothing writes them, and `CLAIM_RESET` still clears them,
  so a value left from before goes at the next release. They stay in
  the schema (no column is dropped).
- **DeviceSetting** (`src/data-service/deviceSettings.ts`) — what people set
  for a phone (team, tags, maintenance, reservation), kept apart from its
  Device row. The row is deleted whenever the phone goes (unplug, reboot, adb
  offline, a restart, a node gone or missing one health probe); through 2.13
  that reset all of them, and a team's phone came back in the shared pool.
  - The store's `updateDevice` saves every `setting` column
    (`deviceFieldOwners.ts`) before it writes the row, and `addDevices` starts
    a new row from what is saved, in the write that creates it, then looks
    again for a setting saved meanwhile.
  - Keyed by udid and host, like the row; never by udid alone (an emulator's
    udid repeats) or nodeId (new at every start). On a hub a node's phones'
    settings are the hub's; a report never writes them.
  - A reservation is restored only while it holds. At start, rows with
    settings and none saved are adopted (rows written through 2.13), and
    `removeDevicesFromDatabaseBeforeRunningThePlugin` forgets those of the
    phones the server clears.
  - A team a not-connected phone still names can't be deleted;
    `PUT /device/:udid/team` moves such a phone too.
- **QueueService** — queues session requests when all devices are busy

### API & Real-time (`src/app/routers/`, `src/dashboard/`)

REST endpoints under `/xenon/api` (documented at `/xenon/api-docs`). All state changes are broadcast to dashboard clients via Socket.io by `EventManager`.

**Errors under `/xenon/api`** (`src/app/apiErrors.ts`). Express 4 ignores
the promise an async handler returns, so a throw after an `await` used to
leave the request unanswered (deleting an unknown API key, a duplicate user
email). `forwardAsyncErrors()` sends a rejection to `next(err)` as Express 5
does, and `apiErrorHandler`, the API router's last layer, answers every error
as JSON: Prisma's P2025 is `404 not_found`, P2002 `409 conflict` naming the
field, a malformed `%` `400`, an error carrying a 4xx `status` keeps it, and
anything else is `500 { error: 'internal' }` with the details only in the log.
A handler needs no try/catch just to be answered.

**The API reference** (`/xenon/api-docs`, raw at `/xenon/api-docs.json`) is
`src/app/swagger.ts` (introduction, auth, shared responses and schemas, tags)
plus one YAML file per area in `src/app/openapi/` (identity, control, grid,
sessions, platform), copied to `lib/` by `build:copy`. A new route needs its
operation in the matching YAML file in the same change:
`test/unit/openapi-coverage.spec.ts` reads the routes the router really
serves and fails on any route missing from the spec, any documented route
no longer served, an invalid spec, or an operation without a summary,
description, known tag, unique `operationId` or (unless public) a 401.
Through 2.12 the spec lived in JSDoc comments in a `.ts` file. `tsc` dropped
most of them, so the published page showed 46 of its 100 paths, and 61 routes
were never documented at all.

**Live events are team-scoped at emit time.** A socket keeps who it is on
`socket.data.identity` (`{ principal, userId, role, teamIds }`), with
`teamIds` from the same `computeTeamIds` REST uses, and follows the user
(see "A socket's identity follows its user" below). The handshake accepts what REST accepts: a bearer JWT, an `(accessKey,
token)` pair (nodes), or the `xenon_dashboard_session` cookie, a `UserSession` id (`/login`).
Until 1.29.0 the socket tried only a raw API key there, so every dashboard
signed in through `/login` was refused and got no live events; through 2.18 it
took both, as REST did.
Any event about a phone goes through
`SocketServer.emitToDashboardForDevices(event, data, scope)`, which sends it
only to the dashboard sockets whose caller passes `isDeviceVisible`. Delivery
is by the exact phone, udid and host, since two servers can each have an
`emulator-5554` in different teams:
`{ udid, host }` resolves the team through `DeviceTeamResolver`,
`{ udid, host, teamId }` uses a row in hand, and `{ phones, strip }` cuts a
multi-phone payload (recording started/stopped) per socket, by each phone's
team. A scope with a udid and no host (an emitter with no phone row to hand)
is resolved as `findPhone` resolves it: the udid's one row, and for two or
more rows the event reaches admins only. A host no row of the udid has is
an unknown phone, even when the udid has one row elsewhere: that row may be
another server's phone in another team (a node's phone that dropped off,
its session still naming its host, beside the hub's of that udid). REST's
`phoneRowsOf` asks the phone's saved setting before taking an only row; the
events don't, so a mark on a recording whose phone's server has changed
address since reaches admins only until the page is reloaded. An unknown
phone reaches admins only. The event log (below) still records each event once, unscoped,
minus a session's own data.

- **Emitters scope by the host when they have one**, in hand or read from
  the row they already read, and by the udid alone when they don't: a
  session from its phone (`sessionEventPhone`: the phone it holds, else its
  udid's Device row on its node, else the udid alone), a heal from its
  session's phone, a recording from its phone or its row's `device_host`,
  the interceptor from the session's device. Recording bookmarks and
  annotations are scoped by the recording's own `device_udid` and
  `device_host`. Through 2.34 the resolver looked a udid up with
  `findFirst`, so an event about one same-named phone could reach the
  other's team.
- Session commands and intercepted requests emit once each, so the resolver
  caches a phone's team for 5 s (`DEVICE_TEAM_TTL_MS`), keyed by udid and
  host (or the udid alone for a host-less scope): one lookup per phone, never
  one per command. Device events and `PUT /device/:udid/team` refresh it
  through `note(udid, host, teamId)`, which also drops the udid's host-less
  answer; the team
  route (`assignDeviceToTeam`) notes each phone it moved. A lookup that outlasts
  2 s (`DEVICE_TEAM_LOOKUP_TIMEOUT_MS`) fails closed for that event.
- Each phone's events go through one delivery chain, so they arrive in the
  order they were emitted whatever their scope shape; a group event waits
  for every phone it names. The chains stay keyed by udid, so two
  same-named phones share one, a stricter order than needed. Different
  udids' events may interleave.
- **Captured traffic is admins only** (`{ udid, host, adminOnly: true }`). The
  interceptor's three events (`interceptor_request`, `_session_started`,
  `_session_stopped`) go only to a socket whose `role` is ADMIN or
  SUPER_ADMIN, as `roleGuard('ADMIN')` decides for the `/interceptor`
  routes, and that sees the phone. The role decides, never `teamIds`
  alone. Admins see every phone, so there is no team lookup: a slow store
  holds no captured request back. Through 2.15 every socket that saw the phone got each request's
  headers and bodies, Members included, while REST and the Network panel
  refused them.
- **A socket's identity follows its user** (`SocketServer.recheck`). REST
  looks the caller up on every request; a socket runs the handshake's own
  check (`check`) again, on its own handshake credential:
  - **Admitted:** it gets its new role and teams where it is, still
    connected.
  - **Refused:** an Inactive or deleted user, a signed-out `UserSession`, a
    revoked or expired key, a rotated access key (a node's pair), or a bearer
    token REST no longer takes. Its connection is closed (`socket.conn.close()`)
    and nothing more is sent to it. The client reconnects as after any drop,
    and the handshake decides on the credential it has then: a fresh token
    from its `auth` function (Xenon Studio, the documented client) or the
    browser's new cookie gets back in, and the refused one is refused once.
    socket.io-client doesn't retry a refused handshake.
  - **Never `socket.disconnect()` for this.** socket.io's client never
    reconnects after `io server disconnect`, so each hourly `exp` would end
    Xenon Studio's live events for good.
  - **Couldn't check** (database down): kept as it was, never closed.
    Closing every dashboard over a hiccup would have their reconnects refused
    too, leaving them all with no live events.
  - **A handshake that couldn't be checked** is answered `connect_error`
    `unavailable` (`HANDSHAKE_UNAVAILABLE`), a refusal `unauthorized`
    (`HANDSHAKE_REFUSED`, only for a `SocketRefused`). socket.io-client tries
    neither again by itself, so the dashboard's socket-manager and the node's
    `SocketClient` try again after `unavailable`, from 1 s doubling to 30 s,
    starting over once connected; `unauthorized` is handled as before (the
    dashboard reads `/auth/me`, the node gives up). Through 2.36 both were
    `unauthorized`, so a dashboard reconnecting during a database hiccup had
    no live events until a reload, and a node none until it restarted.
  - It runs on every change Xenon makes, awaited, so once the REST call has
    answered the socket is updated or gone: `identityChanged(userId)`
    (`src/services/identity/identityChanges.ts`) from `UserService` (role,
    status, delete, `rotateAccessKey`), `UserSessionService` (sign-out,
    revokes), `ApiKeyService.revoke` and `TeamService` (add or remove a
    member). A new writer of a user's role, status, sign-ins, keys or teams
    calls it.
  - It also runs when the credential ends by itself: a timer at the moment
    REST stops taking a bearer token (`exp` + `JWT_CLOCK_TOLERANCE_SEC`, the
    60 s jose allows; the handshake uses the same limit), or at a key's or
    sign-in's `expiresAt` (set again when REST has renewed the sign-in).
  - And every 60 s (`SOCKET_RECHECK_INTERVAL_MS`), for a change made
    elsewhere: another server on the same database, a direct edit. A sweep
    checks 10 sockets at a time.
  - A re-check renews nothing: no sliding TTL (`resolve(id, { renew:
    false })`), no `lastUsedAt` (`touch: false`).
  - **Order:** a check's outcome is applied unless one that started after it
    has already applied its own. A change's check therefore lands before REST
    answers even with a sweep's check running, and a newer check that couldn't
    run doesn't cancel an older refusal. It does stop an older admission
    (what that read may predate the change): the socket stays as it was.
    Through 2.36 the older admission was applied.
  - A handshake that overlapped a change is checked again once connected, and
    its `register_dashboard` joins the room only after that check.
  - Selector events ask about visibility before an `await`: a socket whose
    identity changed meanwhile (user, role or teams, compared by value) gets
    nothing. Every check gives the socket a new identity object, the sweep's
    included; through 2.36 they were compared as objects, so an event whose
    lookup overlapped any check was dropped.
  - **Not covered:** a key or token bound to one team keeps that team after
    its user leaves it (`computeTeamIds` returns the key's team as it is), as
    on REST.
  - **The dashboard after a refused handshake** (`connect_error`
    `unauthorized` with `socket.active` false, `onSocketRefused`; not after
    `unavailable`, which socket-manager retries): it reads `/auth/me` again.
    Signed out, the route guard sends it to sign in. Nothing reconnects from
    there, so a refusal the sign-in doesn't explain can't loop. Signing in
    again revives the socket (`reviveSharedSocket`, from `refresh`).
    socket-manager keeps the socket's phase (`getSocketPhase` /
    `onSocketPhase`: `connecting`, `live`, `reconnecting` for socket.io's
    retries and its own after `unavailable`, `refused`), read through
    `useSocketPhase`. The header's pill (`ConnectionPill`) says "Live updates
    stopped" for `refused`, with a Reload button, until a revive or a
    connect. Through 2.36 nothing held "refused": the pill read "Retrying
    automatically" for a minute, then "Disconnected", while nothing retried.
  - Through 2.15 the identity was fixed at connect until a reload. A demoted
    or disabled admin's open tab kept every captured request, a member taken
    off a team kept its phones' events, and a signed-out cookie's or expired
    bearer token's socket stayed connected.
- **Selector events follow Selector Health's rule**
  (`emitToDashboardForSelector(event, data, { strategy, selector })`): a
  member's socket gets a `selector_*` event only for a selector healed in a
  session they may see (`SelectorVisibilityResolver`: `canSeeSelector` over
  `visibleSessionWhere`, the REST reads' own functions). Answers are cached
  5 s per viewer (user and teams) and selector, a viewer's sessions are read
  once for all their selectors (so a change of who may see a selector takes
  up to ~10 s to apply), and a lookup that fails or outlasts 2 s
  sends that event to admins only. Each selector's events have their own
  delivery chain. Through 2.15 they went to every dashboard socket.
- A new emitter about a phone must name the phone, and one about a
  selector the selector. The plain `emitToDashboard` is private, unscoped
  and only for `NODE_*`, which carry a node's address and nothing else.
- With no team-scoped socket connected (an auth-disabled server, or admins
  only) and nothing pending for the phone, it is the old synchronous room
  broadcast, with no lookup. The two call sites that look a phone up only
  to scope its event, `removeDevice`'s team read and the recording marks'
  `findVideo`, check `SocketServer.hasScopedDashboard()` first, so an
  auth-disabled server makes no lookup at all.

**The event log** (`EventLogService`, the `EventLog` table) keeps a copy of
the dashboard events every emit sends, written fire-and-forget, for
`XENON_EVENT_LOG_RETENTION_DAYS` (30) and pruned daily. `XENON_EVENT_LOG=off`
turns it off. Nothing reads it yet. A copy there outlives the session and
build it came from: deleting either leaves it.

It keeps no session's own data (`EVENT_LOG_KEEPS`, `SocketServer.ts`).
That data's record goes with its session; a copy here would outlive it.

- **`interceptor_request` gets no row.** A captured request carries the
  app's headers (sign-in tokens, cookies) and, with `captureBodies`, its
  bodies. Its record is the session's capture (buffer, archive, HAR). Not a
  summary either: `path` keeps the query string, which can hold a token, and
  the rest isn't worth a row per request. The capture's start and stop are
  still logged.
- **`session_command` is a summary, live and in the log**
  (`sessionCommandSummary`, `src/dashboard/sessionCommandSummary.ts`): the
  session, the command, how it went, how it healed (strategies, selectors,
  tier), its duration and trace ids. Not its `body`, the command's arguments
  (the text `setValue` typed), nor its `response`, the command's answer (a
  page source, a screenshot's base64). Those stay in the session's
  `SessionLog`. The live event reaches every dashboard that can see the
  phone, and no client reads more: neither the dashboard nor Xenon Studio
  subscribes to it. The fields are listed one by one, so a field added to the
  command's record goes nowhere until it is listed.
- **Through 2.14 both were written whole**, kept 30 days, and
  `session_command` was sent whole live.
- **A new event carrying what an app sent, a tester typed or a screen
  showed** gets an entry in `EVENT_LOG_KEEPS`.

### Frontend (`web/`)

React 17 + Vite + Tailwind CSS dashboard. Talks to the backend over REST and Socket.io. Built artifacts are copied into `src/public/` and served as static files by the plugin server.

Settings is one area (`components/settings/SettingsLayout.tsx`): every admin
page is a section under `/settings` (`settings-sections.ts`: General is
`/settings`, then `ai`, `maintenance`, `notifications`, `teams`, `users`,
`api-keys`), and the sidebar has one Settings entry, for admins. Each section
keeps its own `PageHeader`; the layout gives every header inside it the
"Settings" eyebrow and the section links (`ui/LinkTabs`, links with
`aria-current`, not ARIA tabs) through `PageHeaderNav`. The old paths
(`/ai-settings`, `/teams`, ...) redirect with their query and hash. A new admin
page is a section here, not a sidebar item. Notifications moved here from the
sidebar's member list: webhooks are admin-only on the server.

Dialogs: use `ui/Modal` (Radix) for ordinary dialogs. A full-screen view that is
also a route, like device control, uses `ui/InPlaceDialog` instead. Radix's modal
mode hides and blocks everything outside the dialog, which would silence the toast
live region and make toasts unclickable. `InPlaceDialog` marks the background
`inert` (except live regions), moves focus in, closes on Escape except while
typing in a field, and returns focus on close.

#### Design tokens (`web/src/tokens.css`)

Colours live in three layers: **primitives** named by hue (`--green`, `--red-400`,
`--neon-green`), **channels** for alpha tints (`--rgb-green: 34 197 94`, used as
`rgb(var(--rgb-green) / 0.1)`), and **roles** that say what a colour means
(`--color-accent`, `--color-on-accent`, `--color-success`, `--color-warning`,
`--color-danger`, `--color-info`, `--color-highlight`, `--color-focus-ring`).
New UI should use roles.

**Themes.** `<html data-theme>` is `dark` (default) or `light`, chosen in the
account menu (Dark / Light / System) and stored in `localStorage['xenon.theme']`.
An inline script in `web/index.html` applies it before first paint;
`web/src/lib/theme.ts` owns the preference and follows the OS while it is
`system`. The light values live in one `:root[data-theme='light']` block in
`tokens.css`. To keep dark byte-for-byte stable, theme-dependent colours are
written so they compute to the old dark value:

- Neutral washes use `rgb(var(--rgb-fg) / A)` (white in dark, near-black in
  light), never `--rgb-white`.
- Dark wells use `rgb(var(--rgb-well) / calc(A * var(--well-k)))`, and heavy
  drop shadows use `rgb(var(--rgb-black) / calc(A * var(--shadow-k)))`. Both
  `k` values are 1 in dark and scaled down in light.
- A component literal that only works on dark gets a scoped
  `:root[data-theme='light'] .x { … }` override beside it. Don't edit the
  dark rule. In TSX, use the `light:` Tailwind variant defined in
  `web/tailwind.config.js` (e.g. `light:disabled:bg-transparent`).
- Text on a filled accent or success colour uses `--color-on-accent` /
  `--color-on-success` (black in dark, white in light). Never use `--black` or
  `text-black`.
- **Dark islands:** `class="theme-dark"` re-declares the whole dark palette
  on a subtree, because it shares the two `:root` blocks. The terminal, the
  logcat rows (their tag palette only works on dark) and Omni's generated
  code use it. An island with a translucent or absent background needs an
  opaque one in light.

Verify a theme change on both sides. Dark should be pixel-identical at
Playwright `threshold: 0`: the default 0.2 hides small colour shifts. Light
should pass a contrast probe on every route, plus device control, which needs
a route-mocked device.

**Light mode has to read clearly, not only pass AA.** Through 2.19 every light
text colour passed, yet the theme looked washed out: a card's border was
1.25:1 on white, the page 1.07:1 from the cards, and most text was 12px, which
reads thinner dark on white than light on dark. `design/light-theme.test.ts`
holds the floors: text tokens 4.5:1 on `--surface`, `--bg` and `--surface-2`
(secondary text 9:1 and 7:1 on white), `--border` 1.35:1 on white,
`--border-strong` 1.8:1, the page 1.12:1 from the cards, each status colour
4.5:1 on its own 10% tint, caption and mono at least 13px. Light mode also
leaves font smoothing to the platform (`index.css`): grayscale smoothing,
right for light text on dark, thins dark text.

Don't add raw hex or `rgba()` literals. `web/src/design/color-literals.test.ts`
is a ratchet against `color-literals.baseline.json`: a file may lose literals
(lower its number there) but never gain one. Canvas code, persisted annotation
colours and the logcat tag palette are exempt, with reasons in
`color-literals.ts`. The `--accent` variable never existed; its old fallbacks
(blue for Selector Health and the mosaic, border for device cards) are now
`--color-highlight`, `--color-info` and `--border-strong`.

**Wording is for testers.** Say what a thing does, in plain words and
sentence case: no marketing ("global registry", "orchestration", "fleet",
"infrastructure"), no internal names ("etalon", WDA on a settings card), no
ALL-CAPS sentences, and no claim the product doesn't keep (the health-check
schedule card used to promise "WDA restarts, cache purges"; cleanup promised
"zero interference"). `web/src/design/wording.test.ts` checks JSX text and
string literals in `.tsx` for those words and for shouting; its baseline is
empty. Server variable names on the AI engine page and `xe:options` names on
the API keys page stay: admins need the exact names.

**Green means act here** (the rule beside `--color-accent` in `tokens.css`).
The accent is for what you can act on, what is selected, what has focus and
where you are: buttons, links, toggles, the current tab and sidebar item.
Decoration (page-title and card-header icons, empty-state art) is
`--text-muted`; data (versions, ids, inline code, numbers) is `--text`; a
status takes its status colour (good is teal, never the accent). Tags are
`Pill` tones; there is no accent pill. Charts use `--chart-1` …
`--chart-6` in that order, defined per theme;
`web/src/design/chart-palette.test.ts` holds each to 3:1 on `--surface`
and every pair to ΔE >= 13 under normal vision, protanopia, deuteranopia
and tritanopia, so a new colour there has to pass it. A machine can't tell
a button from an icon, so `accent-uses.test.ts` counts every accent use
outside `components/ui/` and lets a file lose them, never gain them
(`UPDATE_ACCENT_BASELINE=1` rewrites the baseline): a new control takes its
green from the shared Button, SegmentedControl, Input or Select. What is
left is controls, selection, focus, the terminal island's prompt and the
sign-in page's brand panel. A repeated per-row action (Apps' Deploy) rests
neutral and turns green on hover. The hard-coded colour baseline
(`color-literals.baseline.json`) is empty: no file has a raw colour left.

**Surfaces come from levels** (`tokens.css`). Depth is `--elevation-flat`
(cards, panels, tables), `-raised`, `-overlay` (menus, popovers) and
`-modal` (dialogs, toasts, the command palette); light redefines all four.
Corners are `--radius-sm` 4, `-md` 6 (controls, menus), `-lg` 8 (cards),
`-xl` 12 (modals) and `-full`. Keyboard focus is `--focus-outline` with
`--focus-outline-offset`, given to every button, link, tab and menu item
by a zero-specificity `:focus-visible` rule in `index.css`; a focused field
keeps its accent border and gets `--ring-field`; selected is
`--ring-selected`. In TSX: `shadow-flat` … `shadow-modal`, and Tailwind's
`rounded`, `-md`, `-lg`, `-xl` and `-full` read the radii. `--shadow-sm/md/lg`
are the old names, now aliases of raised, overlay and modal, and the Mac
launcher's Tailwind reads them. Blur belongs only behind a modal.
`web/src/design/surface-literals.test.ts` is a ratchet over raw
`box-shadow`, `border-radius`, `backdrop-filter: blur()` and their Tailwind
and inline forms (`UPDATE_SURFACE_BASELINE=1` rewrites the baseline). Its
16 left are not depth: three scrims (the modal's backdrop, the upload
overlay, a screen that is off), device control's phone frame (bezel radii
and its ring), accent stripes that mark a row or tab (`inset 2px 0 0`),
two solid selection outlines and the webhook toggles' red and amber
rings. A focused field in error gets `--ring-field-danger`.

**Type sizes come from roles** (`tokens.css`, `--type-<role>-size` /
`-line`): display 32, title 24, heading 16, body 14, label 13 (controls),
caption 13, mono 13 (caption shares label's size and differs by colour and
weight; at 12px most of a page read faint, light mode worst). Nothing on
screen is under 13px but the glyphs below. Weights are
`--weight-regular` / `-medium` / `-semibold`. In TSX use `text-display` …
`text-caption` and `text-mono-data`; Tailwind's `text-xs`, `text-sm` and
`text-base` are pointed at caption, body and heading, so they are the same
pixels. Choose a role by what the text is, not by the number it had. The
`--font-size-*` names are the Mac launcher's (`SCALE_VARS`) and stay as
they are. `web/src/design/font-size-literals.test.ts` is a ratchet like the
colour one, over `font-size: 11px`, `text-[11px]` and inline `fontSize`
(px and rem; an `em` size such as inline code's 0.9em follows its text and
isn't counted). After moving sizes rewrite its baseline with
`UPDATE_FONT_SIZE_BASELINE=1 npx vitest run
src/design/font-size-literals.test.ts`. Every page uses roles now; the
baseline holds only four icon glyphs drawn with a character (×, ▸, a
provider's letter). Text weights stop at semibold (`--weight-semibold`, or
`font-semibold`): no 700, 800 or `font-bold`. Headings are Inter, like
everything else; `'Outfit'` was never loaded and is gone.

**Changing a value in `web/src/tokens.css` also changes the Mac launcher.**
`mac-app/src/renderer/src/tokens.css` is generated from the dark
`.theme-dark, :root` blocks and the light block (surfaces, borders, text, roles and the type
scale, with `-rgb` triples; a new token there lands in the launcher too; `--accent-subtle` /
`--accent-border` are copied verbatim, so keep them literal there) by
`mac-app/scripts/sync-tokens.mjs`, and the
Schema Drift Check workflow fails on any difference. After editing a token
value run `node mac-app/scripts/sync-tokens.mjs` and commit the generated
file in the same PR. #268 missed this and turned main's drift check red.

#### Breakpoints

Supported range is **1280–1440** (laptop + tablet landscape). No phone or
tablet-portrait support: no hamburger, no drawer. The sidebar
(`src/lib/sidebar.ts`) is the 56px icon rail below 1440, and from 1440 shows
labels and group names (Lab, Testing, Admin) at 208px unless the user
collapsed it (remembered in `localStorage['xenon.sidebar']`). That rule is
why: at 1440 an expanded sidebar leaves a page 1232px, more than the rail
leaves it at 1280 (1224), so no page has less room than it did. Below 1440
there is no toggle. Its width is `--sidebar-width` (`<html data-sidebar>`,
set before first paint by the inline script in `index.html`); the header and
`main` read it, and code that sizes against the window calls `sidebarWidth()`
and listens for `xenon:sidebar` (device control's canvas does). Never
hard-code 56.

**Use Tailwind mobile-first `min-width` only** for new work. A few legacy
`max-width` queries remain in component CSS (all firing below 1024px, i.e.
outside the supported range) — don't add more, and prefer `min-width` when you
touch one. Mixing directions is how bugs hide: the codebase has had
`max-width: 1024px` (`device-explorer.css`, `selector-health.css`) alongside
`min-width: 1024px` (`settings.css`), the same number meaning opposite things.

Before choosing a breakpoint, **compute the layout's intrinsic minimum** (sum of
fixed columns + gaps + padding + the sidebar: 56px below 1440, 208px from
1440) and make sure the breakpoint sits *above* it. A viewport query no longer
says how wide a page is: at 1440 the page is 1232px, narrower than at 1400
(1344). The overflow suite runs 1439 and 1440 for that reason. Selector Health shipped a `max-width: 1024px` override 121px below
its own 1146px floor, leaving a dead zone at 1025–1145px that was invisible from
either end.

`web/test/viewport/overflow.spec.ts` (Playwright) guards this. It tests both
sides of every breakpoint boundary. It renders a **route-mocked** Android device
(`page.route('**/xenon/api/device*', …)`) rather than seeding the DB — the device
manager reaps `Device` rows for unattached hardware (`removeStaleDevices`), so a
seeded row is deleted before the page loads. Run it with `npm run test:viewport`
against a running server (auth disabled).

Coverage boundary — all 21 routes in the matrix are now **hermetic**. The 15
data-heavy routes (overview, devices, devices?view=table, recordings,
recordings/:groupId, builds, builds/:buildId, a failed and healed session's
page, apps, selector-health, selector-health with its panel open, settings/teams,
settings/users, settings/api-keys, settings/notifications)
route-mock their data endpoints via `ROUTE_DATA_MOCKS` with deliberately
wide/hostile payloads — multiple rows plus a >100-char session subtitle, an
>80-char selector XPath, a long bundle id, and long team/user names/emails — and
a paired `ROUTE_CONTENT_CHECKS` assertion proves the route's real rows/grid
actually mounted (e.g. `section[aria-label="Selectors"] tbody tr` or `table tbody tr` `not.toHaveCount(0)`)
rather than an `<EmptyState>` placeholder, before the overflow scan runs — a
table with zero rows has nothing to overflow, so without this a broken mock
would pass vacuously. The device-control route keeps its own dedicated device
mock + 11-button toolbar test, and the Logs tab route feeds a mocked log
stream. The shared device mock also lists a pair of same-named phones
(`emulator-5554` on two hosts, `SAME_NAMED_PHONES`), and the Devices mock
shows them; the chooser route (`/devices/emulator-5554/control`, no host)
checks that its two phone links mounted and no phone opened. The control
sweep's mocked list carries the same pair and sweeps that route too. The 3
static-form routes (settings, settings/maintenance, settings/ai) render a
fixed layout with no list data to gate on, so the app-**shell** check
(`aside:has(nav)` with buttons) that every route runs is already non-vacuous
for them, and they have no entry in either map.

One dependency still passes through to the live server unmocked: `AuthProvider`
(mounted app-wide, so every route pays this on mount) calls `GET
/xenon/api/auth/me`. It isn't hermetic in the literal sense, but it's stable —
with auth disabled the server always returns the same synthetic
`SUPER_ADMIN`/`auth-disabled` identity regardless of DB state — and no route
gates its row rendering on `me`, so it doesn't threaten the vacuous-pass
guarantee above.

Note `index.css` sets `body { overflow: hidden }`, so `document.scrollWidth`
always equals `innerWidth`. It cannot detect overflow. Measure element rects.
A centered flex row (`justify-content: center`) overflows both edges, so the
guard checks `rect.left < 0` as well as `rect.right > innerWidth`. It
measures the part of an element on screen: what a clipping ancestor below
`<body>` cuts off (the rest of a `truncate` line behind its ellipsis) doesn't
count, while the ancestor is measured itself.

`web/test/sweep/controls.spec.ts` (`npm run test:sweep`, about 20 minutes) is
the control sweep. On every page it clicks each visible control with a real
mouse click on a fresh load, plus every control inside the menus and dialogs
they open, and fails if one does nothing or can't be clicked. It caught the
dead "Upload app" button (#274) and the account menu hidden behind the Devices
and Apps toolbars (#279). It runs against the live server but changes nothing:
writes and every `/control` request are answered in the browser, streams are
aborted, and device control uses a mocked device.

- A control counts as working if it causes a request, navigation, a DOM change
  to something the page wasn't already changing, a checked-state change, form
  validation, a dialog, file chooser, download, clipboard write or popup, or
  moves focus elsewhere.
- It explains the legitimate no-ops itself: an already selected tab or filter
  (it must expose `aria-selected`/`aria-pressed`/`aria-current`), a control
  under a full-screen overlay, a switch whose slider covers its input, and a
  label whose field already has focus. It skips `inert` content (the
  background of a modal dialog). Anything else needs an entry, with a reason,
  in `EXPECTED_NO_EFFECT`.
- Sign-in pages are swept as a signed-out visitor (`/auth/me` answers 401),
  since on an auth-disabled server `/login` redirects to the dashboard. Every
  route must still be at the requested path after loading, so a redirect can't
  quietly sweep a different page under another's name.
- A self-test injects a dead and a live button and checks that the dead one
  fails. Run the sweep before a release, not on every change.

CSS source lives in `web/src`, but the running server serves the built bundle
from `lib/public`. A CSS change is not live until `npm run build:xenon &&
npm run build:copy` (from the repo root) regenerates and copies it.
`build:copy` also copies the go-ios binary, which only the build fetches, so
in a fresh checkout or worktree it fails until a first `npm run build` (or
`node scripts/fetch-go-ios.js` after `tsc -b`) has put it in
`src/device-managers/ios/vendor/go-ios/`.

### Key Design Patterns

- **Dependency Injection** — TypeDI `@Service()` decorators; use `Container.get(...)` to retrieve singletons
- **Command Interception** — all Appium commands flow through `CommandInterceptor` before reaching the driver
- **Schema-driven config** — `schema.json` is the canonical source for all plugin CLI arguments; `npm run build:schema` regenerates the TypeScript `IPluginArgs` interface from it
- **Structured logging** — scoped loggers (`log.scope('Module')`) with automatic secret redaction

## Key Files

| File | Purpose |
|------|---------|
| `src/plugin.ts` | `XenonPlugin` class — Appium plugin lifecycle hooks |
| `src/index.ts` | Process signal handling and cleanup orchestrator |
| `src/interceptors/CommandInterceptor.ts` | Single chokepoint for all Appium commands; see "Command Interception Flow" above |
| `schema.json` | All plugin CLI arguments (JSON Schema Draft 7) |
| `prisma/schema.prisma` | Database schema; edit here then run `db:generate` |
| `src/services/healing/HealingOrchestrator.ts` | 6-tier healing entry point |
| `src/services/healing/resilioPath.ts` | Resilio's view of a page source (an XML parse): an element's path, the element a learnt find was, and the nearest element to a stored path, answered only at score >= 0.8 with a 0.05 lead |
| `src/gateway/healReport.ts` | A node's heal of a hub's command, on its answer as `x-xenon-heal`; the hub takes it off and records it |
| `src/services/ocr/ocrData.ts` | `createOcrWorker()`: every OCR worker, from the English data vendored beside it, checked by SHA-256, cached nowhere |
| `src/services/settings/aiEngineSettings.ts` | The AI engine page's provider, models and base URL: saved over the startup options, checked, written into `config` at boot and on each save |
| `src/services/autowait/AutowaitService.ts` | Per-session implicit-wait config; runs before healing |
| `src/dashboard/event-manager.ts` | WebSocket broadcast hub |
| `src/device-managers/AndroidDeviceManager.ts` | ADB device discovery & control |
| `src/device-managers/IOSDeviceManager.ts` | simctl + ios-device control |
| `src/device-managers/ios/IOSStreamService.ts` | go-ios + WDA + iproxy lifecycle for live MJPEG |
| `src/device-managers/ios/goIosBinary.ts` | Where go-ios is (shipped beside it), the legacy cache path the start also reaps, and whether it can run here |
| `src/device-managers/ios/IOSTunnels.ts` | One go-ios tunnel per iOS 17+ phone, on a port pair leased from the `tunnel` range; `envFor` gives a go-ios command its phone's `GO_IOS_AGENT_PORT` |
| `src/services/metrics/SessionMetricsService.ts` | A CPU and memory sampler per session on this server's phones, buffered and written every 10 s to `SessionMetric`; Android via `/proc`, iPhone via go-ios `sysmontap` |
| `src/services/metrics/NodeMetricsStore.ts` | On a node: each sampled session's figures in memory for the hub to collect; dropped once collected, kept 10 minutes after the session ends |
| `src/services/metrics/NodeMetricsCollector.ts` | On a hub: a session on a node's phone sampled by asking the node every 10 s; never two asks at once, a last ask at the end |
| `src/services/webhookEvents.ts` | What each webhook event carries (`WEBHOOK_EVENTS`), `sessionFailedPayload`, and `renderTemplate`; the Slack text, the generic body, a template and Send test all read it |
| `src/services/network/PhoneNetworkRestore.ts` | Puts a session's phone network back (Offline profile, interceptor proxy) on every session ending, once, before the phone is released; at boot and before a phone's next session, what a crash left (from `PhoneNetworkLedger`) and dead capture proxies |
| `src/services/network/PhoneNetworkLedger.ts` | What Xenon changed on a phone's network, written before the change and kept until it is put back; `WebConfig` rows in this server's own database |
| `src/services/selector-health/selectorList.ts` | The Selector Health list: "To fix" by `groupBy` over the period's heals, the other tabs from `SelectorState`, search, sort, paging and the four counts |
| `src/services/selector-health/access.ts` | Who may see a selector (a visible session healed it) and who may act (`sessions` scope); `SELECTOR_NOT_FOUND` |
| `web/src/components/selector-health/selector-panel.tsx` | The side panel: status and actions, suggested fixes with Copy as, numbers, where it heals, recent heals, activity |
| `src/helpers/UniversalMjpegProxy.ts` | One-upstream-to-many-clients MJPEG fan-out with backpressure |
| `src/device-managers/android/ScrcpyServerSession.ts` | scrcpy-server lifecycle (push jar + `app_process` + `adb forward` + first-byte-gated connect) for the Android H.264 source |
| `src/app/routers/androidH264Config.ts` | Normalizes the `streaming.androidH264` flag union (`bool \| { source }`) to `{ enabled, source }` |
| `src/services/logcat/logcatParse.ts` | Pure `parseThreadtimeLine`; returns null for continuation lines, banners and malformed input. Infers the year logcat omits, in host-local time |
| `src/services/logcat/PackageResolver.ts` | PID → process name via `ps -A -o PID,NAME`. Negative cache, split `attemptedAt`/`loadedAt` clocks, never throws or blocks a log line |
| `src/device-managers/android/LogcatMultiplexer.ts` | One upstream → many clients, 2000-record replay, **per-client** drop accounting with a visible synthetic marker |
| `src/device-managers/android/LogcatStreamService.ts` | One `adb logcat -v threadtime -T 2000` child per device; idle watchdog, `killAllSync()` for the exit hook |
| `src/services/logcat/SessionDeviceLogs.ts` | A session's Device logs, from its start to its stop: an Android phone's log stream (reopened if it ends) or an iPhone's or simulator's driver log; lines written in batches, held for the hub on a node, collected from the node on a hub |
| `src/services/logcat/iosDriverLog.ts` | An iPhone's or simulator's lines from the XCUITest driver's own `logs.syslog`: levels from the text, the create's lines read without emptying the driver's buffer |
| `src/services/logcat/NodeDeviceLogStore.ts` | On a node: each hub session's device log rows in memory, numbered, for the hub to collect; dropped once collected, kept 10 minutes after the session ends, forgotten if no hub asks within 2 minutes |
| `src/services/logcat/NodeDeviceLogsCollector.ts` | On a hub: a node session's device log lines, asked of the node at once, then every 10 s, page by page while it has more, and once more at the end |
| `src/gateway/nodeAsk.ts` | What a hub makes of a node's answer at a session route (`readNodeReply`: an older node, a refusal, an outage) and which nodes are older (`OlderNodes`); shared by metrics and device logs |
| `src/services/logcat/deviceLogBook.ts` | Pure: which lines a session keeps (its window, by the phone's clock; each once after a reopen; the 10,000 + 2,000 limit) and their threadtime text |
| `src/app/ws/logcatWs.ts` | Ticket + `evaluateDeviceAccess` at connect time; 1008 denies, 1012 on upstream death |
| `src/app/ws/upgradeRouter.ts` | One handler per WebSocket upgrade: Xenon's routes (H.264, logcat, adopted socket.io) first, everything else to Appium's listener, or Xenon's copy of it on Node < 22.21 |
| `src/services/device-access/ticketActorAccess.ts` | `makeTicketActorAuthorizer` — the WS's ownership decision, extracted so it is tested directly rather than through a copy in a spec |
| `web/src/components/device-control/logcat/logcatFilter.ts` | Pure filter grammar (`level:` minimum, `tag:`, `package:`, `-tag:` / `-package:` to hide, text, ANDed) plus `setLevelTerm`, `withTerm` and `withExclusion`, so the level bar, the details panel's buttons and the text box share one query |
| `web/src/components/device-control/logcat/LogList.tsx` | The Logs tab's list: only the rows on screen exist (`@tanstack/react-virtual`); follows the newest line, pauses on a scroll up or a click, keeps the reading place by `seq` while old lines are dropped |
| `web/src/components/device-control/logcat/useLogcatStream.ts` | Mints a ticket per connect, batches frames (React 17 does not auto-batch outside events), resets the buffer on reconnect **except** after 1012 |
| `src/gateway/sessionGateway.ts` | The session layer in front of Appium's routes: internal calls skip auth, per-command auth (or the hub token on a node), then a hub forwards remote sessions; remote DELETE runs the lifecycle |
| `src/gateway/internalCall.ts` | `/wd-internal` + the per-process secret header; one `next()` call site so a refused call answers exactly like an unknown route; `isInsideInternalCall` tells the plugin a command is Xenon's own, never the test's |
| `src/gateway/hubSessionToken.ts` | Hub-signed `x-xenon-hub-token` JWTs, verified by the node against the hub's JWKS: `xenon-node` per session for commands, `xenon-node-create` per create (owner, phone, node), `xenon-node-control` per forwarded `/control` call (user, admin, phone, node) |
| `src/app/ws/nodeSocketRelay.ts` | The H.264 and logcat sockets for another server's phone: a node ticket, the node's socket opened paused, relayed both ways with its close codes and end-to-end backpressure |
| `src/app/routers/nodePhoneControl.ts` | The gate in front of `/control`'s handlers for another server's phone: forward (`NODE_FORWARDED_CONTROL`), answer here (`ANSWERED_HERE`) or refuse with 501; a new action is refused until listed |
| `src/gateway/sessionLocator.ts` | Where a session runs: `SESSION_MANAGER`, then the open Session row and its phone's row; never its own routing table |
| `src/gateway/nodeSessionStatus.ts` | A node's `GET /xenon/api/node/sessions/:id` (hub token, no command, answered from the umbrella) and the hub's memory of which nodes lack it |
| `src/sessions/appiumUmbrella.ts` | Appium's umbrella as `createSession` last saw it; `hasSession` reads `sessionExists` without running a command |
| `src/gateway/nodeWebDriverUrl.ts` | A node's own base path from its public `GET /xenon/api/webdriver`, cached; the hub's is the fallback |
| `src/services/recording/RecordingOrchestrator.ts` | Per-device + composite recording lifecycle |
| `src/services/recording/manualLock.ts` | `manual_<actorId>_<udid>` lock format helpers |
| `src/middleware/authMiddleware.ts` | Populates `req.auth` (and `req.apiKey` on API-key paths) from the header pair or session cookie; `scopesForRole` maps a cookie role to its scopes |
| `src/middleware/deviceAccessGuard.ts` | Ownership guard on `/control` — method-scoped, with the mutation allowlist and `OWNERSHIP_CHECKED_READS` |
| `src/middleware/deviceTeamGuard.ts` | Team guard on `/control` — every request; a hidden phone is handed on as `HIDDEN_DEVICE_UDID` so it answers exactly like an unknown udid |
| `src/middleware/controlDevice.ts` | The one udid parser and per-request memoized device lookup both `/control` guards share; defines `HIDDEN_DEVICE_UDID` |
| `src/services/identity/identityChanges.ts` | `identityChanged(userId)`: the writers of a user's role, status, sign-ins, keys and teams call it, awaited; the socket server checks that user's sockets again (`SocketServer.recheckUser`) |
| `src/services/device-access/DeviceTeamResolver.ts` | Phone (udid and host) → team for the live events; a host-less udid of two rows is unknown (admins only); 5 s TTL cache, 2 s lookup timeout; `canSeeDeviceTeam` fails closed on an unknown phone |
| `src/services/selector-health/SelectorVisibilityResolver.ts` | Whether a member may see a selector, for the `selector_*` live events: Selector Health's REST rule, cached 5 s per viewer and selector, 2 s lookup timeout, a failure answers no |
| `src/services/device-access/deviceVisibility.ts` | Pure `isDeviceVisible(deviceTeamId, teamIds)` — the team rule; `teamIds === undefined` is the only admin |
| `src/services/device-access/appVisibility.ts` | `canSeeApp` / `visibleAppWhere` — uploaded apps follow the device team rule on `App.teamId` |
| `src/services/token/AppDownloadTicketService.ts` | Single-use, app-bound, 10-minute `?ticket=` for the driver's credential-less app download; audience `xenon-app-download` |
| `src/services/device-access/deviceAccessPolicy.ts` | Pure access decision + deny bodies + the shared `isSelfManualLock` / `isOwnSession` primitives |
| `src/services/device-access/SessionOwnerResolver.ts` | Session owner: prefers `Session.user_id`, falls back to `api_key_id → ApiKey.userId`. Caches **positive results only** — a null may mean the row isn't written yet, and caching it would deny the owner for the life of the process |
| `src/services/device-access/LiveSessionOwners.ts` | Owners of the sessions this server drives, while they run; read by `SessionOwnerResolver` before the database, so a node knows who owns the hub's sessions |
| `src/services/session/sessionIdentity.ts` | Pure `resolveSessionIdentity` — derives `{ apiKeyId, userId }` from the presented credential; ignores an unverifiable token rather than rejecting it |
| `src/services/session/xenonOptions.ts` | The one precedence rule for Xenon's options: `xe:options` over the `xenon:options` alias, field by field. Every reader of either namespace goes through `xenonOptionsOf` / `xenonOptionsIn` |
| `src/services/session/sessionCredentials.ts` | `takeSessionCredentials` reads the four secrets and strips them from every bucket in place, first thing in `prepareSession`; nothing puts them back |
| `src/services/session/nodeCreateCaps.ts` | `capsForNode`: the copy of a create a hub sends a node. No credentials, no lease id, the allocated phone pinned in `alwaysMatch` |
| `src/gateway/sessionCreate.ts` | `POST <basePath>/session` in the gateway: allocates, creates another server's phone's session and answers it, hands a local phone to the plugin; on a node, checks the hub's create token |
| `src/gateway/createHandoff.ts` | The allocation on its way from the gateway to `XenonPlugin.createSession`, through `AsyncLocalStorage`; taken once, or given back when the request ends |
| `src/services/device-access/actor.ts` | `resolveActor(req)` — the one place an identity is derived from a request |
| `src/app/routers/streamStartConflict.ts` | `stream/start`'s own conflict decision (proceed / reclaim orphan / deny) |
| `web/src/App.tsx` | Frontend root component and routing |
| `web/src/components/mosaic/DeviceMosaicView.tsx` | Live Devices / mosaic page entry point |

## Tech Stack

- **Runtime**: Node.js `^20.19.0 || ^22.12.0 || >=24.0.0`, Appium 3's range (`engines` in package.json; `package-engines.spec.ts` keeps it equal to the installed Appium's), TypeScript 5.5 (ES2016 target, decorators enabled)
- **Plugin base**: Appium 3.1.1 `BasePlugin`
- **Database**: SQLite + Prisma 5.4 ORM
- **DI**: TypeDI 0.10
- **Testing**: Mocha + Chai + Sinon (60s default timeout), NYC for coverage
- **Frontend**: React 17, Vite 5, Tailwind CSS, Socket.io-client
- **AI integrations**: `@anthropic-ai/sdk`, `@google/generative-ai`, `openai`
- **OCR**: Tesseract.js 7
- **Tracing**: OpenTelemetry 1.9
- **Passwords**: `bcryptjs` (pure JavaScript; see below)

**No runtime dependency may need its install script.** npm 12 runs a
dependency's install scripts only when the installing project allows them
(`allowScripts`), and skips the rest with a warning. Appium installs a plugin
into its own home, whose package.json allows nothing, and `appium plugin
install` still reports success.

- Through 2.17 passwords were hashed with the native `bcrypt`, whose binary
  only its install script downloads. Installed with npm 12, the plugin failed
  to load: "Cannot find module .../bcrypt/lib/binding/napi-v3/bcrypt_lib.node".
- `bcryptjs` reads and writes the same `$2b$` hashes, so stored passwords
  still work. At cost 12 it took 310 ms where `bcrypt` took 240, and it runs
  on the main thread in slices of up to 100 ms, where `bcrypt` ran off it.
- `install-scripts.spec.ts` walks the runtime tree and lists every package
  with an install script (or a `binding.gyp`), each with why it works without
  it, checked under npm 12. A new one needs that check, or a replacement.
- Xenon's own `postinstall` (`prisma generate`) is skipped there too. The
  package ships its generated client, and Prisma's CLI fetches the schema
  engine on its first use at startup, so a first start needs to reach
  Prisma's download host.

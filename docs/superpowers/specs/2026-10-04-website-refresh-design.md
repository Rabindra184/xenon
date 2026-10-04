# The documentation site, refreshed for 2.13

Date: 2026-10-04
Status: design agreed in conversation, section by section (scope "full
refresh"; release notes from `CHANGELOG.md`, blog removed; the API reference
published on the site; approach 1, generate what the repo owns and hand-write
the rest; landing page direction A, "product console"; docs structure as below,
without a cloud page and with a Kotlin SDK page). Waiting for the user's review
of this document.

## Who it is for, and what done means

The site is `website/` (Docusaurus), served by Cloudflare Pages at
https://xenon-6e6.pages.dev. Two readers:

- **Teams evaluating Xenon** for a shared device lab. They land on the home
  page and need to see in a minute what it does, that it is real, and that it
  is safe to run for a team.
- **People running a lab and writing tests against it.** They need guides and
  references that match the version they run.

**Done means:**

- nothing on the site is false for 2.13.1: every flag, capability, route, env
  var, default and behaviour it names exists and works as described;
- everything shipped from 2.0 to 2.13 that a user can reach has a page;
- the configuration reference, the API reference and the release notes are
  built from their sources, so they can't fall behind again;
- the home page looks like the product (the dashboard's graphite palette),
  works at phone width and in both themes, and clears WCAG AA contrast;
- every surviving URL still lands: kept, or redirected;
- a pull request that breaks a link or leaves the API copy stale fails CI.

## What is wrong today

Read in the code and on the live site, 2026-10-04:

1. **False claims.**
   - The landing page's code sample uses `xe:priority`,
     `xe:network_profile` (as written) and `xe:max_thermal_status`.
     `xe:priority` and `max_thermal_status` exist nowhere in `src/`.
   - The site says the healing engine has 5 tiers; it has 6, Resilio first.
   - "Thermal throttling, battery analytics & USB bus integrity monitoring",
     "Audit Trail with session replay", "the most advanced mobile automation
     platform".
   - Omni Inspector "for Appium 2.x". AI providers listed with old default
     models (`gpt-4o`, `claude-3-5-sonnet`).
2. **A page for software that doesn't exist as described.** "Kotlin SDK" is a
   PRD/TRD from February. The SDK does exist
   (`io.github.qasecret:xenon` 2.1.0 on Maven Central, repo
   `github.com/qasecret/xenon`), but the page documents neither it nor how to
   use it.
3. **Missing everything from 2.0 to 2.13:** hubs and nodes through the session
   gateway, device control (live preview, H.264, Android logs, clipboard,
   apps), recordings and their library, CPU and memory, teams, leases, the
   complete OpenAPI reference, Xenon Control for Mac, upgrading, and 25 releases
   of release notes (the blog has one post, 2026-02-17).
4. **Two copies of four pages.** `docs/teams.md`, `docs/node-provisioning.md`,
   `docs/retention.md` and `docs/server-args.md` at the repo root have diverged
   from the site's versions (or have none on the site). The README links to the
   root copies. The root `server-args.md` says it is generated from
   `schema.json`; no generator exists.
5. **Template and migration leftovers.** The Docusaurus dinosaur social card
   and logo, three unDraw images, a "Markdown page example" route, an mkdocs
   `docs/overrides/` folder, `docs/assets/` (a 12 MB `demo.gif`, a DeviceFarm
   logo), a `website/README.md` that still describes yarn and SSH deploys, and
   an announcement bar presenting Network Interceptor as new.
6. **No search, and broken links only warn** (`onBrokenLinks: 'warn'`).
   CI never builds the site.

## Decisions

- **Release notes** come from `CHANGELOG.md`. The blog and its V2 post are
  removed.
- **The API reference is published on the site**, from the spec the server
  serves.
- **Approach 1:** generate what the repo already owns (configuration from
  `schema.json`, release notes from `CHANGELOG.md`, API from the OpenAPI spec),
  hand-write the guides against the 2.13 code, and keep one copy of each page.
- **Look:** direction A, "product console": dark graphite by default, the
  dashboard's palette, the product leading. The light/dark toggle stays.
- **No cloud page.** The `cloud` option still appears in the generated
  configuration reference, because it is a real setting.

## Docs structure

Files stay flat in `website/docs/` (no folders), so a page's URL is
`/docs/<id>`; the sidebar groups them. A page keeps its URL when it keeps its
subject and name; a renamed or merged page gets a new URL and the old one
redirects. Sources are where each page's facts are checked.

### Get started

| Page | URL | From | Checked against |
|---|---|---|---|
| Introduction | `/docs/` | rewrite of `index` | README, CLAUDE.md |
| Quick start | `/docs/quick-start` | rewrite of `setup` (redirect) | README quick start, a real install |
| Installation and requirements | `/docs/installation` | new | README requirements, `package.json` engines, bundled go-ios |
| Xenon Control for Mac | `/docs/xenon-control` | new | `mac-app/README.md`, GitHub Releases (0.1.3) |
| Upgrading | `/docs/upgrading` | new | README "Upgrading", `XENON_AUTO_MIGRATE`, 2.0.0's `xe:options` move |

### Run the lab

| Page | URL | From | Checked against |
|---|---|---|---|
| Devices and allocation | `/docs/devices` | new | device managers, `SessionLifecycleService`, queue, reservations, blocks, tags, health monitor |
| Hub and nodes | `/docs/hub-and-nodes` | rewrite of `remote-execution` + `docs/node-provisioning.md` (redirect) | `src/gateway/`, CLAUDE.md "Hub-Node Topology" |
| Teams | `/docs/teams` | moved from `docs/teams.md`, rewritten | `deviceVisibility.ts`, `computeTeamIds`, `appVisibility.ts` |
| Live device control | `/docs/device-control` | new | `control.ts`, stream services, logcat, `nodePhoneControl.ts` |
| Recordings | `/docs/recordings` | new | `src/services/recording/`, the recordings library |
| Production deployment | `/docs/deployment` | rewrite | `deployment/`, PostgreSQL, HTTPS, `XENON_ALLOWED_ORIGINS` |
| Data retention | `/docs/retention` | merge of both copies | `CleanupService`, `schema.json` cleanup options |
| Notifications and webhooks | `/docs/notifications` | rewrite | webhook routes and services |

### Write tests

| Page | URL | From | Checked against |
|---|---|---|---|
| Capabilities | `/docs/capabilities` | rewrite | `XenonCapabilityManager`, `xenonOptions.ts`, `sessionCredentials.ts` |
| Execute commands | `/docs/execute-commands` | new | the `execute` router in `CommandInterceptor` and its services |
| Leases for CI | `/docs/leases` | new | `LeaseService`, `/sdk/leases` routes |
| Kotlin SDK | `/docs/kotlin-sdk` | new (redirect from `Xenon-Kotlin-SDK-Specs`) | the SDK's README and code at 2.1.0, against plugin 2.13 |
| Autowait | `/docs/autowait` | check | `src/services/autowait/` |
| Network conditioning | `/docs/network-conditioning` | rewrite | `NetworkConditioningService` |
| Network interceptor | `/docs/network-interceptor` | check | `src/services/interceptor/` |

### Sessions and evidence

| Page | URL | From | Checked against |
|---|---|---|---|
| Sessions and builds | `/docs/sessions` | new | session and build routes, the session page, bug reports |
| CPU and memory | `/docs/cpu-and-memory` | new | `src/services/metrics/` |
| AI failure analysis | `/docs/failure-analysis` | split from `ai-features` | `failure-analysis-service.ts`, `AIService` |

### Self-healing

| Page | URL | From | Checked against |
|---|---|---|---|
| How healing works | `/docs/self-healing` | rewrite | `src/services/healing/` |
| Selector Health | `/docs/selector-health` | check | `src/services/selector-health/` |
| AI providers | `/docs/ai-providers` | split from `ai-features` (redirect) | `AIService`, `schema.json` AI options, env vars |
| Omni-Vision | `/docs/omni-vision` | rewrite | `OmniVisionService` |
| Inspector | `/docs/inspector` | rewrite of `omni-inspector` (redirect) | `web/src/components/omni-inspector/` |

### Security

| Page | URL | From | Checked against |
|---|---|---|---|
| Authentication | `/docs/authentication` | split from `enterprise-security` (redirect) | `authMiddleware`, `verifyCredential.ts`, tokens, tickets, `commandAuth.ts` |
| Roles and scopes | `/docs/roles-and-scopes` | split from `enterprise-security` | `scopesForRole`, route guards, the OpenAPI roles |
| Hardening checklist | `/docs/hardening` | new | README "Security and access", env vars |

### Reference

| Page | URL | From | Checked against |
|---|---|---|---|
| Configuration | `/docs/configuration` | generated (redirect from `server-args`) | `schema.json` |
| Environment variables | `/docs/environment-variables` | new, from the root `server-args.md` env table and the README | `process.env` reads in `src/` |
| API reference | `/api` | generated | `website/static/openapi.json` |
| Real-time events | `/docs/real-time-events` | check | `EventManager`, `SocketServer` |
| Observability | `/docs/observability` | new | OpenTelemetry setup, `examples/observability` |
| Architecture | `/docs/architecture` | rewrite | CLAUDE.md "Architecture" |
| Troubleshooting | `/docs/troubleshooting` | rewrite | known failure modes in the changelog |
| Release notes | `/docs/release-notes` | generated | `CHANGELOG.md` |

### Removed

| Page | Redirects to |
|---|---|
| `/docs/design-system` (the dashboard's internal design language) | `/docs/` |
| `/docs/cloud` and `docs/examples/cloud-configs/` | `/docs/` |
| `/markdown-page` | `/` |
| `/blog`, `/blog/xenon-v2`, `/blog/archive`, `/blog/tags`, `/blog/authors` | `/docs/release-notes` |
| `docs/overrides/`, `docs/assets/`, the unDraw and Docusaurus images, `logo.png`, `logo-*.png` | (files, no URL) |

The root `docs/teams.md`, `node-provisioning.md`, `retention.md` and
`server-args.md` are deleted. Their readers move to the site:
`README.md`, `docs/internal/operations.md`, `src/interfaces/IDevice.ts` and
`mac-app/src/renderer/src/schemaForm.ts` link to the site's pages instead.
`docs/internal/` and `docs/superpowers/` stay: they are for contributors.

## The home page

Direction A. Dark graphite by default, light in the light theme, using the
dashboard's palette (values copied into `src/css/custom.css` from
`web/src/tokens.css`, with a comment naming the source). Inter, self-hosted
through `@fontsource`, so the site makes no third-party font requests.

Top to bottom:

1. **Nav:** logo, Docs, API, Release notes, the version (from
   `../package.json`), the theme toggle, GitHub.
2. **Hero:** eyebrow "Appium 3 plugin · open source · self-hosted"; headline
   "Your whole mobile device lab, behind one Appium URL."; the lede; Get
   started and View on GitHub; the install command with a Copy button; the
   Devices screenshot, themed.
3. **Five jobs:** device lab, live control, test evidence, self-healing,
   built for teams, one line each.
4. **How it fits:** your tests (any Appium client, the Kotlin SDK, CI leases)
   → the hub (Appium 3 + Xenon) → nodes and devices; people in the browser.
   Drawn in HTML and CSS, not an image, so it themes and scales.
5. **Live control** and **Test evidence:** two rows, each with a screenshot
   and four points. Live preview on every phone with optional hardware H.264 on
   Android; Android logs; install apps, clipboard, screenshots; recording
   several phones with marks and a proof bundle. Video, screenshots, logs and
   commands; CPU and memory on both platforms; sessions grouped by build; network
   capture with mocks and HAR export (Android).
6. **Self-healing:** the six tiers, cheapest first, the AI tiers marked as
   running on your own provider or a local model; "can first wait out a slow
   screen" (autowait is optional); Selector Health's To fix → Being verified →
   Fixed, with fixes to copy in five languages.
7. **Built for teams:** roles and teams; scoped credentials (key and token
   pairs, short-lived bearer tokens, single-use tickets, a token never outranks
   its creator); owner-checked sessions (optional per-command auth); hub and
   nodes (one URL, survive a hub restart, a command is forwarded, never
   repeated); the complete API; self-hosted (SQLite or PostgreSQL,
   OpenTelemetry).
8. **Works with:** Appium 3, UiAutomator2, XCUITest, WebdriverIO, the Java and
   Python clients, the Kotlin SDK, Xenon Control for Mac, PostgreSQL,
   OpenTelemetry, Gemini · OpenAI · Anthropic · Ollama.
9. **Quick start:** the README's three steps.
10. **Call to action and footer:** ISC license; links by group; security
    policy.

Every sentence on the page must be true of 2.13.1 by the same rules as the
docs. Gone from today's page: the capabilities sample, the claims in "What is
wrong today" 1, the "Built With" internal stack, the announcement bar, the
stacked hero logo.

**Screenshots.** `scripts/dev/readme-screenshots.js` already serves the built
dashboard with mocked API answers and captures the Devices page in both themes.
It gains two more captures, both themes, written to
`website/static/img/screens/`:

- device control on an Android phone with the Logs tab open: the preview shows
  a static sample frame served for the stream, the logcat socket is answered
  with sample lines (`page.routeWebSocket`, Playwright 1.61);
- a session's page with its result, video and CPU and memory chart.

The landing page shows them with Docusaurus's `ThemedImage`. The README keeps
its own `assets/` copies.

**Responsive:** the public site works from 375 px up (unlike the dashboard):
16 px side gutters, no horizontal scroll, the hero and rows stack below
996 px (Docusaurus's own breakpoint).

## How the site is built

**Generated at build time** by `website/scripts/generate.mjs`, run by the
`prestart` and `prebuild` npm scripts, writing git-ignored files:

- `docs/configuration.md` from `../schema.json`: how to set an option (YAML
  key under `plugin.xenon`, `--plugin-xenon-<kebab>` flag), then one table per
  section with key, flag, type, default, allowed values and description.
  Sections follow the launcher's (`mac-app/src/renderer/src/schemaForm.ts`);
  an option it doesn't map goes in "Advanced", as in the launcher. Nested
  objects (`autowait`, `interceptor`, `streaming`) list their fields.
- `docs/release-notes.md` from `../CHANGELOG.md`: the intro, then each `##`
  release as a heading (so the table of contents is a version index), and
  `(#123)` turned into links to `github.com/Rabindra184/xenon/pull/123`.
- The site sets `markdown.format: 'detect'`, so `.md` files are read as
  CommonMark: the changelog's raw `<basePath>`, `<udid>` and `{}` need no
  escaping. A hand-written page that needs a component is `.mdx`.

**Committed, with a drift check:**

- `website/static/openapi.json`, written by a root script,
  `npm run build:openapi` (`scripts/export-openapi.js`, importing
  `swaggerSpec` from `src/app/swagger.ts` through ts-node). The spec needs the
  root's dependencies (`swagger-jsdoc`), which the site's build doesn't
  install.
- The Schema Drift Check job runs it and fails when the file differs, with a
  message naming the command.

**Rendering:**

- `/api` is `@scalar/docusaurus`, reading `/openapi.json`, following the site's
  theme, with its "try it" client and proxy off: a public page can't reach a
  lab's server and must not send credentials through a third party.
- Search: `@easyops-cn/docusaurus-search-local`, indexing docs and pages, no
  external service.
- Redirects: `@docusaurus/plugin-client-redirects`, the table above.
- `onBrokenLinks: 'throw'` and `onBrokenMarkdownLinks: 'throw'`.
- Docusaurus 3.9.2 → 3.10.x, every `@docusaurus/*` package on the same version.
- A 1200 × 630 social card made from the hero, replacing the Docusaurus one.
- `website/README.md` rewritten: how to run the site, what is generated from
  where, and how to refresh the screenshots and the API copy.

**CI:** a new workflow, `website.yml`, on pull requests and pushes to `main`
that touch `website/**`, `CHANGELOG.md`, `schema.json`, `src/app/openapi/**`,
`src/app/swagger.ts` or `package.json`: `npm ci` and `npm run build` in
`website/` (Node 22). Deploying stays with Cloudflare Pages.

## How the content is written and checked

- Written from the code, not from the old page. A claim that can't be
  confirmed is removed, not softened.
- Current behaviour only. History ("through 2.10 it did X") belongs in the
  release notes.
- The README's 2.13 tone: plain English for testers and lab admins, concrete
  commands, no superlatives. Tool names an operator installs (adb, go-ios,
  ffmpeg) are fine; internal class names only on Architecture and in "checked
  against" notes, never in a how-to.
- Code samples use real option, capability, route and header names, and
  `xe:options` (never `df:options`; `xenon:options` only where the alias is
  explained).
- **Kotlin SDK page:** installation from Maven Central, configuration,
  leasing a device, the driver wrapper, the JUnit 5, TestNG and Kotest
  integrations, from the SDK's README and code at 2.1.0. Each documented call is
  checked against plugin 2.13's routes and capabilities. What no longer works
  is left off the page and reported to the user (already seen: its autowait and
  interceptor DSL writes the flat keys `"xenon:options.autowait"` and
  `"xenon:options.interceptor"`, which the plugin doesn't read; it reads a
  nested `xenon:options` object).

## Verification

1. **Fact-check.** Reviewer agents each take a group of pages and check every
   claim against the sources in the tables above, returning mismatches with
   file and line. Fixed, then re-checked.
2. **Stale-term gate**, zero hits in `website/docs`, `website/src` and the
   generated configuration page: `df:options`, `x-xenon-api-key`,
   `xe:priority`, `max_thermal_status`, `5-tier`, `Florence`, `gRPC`,
   `Appium 2.x`, `estCostUsd`, `bootstrap-key`, `xenon-platform/xenon`.
   Release notes are exempt: they are history and name old things on purpose.
   The one allowed exception elsewhere is Upgrading, which names `df:options`
   to say it is no longer read.
3. **Build.** `npm run build` in `website/` with links failing the build; the
   new Website check green on the pull request; the drift check green.
4. **Look.** The home page and a sample of docs pages (a guide, Configuration,
   Release notes, `/api`), dark and light, at 1440, 1280 and 375 px: no
   horizontal overflow (element rects), text contrast measured to WCAG AA on
   the home page. Screenshots shared.
5. **Redirects.** Every old URL in the tables is opened and lands on its
   page.
6. **Generators.** Removing an option from a copy of `schema.json`, or adding a
   release to a copy of `CHANGELOG.md`, changes the generated page (unit check
   in `website/scripts/`).

## Delivery

- One branch, `docs/website-refresh`, one pull request, with a commit per
  part: plumbing and generators; landing page and screenshots; docs content;
  the root `docs/` move and link updates; CI.
- No version bump and no changelog entry: nothing in the npm package changes
  (the root gets a script and a CI job). Cloudflare deploys on merge.
- The Kotlin SDK mismatches go to the user as a list; a follow-up in the SDK
  repo is theirs to decide.

## Open items

- **Cloudflare Pages settings** (not visible from the repo): the build must
  run `npm run build` in `website/` with the whole repository checked out and
  Node 20 or later, output `website/build`. To be confirmed by the user before
  merge.
- The Kotlin SDK's compatibility list, produced during the work.

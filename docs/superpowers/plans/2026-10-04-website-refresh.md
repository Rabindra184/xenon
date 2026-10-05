# Documentation site refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `website/` (Docusaurus, xenon-6e6.pages.dev) in line with Xenon 2.13.1: a new home page, a restructured and fact-checked docs set, and generated configuration, API and release-notes references that can't fall behind.

**Architecture:** Docs files stay flat in `website/docs/` and the sidebar groups them. Three references are generated: configuration and release notes at site build time from `../schema.json` and `../CHANGELOG.md` (`website/scripts/generate.mjs`), the API from a committed `website/openapi.json` that a root script exports from `src/app/swagger.ts` and CI keeps in sync. A content checker (`website/scripts/check-content.mjs`) fails on unfinished pages and stale terms, and a new CI workflow builds the site on every PR that touches it.

**Tech Stack:** Docusaurus 3.10 (React 19, TypeScript), `@scalar/docusaurus`, `@easyops-cn/docusaurus-search-local`, `@docusaurus/plugin-client-redirects`, `@fontsource-variable/inter`, Node's built-in test runner (`node --test`) for the site scripts, Mocha + ts-node for the root export script, Playwright (from `web/node_modules`) for screenshots.

**Spec:** `docs/superpowers/specs/2026-10-04-website-refresh-design.md`

## Global Constraints

- Branch `docs/website-refresh`; one PR at the end. Stage explicit paths only, never `git add -A` or `git add .` (the working tree carries unrelated `temp-appium/` edits).
- No version bump and no `CHANGELOG.md` entry.
- Every flag, capability, route, header, env var and default a page names must exist in 2.13.1. A claim that can't be confirmed is removed, not softened.
- Current behaviour only; history ("through 2.10 it did X") belongs in the release notes.
- Tone: the README's 2.13 tone. Plain English for testers and lab admins, concrete commands, sentence-case headings, no superlatives ("powerful", "enterprise-grade", "most advanced", "seamless"). Internal class names only on Architecture.
- Capabilities in samples use `xe:options`; `xenon:options` only where the alias is explained; `df:options` only on Upgrading, to say it is no longer read.
- Docs files are flat in `website/docs/`, named `<id>.md` (`.mdx` only when the page uses a component such as `Tabs`). URL is `/docs/<id>`.
- Home page palette from `web/src/tokens.css`. Dark: `--bg #0e1013`, `--surface #15181d`, `--surface-2 #1b1f25`, `--border #262b33`, `--border-strong #333a44`, `--text #e7e9ee`, `--text-muted #a3a9b5`, `--text-dim #868d99`, accent `#22c55e`, on-accent `#0b0d10`. Light: `--bg #f6f7f9`, `--surface #ffffff`, `--surface-2 #f1f3f6`, `--border #e3e6eb`, `--border-strong #d3d8df`, `--text #14171c`, `--text-muted #4b5260`, `--text-dim #5f6673`, accent `#146c35`, on-accent `#ffffff`.
- Default colour mode dark (`defaultMode: 'dark'`, `respectPrefersColorScheme: false`), toggle kept.
- The site works from 375 px wide: 16 px side gutters, no horizontal scroll; home rows stack below 996 px.
- The stub marker is the exact string `XENON-DOCS-STUB`.
- Stale terms (zero hits outside `release-notes.md`; `df:options` also allowed in `upgrading.md`): `df:options`, `x-xenon-api-key`, `xe:priority`, `max_thermal_status`, `5-tier` (any case), `Florence`, `gRPC`, `Appium 2.x`, `estCostUsd`, `bootstrap-key`, `xenon-platform/xenon`.
- The repo URL is `https://github.com/Rabindra184/xenon`; npm package `@xenon-device-management/xenon`.

## Review Focus

1. **A release with a different version** (`package.json` bumped to 2.14.0, nothing else): the committed `website/openapi.json` must not change and the drift check must stay green, while the site shows 2.14.0 in the nav and on `/api`. Test in Task 4.
2. **`CHANGELOG.md` text that MDX or Markdown would misread** (`<basePath>`, `{}`, a `#123` inside inline code, a heading with a backtick): the release-notes page must build and keep inline code untouched. Test in Task 2.
3. **A schema option added without a section** (a new key in `schema.json` the launcher doesn't map) and **an object option whose definition is missing**: the configuration page lists the key under Advanced and doesn't crash. Test in Task 2.
4. **An old URL someone bookmarked** (`/docs/setup`, `/docs/server-args`, `/blog/xenon-v2`, `/docs/cloud`): each lands on its new page after a build. Checked in Task 1 and Task 15.
5. **A reader on a phone** (375 px): the home page's code lines, the install command and the How-it-fits diagram must wrap or scroll inside their own box, never widen the page. Checked in Task 6 and Task 15.

---

## Task 1: Site plumbing, new structure and stubs

**Files:**
- Modify: `website/package.json`, `website/package-lock.json`, `website/docusaurus.config.ts`, `website/sidebars.ts`, `website/src/css/custom.css`, `website/src/pages/index.tsx`
- Create: `website/src/clientModules/fonts.ts`, one stub per new page id (list below)
- Delete: `website/blog/`, `website/src/pages/markdown-page.md`, `website/src/pages/index.module.css`, `website/docs/overrides/`, `website/docs/assets/`, `website/docs/examples/`, `website/docs/design-system.md`, `website/docs/cloud.md`, `website/docs/Xenon-Kotlin-SDK-Specs.md`, `website/static/img/undraw_*.svg`, `website/static/img/docusaurus.png`, `website/static/img/docusaurus-social-card.jpg`, `website/static/img/logo.png`, `website/static/img/logo-dark.png`, `website/static/img/logo-light.png`, `website/static/img/logo-stacked.svg`

**Interfaces:**
- Produces: the final sidebar ids (used by every content task), `customFields.version` (string, from `../package.json`), the CSS variables `--xe-bg`, `--xe-surface`, `--xe-surface-2`, `--xe-border`, `--xe-border-strong`, `--xe-text`, `--xe-text-muted`, `--xe-text-dim`, `--xe-accent`, `--xe-on-accent` defined for both themes in `custom.css` (used by Task 6).

- [ ] **Step 1: Upgrade and add dependencies**

In `website/`: every `@docusaurus/*` package to the same latest `3.10.x`; add `@docusaurus/plugin-client-redirects@3.10.x`, `@easyops-cn/docusaurus-search-local`, `@scalar/docusaurus`, `@fontsource-variable/inter`. Keep `@docusaurus/theme-mermaid`, `lucide-react`, `clsx`, `prism-react-renderer`. Run `npm install` and confirm `npm ls @docusaurus/core` shows one version.

- [ ] **Step 2: Remove the template and stale files** listed under Delete above (`git rm -r`).

- [ ] **Step 3: Stub every page that will be written or rewritten**

Replace the content of each page below (moving the file with `git mv` where the id changes) with front matter plus one line containing `XENON-DOCS-STUB`. Writers read the old text with `git show origin/main:website/docs/<old>.md`.

| id (file) | title | old file |
|---|---|---|
| `index` | Introduction | `index.md` |
| `quick-start` | Quick start | `setup.md` |
| `installation` | Installation and requirements | — |
| `xenon-control` | Xenon Control for Mac | — |
| `upgrading` | Upgrading | — |
| `devices` | Devices and allocation | — |
| `hub-and-nodes` | Hub and nodes | `remote-execution.md` |
| `teams` | Teams | — |
| `device-control` | Live device control | — |
| `recordings` | Recordings | — |
| `deployment` | Production deployment | `deployment.md` |
| `retention` | Data retention | `retention.md` |
| `notifications` | Notifications and webhooks | `notifications.md` |
| `capabilities` | Capabilities | `capabilities.md` |
| `execute-commands` | Execute commands | — |
| `leases` | Leases for CI | — |
| `kotlin-sdk` | Kotlin SDK | — |
| `network-conditioning` | Network conditioning | `network-conditioning.md` |
| `sessions` | Sessions and builds | — |
| `cpu-and-memory` | CPU and memory | — |
| `failure-analysis` | AI failure analysis | — |
| `self-healing` | How healing works | `self-healing.md` |
| `ai-providers` | AI providers | `ai-features.md` |
| `omni-vision` | Omni-Vision | `omni-vision.md` |
| `inspector` | Inspector | `omni-inspector.md` |
| `authentication` | Authentication | `enterprise-security.md` |
| `roles-and-scopes` | Roles and scopes | — |
| `hardening` | Hardening checklist | — |
| `environment-variables` | Environment variables | — |
| `observability` | Observability | — |
| `architecture` | Architecture | `architecture.md` |
| `troubleshooting` | Troubleshooting | `troubleshooting.md` |
| `configuration` | Configuration | `server-args.md` (temporary stub; Task 2 replaces it with generated output) |
| `release-notes` | Release notes | — (temporary stub; Task 2) |

Kept as they are for now (checked in their content task): `autowait.md`, `selector-health.md`, `network-interceptor.md`, `real-time-events.md`.

- [ ] **Step 4: Write `sidebars.ts`**

One sidebar `docs`, categories in this order, all `collapsed: false` except Reference: Get started (`index`, `quick-start`, `installation`, `xenon-control`, `upgrading`); Run the lab (`devices`, `hub-and-nodes`, `teams`, `device-control`, `recordings`, `deployment`, `retention`, `notifications`); Write tests (`capabilities`, `execute-commands`, `leases`, `kotlin-sdk`, `autowait`, `network-conditioning`, `network-interceptor`); Sessions and evidence (`sessions`, `cpu-and-memory`, `failure-analysis`); Self-healing (`self-healing`, `selector-health`, `ai-providers`, `omni-vision`, `inspector`); Security (`authentication`, `roles-and-scopes`, `hardening`); Reference (`configuration`, `environment-variables`, a `link` item "API reference" to `/api`, `real-time-events`, `observability`, `architecture`, `troubleshooting`, `release-notes`).

The `/api` link item is added in Task 4, when the route exists; until then leave it out (broken links fail the build).

- [ ] **Step 5: Rewrite `docusaurus.config.ts`**

- `title: 'Xenon'`, `tagline: 'Your whole mobile device lab, behind one Appium URL.'`, `favicon: 'img/favicon-premium.svg'`, `url: 'https://xenon-6e6.pages.dev'`, `baseUrl: '/'`.
- `onBrokenLinks: 'throw'`, `markdown: { format: 'detect', mermaid: true, hooks: { onBrokenMarkdownLinks: 'throw' } }`.
- Read `version` from `../package.json` with `fs.readFileSync` + `JSON.parse`; expose as `customFields.version`.
- `presets` classic: `docs: { sidebarPath, editUrl: 'https://github.com/Rabindra184/xenon/tree/main/website/' }`, `blog: false`, theme `customCss`.
- `themes`: `@docusaurus/theme-mermaid`, and `[require.resolve('@easyops-cn/docusaurus-search-local'), { hashed: true, indexBlog: false, docsRouteBasePath: '/docs', highlightSearchTermsOnTargetPage: true }]`.
- `plugins`: `['@docusaurus/plugin-client-redirects', { redirects }]` with exactly: `/docs/setup`→`/docs/quick-start`; `/docs/remote-execution`→`/docs/hub-and-nodes`; `/docs/server-args`→`/docs/configuration`; `/docs/ai-features`→`/docs/ai-providers`; `/docs/omni-inspector`→`/docs/inspector`; `/docs/enterprise-security`→`/docs/authentication`; `/docs/Xenon-Kotlin-SDK-Specs`→`/docs/kotlin-sdk`; `/docs/design-system`→`/docs/`; `/docs/cloud`→`/docs/`; `/markdown-page`→`/`; `/blog`, `/blog/xenon-v2`, `/blog/archive`, `/blog/tags`, `/blog/authors`→`/docs/release-notes`.
- `clientModules: ['./src/clientModules/fonts.ts']` (that file: `import '@fontsource-variable/inter';`).
- `themeConfig`: `image: 'img/social-card.png'` (file arrives in Task 6; Docusaurus doesn't link-check it); `colorMode: { defaultMode: 'dark', respectPrefersColorScheme: false }`; no announcement bar; navbar `title: 'Xenon'`, logo `img/logo-premium.svg`, items: Docs (`docSidebar` `docs`), Release notes (`/docs/release-notes`), right: `{ to: '/docs/release-notes', label: 'v' + version, className: 'navbar-version' }`, GitHub (`https://github.com/Rabindra184/xenon`, `className: 'header-github-link'`, `aria-label: 'GitHub'`); footer style `dark`, logo `img/logo-premium.svg`, groups Get started (Quick start, Installation, Upgrading), Run the lab (Hub and nodes, Teams, Production deployment), Reference (Configuration, Release notes), Project (GitHub, Issues `…/issues`, Security policy `…/blob/main/SECURITY.md`, npm package), copyright `Released under the ISC License · © ${year} Xenon`; prism github/dracula with `bash`, `json`, `typescript`, `kotlin`, `java`, `python`, `yaml`.

- [ ] **Step 6: Theme**

`custom.css`: Inter (`'Inter Variable', system-ui, -apple-system, sans-serif`) as `--ifm-font-family-base`; the `--xe-*` variables for `:root` (light values) and `[data-theme='dark']` (dark values) from Global Constraints; Infima mapped onto them (`--ifm-background-color`, `--ifm-background-surface-color`, `--ifm-color-primary` + its six shades, `--ifm-font-color-base`, `--ifm-toc-border-color`, `--ifm-color-emphasis-300` for borders, navbar and footer backgrounds). No other hex values in the file. `.navbar-version` is a small pill (border `--xe-border-strong`, radius 999px).

- [ ] **Step 7: Placeholder home page**

`src/pages/index.tsx`: a `Layout` with an `h1` "Xenon" and a link to `/docs/`. Task 6 replaces it.

- [ ] **Step 8: Build and check redirects**

Run: `cd website && npm run build`
Expected: exit 0. Then `grep -l 'quick-start' build/docs/setup/index.html` and `grep -l 'release-notes' build/blog/xenon-v2/index.html` both print the file.

- [ ] **Step 9: Commit**

```bash
git add website/package.json website/package-lock.json website/docusaurus.config.ts website/sidebars.ts website/src website/docs website/static
git commit -m "docs(website): new structure, Docusaurus 3.10, search, redirects and stubs"
```
(`git add` of the deleted paths is covered by the earlier `git rm`.)

---

## Task 2: Generated configuration and release-notes pages

**Files:**
- Create: `website/scripts/generate.mjs`, `website/scripts/lib/configuration.mjs`, `website/scripts/lib/releaseNotes.mjs`, `website/scripts/lib/configuration.test.mjs`, `website/scripts/lib/releaseNotes.test.mjs`, `website/scripts/lib/fixtures/schema.json`, `website/scripts/lib/fixtures/CHANGELOG.md`
- Modify: `website/package.json` (scripts), `website/.gitignore`
- Delete: the temporary stubs `website/docs/configuration.md`, `website/docs/release-notes.md`

**Interfaces:**
- Produces:
  - `renderConfiguration(schema: object): string` (Markdown for `docs/configuration.md`, front matter included)
  - `renderReleaseNotes(changelog: string): string` (Markdown for `docs/release-notes.md`, front matter included)
  - `SECTIONS: Array<{ title: string, keys: string[] }>` in `configuration.mjs`
  - `generate.mjs` writes `docs/configuration.md`, `docs/release-notes.md` and, once Task 4 lands, `static/openapi.json`
  - npm scripts `generate`, `prestart`, `prebuild` (all `node scripts/generate.mjs`), `test` (`node --test scripts/`)

- [ ] **Step 1: Write the failing tests**

`configuration.test.mjs` against `fixtures/schema.json` (four properties: `maxSessions` integer default 8 required; `platform` string enum `["ios","android","both"]` default `both`; `autowait` object whose description ends "See AutowaitConfig interface for details." with `definitions.AutowaitConfig` having `enabled` boolean default false and `timeoutMs` integer; `brandNewOption` boolean that no section lists):
- output contains `## Session Control` before `## Advanced`, and `brandNewOption` appears only after `## Advanced`;
- the `maxSessions` row contains `` `--plugin-xenon-max-sessions` ``, `integer`, `8`, and marks it required;
- the `platform` row lists `` `ios` ``, `` `android` ``, `` `both` ``;
- rows `autowait.enabled` and `autowait.timeoutMs` exist and the text "See AutowaitConfig interface" does not;
- with `definitions.AutowaitConfig` deleted, rendering doesn't throw and the `autowait` row remains (Review Focus 3);
- a `|` inside a description is escaped as `\|`;
- the front matter has `custom_edit_url: https://github.com/Rabindra184/xenon/blob/main/schema.json`.

`releaseNotes.test.mjs` against `fixtures/CHANGELOG.md` (an intro paragraph, `## 2.13.1` containing "(#444)", a line with `` `<basePath>/session` `` and a bare `{}`, an inline-code span `` `fix (#12)` ``, and `## 2.13.0`):
- `## 2.13.1` and `## 2.13.0` survive as headings, in order;
- `(#444)` becomes `([#444](https://github.com/Rabindra184/xenon/pull/444))`;
- `` `fix (#12)` `` is unchanged (no link inside code) (Review Focus 2);
- the `# Changelog` title is replaced by front matter `title: Release notes` and the intro is kept;
- `<basePath>` and `{}` are unchanged;
- the front matter has `custom_edit_url: https://github.com/Rabindra184/xenon/blob/main/CHANGELOG.md`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd website && node --test scripts/`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `configuration.mjs`**

`SECTIONS` is a copy of `SECTION_ORDER` in `mac-app/src/renderer/src/schemaForm.ts` (titles and key lists verbatim, a comment naming that file); keys in no section go under `## Advanced`. Page shape: front matter (`title: Configuration`, `description`, `custom_edit_url` to `schema.json` on GitHub), a short intro generated from fixed text: how to set an option in a config file (`server.plugin.xenon.<key>`, YAML example with `platform` and `maxSessions`) and as a flag (`--plugin-xenon-<kebab-case>`), that `required` options have defaults Appium needs in a complete config file, and that secrets belong in env vars ([Environment variables](./environment-variables.md)). Then per section a table `| Option | Flag | Type | Default | Description |`. Type: `type`, or `oneOf`/`anyOf` types joined with ` \| `, `array of <item type>`; enum values appended to the description as "One of: …". An object property whose description names `See <Def> interface for details.` drops that sentence and gets one extra row per field of `definitions[<Def>]` as `<key>.<field>`; an array whose `items.$ref` names a definition gets rows `<key>[].<field>`. Defaults rendered as inline code JSON (`` `[]` ``, `` `false` ``), em dash when absent. A banner comment at the top of the output: generated from `schema.json`, edit that file.

- [ ] **Step 4: Implement `releaseNotes.mjs`**

Replace the first `# ` heading with front matter `title: Release notes` / `description: What changed in each Xenon release.` / `toc_max_heading_level: 2` / `custom_edit_url` to `CHANGELOG.md` on GitHub; keep everything else verbatim, except that `(#N)` outside inline code and fenced code becomes a PR link. Inline code and fences are detected per line (track ``` fences; split on backticks for inline spans).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd website && node --test scripts/`
Expected: PASS.

- [ ] **Step 6: Wire it up**

`generate.mjs` reads `../schema.json` and `../CHANGELOG.md` relative to its own directory (`fileURLToPath(new URL('../..', import.meta.url))`), writes the two pages, and logs one line each. `git rm` the two temporary stubs; add `/docs/configuration.md`, `/docs/release-notes.md` and `/static/openapi.json` to `website/.gitignore`; add the npm scripts listed in Interfaces.

- [ ] **Step 7: Build**

Run: `cd website && npm run build`
Expected: exit 0; `build/docs/configuration/index.html` contains `--plugin-xenon-max-sessions`; `build/docs/release-notes/index.html` contains `2.13.1` and `pull/444`.

- [ ] **Step 8: Commit**

```bash
git add website/scripts website/package.json website/.gitignore
git commit -m "docs(website): generate the configuration reference and release notes"
```

---

## Task 3: Content checker and the Website CI check

**Files:**
- Create: `website/scripts/check-content.mjs`, `website/scripts/lib/checkContent.mjs`, `website/scripts/lib/checkContent.test.mjs`, `.github/workflows/website.yml`
- Modify: `website/package.json` (script `check`)

**Interfaces:**
- Produces: `findProblems(files: Array<{ path: string, text: string }>): Array<{ path: string, line: number, problem: string }>`; CLI `npm run check [-- <file>...]` (no args: every `.md`/`.mdx` under `docs/` plus `src/**/*.{tsx,ts,css}`; exit 1 and one line per problem when any).

- [ ] **Step 1: Write the failing test** `checkContent.test.mjs`:
- a file containing `XENON-DOCS-STUB` → problem "unfinished page";
- each stale term from Global Constraints in `docs/foo.md` → one problem naming the term, with the right line number;
- `5-Tier` (mixed case) is caught;
- the same terms in `docs/release-notes.md` → no problems;
- `df:options` in `docs/upgrading.md` → no problem, but `xe:priority` there → a problem;
- a clean file → `[]`.

- [ ] **Step 2: Run it to verify it fails** — `cd website && node --test scripts/` → FAIL.

- [ ] **Step 3: Implement `checkContent.mjs` and the CLI** (rules exactly as Global Constraints; the exemptions are a map from file basename to the terms it may contain, `release-notes.md` → all).

- [ ] **Step 4: Run tests to verify they pass** — `node --test scripts/` → PASS. Then `npm run check` → exit 1 listing the Task 1 stubs (expected until the content tasks finish).

- [ ] **Step 5: Add `.github/workflows/website.yml`**

Name `Website`. On `pull_request` (branches `main`) and `push` (branches `main`), `paths`: `website/**`, `CHANGELOG.md`, `schema.json`, `package.json`, `src/app/openapi/**`, `src/app/swagger.ts`, `.github/workflows/website.yml`. One job on `ubuntu-latest`: checkout, setup-node 22 with npm cache on `website/package-lock.json`, then in `website/`: `npm ci`, `npm test`, `npm run check`, `npm run build`. Use the same action major versions as `schema-drift-check.yml`.

- [ ] **Step 6: Commit**

```bash
git add website/scripts website/package.json .github/workflows/website.yml
git commit -m "ci: build and check the documentation site on pull requests"
```

---

## Task 4: The API reference on the site

**Files:**
- Create: `scripts/export-openapi.js`, `scripts/lib/openapi-for-site.js`, `test/unit/openapi-for-site.spec.ts`, `website/openapi.json`, `website/scripts/lib/openapi.mjs`, `website/scripts/lib/openapi.test.mjs`
- Modify: `package.json` (script `build:openapi`), `.github/workflows/schema-drift-check.yml`, `website/scripts/generate.mjs`, `website/docusaurus.config.ts`, `website/sidebars.ts`, `website/src/css/custom.css`

**Interfaces:**
- Consumes: `swaggerSpec` exported by `src/app/swagger.ts`; Task 2's `generate.mjs`.
- Produces: `forSite(spec: object, version: string): object` in `scripts/lib/openapi-for-site.js`; the token `__XENON_VERSION__`; `website/openapi.json` (committed); `website/static/openapi.json` (generated, git-ignored); the `/api` route.

- [ ] **Step 1: Write the failing test** `test/unit/openapi-for-site.spec.ts` (Mocha, Chai): given a spec `{ info: { version: '2.13.1', description: 'This reference describes version **2.13.1**. The raw OpenAPI document is at [`/xenon/api-docs.json`](/xenon/api-docs.json).' }, paths: { '/api/devices': {} } }`, `forSite(spec, '2.13.1')`:
- `info.version === '__XENON_VERSION__'`;
- `JSON.stringify(result)` does not contain `2.13.1` (Review Focus 1);
- the description contains `` `/xenon/api-docs.json` on your server `` and no Markdown link to it;
- `paths` is deep-equal to the input's;
- the input object is not mutated.

- [ ] **Step 2: Run it to verify it fails** — `npx mocha test/unit/openapi-for-site.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `forSite`** (deep clone; replace every occurrence of the exact version string inside `info` with the token; rewrite that one link to plain code + " on your server").

- [ ] **Step 4: Run the test** — PASS.

- [ ] **Step 5: Export script.** `scripts/export-openapi.js`: `require('ts-node').register({ transpileOnly: true })`, require `../src/app/swagger` for `swaggerSpec`, read `package.json` version, write `forSite(...)` to `website/openapi.json` with 2-space indent and a trailing newline. Root `package.json`: `"build:openapi": "node scripts/export-openapi.js"`. Run it; confirm the file has 100 or more `paths` and contains no `2.13.1`.

- [ ] **Step 6: Drift check.** In `schema-drift-check.yml`, after the token step: `npm run build:openapi` then `git diff --exit-code website/openapi.json`, failing with `::error::The site's API reference is stale. Run 'npm run build:openapi' and commit website/openapi.json.`

- [ ] **Step 7: Generated copy.** `generate.mjs` also writes `static/openapi.json`: `website/openapi.json` with `__XENON_VERSION__` replaced by `../package.json`'s version. The replacement is `withVersion(specText: string, version: string): string` in `website/scripts/lib/openapi.mjs`; `openapi.test.mjs` checks every token is replaced and nothing else changes. (This refines the spec, which named `website/static/openapi.json` as the committed file: committing a version-free copy outside `static/` keeps a release's version bump from tripping the drift check, while the served copy shows the current version.)

- [ ] **Step 8: Scalar.** In `docusaurus.config.ts` plugins: `['@scalar/docusaurus', { label: 'API', route: '/api', showNavLink: false, configuration: { url: '/openapi.json', hideTestRequestButton: true, hideClientButton: true, withDefaultFonts: false, hideDarkModeToggle: true } }]` (no `proxyUrl`). Navbar: add `{ to: '/api', label: 'API', position: 'left' }` after Docs. Sidebar: add the Reference link item "API reference" → `/api` after `environment-variables`. In `custom.css`, under `.light-mode` and `.dark-mode` (Scalar's theme classes), set `--scalar-font: 'Inter Variable', system-ui, sans-serif`, `--scalar-color-accent: var(--xe-accent)`, `--scalar-background-1: var(--xe-bg)`, `--scalar-background-2: var(--xe-surface)`, `--scalar-border-color: var(--xe-border)`.

- [ ] **Step 9: Check the theme follows the site.** `npm run build && npm run serve`, open `/api` in the browser pane, toggle the site theme. Expected: the reference switches with it. If it doesn't, set `hideDarkModeToggle: false` (Scalar's own toggle stays usable) and note it in the PR description.

- [ ] **Step 10: Bump test (Review Focus 1).** Temporarily set root `package.json` version to `2.14.0`, run `npm run build:openapi`: `git diff --exit-code website/openapi.json` exits 0; `cd website && npm run generate` writes `static/openapi.json` containing `2.14.0`. Restore the version (`git checkout package.json`).

- [ ] **Step 11: Commit**

```bash
git add scripts/export-openapi.js scripts/lib/openapi-for-site.js test/unit/openapi-for-site.spec.ts package.json .github/workflows/schema-drift-check.yml website/openapi.json website/scripts website/docusaurus.config.ts website/sidebars.ts website/src/css/custom.css
git commit -m "docs(website): publish the API reference from the server's OpenAPI spec"
```

---

## Task 5: Product screenshots for the site

**Files:**
- Modify: `scripts/dev/readme-screenshots.js`
- Create: `scripts/dev/screenshot-fixtures/phone-screen.html`, `scripts/dev/screenshot-fixtures/session.js` (sample session, command log, device and debug logs, metrics), `scripts/dev/screenshot-fixtures/logcat.js` (sample log records); outputs `website/static/img/screens/{devices,device-control,session}-{dark,light}.png`

**Interfaces:**
- Produces: the six PNGs above (Task 6). The README's `assets/dashboard-{dark,light}.png` keep being written as today.

Facts the mocks must respect (from reading `web/src`; file:line in the research notes):
- The current handler aborts every path containing `/stream`, answers `/session*` with `[]` (the session page then redirects to `/builds`) and anything unknown with `{}`.
- Device control is `/xenon/devices/<udid>/control/logs`. On mount it calls `POST /control/<udid>/stream/start` (body ignored), then `GET /device?t=…` again; it polls `GET /control/<udid>/display` and draws "Display is off" only for `{ state: 'off' }`. The preview is an `<img>` on `GET /control/<udid>/stream?t=…` (MJPEG path; device control has no H.264 path), drawn with `objectFit: contain` at the device's `screenWidth`/`screenHeight` (strings).
- The Logs tab mints `POST /control/<udid>/stream/ticket` → reads `{ ticket }`, then opens `ws://…/xenon/api/control/<udid>/logcat?ticket=…`. Each WebSocket message is one JSON record `{ ts, pid, tid, level: 'V'|'D'|'I'|'W'|'E'|'F', tag, message, pkg? }`. `onopen` clears the buffer, so records must be sent after the socket opens.
- The session page is `/xenon/builds/<buildId>/sessions/<id>`. It reads `GET /build` (array; finds `id === buildId`), `GET /session/<id>` (needs string `id` and `status`; `running` makes it poll), `/session_log` (newest first), `/logs/device`, `/logs/debug`, `/profiling` (`[]` hides its tab), `/metrics` (`{ platform, intervalMs, appId, series: { deviceCpu, deviceMem, appCpu, appMem }, recording: null, samples: [{ t, deviceCpu, deviceMemMb, deviceMemTotalMb, appCpu, appMemMb, app }] }`, CPU 0–100, memory MB, `app` constant), and `GET /interceptor/sessions/<id>/requests` (404 → "No network capture").
- The video card shows `<video>` when `video_recording` is `<id>/video/<file>`, served at `/xenon/api/session/<id>/asset/video/<file>`.

- [ ] **Step 1: Phone frame.** `phone-screen.html` is a plausible shop app checkout screen (app bar, a product list with prices, a "Pay now" button) sized 1344 × 2992 CSS px, using only system fonts and the green accent. The script renders it once with `page.setContent` + `screenshot({ type: 'jpeg', quality: 85 })` to a buffer, and with the bundled ffmpeg (`require('@ffmpeg-installer/ffmpeg').path`, which has `libvpx-vp9`) turns it into a 2-second `session.webm` in a temp dir.

- [ ] **Step 2: Mocks.** Replace the blanket `/stream` abort with exact rules: `GET /control/<udid>/stream` → the JPEG (`contentType: 'image/jpeg'`); `POST …/stream/start` → `{ success: true, type: 'mjpeg' }`; `POST …/stream/ticket` → `{ ticket: 'sample', expiresIn: 60 }`; `POST …/stream/leave` → `{}`; any other `/stream` path → abort. `GET /control/<udid>/display` → `{ state: 'on' }`. Add `screenWidth: '1344'`, `screenHeight: '2992'` (and `marketingName`, `manufacturer`, `model` if missing) to the Pixel 8 Pro entry. `page.routeWebSocket(/\/xenon\/api\/control\/[^/]+\/logcat/, ws => …)` sends `logcat.js`'s records 300 ms after connect: about 40 lines over the last two minutes, mostly I and D from `ActivityTaskManager`, `OkHttp`, `ShopCheckout`, `chromium`, with three W and two E (a payment retry), `pkg` `com.example.shop` or `system_server`. Session routes answer from `session.js`: build `bld-42` named `nightly-2026-10-04`; session `Checkout: pay by saved card`, status `passed`, Pixel 8 Pro, Android 15, `ranOn: 'here'`, owner Priya, 2 min 38 s, `video_recording: '<id>/video/session.webm'`; 14 commands newest first, one healed (`healing_tier` 2, Fuzzy XML, confidence 0.91) and none failed; a few device and debug log rows; 80 metrics samples at 2 s with a smooth CPU curve (device 15–45 %, app 5–25 %, first sample `null`), app memory rising 290 → 340 MB, device memory ~5.2 GB of 11.5 GB; interceptor requests → status 404; the asset path → the WebM (`contentType: 'video/webm'`).

- [ ] **Step 3: Captures.** For each theme (dark, light; existing context setup): the Devices page as today (also copied to `website/static/img/screens/devices-<theme>.png`); `/xenon/devices/28141FDH2000AB/control/logs` (use the Pixel 8 Pro's udid from the fixture), waiting for the preview `<img>`'s `load`, the status pill "Live" and at least 30 log rows; the session page, waiting for the CPU chart's SVG path and `video.readyState >= 2`, framed so the outcome header, the tiles and the CPU chart are all visible (viewport 1440 × 900, or 1440 × 1100 if they don't fit). Hide the "Connecting…" badge as today.

- [ ] **Step 4: Run and look.** `cd web && npm run build && cd .. && node scripts/dev/readme-screenshots.js`. Open all eight PNGs: no spinner, no "Waiting for stream", no "Stream unavailable", no empty state, no redirect to Builds, both themes correct. `git diff --stat assets/` should show the README images unchanged or only re-encoded.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev/readme-screenshots.js scripts/dev/screenshot-fixtures website/static/img/screens
git commit -m "docs: product screenshots for the site, from a mocked dashboard"
```

---

## Task 6: The home page

**Files:**
- Create: `website/src/components/home/Hero.tsx`, `Jobs.tsx`, `HowItFits.tsx`, `FeatureRow.tsx`, `Healing.tsx`, `Teams.tsx`, `WorksWith.tsx`, `QuickStart.tsx`, `CallToAction.tsx`, `home.module.css`; `website/scripts/social-card.mjs`; `website/static/img/social-card.png`
- Modify: `website/src/pages/index.tsx`

**Interfaces:**
- Consumes: Task 1's `--xe-*` variables and `customFields.version`; Task 5's `static/img/screens/{devices,device-control,session}-{dark,light}.png`.

- [ ] **Step 1: Build the page.** The layout and every word of copy are fixed by the approved mockup, `.superpowers/brainstorm/9801-1791105048/content/landing-full.html` (sections 2–10; section 1 is Docusaurus's navbar and the mockup footer is Docusaurus's footer from Task 1). One component per section, all styled from `home.module.css` with `--xe-*` variables only (no hex), so the light theme works. Screenshots via `@theme/ThemedImage` with `useBaseUrl`. The install command and the three quick-start steps use `@theme/CodeBlock` (its Copy button). "How it fits" is HTML and CSS, not an image. Buttons: Get started → `/docs/quick-start`, View on GitHub → repo, Read the quick start → `/docs/quick-start`, Browse the API → `/api`. `Layout` `title="Mobile device lab for Appium"`, `description` = the hero lede.

- [ ] **Step 2: Responsive.** Below 996 px every two-column row, the jobs strip (to 2 columns, 1 below 600 px), the flow diagram (vertical, arrows rotated) and the six tiers (3 columns, 2 below 600 px) stack. Code blocks scroll inside their box.

- [ ] **Step 3: Check in the browser pane.** Add a local `.claude/launch.json` configuration `website` (`npm run serve --prefix website -- --port 3100`, port 3100; the file is git-ignored) after `npm run build`. At 1440, 1280 and 375 px, dark and light: no element's rect extends past `innerWidth` or left of 0 (`javascript_tool` over `document.querySelectorAll('main *')`); screenshots of each.

- [ ] **Step 4: Social card.** `scripts/social-card.mjs` (Playwright from `../web/node_modules/playwright`) opens the served home page at 1200 × 630 in dark mode, hides the navbar, and writes `static/img/social-card.png`. Run it; open the PNG and check the headline and screenshot are both in frame.

- [ ] **Step 5: Build and check** — `npm run build && npm run check -- src/pages/index.tsx src/components/home/*` → exit 0, no problems.

- [ ] **Step 6: Commit**

```bash
git add website/src/pages/index.tsx website/src/components/home website/scripts/social-card.mjs website/static/img/social-card.png
git commit -m "docs(website): the new home page"
```

---

## Content tasks (7–14): how every page is written

Each content task replaces its stubs. For every page:

1. Read the old page if any (`git show origin/main:website/docs/<old>.md`) and the sources named in the spec's docs-structure tables. Write from the sources.
2. Structure: one-paragraph intro saying what the page is for; sections with `##` sentence-case headings; commands and samples that run as written; "Related" links at the end only where useful.
3. Link with relative file links (`./teams.md`) so broken links fail the build.
4. Then run `npm run check -- docs/<id>.md …` (exit 0) and `npm run build` (exit 0).
5. Fact-check: dispatch one reviewer (subagent) per task with the pages and the sources; it returns each claim it couldn't confirm with file:line. Fix or remove, then commit.

The outlines below fix what each page must cover. A writer may add a section the sources support; nothing may be left out.

## Task 7: Get started

**Files:** `website/docs/index.md`, `quick-start.md`, `installation.md`, `xenon-control.md`, `upgrading.md`

- [ ] **Step 1: `index.md` (Introduction, served at `/docs/`).** What Xenon is (an Appium 3 plugin that turns devices on one machine or many into a shared lab); what it does (the five jobs, each linking to its section's first page); how it fits (a Mermaid diagram: tests → hub → nodes → devices, people → dashboard → hub); what you need (link to Installation); where to go next.
- [ ] **Step 2: `quick-start.md`.** The README quick start, four steps, verbatim commands; default admin `admin@xenon.local` / `Admin@123` and the warning to change it or set `XENON_BOOTSTRAP_ADMIN_EMAIL` / `XENON_BOOTSTRAP_ADMIN_PASSWORD` first; where the access key and token are (Profile); the capabilities sample from the README in JavaScript, Java and Python (`.mdx` with `Tabs`); "What you should see" (the Sessions page); next steps.
- [ ] **Step 3: `installation.md`.** Requirements table from the README (Node 20.19+, Appium 3.x, drivers, Android platform tools, macOS + Xcode for iOS); check against `package.json` `engines` and the go-ios and ffmpeg handling in `src/` (state precisely whether go-ios and ffmpeg are bundled or must be installed); install from npm; a config-file setup (`appium server --config xenon.yaml`) linking to Configuration; database (SQLite default path under `~/.cache/xenon`, PostgreSQL via `XENON_DB_PROVIDER`/`DATABASE_URL`, migrations at startup); installing from source (`npm run dev`); checking it works.
- [ ] **Step 4: `xenon-control.md`.** From `mac-app/README.md`: what it does (configures and starts Appium with Xenon, settings form from `schema.json`, profiles, secrets in the Keychain, toolchain checks, first-run setup, launch preview); download from `https://github.com/Rabindra184/xenon/releases/latest` (no hard-coded version); first launch on macOS (check `mac-app/README.md` and the `docs/mac-app-*` branches' notes for the Gatekeeper step; include it only if confirmed); it hands off to the dashboard once the server is up.
- [ ] **Step 5: `upgrading.md`.** Read the release notes first (link); `appium plugin update xenon`; migrations at startup, or `XENON_AUTO_MIGRATE=false` and applying them yourself; hubs and nodes (each release's notes say whether order matters; 2.13 allows any order); from 1.x to 2.x: credentials and options move to `xe:options`, `df:options` is no longer read (sample before and after, from the 2.0.0 changelog entry).
- [ ] **Step 6: Check, build, fact-check, commit** (as above). Commit message: `docs(website): Get started pages`.

## Task 8: Run the lab

**Files:** `website/docs/devices.md`, `hub-and-nodes.md`, `teams.md`, `device-control.md`, `recordings.md`, `deployment.md`, `retention.md`, `notifications.md`

- [ ] **Step 1: `devices.md`.** Discovery (Android devices and emulators via adb; iPhones; iOS simulators; `platform`, `androidDeviceType`, `iosDeviceType`, `simulators`, `emulators`, `bootedSimulators`, `bootedEmulators`); device states as the Devices page shows them (Ready, Busy, Reserved, Maintenance, Offline) and what causes each; how a session gets a device (free, healthy, visible to the caller's teams, not blocked or reserved or leased) and the capabilities that narrow it (`appium:udids`, `appium:minSDK`, `appium:maxSDK`, `appium:tags`, `appium:iPhoneOnly`, `appium:iPadOnly`, `appium:filterByHost`); the queue (`appium:deviceAvailabilityTimeout`, `appium:deviceRetryInterval`, `deviceAvailabilityTimeoutMs`); reservations (who may release or extend; extension at least a minute, end no more than 24 h ahead); blocking a device for maintenance (udid and host); tags; health checks (`healthCheckIntervalMs`, `healthCheckSchedule`).
- [ ] **Step 2: `hub-and-nodes.md`.** Merge of old `remote-execution.md` and `docs/node-provisioning.md`, rewritten against `src/gateway/` and CLAUDE.md "Hub-Node Topology": what a hub and a node are; setting up a hub; provisioning a node's user and token (devices scope) and recovering a lost one; starting a node (`XENON_HUB_ACCESS_KEY`, `XENON_HUB_TOKEN`, `--plugin-xenon-hub`); what goes through the hub (session create and commands, device control, live preview and logs, recordings) and what doesn't (install by path; BiDi and session WebSockets); base paths may differ; a hub restart keeps node sessions; tuning intervals (`sendNodeDevicesToHubIntervalMs`, `checkStaleDevicesIntervalMs`, `sessionHeartbeatIntervalMs`); security (credentials checked at the hub; turn on `XENON_REQUIRE_COMMAND_AUTH` on the hub; nodes on a trusted network); upgrading order.
- [ ] **Step 3: `teams.md`.** From `docs/teams.md`, corrected to 2.13 (`deviceVisibility.ts`, `computeTeamIds`, `appVisibility.ts`, `sessionVisibility.ts`): devices in a team or the shared pool; who sees what (members: their teams + shared pool; admins: all); API tokens narrowed by a team; uploaded apps have a team; sessions follow their device; a hidden device answers as unknown; setting teams up in the dashboard and via the API; a team that owns apps can't be deleted.
- [ ] **Step 4: `device-control.md`.** Opening device control; the live preview (MJPEG; Android H.264 via `streaming.androidH264`, falling back to MJPEG); tap, swipe, type, keys; the Actions tab (install from the app library or upload, installed apps, uninstall); clipboard (Android read only; iPhone write takes about 3 s); Screenshot tab; Logs tab (Android logcat; filter grammar `level:`, `tag:`, `package:`, `-tag:`, `-package:`, text; dropped-lines marker); Omni-Vision and Inspector tabs (link); holds (your preview holds the phone; released 3 s after the last view closes; others see who holds it; sessions queue behind a hold); who may control a phone (team rule, held by someone else → refused with their name, admins override); node phones work through the hub except install by path.
- [ ] **Step 5: `recordings.md`.** Live devices page; recording one or several phones; Interact / Annotate; marks; the combined side-by-side video; the recordings library (find, replay in sync, download, delete); proof bundle contents (manifest, README, per device `video.mp4`, `bookmarks.json`, `annotations.json`, `device.json`, composite); limits (`maxConcurrentRecordings`), storage (`recordingsAssetsPath`), cleanup (`recordingCleanupDays`, `recordingCleanupMaxCount`, `recordingFailedCleanupDays`); a phone is freed when its recording ends; node phones are recorded on the hub.
- [ ] **Step 6: `deployment.md`.** Topologies (one server; hub and nodes); PostgreSQL; migrations; running under a process manager (`deployment/ecosystem.config.js`); HTTPS behind a reverse proxy and `XENON_ALLOWED_ORIGINS`; sizing (`maxSessions`, recordings); backups (the SQLite file / PostgreSQL); logs (`enableJsonLogging`); link to Hardening.
- [ ] **Step 7: `retention.md`.** Merge of both copies, checked against `CleanupService` and `schema.json`: what is deleted and when (`buildCleanupDays`, `buildCleanupMaxCount`, `buildCleanupSchedule`, `deleteBuildAssets`, the recording options); changing it from Maintenance (super admin); running it now.
- [ ] **Step 8: `notifications.md`.** Webhooks: types, events, templates, Send test (reports a failed delivery), who may manage them (admin scope); email (`XENON_SMTP_URL`, `XENON_SMTP_FROM`) for password reset.
- [ ] **Step 9: Check, build, fact-check, commit.** `docs(website): Run the lab pages`.

## Task 9: Write tests (without the Kotlin SDK)

**Files:** `website/docs/capabilities.md`, `execute-commands.md`, `leases.md`, `autowait.md`, `network-conditioning.md`, `network-interceptor.md`

- [ ] **Step 1: `capabilities.md`.** `xe:options` fields (`accessKey`, `token`, `sessionToken`, `leaseId`, `leaseToken`, `team`/`teamId`, `healingTiers`, `interceptor`, `autowait` as read by `xenonOptions.ts` and its callers); credentials are stripped before the driver and every record; `xenon:options` alias rule (field by field, `xe:options` wins); the `xe:` capabilities from `XenonCapabilityManager` (each with its aliases as accepted); device-selection `appium:` capabilities (link to Devices); a complete sample in JavaScript, Java and Python (`.mdx`, `Tabs`).
- [ ] **Step 2: `execute-commands.md`.** Prefixes `xenon:` and `xe:` (legacy `plugin:` for the autowait pair); session metadata commands from `src/dashboard/commands.ts` (each name, arguments, effect); autowait (`setAutowaitProperties`, `getAutowaitProperties`); Omni-Vision (`smartTap`/`omniClick`, `uiInventory`/`uiScanExport`, `analyzeScreen`/`omniScan`, `visualTap`, `assertVisualState`); network interceptor (`addMock`, `removeMock`, `clearMocks`, `getRequests`, `getMocks`, `exportHar`, Android only). Each with a one-line JavaScript example.
- [ ] **Step 3: `leases.md`.** Why lease (reserve before the test starts); `POST /xenon/api/sdk/leases` request (`filters` incl. `platform`, `sdk`, `deviceName`, `udid`, `teamId`, `tags` as `sdk-leases.ts` accepts, `durationMs`) and response (`leaseId`, `leaseToken`, `appiumCapabilities`); heartbeat, extend, release routes; expiry (three missed heartbeats or `expiresAt`); creating a session on a lease (`xe:options.leaseId` + `leaseToken`); what a lease skips (blocked, reserved, unhealthy) and the `404` when nothing matches; `GET /xenon/api/sdk/version`; a full curl example.
- [ ] **Step 4: `autowait.md`, `network-interceptor.md`.** Check every line against `src/services/autowait/` and `src/services/interceptor/`; fix what's wrong; remove version history.
- [ ] **Step 5: `network-conditioning.md`.** From `NetworkConditioningService` and `XenonCapabilityManager`: the capability and its accepted profile values, what each simulates, which platforms, latency added for local sessions only (nodes add their own).
- [ ] **Step 6: Check, build, fact-check, commit.** `docs(website): Write tests pages`.

## Task 10: Kotlin SDK page and compatibility report

**Files:** `website/docs/kotlin-sdk.md` (or `.mdx`); report at `<scratchpad>/kotlin-sdk-compat.md` (not committed)

- [ ] **Step 1: Read the SDK** at `/Users/rabindrabiswal/Workspace/xenon` (README, `XENON_SDK_EXAMPLES.md`, `src/main/kotlin/io/github/qasecret/xenon/`, `CHANGELOG.md`, `build.gradle.kts`). Published coordinates `io.github.qasecret:xenon:2.1.0` (Maven Central), repo `https://github.com/qasecret/xenon`, Apache-2.0, JVM 21.
- [ ] **Step 2: Check each public flow against plugin 2.13** (routes in `src/app/routers/`, capability reading in `xenonOptions.ts`): configuration and auth headers; `getDevices`/`getDevice` filters; `lease(...)` on `/sdk/leases` and the legacy `/reservation` path; `driver(lease)` capabilities; JUnit 5 / TestNG / Kotest integration; `ControlService` calls; recording and streaming calls; the autowait and interceptor capability DSL (known: flat `"xenon:options.autowait"` / `"xenon:options.interceptor"` keys, which the plugin doesn't read). Record each as works / doesn't work (why, file:line on both sides) / not verifiable.
- [ ] **Step 3: Write the page** covering only flows marked "works": installing (Gradle Kotlin DSL and Maven), configuring the hub URL and credentials, leasing a device and getting a driver, the test-framework integrations, the side-channel control calls, links to the SDK's README and examples. A note at the top: the SDK is versioned separately; this page describes 2.1.0.
- [ ] **Step 4: Write the compatibility report** (a table of every flow and its status) to the scratchpad for the final summary.
- [ ] **Step 5: Check, build, fact-check, commit.** `docs(website): Kotlin SDK page`.

## Task 11: Sessions and evidence

**Files:** `website/docs/sessions.md`, `cpu-and-memory.md`, `failure-analysis.md`

- [ ] **Step 1: `sessions.md`.** The Sessions page (period, summary: pass rate and its change, failures, running, median and p90 duration; paging 200 at a time; filters; builds column); naming and grouping (`xe:name`, `xe:build`); a session's page (result and why first; tiles: result, commands, self-healing, slowest command; video, screenshots, device logs, commands); setting the result from a test (`xenon: setSessionStatus`); a build's page and Copy failed tests; bug report bundles (contents; network capture admins only); who sees which sessions (team rule).
- [ ] **Step 2: `cpu-and-memory.md`.** From `src/services/metrics/`: every 2 s, written every 10 s; Android (device and app CPU and memory, the app is `appPackage` or the foreground app); iPhone (device CPU only); node sessions sampled by the node and collected by the hub; `sessionMetrics: false`; the panel's states ("isn't recorded"); `GET /xenon/api/session/:id/metrics`.
- [ ] **Step 3: `failure-analysis.md`.** From `failure-analysis-service.ts` and `AIService`: what it analyses, when it runs, what it needs (an AI provider), where results appear, what data leaves the server (to the configured provider only).
- [ ] **Step 4: Check, build, fact-check, commit.** `docs(website): Sessions and evidence pages`.

## Task 12: Self-healing

**Files:** `website/docs/self-healing.md`, `selector-health.md`, `ai-providers.md`, `omni-vision.md`, `inspector.md`

- [ ] **Step 1: `self-healing.md`.** Autowait first (optional); the six tiers table (0 Resilio, 1 Native, 2 Fuzzy XML, 3 OCR, 4 Visual AI, 5 LLM) as in the README; stored fingerprints and how they're learnt; what the test gets back (a real element, or a coordinate tap for a visual result); turning it off (`enableSelfHealing`, `--plugin-xenon-enable-self-healing=false`) or choosing tiers per session (`xe:options.healingTiers`); which tiers call your AI provider; link to Selector Health.
- [ ] **Step 2: `selector-health.md`.** Check every line against `src/services/selector-health/` and the CLAUDE.md "Selector Health" section; remove history and cost wording; keep the API section accurate (routes under `/xenon/api/healing/`).
- [ ] **Step 3: `ai-providers.md`.** Providers (`gemini`, `openai`, `anthropic`, `ollama`); setting one (`XENON_AI_PROVIDER`, the `XENON_*_API_KEY` vars and their unprefixed fallbacks as `src/` reads them, `XENON_AI_MODEL` and per-provider model vars, `XENON_AI_BASE_URL`; or `aiProvider`/`aiModel`/`aiBaseUrl`); default models exactly as `AIService` sets them; the AI engine page (super admin; whether keys are stored or shown, exactly as the code does); what each feature sends to the provider.
- [ ] **Step 4: `omni-vision.md`.** OCR and AI vision; `-custom:ai-icon` / `-custom:ai-text` locator strategies and the virtual elements they return; what works on a virtual element; the execute commands (link); Omni-Vision in device control; needs an AI provider for the vision parts.
- [ ] **Step 5: `inspector.md`.** From `web/src/components/omni-inspector/`: the element tree, the details pane, locator suggestions and their order, generated code (the languages the code offers), the Checks tab, Test locator.
- [ ] **Step 6: Check, build, fact-check, commit.** `docs(website): Self-healing pages`.

## Task 13: Security

**Files:** `website/docs/authentication.md`, `roles-and-scopes.md`, `hardening.md`

- [ ] **Step 1: `authentication.md`.** Credentials table (dashboard session cookie, access key + token headers, bearer JWT from `POST /xenon/api/auth/token` with its audiences, hub token for hub↔node only); creating tokens (Profile); session credentials in `xe:options` (`accessKey`+`token`, or `sessionToken`); `XENON_REQUIRE_SESSION_TOKEN`; per-command auth (`XENON_REQUIRE_COMMAND_AUTH`: owner or override admin; refusal looks like an unknown session; 30 s cache); single-use tickets (streams, app downloads); CSRF (`Origin` for cookie changes; headers and bearer exempt); rate limits (per key / per user, 300/min, 10× reads, `X-RateLimit-*`, `429` + `Retry-After`); sign-in protection and password reset (`XENON_LOGIN_RATE_LIMIT_*`, `XENON_RESET_*`, SMTP); `XENON_AUTH_DISABLED` for local development only.
- [ ] **Step 2: `roles-and-scopes.md`.** Roles (`SUPER_ADMIN`, `ADMIN`, `MEMBER`) and what each may do; scopes (`read`, `sessions`, `devices`, `admin`); a dashboard user's scopes by role; a token can't exceed its creator; the permission matrix from the old `enterprise-security.md`, checked against the routers and the 2.13.0 Access changes (settings need super admin; `/users` and webhooks need `admin`; recordings need `devices`); teams (link).
- [ ] **Step 3: `hardening.md`.** A checklist: bootstrap admin password before first start; `XENON_REQUIRE_SESSION_TOKEN`; `XENON_REQUIRE_COMMAND_AUTH` on the hub; HTTPS and `XENON_ALLOWED_ORIGINS`; nodes on a trusted network; least-privilege tokens; teams; secrets in env vars, not config files; `XENON_AUTH_DISABLED` never on a shared machine; keep up to date; reporting a vulnerability (`SECURITY.md`).
- [ ] **Step 4: Check, build, fact-check, commit.** `docs(website): Security pages`.

## Task 14: Reference (hand-written pages)

**Files:** `website/docs/environment-variables.md`, `real-time-events.md`, `observability.md`, `architecture.md`, `troubleshooting.md`

- [ ] **Step 1: `environment-variables.md`.** Every `XENON_*` and `OTEL_*` variable `src/` reads, plus `DATABASE_URL`, `GEMINI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` fallbacks, `CLOUD_USERNAME`/`CLOUD_KEY` (credentials for the `cloud` option), `HTTP_PROXY`/`HTTPS_PROXY`; grouped (Setup, Database, AI, Hub and nodes, Security and sign-in, Email, Recordings and storage, Logging and telemetry); each with what it does and its default, from the code. Leave out `NODE_ENV`, `PATH`, `APPIUM_HOME`, `UDIDS`, `CHROMEDRIVER_*`. Start from the root `docs/server-args.md` env table, then verify each against `src/`.
- [ ] **Step 2: `real-time-events.md`.** Check against `EventManager` and `SocketServer`: connecting (the credentials the handshake accepts), events are team-scoped, event names and payloads, protocol version.
- [ ] **Step 3: `observability.md`.** OpenTelemetry traces, logs and metrics (the `OTEL_*` vars `src/` reads, `XENON_OTEL_DEBUG`); what a trace contains (only what the code sets); JSON logs (`enableJsonLogging` / `XENON_JSON_LOGGING`); the event log (`XENON_EVENT_LOG`, retention); the `examples/observability` Docker Compose stack (Grafana, Tempo, Loki) and how to start it.
- [ ] **Step 4: `architecture.md`.** For readers who want to know how it works: the plugin inside Appium; the command flow in order (from CLAUDE.md "Command Interception Flow"); the session gateway and hub forwarding; device managers and streaming; healing; data layer (SQLite/PostgreSQL via Prisma); the dashboard and live events. Mermaid diagrams where they help. Class names allowed here.
- [ ] **Step 5: `troubleshooting.md`.** Symptom → cause → fix, each confirmed in the code or changelog: no Android devices (adb path, `ANDROID_HOME`, launched from a GUI without a shell `PATH`); iPhone not streaming or WebDriverAgent start timing out (retry once; iOS 17+ tunnels); a session waits in the queue (a preview hold, a reservation, a lease, teams); live preview falls back from H.264 to MJPEG; `401`/`403`/`404`/`409`/`503` from the API and what each means here; dashboard behind a proxy refuses changes (`XENON_ALLOWED_ORIGINS`); migrations at startup; where the logs are.
- [ ] **Step 6: Check, build, fact-check, commit.** `docs(website): Reference pages`.

## Task 15: One copy of each page, and final checks

**Files:**
- Delete: `docs/teams.md`, `docs/node-provisioning.md`, `docs/retention.md`, `docs/server-args.md`
- Modify: `README.md` (lines 142, 161, 243), `docs/internal/operations.md:149`, `src/interfaces/IDevice.ts:73`, `mac-app/src/renderer/src/schemaForm.ts:4`, `website/README.md`

- [ ] **Step 1: Move the readers to the site.** README links become `https://xenon-6e6.pages.dev/docs/hub-and-nodes`, `/docs/configuration`, `/docs/retention`, `/docs/teams`; `operations.md` → the hub-and-nodes page; the two code comments name the site page. `git rm` the four root files. Then `grep -rn "docs/\(teams\|node-provisioning\|retention\|server-args\)" --include=*.md --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v CHANGELOG | grep -v '^./website/build'` prints nothing.

- [ ] **Step 2: `website/README.md`.** What the site is; `npm install`, `npm start`, `npm run build`, `npm test`, `npm run check`; what is generated from where (configuration ← `schema.json`, release notes ← `CHANGELOG.md`, `/api` ← `openapi.json` ← `npm run build:openapi` at the root); refreshing the screenshots (Task 5's command); deployment (Cloudflare Pages builds `website/` from the full repo, Node 20+, output `build`).

- [ ] **Step 3: Whole-site gates.** `cd website && npm test && npm run check && npm run build` → all exit 0 (no stubs remain). At the root: `npx mocha test/unit/openapi-for-site.spec.ts test/unit/openapi-coverage.spec.ts` → PASS; `npm run build:openapi && git diff --exit-code website/openapi.json` → exit 0.

- [ ] **Step 4: Redirects (Review Focus 4).** With the built site served (`.claude/launch.json` `website`), open each `from` path in Task 1 Step 5 in the browser pane; each ends on its `to` page.

- [ ] **Step 5: Look (Review Focus 5).** In the browser pane at 1440, 1280 and 375 px, dark and light: the home page, `/docs/quick-start`, `/docs/configuration`, `/docs/release-notes`, `/api`. No horizontal overflow (element rects); home-page text contrast measured with computed colours against their backgrounds, every pair ≥ 4.5:1 (≥ 3:1 for text 24 px+ or 18.66 px bold). Fix anything that fails. Save screenshots to the scratchpad for the summary.

- [ ] **Step 6: Search.** Search "lease" and "healingTiers" in the built site; both return their pages.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/internal/operations.md src/interfaces/IDevice.ts mac-app/src/renderer/src/schemaForm.ts website/README.md
git commit -m "docs: the site is the one copy of the user docs"
```

- [ ] **Step 8: Open the PR** with `gh pr create --body-file` (body written to a file first): summary, what was removed and why, the generated references, the new CI check, the Cloudflare settings to confirm (build `npm run build` in `website/`, full repo checkout, Node 20+, output `website/build`), screenshots, and a pointer to the Kotlin SDK report.

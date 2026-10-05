# Xenon documentation site

The source of [xenon-6e6.pages.dev](https://xenon-6e6.pages.dev): the home page, the docs under `/docs`, and the API reference at `/api`. It is a [Docusaurus](https://docusaurus.io/) site, and it is the one place the user docs live. The repository's README links here for the details.

## Work on it

Use Node 22 (`.nvmrc` says so, for `nvm use`). Everything runs from this folder:

```bash
cd website
npm install
npm start          # a local preview at http://localhost:3000, reloaded as you edit
npm run build      # the finished site, in build/
npm run serve      # serves build/, to check it as it will be published
npm test           # the tests of the scripts in scripts/lib/
npm run check      # unfinished pages and retired terms; name files to check only those
```

`npm run check -- docs/leases.md` checks one page. CI runs `npm test`, `npm run check` and `npm run build` on every pull request that touches the site (`.github/workflows/website.yml`). The build fails on a broken link, so link pages with relative file links such as `./teams.md`.

## Pages

Each page is one file in `docs/`, named after its address: `docs/teams.md` is `/docs/teams`. A page that uses a component such as `Tabs` is `.mdx`. `sidebars.ts` puts the pages in order, and `docusaurus.config.ts` holds the navbar, the footer and the redirects from old addresses.

The home page is `src/pages/index.tsx` with its sections in `src/components/home/`, and `/api` is `src/pages/api.tsx`. The colours are in `src/css/custom.css`, taken from the dashboard's `web/src/tokens.css`.

## What is generated

Three references come from files elsewhere in the repository, so they can't fall behind it. `scripts/generate.mjs` writes them before `npm start`, `npm run build` and `npm run check` (or by hand with `npm run generate`). Edit the source, not the output, which git ignores:

| Page | Written to | From |
|---|---|---|
| Configuration (`/docs/configuration`) | `docs/configuration.md` | `../schema.json` |
| Release notes (`/docs/release-notes`) | `docs/release-notes.md` | `../CHANGELOG.md` |
| API reference (`/api`) | `static/openapi.json` | `openapi.json`, with the plugin's version from `../package.json` |

`openapi.json` is committed. It is exported from the server's own spec (`src/app/swagger.ts` and `src/app/openapi/`) by `npm run build:openapi` at the repository root. Run that after changing the API, and commit the file: the Schema Drift Check workflow fails when it differs from what the server would export.

## Pictures

The product screenshots in `static/img/screens/` come from the dashboard, served with sample data, so no server or phone is needed. From the repository root:

```bash
cd web && npm run build && cd ..
node scripts/dev/readme-screenshots.js
```

It writes the README's pictures in `assets/` as well. `static/img/social-card.png`, the picture a shared link shows, comes from the built site: run `npm run build && npm run serve -- --port 3100`, then `node scripts/social-card.mjs` in another terminal. Both scripts use the Playwright in `web/node_modules`, so run `npm install` in `web/` first.

## Deployment

Cloudflare Pages builds and publishes the site, with these settings:

- **Root directory:** `website`, from a full checkout of the repository. The build reads `schema.json`, `CHANGELOG.md` and `package.json` one folder up.
- **Build command:** `npm run build`
- **Output directory:** `build` (that is, `website/build`)
- **Node:** 22

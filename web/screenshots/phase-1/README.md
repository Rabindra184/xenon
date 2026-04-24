# Phase 1 baseline screenshots

Capture v1 and v2 variants of these routes and drop the PNGs into this
directory before merging phase 1. Filenames: `<route>-v1.png`, `<route>-v2.png`.

## Routes

- `/devices`
- `/builds`
- `/settings`

## How to capture

```bash
cd web && npm run start
# open http://localhost:3000/xenon/<route>?themeV2=1  → save as <route>-v2.png
# open http://localhost:3000/xenon/<route>?themeV2=0  → save as <route>-v1.png
```

Under Phase 1, the v2 shots should render **identically** to v1 — no screens
have been rebuilt yet. This baseline is the diff reference for later phases.

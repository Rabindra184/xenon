# Contributing to Xenon

## Development setup

```bash
nvm use 20
npm install
npm run dev        # migrate DB + build + install plugin + start server
```

## Running tests

```bash
npm test                         # unit tests
npm run test:e2e                 # end-to-end (real device + running server)
npm run test:coverage            # NYC coverage report
```

## Database changes

Xenon uses Prisma with SQLite (dev) and PostgreSQL (production). Every schema change must be accompanied by a migration.

### Adding or modifying a model

1. Edit `prisma/schema.prisma`.
2. Generate a migration:
   ```bash
   npm run db:generate -- --name describe_your_change
   ```
3. Regenerate the TypeScript client:
   ```bash
   npm run build:schema
   ```
4. Commit **both** `prisma/migrations/<timestamp>_describe_your_change/` and the updated `src/generated/client/`.

### Why this matters

CI runs two gates on every PR:

- **Schema drift check** — `prisma migrate diff` verifies migrations match the schema. Fails if you edited `schema.prisma` without generating a migration.
- **Client freshness check** — diffs the generated `index.d.ts` against the committed copy. Fails if `src/generated/client` is stale.

PRs that skip either step will not merge.

## Code style

```bash
npm run lint      # ESLint with auto-fix
npm run format    # Prettier
```

TypeScript strict mode is enabled. No `any` casts without a comment explaining why.

## Pull requests

- Target `main`.
- One logical change per PR; keep diffs reviewable.
- Include unit tests for new behaviour.
- Update `schema.json` (and run `npm run build:schema`) if you add plugin CLI arguments.

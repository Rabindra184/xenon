# Data Retention & Maintenance

Xenon runs a scheduled cleanup job that purges old builds, sessions, and their artifacts (video recordings, screenshots, performance traces) so that long-running hubs don't fill the disk.

## How the job is triggered

- Cron expression: [`buildCleanupSchedule`](./server-args.md#data-retention) — defaults to `0 0 * * *` (midnight local time).
- Implemented by `CleanupService.runCleanup` in `src/services/CleanupService.ts`. Scheduled at startup by `setupCronCleanupBuilds` in `src/device-utils.ts`.
- Rescheduling is picked up at runtime: updating `buildCleanupSchedule` on the dashboard's Maintenance page or with `POST /xenon/api/config` cancels the old timer and installs a new one.

## What gets deleted

Each run executes three phases in order:

1. **Purge builds older than `buildCleanupDays`** (default `30`). Every session attached to a purged build is deleted along with its `SessionLog`, `Log`, and `Profiling` rows.
2. **Evict past the count cap `buildCleanupMaxCount`** (default `100`). Builds are sorted newest-first; anything beyond the cap is purged regardless of age. This guarantees a bounded build table even on noisy pipelines.
3. **Sweep orphan sessions** — sessions with no `build_id` older than `buildCleanupDays`. These come from ad-hoc WebDriver runs that never sent a build capability; without this sweep their artifacts would accumulate forever.

## What "deleting assets" means

When [`deleteBuildAssets`](./server-args.md#data-retention) is `true` (the default), the job also removes the files on disk:

- Session videos (`*.mp4`)
- Screenshots
- Performance traces (`performance_trace`)

Assets live under `~/.cache/xenon/assets/sessions/<session-id>/` by default (`sessionAssetsPath` in `src/config.ts`). The cleanup code resolves every candidate path against this base and refuses to remove anything that would escape it — so tampered DB rows cannot trick the job into deleting unrelated files.

Set `deleteBuildAssets: false` if you archive artifacts yourself (e.g. uploaded to S3 before the cleanup runs) and only want the DB rows pruned.

## Recommended settings

| Use case | `buildCleanupDays` | `buildCleanupMaxCount` | `deleteBuildAssets` |
|----------|-------------------|------------------------|---------------------|
| Local dev | `7` | `25` | `true` |
| CI (noisy, short-lived) | `14` | `100` | `true` |
| Regulated / forensic | `90` | `1000` | `false` (archive externally) |

## Configuring it

### Config file

```yaml
plugin:
  xenon:
    buildCleanupDays: 14
    buildCleanupMaxCount: 100
    buildCleanupSchedule: "0 2 * * *"   # 02:00 local time
    deleteBuildAssets: true
```

### CLI

```bash
appium server --use-plugins=xenon \
  --plugin-xenon-build-cleanup-days=14 \
  --plugin-xenon-build-cleanup-max-count=100 \
  --plugin-xenon-build-cleanup-schedule="0 2 * * *" \
  --plugin-xenon-delete-build-assets
```

### Runtime (dashboard or API)

```bash
curl -X POST http://localhost:4723/xenon/api/config \
  -H "X-Xenon-Access-Key: $XENON_ACCESS_KEY" -H "X-Xenon-Token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "buildCleanupDays": 14, "deleteBuildAssets": true }'
```

Changing them needs a super admin. Send only the fields to change: a field sent is saved as the lab's own.

Runtime updates persist to the `WebConfig` table and survive restarts. **A value saved this way replaces the option the server was started with**, for as long as it is saved; with nothing saved, the option applies, and with neither, the default. The retention window, the build cap and the asset purge are read at the start of each run, so a change applies at the next run with no restart; a new schedule replaces the running timer at once.

The values must be able to work: `buildCleanupDays` and `buildCleanupMaxCount` whole numbers of at least 1, `buildCleanupSchedule` a cron expression of five or six fields, `deleteBuildAssets` true or false. Anything else is refused with `400` and nothing is saved. (Through 2.13 the cleanup job read only the startup options, and a second setting could not be saved at all, so what the Maintenance page saved did nothing.)

## Manually triggering cleanup

If you need to run the job on demand (migration, disaster recovery, etc.), call `CleanupService.runCleanup(pluginArgs)` from a one-off Node script or expose it behind a private endpoint. There is no public manual-trigger API today.

## Observability

- Each run logs `Starting cleanup: Retention = … days, Max Builds = …, Purge Assets = …` at `info`.
- Per-build purges are logged at `debug` (`Purged build: <id> (<n> sessions removed)`).
- Failures are caught and logged at `error` (`❌ Cleanup failed: …`); the job does not throw so the cron timer keeps running.

## Related

- [`docs/server-args.md`](./server-args.md#data-retention) — flag reference
- [README — Configuration](../README.md#-configuration)

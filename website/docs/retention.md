---
title: Data retention
description: What Xenon deletes and when. The cleanup job removes old builds, sessions, their videos and screenshots, and old recordings, so that a busy lab doesn't fill its disk.
---

Every test session leaves rows in the database and, usually, a video and screenshots on disk. A cleanup job removes the old ones on a schedule, so a busy lab doesn't fill its disk. This page explains what the job deletes and when, the options that control it, and how to change them.

Each server, whether a hub, a node or a standalone one, runs its own cleanup on its own database and its own files.

## What gets deleted

The job runs on a cron schedule, `buildCleanupSchedule`, in the server's local time. It's `0 0 * * *` by default: every night at midnight. Each run does four things, in this order:

1. **Old builds.** A build older than `buildCleanupDays` (default `30`) is deleted, with every session in it.
2. **Too many builds.** If there are more than `buildCleanupMaxCount` builds (default `100`), the newest that many are kept and the rest are deleted, however recent they are. Every build counts, the `Default Build` ones too: a test that sends no `xe:build` is filed under a build called `Default Build`, and a new one is started when such a session starts more than 30 minutes after the start of the latest one. A lab that runs many of those tests reaches the cap sooner.
3. **Old sessions with no build.** A session that belongs to no build at all is deleted once it is older than `buildCleanupDays`.
4. **Old recordings.** The recordings made on the Live devices page have their own limits: `recordingCleanupDays` (default `30`), `recordingCleanupMaxCount` (default `100`) and, for failed recordings, which hold no video, `recordingFailedCleanupDays` (default `2`). A recording that is still running is never deleted. The job also removes any recording folder that no recording points to. [Recordings](./recordings.md) has more.

A session is deleted with everything that belongs to it: its command history, its device and debug logs, its profiling data and its CPU and memory samples. The healed selectors in its command history go with it, so the Selector Health counts for that period shrink.

### Files on disk

With `deleteBuildAssets` on, which is the default, deleting a build or a session also deletes its files: its video, its screenshots and its performance trace. Xenon then removes the session's whole folder, `~/.cache/xenon/assets/sessions/<session id>/`, so stray files go too. It refuses to remove anything outside that folder.

With `deleteBuildAssets` off, only the database rows go and the files stay where they are. Use that if you copy artifacts elsewhere before the job runs and clear the folder yourself. It doesn't apply to recordings: expired recordings always lose their files.

### What isn't deleted

Uploaded apps stay until someone deletes them on the **Apps** page. The job doesn't touch users, tokens, teams, webhooks, devices or the selector fingerprints that healing keeps. Xenon's internal log of live events is pruned separately, once a day: events older than 30 days go, or older than `XENON_EVENT_LOG_RETENTION_DAYS` days when you set it.

## Set the options

A server starts with the options in its config file or flags. For the first four options in the table below, a super admin can also save values on the dashboard's **Maintenance** page. A value saved on the page wins over the option, and the option wins over the default. Put the options in a config file, as [Configuration](./configuration.md) describes:

```yaml
server:
  use-plugins: [xenon]
  plugin:
    xenon:
      buildCleanupDays: 14
      buildCleanupMaxCount: 100
      buildCleanupSchedule: "0 2 * * *"   # 02:00, server time
      deleteBuildAssets: true
      recordingCleanupDays: 14
```

Or as flags, for the options that take a value:

```bash
appium server --use-plugins=xenon \
  --plugin-xenon-build-cleanup-days=14 \
  --plugin-xenon-build-cleanup-max-count=100 \
  --plugin-xenon-build-cleanup-schedule="0 2 * * *" \
  --plugin-xenon-recording-cleanup-days=14
```

| Option | Default | What it does |
|---|---|---|
| `buildCleanupDays` | `30` | Builds and sessions older than this many days are deleted. The page calls it **Retention window**. |
| `buildCleanupMaxCount` | `100` | The most builds to keep, newest first. The page calls it **Max build capacity**. |
| `buildCleanupSchedule` | `0 0 * * *` | When the job runs, as a five-field cron expression: for example `0 */12 * * *` is every 12 hours and `0 0 * * 0` is Sunday at midnight. The page calls it **Cleanup orchestration**. |
| `deleteBuildAssets` | `true` | Whether files are deleted with their rows. The page calls it **Asset purge strategy**. To turn it off in a config file, set it to `false`. |
| `recordingCleanupDays` | `30` | Recordings older than this are deleted. Options only: the page doesn't show it. |
| `recordingCleanupMaxCount` | `100` | The most recordings to keep, counting each phone's video separately. Options only. |
| `recordingFailedCleanupDays` | `2` | Failed recordings older than this are deleted. Options only. |

### The Maintenance page

The page shows what the server runs with now: the value saved on the page, else the option the server started with, else the default. A change takes effect without a restart. The retention window, the build cap and the asset purge are read at the start of each run, and a new schedule replaces the old one at once.

- **Save configuration** saves only the fields you changed. A field you save becomes the lab's own, and from then on it hides any later change to the server's option, so a field you didn't touch is left alone.
- **Restore Defaults** saves every value, going back to the defaults the server declares.
- A value the job would act on badly is refused, and nothing is saved: a retention window or a build cap that isn't a whole number of at least 1, a schedule that isn't a cron expression of five or six fields, or an asset purge that isn't true or false. Over the API, `POST /xenon/api/config` answers `400` with `invalid_setting` and the name of the field.
- Only a super admin can save. When the server can't read its settings, the page says so and offers **Try again**, instead of showing numbers of its own.

Each server has its own settings: a hub's page doesn't change its nodes' cleanup.

Choose the values to fit your disk, not only your history. A lab that runs many builds a day reaches `buildCleanupMaxCount` before `buildCleanupDays`, and the cap then decides how much is kept. If you need to keep builds for audit, copy what you need out first and set `deleteBuildAssets` to `false`, or raise the limits and give the disk room.

## Run it now

There is no button or API call that runs the job at once. To run it at a time you choose, set the schedule to a time soon, such as `*/5 * * * *` for every five minutes, and set it back afterwards. On the Maintenance page a new schedule starts at once. As an option, use `--plugin-xenon-build-cleanup-schedule="*/5 * * * *"` and restart the server. A deletion can't be undone, so back up anything you want to keep first.

## See what it did

The server's log shows each run. It starts with the settings it used, then says what it purged:

```text
Starting cleanup: Retention = 30 days, Max Builds = 100, Purge Assets = true
```

A line such as `No builds identified for cleanup.` means nothing was old enough. A failure is logged as `Cleanup failed: ...` and doesn't stop the schedule: the job tries again at its next time. At start, and each time a new schedule is saved, the log shows the schedule the job was given: `Build cleanup scheduled with expression: 0 0 * * *`.

## Related

- [Recordings](./recordings.md)
- [Configuration](./configuration.md): every option, with its flag.
- [Production deployment](./deployment.md): backups and disk planning.

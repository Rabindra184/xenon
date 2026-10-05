---
title: Production deployment
description: Run Xenon for a team, as one server or a hub with nodes. Where the data lives and how to back it up, a process manager, HTTPS behind a reverse proxy, sizing and logs.
---

This page is for running Xenon where other people depend on it. It covers the two ways to lay out a lab, where Xenon keeps its data and how to back it up, keeping it running, putting it behind HTTPS, sizing it, and logging. For locking it down, read [Hardening](./hardening.md) as well.

## Choose a layout

- **One server.** One machine runs Appium with Xenon, and every phone is plugged into it. It's the simplest to run and fits a small team or a CI runner. This is what the [Quick start](./quick-start.mdx) sets up.
- **A hub and nodes.** One hub holds the lab's users, teams and history, and each node is a machine with phones plugged into it. Tests and people use the hub only. Choose this when the phones need more than one machine, such as Android phones on a Linux machine and iPhones on a Mac. [Hub and nodes](./hub-and-nodes.md) explains how to set it up.

A hub can have phones of its own too. Either way, each server has its own database.

## Before you open it to others

- Set the first super admin's email and password before the first start, so the default `admin@xenon.local` / `Admin@123` never exists on a reachable server: `XENON_BOOTSTRAP_ADMIN_EMAIL` and `XENON_BOOTSTRAP_ADMIN_PASSWORD`. Xenon reads them only when it creates its first user.
- Serve Xenon over HTTPS: see [HTTPS behind a reverse proxy](#https-behind-a-reverse-proxy).
- Set `XENON_PUBLIC_URL` to the address people use, such as `https://xenon.example.com`. Password reset links point there, and without it Xenon emails none: see [A forgotten password](./authentication.md#a-forgotten-password).
- Turn on `XENON_REQUIRE_SESSION_TOKEN`, so every session has an owner, and on a hub `XENON_REQUIRE_COMMAND_AUTH`, so every command is checked. Per-command checks need every client to send its credentials with every command, and the Kotlin SDK doesn't: see [Check every command](./authentication.md#check-every-command) and [Hardening](./hardening.md).
- Set up [backups](#back-up-the-data) and decide how long to keep data: [Data retention](./retention.md).

## Where Xenon keeps its data

Everything is under `~/.cache/xenon` of the user that runs Appium, unless you move it:

| Path | Holds | How to move it |
|---|---|---|
| `xenon.db` | The database: users, tokens, devices, sessions, builds, recordings and settings. | `DATABASE_URL`, or `--plugin-xenon-database-url`, as `file:/data/xenon/xenon.db` |
| `xenon-jwt-private.pem` | The key that signs tokens and stream tickets. It sits next to the default database, not next to the one `DATABASE_URL` names. | `XENON_JWT_KEY_DIR` |
| `assets/sessions/` | Session videos and screenshots, and `recordings/` with the recordings made on the Live devices page. | `recordingsAssetsPath`, or `XENON_RECORDINGS_ASSETS_PATH`, for the recordings only |
| `apps/` | Apps uploaded to the app library. | |
| `interceptor-ca/` | The certificate authority, with its private key, that the network interceptor signs with. Keep it private. Xenon makes it when the interceptor first runs. | |

The database is a SQLite file, so there is no database server to run. Keep it on the machine's own disk. SQLite is the only database Xenon stores its data in: a `postgresql://` URL stops the server at startup, with a message that says what to set. Leave `databaseProvider` unset. Set to `postgresql`, it logs a warning that it has no effect, but a database made with the default setting then stops the server at startup: see [The server doesn't start](./troubleshooting.md#the-server-doesnt-start).

### Database changes on upgrade

Each time it starts, Xenon brings the database up to date, and the log says `Syncing database schema` and then `Database schema in sync`. If your pipeline applies database changes itself, set `XENON_AUTO_MIGRATE=false` and apply them before starting a new version: [Upgrading](./upgrading.md) shows the command.

### Back up the data

Back up each server whose data you care about, on a schedule, and before every upgrade. A hub holds the lab's users, tokens, teams and history, so it matters most.

```bash
# A consistent copy of the database, while Xenon runs
sqlite3 ~/.cache/xenon/xenon.db ".backup '/backups/xenon/xenon.db'"

# The signing key, and the files
cp ~/.cache/xenon/xenon-jwt-private.pem /backups/xenon/
rsync -a ~/.cache/xenon/assets/ /backups/xenon/assets/
rsync -a ~/.cache/xenon/apps/ /backups/xenon/apps/
rsync -a ~/.cache/xenon/interceptor-ca/ /backups/xenon/interceptor-ca/
```

Also keep your config file, and the values of the environment variables you set, in your own secret store. To restore, stop Xenon, put the files back and start it again. Without the signing key, Xenon makes a new one, and tokens and tickets signed with the old one stop working. Without `interceptor-ca/`, Xenon makes a new certificate authority the next time the network interceptor runs, and a real phone needs the new certificate installed by hand, as [Network interceptor](./network-interceptor.md#the-certificate) describes. The backup holds its private key, so keep it private.

## Keep it running

Run Appium under a process manager, so that it starts at boot and comes back after a crash. Give the manager the environment Xenon needs: `ANDROID_HOME` for Android, a home folder where the plugin is installed (`APPIUM_HOME` if you don't use `~/.appium`), and the variables from [Environment variables](./environment-variables.md). This is a [PM2](https://pm2.keymetrics.io/) file, based on the repository's `deployment/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: 'xenon-hub',
      script: 'appium',
      args: 'server --use-plugins=xenon --plugin-xenon-enable-dashboard --keep-alive-timeout 800',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      // Edit these paths. Variables exported where you run pm2 are passed on too.
      env: {
        NODE_ENV: 'production',
        APPIUM_HOME: '/home/xenon/.appium',
        ANDROID_HOME: '/home/xenon/Android/Sdk',
        DATABASE_URL: 'file:/data/xenon/xenon.db',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/xenon-hub-error.log',
      out_file: './logs/xenon-hub-out.log',
      merge_logs: true,
    },
  ],
};
```

Start it with `pm2 start ecosystem.config.js`, and `pm2 save` and `pm2 startup` to bring it back after a reboot. For more than a few options, put them in a config file and start with `appium server --config /etc/xenon/xenon.yaml`: [Configuration](./configuration.md) has the options. Keep secrets such as the bootstrap password and the AI keys in the environment, not in a config file.

Mind what a restart does:

- **Stop it with SIGTERM or SIGINT,** which is what a process manager does by default. A node then tries to tell its hub that it is leaving, but that can lose a race with Appium's own exit, so the hub also drops the node's phones when its health probe fails. A server that is killed instead, or crashes, is cleaned up at its next start.
- **At every start,** sessions that were still running on the server's own phones are marked failed and their phones freed, and a recording that was running is marked failed with `server_restart`. A hub keeps its nodes' sessions: see [Hub and nodes](./hub-and-nodes.md#restarts-and-failures).
- **A server's own phones are listed again** when it starts, and each keeps its team, tags, maintenance flag and reservation. To start with none of them, set `removeDevicesFromDatabaseBeforeRunningThePlugin`: see [Devices and allocation](./devices.md#what-a-phone-keeps-when-it-goes).

Appium closes a connection that has been idle longer than `--keep-alive-timeout` (600 seconds by default), so raise it if your tests pause for long between commands.

Appium serves tests at `/` by default, and many clients expect `/wd/hub`: add `--base-path /wd/hub` to serve it there. Xenon's dashboard and API stay at `/xenon` either way.

To check that a server is up, `GET /xenon/api/health` needs no login and answers `{"ok":true}`. It is what a hub uses to check its nodes.

## HTTPS behind a reverse proxy

Xenon addresses its servers as `http://`, so serve HTTPS with a reverse proxy such as nginx or Caddy in front of the hub, not with Appium's own TLS options, and let only the proxy reach Xenon's port with your firewall. The proxy has to:

- **Pass WebSocket upgrades.** The dashboard's live updates use `/socket.io/`, and the live preview and logs use sockets under `/xenon/api/control/`. Without them, socket.io falls back to polling, the Android H.264 preview to MJPEG, and live logs stop.
- **Keep the `Host` header, port included.** The dashboard's requests that change something are accepted only when their `Origin` or `Referer` matches the `Host` the server sees, and that comparison includes the port. In nginx, `$http_host` passes the header as the browser sent it, port and all, where `$host` drops the port. If the proxy rewrites `Host`, the dashboard answers `403` for every save. Either keep it, or list the address people use in `XENON_ALLOWED_ORIGINS`, a comma-separated list of origins or hosts, such as `https://xenon.example.com`.
- **Set `X-Forwarded-Proto`.** The sign-in cookie is marked `Secure` only when Xenon sees HTTPS, either directly or from `X-Forwarded-Proto: https`.
- **Set `X-Forwarded-For`, and overwrite any value a client sends.** Xenon limits sign-in attempts per client address (5 in 5 minutes by default), and takes the address from the first value of that header. Without it every user behind the proxy shares one limit, and one that a client could set would let it dodge the limit.
- **Pass the credential headers unchanged:** `x-xenon-access-key`, `x-xenon-token` and `Authorization`.
- **Allow long requests.** Previews and live logs stay open as long as someone watches. Uploading an app to install on a phone can be as large as 4 GB. Session creation can take minutes the first time a driver installs on a phone. Raise the proxy's body-size and timeout limits to match, and turn off buffering of responses for the preview and of request bodies for large uploads.

An nginx configuration that does this:

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

# Any other host name: refuse the TLS handshake, and close a request
# for any other host name.
server {
  listen 443 ssl default_server;
  ssl_reject_handshake on;
  return 444;
}

server {
  listen 443 ssl;
  server_name xenon.example.com;
  ssl_certificate     /etc/ssl/xenon/fullchain.pem;
  ssl_certificate_key /etc/ssl/xenon/privkey.pem;

  client_max_body_size 4g;

  location / {
    proxy_pass http://127.0.0.1:4723;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
}
```

Set `XENON_PUBLIC_URL=https://xenon.example.com` in Xenon's environment, so the reset links it sends point at the proxy. Nodes then use the public address, `--plugin-xenon-hub=https://xenon.example.com`, and check its certificate. The hub reaches each node over plain HTTP at the node's own address, so keep nodes on a private network: see [Hub and nodes](./hub-and-nodes.md#security).

## Size it

- **`maxSessions`** (default `8`) holds new session requests back while that many Appium sessions are running or being started. Live previews, recordings and SDK leases with no session on them don't use a slot, and a hub counts its nodes' phones too. A value below `1` means no limit. Set it to what your machines and your phones can run together, and watch the queue on the Overview page.
- **Recordings** are capped by `maxConcurrentRecordings`, or `XENON_MAX_CONCURRENT_RECORDINGS` when the option isn't set (default `4`), across all users. Each recording runs its own encoder, so lower it on a small machine. See [Recordings](./recordings.md).
- **The idle timeout** `newCommandTimeoutSec` (default `60` seconds) frees a phone from a test that has gone quiet. A session can set its own with `appium:newCommandTimeout`.
- **Disk** use grows with session videos, screenshots and recordings. [Data retention](./retention.md) deletes them on a schedule: choose its limits to fit the disk you have.

## Logs

Appium writes to its standard output, which a process manager collects. To also write to a file, give Appium `--log /var/log/xenon/appium.log`. Rotate the file or the manager's logs with `logrotate` or the manager's own tool.

To ship the logs to a log system, turn on `enableJsonLogging` (`--plugin-xenon-enable-json-logging`), or set `XENON_JSON_LOGGING=true`. The option wins when it is set, to `true` or `false`, and with neither the logs are plain text. With JSON logging on, Xenon writes each of its messages as one JSON object with `timestamp`, `level`, `scope` and `message`, and `sessionId`, `udid`, `requestId`, `commandName` and trace ids when they apply. Appium's own lines keep their usual format. Secrets are masked in the log either way.

For metrics and traces, see [Observability](./observability.md): `GET /xenon/api/metrics` serves metrics in Prometheus format to any signed-in caller, so don't expose it beyond the people who may see lab figures.

## Related

- [Hardening](./hardening.md)
- [Hub and nodes](./hub-and-nodes.md)
- [Data retention](./retention.md)
- [Upgrading](./upgrading.md)
- [Environment variables](./environment-variables.md)
- [Configuration](./configuration.md)

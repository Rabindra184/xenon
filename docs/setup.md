---
title: Setup & Requirements
hide:
  - navigation
---
## Prerequisite

Appium version 2.0.X

## Installation - Server

Install the plugin using Appium's plugin CLI, either as a named plugin or via NPM:

```
appium plugin install --source=npm appium-xenon
appium plugin install --source=npm appium-dashboard
```

## Installation - Client

No special action is needed to make things work on the client side.

## Activation

The plugin will not be active unless turned on when invoking the Appium server. See "Argument options" below

```
appium server -ka 800 --use-plugins=xenon,appium-dashboard  -pa /wd/hub --plugin-xenon-platform=android
```

You can also pass all the arguments in a config file. Refer [here](https://github.com/AppiumTestDistribution/appium-xenon/blob/main/server-config.json)
```
appium server -ka 800 --use-plugins=xenon --config ./server-config.json -pa /wd/hub
```

## Device UI

- Navigate to localhost:4723/xenon once the appium server is started.

<img src="https://github.com/AppiumTestDistribution/appium-xenon/blob/main/docs/assets/images/demo.gif?raw=true">

User can block/unblock devices from Dashboard manually. These devices will not be picked up for automation.

Once automation picks the device user cannot manually unblock, it's responsible for the automation script.

## Database Setup (Optional)

By default, Xenon uses a local **SQLite** database to store device states and session history. For large-scale distributed deployments, you can switch to **PostgreSQL**.

### PostgreSQL Configuration

To use PostgreSQL, pass the provider and connection URL via Appium's plugin arguments:

```bash
appium server ... \
  --plugin-xenon-database-provider=postgresql \
  --plugin-xenon-database-url="postgresql://user:password@localhost:5432/xenon"
```

Alternatively, use environment variables:
- `XENON_DB_PROVIDER=postgresql`
- `DATABASE_URL=postgresql://user:password@localhost:5432/xenon`


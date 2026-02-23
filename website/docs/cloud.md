---
title: Cloud Execution
hide:
  - navigation
---

### BrowserStack

```
CLOUD_USERNAME="username" CLOUD_KEY="apiKey" appium server -ka 800 --use-plugins=xenon --config ./website/docs/examples/cloud-configs/bs-config.json -pa /wd/hub
```
Refer on BroswerStack config [here](https://github.com/xenon-platform/xenon/blob/main/website/docs/examples/cloud-configs/bs-config.json)

### pCloudy

```
CLOUD_USERNAME="useremail" CLOUD_KEY="apiKey" appium server -ka 800 --use-plugins=xenon --config ./website/docs/examples/cloud-configs/pcloudy-config.json -pa /wd/hub
```
Refer on pCloudy config [here](https://github.com/xenon-platform/xenon/blob/main/website/docs/examples/cloud-configs/pcloudy-config.json)

### SauceLabs

```
CLOUD_KEY="apiKey" CLOUD_USERNAME="useremail" appium server -ka 800 --use-plugins=xenon --config ./website/docs/examples/cloud-configs/sauce-config.json -pa /wd/hub
```
Refer on sauce config [here](https://github.com/xenon-platform/xenon/blob/main/website/docs/examples/cloud-configs/sauce-config.json)

### LambdaTest

```
CLOUD_KEY="apiKey" CLOUD_USERNAME="useremail" appium server -ka 800 --use-plugins=xenon --config ./website/docs/examples/cloud-configs/lt-config.json -pa /wd/hub
```
Make sure all `appiumVersion: 2.0` in your capabilities.
Refer on LambdaTest config [here](https://github.com/xenon-platform/xenon/blob/main/website/docs/examples/cloud-configs/lt-config.json)


### HeadSpin

```
appium server -ka 800 --use-plugins=xenon --config ./website/docs/examples/cloud-configs/hs-config.json
```
Refer on HeadSpin config [here](https://github.com/xenon-platform/xenon/blob/main/website/docs/examples/cloud-configs/hs-config.json).

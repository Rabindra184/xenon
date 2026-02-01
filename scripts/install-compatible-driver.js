#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

try {
  console.log('Detecting Appium server version...');
  // Prefer local appium CLI if available, else fall back to global 'appium'
  const localAppium = path.resolve(__dirname, '..', 'node_modules', '.bin', 'appium');
  const appiumCmd = fs.existsSync(localAppium) ? localAppium : 'appium';
  const versionRaw = execSync(`${appiumCmd} --version`, { encoding: 'utf8' }).trim();
  // appium --version returns something like "2.4.1" or "3.0.0-rc.2"
  const version = semver.coerce(versionRaw);
  if (!version) {
    console.error('Unable to parse Appium version:', versionRaw);
    process.exit(1);
  }

  const major = version.major;
  console.log('Appium server version detected:', version.raw);

  let driverToInstall = 'xcuitest@5.14.0';
  if (major >= 3) {
    console.log('Appium 3.x detected; installing latest compatible xcuitest driver');
    driverToInstall = 'xcuitest';
  } else {
    console.log(
      'Appium 2.x detected; installing xcuitest driver compatible with Appium 2.4.1 (5.14.0)',
    );
  }

  const cmd = `${appiumCmd} driver install ${driverToInstall}`;
  console.log('Running:', cmd);
  execSync(cmd, { stdio: 'inherit' });
} catch (err) {
  console.error('Failed to install driver:', err.message);
  process.exit(1);
}

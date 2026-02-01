rm -rf /tmp/xenon
export APPIUM_HOME=/tmp/xenon
echo 'Building Plugin'
npm run build
echo 'Uninstall Plugin'
./node_modules/.bin/appium plugin uninstall xenon
echo 'Install Plugin'
./node_modules/.bin/appium plugin install --source=local .

echo 'Plugin List'
./node_modules/.bin/appium plugin list

echo 'Installing UIAutomator2 driver'
./node_modules/.bin/appium driver install uiautomator2

echo 'Installing XCUIDriver driver'
node ./scripts/install-compatible-driver.js
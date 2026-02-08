module.exports = {
    apps: [
        {
            name: 'xenon-hub',
            script: 'appium',
            args: 'server -ka 800 --use-plugins=xenon -pa /wd/hub --plugin-xenon-enable-dashboard',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '2G',
            env: {
                NODE_ENV: 'production',
                APPIUM_HOME: process.env.APPIUM_HOME || '/usr/local/lib/node_modules/appium',
                DATABASE_URL: process.env.DATABASE_URL || 'file:./xenon_hub.db',
                PORT: 4723
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/xenon-hub-error.log',
            out_file: './logs/xenon-hub-out.log',
            merge_logs: true
        }
    ]
};

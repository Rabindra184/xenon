import log from '../logger';
import loki from 'lokijs';

// database class singleton
export class XenonDatabase {
  private static _instance: XenonDatabase;
  private _dbList: { dbname: string; db: loki }[] = [];

  static get DeviceModel() {
    return XenonDatabase.getDeviceModel();
  }
  static get PendingSessionsModel() {
    return XenonDatabase.getPendingSessionsModel();
  }
  static get CLIArgs() {
    return XenonDatabase.getCLIArgs();
  }
  static get db() {
    return XenonDatabase.getDB();
  }

  private constructor() {
    log.info('Initializing database');
    XenonDatabase._instance = this;
  }

  public static instance() {
    return XenonDatabase._instance || new XenonDatabase();
  }

  private static dbname() {
    const appium_home = process.env.APPIUM_HOME || './temp-appium';
    // log.debug(`Using database file: ${appium_home}/xenon-db.json`);
    return `${appium_home}/xenon-db.json`;
  }

  private static async getDeviceModel() {
    return (await XenonDatabase.getDB()).addCollection('devices');
  }

  private static async getPendingSessionsModel() {
    return (await XenonDatabase.getDB()).addCollection('pending-sessions');
  }

  private static async getCLIArgs() {
    return (await XenonDatabase.getDB()).addCollection('cliArgs');
  }

  private static initCollections(db: loki) {
    db.addCollection('devices');
    db.addCollection('pending-sessions');
    db.addCollection('cliArgs');
  }

  private static async getDB() {
    const existingDb = XenonDatabase.instance()._dbList.find(
      (db) => db.dbname === XenonDatabase.dbname(),
    );

    if (existingDb) return existingDb.db;

    log.debug(`Creating new database: ${XenonDatabase.dbname()}`);

    const db = await new Promise<loki>((resolve, reject) => {
      const db = new loki(XenonDatabase.dbname(), {
        autoload: true,
      });

      db.on('autoload', () => {
        log.info('Database autoloaded');
      });

      db.on('error', (err) => {
        log.error(`Error in database: ${err}`);
        reject(err);
      });

      db.on('loaded', () => {
        log.info('Database loaded');
        XenonDatabase.initCollections(db);
        resolve(db);
      });

      db.on('flushChanges', () => {
        log.info('Database changes flushed');
      });

      db.on('close', () => {
        log.info('Database closed');
      });
    });

    XenonDatabase.instance()._dbList.push({ dbname: XenonDatabase.dbname(), db });

    return db;
  }
}

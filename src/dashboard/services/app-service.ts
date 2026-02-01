import { prisma } from '../../prisma';
import { config } from '../../config';
import path from 'path';
import fs from 'fs-extra';
import { ADB } from 'appium-adb';
import log from '../../logger';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export class AppService {
  constructor() {
    this.ensureAppDir();
  }

  private async ensureAppDir() {
    try {
      await fs.ensureDir(config.appsPath);
    } catch (err) {
      log.error(`Failed to create apps directory at ${config.appsPath}: ${err}`);
    }
  }

  async getApps() {
    return await prisma.app.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAppById(id: string) {
    return await prisma.app.findUnique({
      where: { id },
    });
  }

  async getWDAApp() {
    return await prisma.app.findFirst({
      where: {
        platform: 'ios',
        OR: [
          { name: { contains: 'wda-signed' } },
          { name: { contains: 'wda-resign' } },
          { name: { contains: 'WebDriverAgent' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteApp(id: string) {
    const app = await this.getAppById(id);
    if (app) {
      if (await fs.exists(app.filepath)) {
        await fs.remove(app.filepath);
      }
      return await prisma.app.delete({
        where: { id },
      });
    }
  }

  async uploadApp(file: any) {
    await this.ensureAppDir();

    // Calculate MD5 to check for duplicates
    const md5 = crypto.createHash('md5').update(file.data).digest('hex');
    const existingApp = await prisma.app.findUnique({ where: { md5 } });
    if (existingApp) {
      log.info(`App with MD5 ${md5} already exists. Returning existing app.`);
      return existingApp;
    }

    const id = uuidv4();
    const filename = file.name;
    const extension = path.extname(filename).toLowerCase();
    const filepath = path.join(config.appsPath, `${id}${extension}`);

    await fs.writeFile(filepath, file.data);

    let packageName: string | undefined;
    let version: string | undefined;
    let platform: string | undefined;

    if (extension === '.apk') {
      platform = 'android';
      try {
        const adb = await ADB.createADB({});
        const apkInfo: any = await adb.getApkInfo(filepath);
        packageName = apkInfo.name;
        version = apkInfo.versionName || apkInfo.versionCode?.toString();
      } catch (err) {
        log.warn(`Failed to extract metadata for APK ${filename}: ${err}`);
      }
    } else if (extension === '.ipa') {
      platform = 'ios';
      // For IPA, we could use appium-ios-device or similar,
      // but for now let's just mark it as ios.
    }

    return await prisma.app.create({
      data: {
        id,
        name: filename,
        filename,
        filepath,
        mimetype: file.mimetype,
        size: file.size,
        packageName,
        version,
        platform,
        md5,
      },
    });
  }
}

export const APP_SERVICE = new AppService();

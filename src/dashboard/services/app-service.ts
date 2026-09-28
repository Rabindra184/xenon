import { prisma } from '../../prisma';
import { config } from '../../config';
import path from 'path';
import fs from 'fs-extra';
import { ADB } from 'appium-adb';
import log from '../../logger';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { visibleAppWhere } from '../../services/device-access/appVisibility';

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

  /**
   * The apps a caller may see (`teamIds` as on req.auth: undefined is an
   * admin), newest first, each with its team's name for the Team column.
   */
  async getApps(teamIds?: string[]) {
    return await prisma.app.findMany({
      where: visibleAppWhere(teamIds),
      include: { team: { select: { id: true, name: true } } },
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

  /** Moves an app to a team, or to the shared pool with null. Returns rows changed (0 or 1). */
  async setAppTeam(id: string, teamId: string | null): Promise<number> {
    const result = await prisma.app.updateMany({ where: { id }, data: { teamId } });
    return result.count;
  }

  /**
   * Stores an uploaded app in `teamId`'s team, or shared when null.
   *
   * The same bytes (by md5, which is unique) are stored once: re-uploading
   * them returns the existing app unchanged, in whatever team it is already
   * in. An admin who wants it elsewhere moves it with PUT /apps/:id/team.
   */
  async uploadApp(file: any, teamId: string | null = null) {
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
        teamId,
      },
    });
  }
}

export const APP_SERVICE = new AppService();

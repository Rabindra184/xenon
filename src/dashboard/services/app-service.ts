import { prisma } from '../../prisma';
import { config } from '../../config';
import path from 'path';
import fs from 'fs-extra';
import { ADB } from 'appium-adb';
import log from '../../logger';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import AsyncLock from 'async-lock';
import { visibleAppWhere } from '../../services/device-access/appVisibility';
import { AppIdentity, apkIdentity, iosArchiveIdentity } from '../../services/apps/appIdentity';

/** The error a move answers `409` with: the team already has the file. */
export class AppAlreadyInTeam extends Error {
  constructor() {
    super('That team already has an app with the same file.');
    this.name = 'AppAlreadyInTeam';
  }
}

/** What GET /apps may narrow its list by; every one given must match. */
export interface AppFilter {
  md5?: string;
  packageName?: string;
  platform?: 'android' | 'ios';
}

export class AppService {
  /**
   * One app per file per team is kept here, not by a unique index: adding
   * one over [md5, teamId] makes `prisma db push` (how a database without
   * migration history starts) refuse without --accept-data-loss, so the
   * server wouldn't start. An upload's check and insert run under one lock
   * per md5, so two uploads of a build can't both store it.
   */
  private md5Lock = new AsyncLock();

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

  /**
   * Moves an app to a team, or to the shared pool with null. Returns rows
   * changed (0 or 1). Throws AppAlreadyInTeam when another app there has the
   * same file.
   */
  async setAppTeam(id: string, teamId: string | null): Promise<number> {
    const app = await this.getAppById(id);
    if (!app) return 0;
    const move = async () => {
      if (app.md5) {
        const there = await prisma.app.findFirst({
          where: { md5: app.md5, teamId, NOT: { id } },
          select: { id: true },
        });
        if (there) throw new AppAlreadyInTeam();
      }
      const result = await prisma.app.updateMany({ where: { id }, data: { teamId } });
      return result.count;
    };
    return app.md5 ? this.md5Lock.acquire(app.md5, move) : move();
  }

  /**
   * Stores an uploaded app in `teamId`'s team, or shared when null.
   *
   * The same bytes (by md5) are stored once for everyone who can see them:
   * re-uploading bytes an app the uploader can see already holds (`teamIds`,
   * as on req.auth: undefined for an admin, who sees every app) returns that
   * app unchanged, in whatever team it is in. An admin who wants it elsewhere
   * moves it with PUT /apps/:id/team.
   *
   * Bytes only apps the uploader can't see hold get a row, and a file, of
   * their own in `teamId` (ENH-16): returning another team's app would show
   * a member that team's build, and refusing would tell them it exists. So
   * there is one app per file per team (kept by `md5Lock`), not one per file
   * across the library.
   */
  async uploadApp(file: any, teamId: string | null = null, teamIds?: string[]) {
    await this.ensureAppDir();
    const md5 = crypto.createHash('md5').update(file.data).digest('hex');
    return this.md5Lock.acquire(md5, () => this.storeUpload(file, md5, teamId, teamIds));
  }

  private async storeUpload(
    file: any,
    md5: string,
    teamId: string | null,
    teamIds: string[] | undefined,
  ) {
    const existingApp = await this.visibleWithMd5(md5, teamIds);
    if (existingApp) {
      log.info(`App with MD5 ${md5} already exists. Returning existing app.`);
      return existingApp;
    }

    // Never two apps with one file in one team, even one the uploader can't
    // see there.
    const inTeam = await prisma.app.findFirst({ where: { md5, teamId } });
    if (inTeam) return inTeam;

    const id = uuidv4();
    const filename = file.name;
    const extension = path.extname(filename).toLowerCase();
    const filepath = path.join(config.appsPath, `${id}${extension}`);

    await fs.writeFile(filepath, file.data);
    const identity = await this.identityOf(file.data, filepath, filename, extension);

    try {
      return await prisma.app.create({
        data: {
          id,
          name: filename,
          filename,
          filepath,
          mimetype: file.mimetype,
          size: file.size,
          packageName: identity.packageName,
          version: identity.version,
          buildNumber: identity.buildNumber,
          platform: identity.platform,
          md5,
          teamId,
        },
      });
    } catch (error: any) {
      await fs.remove(filepath).catch(() => undefined);
      throw error;
    }
  }

  /** The app holding bytes with `md5` that a caller with `teamIds` can see, if any. */
  private async visibleWithMd5(md5: string, teamIds?: string[]) {
    const visible = visibleAppWhere(teamIds);
    return await prisma.app.findFirst({
      where: visible ? { AND: [{ md5 }, visible] } : { md5 },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * The apps a caller with `teamIds` can see (appVisibility.ts) that match
   * every filter given, newest first, each with its team's name for the Team
   * column (`teamIds` as on req.auth: undefined is an admin).
   * With `latest`, only the newest: CI asks for the build to test without
   * knowing its id.
   */
  async findApps(
    teamIds: string[] | undefined,
    filter: AppFilter,
    opts: { latest?: boolean } = {},
  ) {
    const match: Record<string, string> = {};
    if (filter.md5) match.md5 = filter.md5;
    if (filter.packageName) match.packageName = filter.packageName;
    if (filter.platform) match.platform = filter.platform;
    // The plainest query that says it: no filter and an admin is no `where`.
    const parts = [
      ...(Object.keys(match).length > 0 ? [match] : []),
      ...[visibleAppWhere(teamIds)].filter((w) => w !== undefined),
    ];
    return await prisma.app.findMany({
      where: parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { AND: parts },
      include: { team: { select: { id: true, name: true } } },
      // id breaks a tie between two apps stored in one millisecond.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(opts.latest ? { take: 1 } : {}),
    });
  }

  /**
   * What the uploaded app says it is (appIdentity.ts). An APK is read with
   * adb, an `.ipa` or zipped `.app` from its own Info.plist. One that can't be
   * read is stored all the same, with a warning, and without those fields.
   */
  private async identityOf(
    data: Buffer,
    filepath: string,
    filename: string,
    extension: string,
  ): Promise<AppIdentity> {
    if (extension === '.apk') {
      try {
        const adb = await ADB.createADB({});
        return apkIdentity(await adb.getApkInfo(filepath));
      } catch (err) {
        log.warn(`Failed to extract metadata for APK ${filename}: ${err}`);
        return { platform: 'android' };
      }
    }
    if (extension === '.ipa' || extension === '.zip') {
      try {
        const identity = await iosArchiveIdentity(data);
        if (identity) return identity;
        if (extension === '.ipa') log.warn(`No app Info.plist in ${filename}`);
      } catch (err) {
        log.warn(`Failed to read the Info.plist of ${filename}: ${err}`);
      }
      return extension === '.ipa' ? { platform: 'ios' } : {};
    }
    return {};
  }
}

export const APP_SERVICE = new AppService();

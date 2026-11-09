import yauzl from 'yauzl';
import bplist from 'bplist-parser';
// plist ships no types, and ts-node doesn't load a standalone declaration file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plist = require('plist') as { parse(xml: string): unknown };

/**
 * What an uploaded app says it is: its id (an Android package or an iOS
 * bundle id), its version and the build within that version (ENH-16).
 * Through 2.26 Xenon read an APK's package and version with adb and nothing
 * from an iOS app, so the library couldn't say which iOS build it held.
 */
export interface AppIdentity {
  platform?: 'android' | 'ios';
  packageName?: string;
  version?: string;
  buildNumber?: string;
}

/** The largest Info.plist read; a real one is a few KB. */
export const MAX_INFO_PLIST_BYTES = 1024 * 1024;

/**
 * The app's own Info.plist in an `.ipa` (`Payload/<name>.app/Info.plist`)
 * or a zipped simulator build (`<name>.app/Info.plist`), never a nested
 * framework's, extension's or watch app's.
 */
const OWN_INFO_PLIST = /^(?:Payload\/)?[^/]+\.app\/Info\.plist$/;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

/** The identity in an Info.plist's bytes, binary or XML. Throws when it can't be read. */
export function infoPlistIdentity(bytes: Buffer): AppIdentity {
  const parsed: any =
    bytes.subarray(0, 8).toString('latin1') === 'bplist00'
      ? bplist.parseBuffer(bytes)[0]
      : plist.parse(bytes.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Info.plist is not a dictionary');
  }
  return {
    platform: 'ios',
    packageName: text(parsed.CFBundleIdentifier),
    version: text(parsed.CFBundleShortVersionString),
    buildNumber: text(parsed.CFBundleVersion),
  };
}

/**
 * An iOS app's identity from the bytes of its `.ipa` or zipped `.app`, or
 * undefined when the archive holds no app Info.plist. Throws when the
 * archive or the plist can't be read.
 */
export function iosArchiveIdentity(archive: Buffer): Promise<AppIdentity | undefined> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError ?? new Error('not a zip archive'));
      let settled = false;
      const finish = (error: Error | undefined, identity?: AppIdentity) => {
        if (settled) return;
        settled = true;
        zip.close();
        if (error) reject(error);
        else resolve(identity);
      };
      zip.on('error', (error) => finish(error));
      zip.on('end', () => finish(undefined, undefined));
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!OWN_INFO_PLIST.test(entry.fileName)) return zip.readEntry();
        if (entry.uncompressedSize > MAX_INFO_PLIST_BYTES) {
          return finish(new Error(`Info.plist is ${entry.uncompressedSize} bytes`));
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return finish(streamError ?? new Error('unreadable entry'));
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_INFO_PLIST_BYTES) {
              stream.destroy();
              return finish(new Error('Info.plist is too large'));
            }
            chunks.push(chunk);
          });
          stream.on('error', (error) => finish(error));
          stream.on('end', () => {
            try {
              finish(undefined, infoPlistIdentity(Buffer.concat(chunks)));
            } catch (error: any) {
              finish(error);
            }
          });
        });
      });
      zip.readEntry();
    });
  });
}

/** An APK's identity from what appium-adb's `getApkInfo` answers. */
export function apkIdentity(info: any): AppIdentity {
  const versionCode =
    info?.versionCode === undefined || info?.versionCode === null
      ? undefined
      : String(info.versionCode);
  return {
    platform: 'android',
    packageName: text(info?.name),
    version: text(info?.versionName) ?? versionCode,
    buildNumber: text(versionCode),
  };
}

import { Service } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/device-store';
import log from '../../logger';
import { typeFamilyOf } from './elementType';
import {
  chooseFingerprint,
  FingerprintScope,
  fingerprintKey,
  parseFingerprintKey,
  PlatformFamily,
  platformFamilyOf,
  readKeys,
  StoredFingerprint,
} from './fingerprintKey';

export interface LocatorSignature {
  selector: string;
  strategy: string;
  attributes: Record<string, string>;
  nodeName: string;
  path?: any; // JSON representation of resiliotree.Path
  lastSeen: number;
}

/** A stored fingerprint as `listSignatures` describes it. */
export interface PlatformSignature extends LocatorSignature {
  /** The platform it is for: its key's, or a legacy row's type's (null when that says none). */
  platform: PlatformFamily | null;
  /** Stored under the bare selector (written through 2.36, or by a session of neither platform). */
  legacy: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

@Service()
export class HealEtalonService {
  private logger = log.scope('HealEtalonService');
  private store = DeviceStoreFactory.getHealEtalonStore();

  constructor() {}

  /**
   * Saves the fingerprint under the session's platform's key
   * (fingerprintKey.ts), or the bare selector when the platform is neither.
   * Whether it was saved: learning marks a selector learnt again only then.
   */
  async saveSignature(
    strategy: string,
    selector: string,
    node: any,
    path?: any,
    platformName?: unknown,
  ): Promise<boolean> {
    try {
      const attributes: Record<string, string> = {};

      // Extract identifying attributes. Not `value`: on a text field it is
      // what the test typed, an email or a name, which says nothing about
      // which field it is.
      const nodeAttrs = node.attributes || [];
      const anchorNames = [
        'content-desc',
        'resource-id',
        'text',
        'name',
        'id',
        'hint',
        'label',
        'accessibility-id',
        'x',
        'y',
        'width',
        'height',
      ];

      for (let i = 0; i < nodeAttrs.length; i++) {
        const attr = nodeAttrs[i];
        if (anchorNames.includes(attr.name.toLowerCase())) {
          attributes[attr.name.toLowerCase()] = attr.value;
        }
      }

      const signature: LocatorSignature = {
        selector: fingerprintKey(platformFamilyOf(platformName), strategy, selector),
        strategy,
        attributes,
        nodeName: node.nodeName || 'Unknown',
        path,
        lastSeen: Date.now(),
      };

      await this.store.saveSignature(signature);
      this.logger.debug(`Saved signature for locator: ${signature.selector}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to save signature: ${err.message}`);
      return false;
    }
  }

  /**
   * The fingerprint a session reads for a find: its platform's under the
   * find's strategy, else the legacy row when that serves it
   * (fingerprintKey.ts). Without a platform of either family, the legacy row.
   * The answer's `selector` is the selector, never the stored key.
   */
  async getSignature(selector: string, scope?: FingerprintScope): Promise<LocatorSignature | null> {
    try {
      const family = platformFamilyOf(scope?.platformName);
      if (!family) return await this.store.getSignature(selector);
      const strategy = String(scope?.strategy ?? '');
      const rows: StoredFingerprint[] = await this.store.getSignatures(
        readKeys(family, strategy, selector),
      );
      const chosen = chooseFingerprint(rows, family, strategy, selector);
      return chosen ? ({ ...chosen, selector } as unknown as LocatorSignature) : null;
    } catch (err: any) {
      this.logger.error(`Failed to retrieve signature: ${err.message}`);
      return null;
    }
  }

  /**
   * Every fingerprint this server holds for a selector, one per platform a
   * session would read, newest first: under `strategy`, or any strategy when
   * it is empty. A legacy row is listed when no row of its platform and
   * strategy has replaced it for reading.
   */
  async listSignatures(selector: string, strategy = ''): Promise<PlatformSignature[]> {
    const rows: StoredFingerprint[] = strategy
      ? await this.store.getSignatures([
          fingerprintKey('android', strategy, selector),
          fingerprintKey('ios', strategy, selector),
          selector,
        ])
      : await this.store.getSignaturesOfSelector(selector);
    const keyed = rows
      .map((row) => ({ row, key: parseFingerprintKey(row.selector) }))
      .filter(({ row, key }) => (key ? key.selector === selector : row.selector === selector));
    const out: PlatformSignature[] = [];
    for (const { row, key } of keyed) {
      if (key) {
        out.push({ ...(row as any), selector, platform: key.family, legacy: false });
        continue;
      }
      if (strategy && row.strategy && row.strategy !== strategy) continue;
      const platform = typeFamilyOf(row.nodeName);
      const replaced = keyed.some(
        ({ key: other }) =>
          other !== null &&
          other.family === platform &&
          (!row.strategy || other.strategy === row.strategy),
      );
      if (!replaced) out.push({ ...(row as any), selector, platform, legacy: true });
    }
    return out.sort((a, b) => writtenAt(b) - writtenAt(a));
  }
}

function writtenAt(signature: PlatformSignature): number {
  for (const value of [signature.updatedAt, signature.lastSeen]) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const t = new Date(value).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  return 0;
}

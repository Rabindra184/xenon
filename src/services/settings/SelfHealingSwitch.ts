import { Container, Service } from 'typedi';
import log from '../../logger';
import { IPluginArgs } from '../../interfaces/IPluginArgs';
import { WebConfigService } from '../../data-service/web-config-service';
import { selfHealingEnabled } from './labSettings';

/** How long after a failed read of the saved value it is read again. */
export const SELF_HEALING_RELOAD_MS = 30_000;

/**
 * Where the saved value stands:
 * - `not-loaded`: before the boot's load (no command arrives then);
 * - `failed`: the load could not read it, and it is read again every
 *   SELF_HEALING_RELOAD_MS until it can;
 * - `loaded`: read (or saved since), `saved` undefined when nothing is saved.
 */
type SavedValue =
  | { state: 'not-loaded' }
  | { state: 'failed' }
  | { state: 'loaded'; saved: boolean | undefined };

/**
 * Whether self-healing is on, for the command interceptor, which asks at every
 * command and so must never read the database.
 *
 * The value saved on the Settings page (the `WebConfig` row `enableSelfHealing`)
 * is kept here, loaded once at boot and replaced when `POST /config` saves it.
 * The rule is the one every lab setting follows (`selfHealingEnabled`): the
 * saved value, else the plugin option the server started with, else on. The
 * interceptor passes the options it was given, so the startup half is always
 * the live one.
 *
 * A boot that can't read the saved value follows the startup option, reads it
 * again every SELF_HEALING_RELOAD_MS until it can, and meanwhile withholds the
 * AI tiers (`withholdsAiTiers`): a lab may have saved healing off to keep its
 * screens from the AI provider. Through 2.36 such a boot ran every tier on the
 * startup option until the next restart.
 *
 * Through 2.13 the toggle was stored nowhere and the interceptor read the
 * startup options alone, so switching healing off in the dashboard did nothing.
 */
@Service()
export class SelfHealingSwitch {
  private value: SavedValue = { state: 'not-loaded' };
  private reloadTimer: NodeJS.Timeout | undefined;
  /** Counts the loads and saves, so a read that finishes after a newer one changes nothing. */
  private generation = 0;

  /** Whether a failed findElement goes on to the healing tiers, now. */
  isEnabled(startup: Partial<IPluginArgs>): boolean {
    const saved = this.value.state === 'loaded' ? this.value.saved : undefined;
    return selfHealingEnabled(startup.enableSelfHealing, saved);
  }

  /**
   * Whether healing must leave out the tiers that send the screen to the AI
   * provider (4 Visual AI, 5 LLM): while the saved value could not be read.
   */
  withholdsAiTiers(): boolean {
    return this.value.state === 'failed';
  }

  /**
   * Reads the saved value, at boot. A database that can't be read leaves the
   * startup option in charge of the tiers that stay on this server, as it
   * does for the cleanup job, and is said once here rather than at every
   * command; it is read again every SELF_HEALING_RELOAD_MS until it can be.
   */
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.stop();
    try {
      const { enableSelfHealing } = await Container.get(WebConfigService).getConfig();
      if (generation !== this.generation) return;
      const wasFailed = this.value.state === 'failed';
      this.value = {
        state: 'loaded',
        saved: typeof enableSelfHealing === 'boolean' ? enableSelfHealing : undefined,
      };
      if (wasFailed)
        log.info('Read the saved self-healing setting; every allowed tier runs again.');
    } catch (err: any) {
      if (generation !== this.generation) return;
      const first = this.value.state !== 'failed';
      this.value = { state: 'failed' };
      if (first) {
        log.warn(
          `Could not read the saved self-healing setting, using the startup option without the AI tiers (Visual AI and LLM) until it can be read; trying again every ${SELF_HEALING_RELOAD_MS / 1000} s: ${err?.message}`,
        );
      } else {
        log.debug(`Still could not read the saved self-healing setting: ${err?.message}`);
      }
      this.reloadTimer = setTimeout(() => {
        this.reloadTimer = undefined;
        void this.load();
      }, SELF_HEALING_RELOAD_MS);
      this.reloadTimer.unref?.();
    }
  }

  /** What `POST /config` just saved, in force for the next command. */
  set(saved: boolean | undefined): void {
    this.generation += 1;
    this.stop();
    this.value = { state: 'loaded', saved };
  }

  /** Stops reading the saved value again (a shutdown, or a spec's end). */
  stop(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = undefined;
  }
}

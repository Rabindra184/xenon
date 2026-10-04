import { Container, Service } from 'typedi';
import log from '../../logger';
import { IPluginArgs } from '../../interfaces/IPluginArgs';
import { WebConfigService } from '../../data-service/web-config-service';
import { selfHealingEnabled } from './labSettings';

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
 * Through 2.13 the toggle was stored nowhere and the interceptor read the
 * startup options alone, so switching healing off in the dashboard did nothing.
 */
@Service()
export class SelfHealingSwitch {
  /** What the dashboard saved; undefined until it is loaded, and when nothing is saved. */
  private saved: boolean | undefined;

  /** Whether a failed findElement goes on to the healing tiers, now. */
  isEnabled(startup: Partial<IPluginArgs>): boolean {
    return selfHealingEnabled(startup.enableSelfHealing, this.saved);
  }

  /**
   * Reads the saved value, once, at boot. A database that can't be read leaves
   * the startup option in charge, as it does for the cleanup job, and is said
   * once here rather than at every command.
   */
  async load(): Promise<void> {
    try {
      const { enableSelfHealing } = await Container.get(WebConfigService).getConfig();
      this.saved = typeof enableSelfHealing === 'boolean' ? enableSelfHealing : undefined;
    } catch (err: any) {
      this.saved = undefined;
      log.warn(
        `Could not read the saved self-healing setting, using the startup option: ${err?.message}`,
      );
    }
  }

  /** What `POST /config` just saved, in force for the next command. */
  set(saved: boolean | undefined): void {
    this.saved = saved;
  }
}

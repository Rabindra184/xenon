import type { ReactNode } from 'react';
import styles from './home.module.css';

const tiers = [
  ['Resilio', 'Stored fingerprints from earlier runs'],
  ['Native', 'Your selector as written, retried with autowait on'],
  ['Fuzzy XML', 'Page source vs the fingerprint'],
  ['OCR', "The element's text on screen"],
  ['Visual AI', 'A screenshot, analysed'],
  ['LLM', 'Page source and selector, reasoned'],
] as const;

// Tiers 4 and 5 are the two that call out to an AI provider.
const FIRST_AI_TIER = 4;

export default function Healing(): ReactNode {
  return (
    <section className={`${styles.section} ${styles.pad}`}>
      <div className={styles.wrap}>
        <p className={styles.label}>Self-healing</p>
        <h2 className={styles.title}>A moved button shouldn't fail the build.</h2>
        <p className={styles.sub}>
          When <span className={styles.mono}>findElement</span> fails, Xenon can first wait out a slow screen, then try
          six strategies, cheapest first. The AI tiers run on your own provider key, or a local model.
        </p>
        <ol className={styles.ladder}>
          {tiers.map(([name, text], tier) => (
            <li key={name} className={`${styles.rung} ${tier >= FIRST_AI_TIER ? styles.rungAi : ''}`}>
              <span className={styles.tier}>TIER {tier}</span>
              <strong>{name}</strong>
              {text}
            </li>
          ))}
        </ol>
        <div className={styles.cheap}>
          <span>← cheap, local</span>
          <span>your AI provider →</span>
        </div>
        <div className={styles.states}>
          <span>
            Then <strong>Selector Health</strong> lists what healed, with a fix to copy in five languages:
          </span>
          <span className={styles.statesFlow}>
            <span className={styles.pill}>To fix</span>
            <span aria-hidden="true">→</span>
            <span className={`${styles.pill} ${styles.pillVerify}`}>Being verified</span>
            <span aria-hidden="true">→</span>
            <span className={`${styles.pill} ${styles.pillFixed}`}>Fixed</span>
          </span>
        </div>
      </div>
    </section>
  );
}

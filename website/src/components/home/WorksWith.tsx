import type { ReactNode } from 'react';
import styles from './home.module.css';

const partners = [
  'Appium 3',
  'UiAutomator2',
  'XCUITest',
  'WebdriverIO',
  'Java client',
  'Python client',
  'Kotlin SDK',
  'Xenon Control for Mac',
  'PostgreSQL',
  'OpenTelemetry',
  'Gemini · OpenAI · Anthropic · Ollama',
];

export default function WorksWith(): ReactNode {
  return (
    <section className={`${styles.section} ${styles.pad}`}>
      <div className={styles.wrap}>
        <h2 className={styles.label}>Works with</h2>
        <ul className={styles.works}>
          {partners.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

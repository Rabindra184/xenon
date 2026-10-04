import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import styles from './home.module.css';

export default function CallToAction(): ReactNode {
  return (
    <section className={`${styles.section} ${styles.cta}`}>
      <div className={styles.wrap}>
        <h2 className={styles.title}>Bring your device lab together.</h2>
        <p className={styles.sub}>
          Open source under the ISC license. Install it on the Appium server you already run.
        </p>
        <div className={styles.buttons}>
          <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/docs/quick-start">
            Read the quick start
          </Link>
          <Link className={`${styles.btn} ${styles.btnSecondary}`} to="/api">
            Browse the API
          </Link>
        </div>
      </div>
    </section>
  );
}

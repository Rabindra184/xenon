import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import CodeBlock from '@theme/CodeBlock';
import ThemedImage from '@theme/ThemedImage';
import styles from './home.module.css';

// The lede doubles as the page's meta description, so it lives here and the
// page imports it.
export const lede =
  'Xenon allocates Android and iOS devices across every machine in the lab, records each session, heals selectors that broke, and lets your team watch and control any phone from the browser.';

export default function Hero(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const repo = siteConfig.customFields?.repo as string;
  const sources = {
    light: useBaseUrl('/img/screens/devices-light.webp'),
    dark: useBaseUrl('/img/screens/devices-dark.webp'),
  };

  return (
    <section className={styles.section}>
      <div className={`${styles.wrap} ${styles.hero}`}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>Appium 3 plugin · open source · self-hosted</p>
          <h1 className={styles.heroTitle}>Your whole mobile device lab, behind one Appium URL.</h1>
          <p className={styles.lede}>{lede}</p>
          <div className={styles.buttons}>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/docs/quick-start">
              Get started
            </Link>
            <Link className={`${styles.btn} ${styles.btnSecondary}`} href={repo}>
              View on GitHub
            </Link>
          </div>
          <div className={styles.install}>
            <CodeBlock language="bash">
              {'appium plugin install --source=npm @xenon-device-management/xenon'}
            </CodeBlock>
          </div>
        </div>
        <div className={styles.frame}>
          <ThemedImage
            className={styles.shot}
            sources={sources}
            alt="Xenon dashboard, Devices page"
            width={1600}
            height={778}
            loading="eager"
            decoding="async"
          />
        </div>
      </div>
    </section>
  );
}

import type { ReactNode } from 'react';
import styles from './home.module.css';

function Chips({ items }: { items: readonly string[] }): ReactNode {
  return (
    <ul className={styles.chips}>
      {items.map((item) => (
        <li key={item} className={styles.chip}>
          {item}
        </li>
      ))}
    </ul>
  );
}

// The arrows only point the way; the boxes say the rest.
const Arrow = (): ReactNode => (
  <div className={styles.arrow} aria-hidden="true">
    →
  </div>
);

export default function HowItFits(): ReactNode {
  return (
    <section className={`${styles.section} ${styles.pad}`}>
      <div className={styles.wrap}>
        <p className={styles.label}>How it fits</p>
        <h2 className={styles.title}>Nothing new for your tests to learn.</h2>
        <p className={styles.sub}>
          Tests keep their Appium client and ask for a device with ordinary capabilities. Xenon runs inside the Appium
          server and does the rest.
        </p>
        <div className={styles.flow}>
          <div className={styles.box}>
            <h3>Your tests</h3>
            <Chips items={['WebdriverIO', 'Java', 'Python', 'Kotlin SDK', 'any Appium client']} />
            <p className={styles.boxNote}>+ CI leases over REST</p>
          </div>
          <Arrow />
          <div className={`${styles.box} ${styles.hub}`}>
            <h3>Hub: Appium 3 + Xenon</h3>
            <p>
              Checks who you are and which devices your team may use, picks a free healthy one, records the session,
              heals selectors. One URL, one set of rules.
            </p>
          </div>
          <Arrow />
          <div className={styles.box}>
            <h3>Nodes and devices</h3>
            <Chips items={['Android phones', 'emulators', 'iPhones', 'iOS simulators']} />
            <p className={styles.boxNote}>on the hub's machine or any node</p>
          </div>
        </div>
        <div className={styles.people}>
          <div className={styles.box}>
            <h3>People, in the browser</h3>
            <p>watch, control, record and reserve devices · review sessions · fix selectors</p>
          </div>
        </div>
      </div>
    </section>
  );
}

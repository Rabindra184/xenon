import type { ReactNode } from 'react';
import styles from './home.module.css';

const jobs = [
  ['Device lab', 'Finds every phone, emulator and simulator; one pool across hub and nodes.'],
  ['Live control', 'Preview, tap, type, install apps and stream Android logs in the browser.'],
  ['Test evidence', 'Video, logs and commands for each session, and CPU and memory charts from Android phones.'],
  ['Self-healing', 'Six strategies find a moved element before the test fails.'],
  ['Built for teams', 'Roles, teams, scoped tokens and a complete API.'],
] as const;

export default function Jobs(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.wrap}>
        <ul className={styles.jobs}>
          {jobs.map(([name, text]) => (
            <li key={name} className={styles.job}>
              <strong>{name}</strong>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

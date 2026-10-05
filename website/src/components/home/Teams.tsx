import type { ReactNode } from 'react';
import styles from './home.module.css';

const cards = [
  [
    'Roles and teams',
    "Super admin, admin and member. Teams decide which devices each person can reach; everything else looks like it doesn't exist.",
  ],
  [
    'Scoped credentials',
    'Access key and token pairs, short-lived bearer tokens, single-use tickets for streams and downloads. A token never outranks its creator.',
  ],
  [
    'Owner-checked sessions',
    'Optional credentials on every Appium command, not just the first, with sessions only their owner can drive.',
  ],
  [
    'Hub and nodes',
    "Every machine's devices behind one URL. Nodes survive a hub restart; the hub forwards, never re-runs, a command.",
  ],
  [
    'Complete API',
    'Every route documented in OpenAPI, with roles, scopes and answers, and JSON errors throughout.',
  ],
  [
    'Self-hosted',
    'Your devices, your network. SQLite built in, one database file per server, and OpenTelemetry traces and logs.',
  ],
] as const;

export default function Teams(): ReactNode {
  return (
    <section className={`${styles.section} ${styles.pad}`}>
      <div className={styles.wrap}>
        <p className={styles.label}>Built for teams</p>
        <h2 className={styles.title}>Shared, governed, and yours to run.</h2>
        <ul className={styles.cards}>
          {cards.map(([name, text]) => (
            <li key={name} className={styles.card}>
              <h3>{name}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import type { ReactNode } from 'react';
import CodeBlock from '@theme/CodeBlock';
import styles from './home.module.css';

const steps = [
  {
    title: 'Install the plugin and a driver',
    language: 'bash',
    code: `appium plugin install --source=npm \\
  @xenon-device-management/xenon
appium driver install uiautomator2`,
  },
  {
    title: 'Start Appium with the dashboard',
    language: 'bash',
    code: `appium server --use-plugins=xenon \\
  --plugin-xenon-platform=both \\
  --plugin-xenon-enable-dashboard`,
  },
  {
    title: 'Point a test at it',
    language: 'js',
    code: `'xe:options': {
  accessKey: process.env.XENON_ACCESS_KEY,
  token: process.env.XENON_TOKEN,
},
'xe:build': 'nightly',`,
  },
] as const;

export default function QuickStart(): ReactNode {
  return (
    <section className={`${styles.section} ${styles.pad}`}>
      <div className={styles.wrap}>
        <p className={styles.label}>Quick start</p>
        <h2 className={styles.title}>Running in three commands.</h2>
        <ol className={styles.steps}>
          {steps.map(({ title, language, code }, index) => (
            <li key={title} className={styles.step}>
              <div className={styles.stepHead}>
                <i className={styles.stepNumber}>{index + 1}</i>
                {title}
              </div>
              <CodeBlock language={language}>{code}</CodeBlock>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

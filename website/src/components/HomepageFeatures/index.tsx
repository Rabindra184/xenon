import type { ReactNode } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

import { ShieldCheck, Zap, BarChart3, type LucideIcon } from 'lucide-react';

type FeatureItem = {
  title: string;
  Icon: LucideIcon;
  description: ReactNode;
  color: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Autonomous Self-Healing',
    Icon: ShieldCheck,
    color: '#22C55E',
    description: (
      <>
        Powered by <b>ResilioTree</b>. Xenon automatically detects and recovers hardware from bad states
        and flaky locators in real-time, ensuring zero-downtime execution.
      </>
    ),
  },
  {
    title: 'AI Root-Cause Analysis',
    Icon: Zap,
    color: '#EAB308',
    description: (
      <>
        Strategic intelligence that goes beyond simple logs. Xenon uses <b>Florence-2</b> and <b>Phi-series</b>
        SLMs to perform post-mortem diagnostics on failed sessions.
      </>
    ),
  },
  {
    title: 'Enterprise Observability',
    Icon: BarChart3,
    color: '#3B82F6',
    description: (
      <>
        Engineered for scale. Distributed <b>OpenTelemetry</b> tracing, high-fidelity MJPEG streaming,
        and real-time performance profiling for industrial-grade labs.
      </>
    ),
  },
];

function Feature({ title, Icon, description, color }: FeatureItem) {
  return (
    <div className={clsx('col col--4', styles.featureCard)}>
      <div className={styles.iconWrapper} style={{ backgroundColor: `${color}15` }}>
        <Icon className={styles.featureIcon} style={{ color }} size={48} />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
        <p className={styles.featureDescription}>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}


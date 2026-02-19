import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {
  ShieldCheck, Brain, Activity, Eye, MonitorSmartphone, Shield,
  Cpu, Wifi, HeartPulse, LayoutDashboard, Terminal, Bell,
  Cloud, Zap, Database, GitBranch, ArrowRight,
} from 'lucide-react';

import styles from './index.module.css';

/* ─────────────────────────────────────────────
   SECTION 1 — Hero
   ───────────────────────────────────────────── */
function HeroSection() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className="container">
        <div className={styles.heroInner}>
          <div className={styles.heroLogoWrap}>
            <img src="img/logo-stacked.svg" alt="Xenon Logo" className={styles.heroLogo} />
          </div>
          <Heading as="h1" className={styles.heroTitle}>
            {siteConfig.title}
          </Heading>
          <p className={styles.heroSubtitle}>
            <strong>Autonomous</strong> Mobile Infrastructure for <strong>Enterprise</strong> Teams
          </p>
          <p className={styles.heroTagline}>
            Self-healing device orchestration, AI-powered diagnostics, and industrial-grade observability — all from a single Appium plugin.
          </p>
          <div className={styles.heroCta}>
            <Link className="button button--primary button--lg" to="/docs/">
              Get Started
            </Link>
            <Link className="button button--outline button--lg" to="https://github.com/Rabindra184/xenon">
              View on GitHub
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────
   SECTION 2 — Core Pillars (6-Card Grid)
   ───────────────────────────────────────────── */
const pillars = [
  {
    Icon: ShieldCheck, color: '#22C55E', title: 'Autonomous Self-Healing',
    desc: 'Powered by ResilioTree — repairs broken locators in real-time using semantic AI matching. Tests pass even when developers change class names.',
  },
  {
    Icon: Brain, color: '#A78BFA', title: 'AI Root-Cause Analysis',
    desc: 'Multimodal triage with Phi-4, Gemini & Florence-2. Captures screenshots + logs and instantly diagnoses failure root cause.',
  },
  {
    Icon: Activity, color: '#3B82F6', title: 'Enterprise Observability',
    desc: 'Native OpenTelemetry integration — every session gets a Trace ID. Visualize flows in Jaeger, Honeycomb, or Grafana.',
  },
  {
    Icon: Eye, color: '#F59E0B', title: 'Omni-Vision',
    desc: 'Visual element grounding via Florence-2. Interact with devices through visual intelligence, not just DOM queries.',
  },
  {
    Icon: MonitorSmartphone, color: '#EC4899', title: 'Live Device Streaming',
    desc: 'High-fidelity MJPEG streaming with hardware-accelerated Fragmented MP4 video recording for every session.',
  },
  {
    Icon: Shield, color: '#14B8A6', title: 'Enterprise Security',
    desc: 'RBAC with 4 roles, OIDC/SAML identity federation, visual PII masking (GDPR/SOC2), and mTLS encryption.',
  },
];

function CorePillars() {
  return (
    <section className={styles.pillars}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2" className={styles.sectionTitle}>Core Pillars</Heading>
          <p className={styles.sectionSubtitle}>
            Six foundational capabilities that make Xenon the most advanced mobile automation platform.
          </p>
        </div>
        <div className={styles.pillarGrid}>
          {pillars.map(({ Icon, color, title, desc }) => (
            <div key={title} className={styles.pillarCard}>
              <div className={styles.pillarIcon} style={{ backgroundColor: `${color}12` }}>
                <Icon size={28} style={{ color }} />
              </div>
              <h3 className={styles.pillarTitle}>{title}</h3>
              <p className={styles.pillarDesc}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   SECTION 3 — Platform Capabilities (Z-Pattern)
   ───────────────────────────────────────────── */
const infraFeatures = [
  { Icon: Cpu, label: 'Auto-Discovery', detail: 'Instant detection of Android devices, iOS Simulators & Real devices' },
  { Icon: Zap, label: 'Smart Allocation', detail: 'Priority-based device locking with cross-cell failover' },
  { Icon: HeartPulse, label: 'Health Watchdog', detail: 'Thermal throttling, battery analytics & USB bus integrity monitoring' },
  { Icon: Wifi, label: 'Network Conditioning', detail: 'Simulate 4G, 3G, Edge, and Offline directly from capabilities' },
];

const dxFeatures = [
  { Icon: Terminal, label: 'Execute Script API', detail: 'setSessionStatus, captureEvidence, addTag, debug — all via xenon: namespace' },
  { Icon: LayoutDashboard, label: 'Real-Time Dashboard', detail: 'WebSocket-powered live view of devices, sessions & AI diagnostics' },
  { Icon: Bell, label: 'Notifications', detail: 'Slack & Email alerts for session failures and infrastructure events' },
  { Icon: Database, label: 'Audit Trail', detail: 'Full request logging with session replay and command history' },
];

function PlatformCapabilities() {
  return (
    <section className={styles.capabilities}>
      <div className="container">
        {/* Row A: Infrastructure */}
        <div className={styles.capRow}>
          <div className={styles.capText}>
            <span className={styles.capLabel}>Infrastructure Intelligence</span>
            <Heading as="h2" className={styles.capTitle}>
              Devices that manage themselves
            </Heading>
            <p className={styles.capDesc}>
              Xenon treats devices as shared resources in a global mesh. Auto-discovery, health monitoring, and smart allocation ensure your infrastructure runs autonomously.
            </p>
            <div className={styles.capFeatures}>
              {infraFeatures.map(({ Icon, label, detail }) => (
                <div key={label} className={styles.capFeature}>
                  <Icon size={18} className={styles.capFeatureIcon} />
                  <div>
                    <strong>{label}</strong>
                    <span>{detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.capVisual}>
            <div className={styles.capGlowCard}>
              <pre className={styles.capCode}>
                {`// Auto-discovered device allocation
{
  "platformName": "iOS",
  "xe:priority": "high",
  "xe:network_profile": "4G",
  "xe:max_thermal_status": "Fair"
}`}
              </pre>
            </div>
          </div>
        </div>

        {/* Row B: Developer Experience */}
        <div className={clsx(styles.capRow, styles.capRowReverse)}>
          <div className={styles.capText}>
            <span className={styles.capLabel}>Developer Experience</span>
            <Heading as="h2" className={styles.capTitle}>
              Built for engineers, by engineers
            </Heading>
            <p className={styles.capDesc}>
              Rich APIs, real-time dashboards, and integrated notifications. Every insight is one command away.
            </p>
            <div className={styles.capFeatures}>
              {dxFeatures.map(({ Icon, label, detail }) => (
                <div key={label} className={styles.capFeature}>
                  <Icon size={18} className={styles.capFeatureIcon} />
                  <div>
                    <strong>{label}</strong>
                    <span>{detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.capVisual}>
            <div className={styles.capGlowCard}>
              <pre className={styles.capCode}>
                {`// Runtime test metadata
await driver.executeScript(
  'xenon: setSessionStatus',
  [{ status: 'passed',
     reason: 'Checkout flow verified' }]
);

await driver.executeScript(
  'xenon: captureEvidence',
  ['Payment confirmation screen']
);`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   SECTION 4 — Cloud & Scale
   ───────────────────────────────────────────── */
const providers = [
  'BrowserStack', 'SauceLabs', 'LambdaTest', 'HeadSpin', 'pCloudy',
];

function CloudScale() {
  return (
    <section className={styles.cloud}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2" className={styles.sectionTitle}>Run Anywhere</Heading>
          <p className={styles.sectionSubtitle}>
            Your infrastructure, any cloud. Xenon integrates with 5+ cloud device providers — or runs entirely on-premise.
          </p>
        </div>
        <div className={styles.providerGrid}>
          {providers.map((name) => (
            <div key={name} className={styles.providerBadge}>
              <Cloud size={20} />
              <span>{name}</span>
            </div>
          ))}
        </div>
        <div className={styles.cloudFeatures}>
          <div className={styles.cloudFeature}>
            <GitBranch size={20} />
            <div>
              <strong>Cellular Architecture</strong>
              <p>Regional cells (US-West, EU-Central) with shared PostgreSQL state for global scale.</p>
            </div>
          </div>
          <div className={styles.cloudFeature}>
            <Zap size={20} />
            <div>
              <strong>gRPC/NATS Event Bus</strong>
              <p>High-performance messaging for cross-node command routing and distributed state sync.</p>
            </div>
          </div>
          <div className={styles.cloudFeature}>
            <Shield size={20} />
            <div>
              <strong>Disaster Recovery</strong>
              <p>Automatic session re-routing. Stateless Hubs with persistent registries.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   SECTION 5 — Technology Stack (Badge Row)
   ───────────────────────────────────────────── */
const techStack = [
  'Appium', 'Node.js', 'TypeScript', 'gRPC', 'PostgreSQL',
  'OpenTelemetry', 'WebSocket', 'NATS', 'Prisma', 'Florence-2',
];

function TechStack() {
  return (
    <section className={styles.techStack}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2" className={styles.sectionTitle}>Built With</Heading>
        </div>
        <div className={styles.techBadges}>
          {techStack.map((tech) => (
            <span key={tech} className={styles.techBadge}>{tech}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   SECTION 6 — CTA Footer Banner
   ───────────────────────────────────────────── */
function CtaBanner() {
  return (
    <section className={styles.cta}>
      <div className="container">
        <Heading as="h2" className={styles.ctaTitle}>
          Ready to modernize your mobile lab?
        </Heading>
        <p className={styles.ctaDesc}>
          Get started in minutes. Xenon installs as a single Appium plugin.
        </p>
        <div className={styles.ctaButtons}>
          <Link className="button button--primary button--lg" to="/docs/setup">
            Quick Start Guide <ArrowRight size={18} style={{ marginLeft: 8 }} />
          </Link>
          <Link className="button button--outline button--lg" to="https://github.com/Rabindra184/xenon">
            Star on GitHub
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   PAGE ASSEMBLY
   ───────────────────────────────────────────── */
export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} – Intelligent Mobile Infrastructure`}
      description="Self-healing, AI-powered device orchestration platform for Appium. Scalable, reliable, and enterprise-ready.">
      <HeroSection />
      <main>
        <CorePillars />
        <PlatformCapabilities />
        <CloudScale />
        <TechStack />
        <CtaBanner />
      </main>
    </Layout>
  );
}

import type { ReactNode } from 'react';
import Layout from '@theme/Layout';
import CallToAction from '../components/home/CallToAction';
import FeatureRows from '../components/home/FeatureRow';
import Healing from '../components/home/Healing';
import Hero, { lede } from '../components/home/Hero';
import HowItFits from '../components/home/HowItFits';
import Jobs from '../components/home/Jobs';
import QuickStart from '../components/home/QuickStart';
import Teams from '../components/home/Teams';
import WorksWith from '../components/home/WorksWith';

export default function Home(): ReactNode {
  return (
    <Layout title="Mobile device lab for Appium" description={lede}>
      <main>
        <Hero />
        <Jobs />
        <HowItFits />
        <FeatureRows />
        <Healing />
        <Teams />
        <WorksWith />
        <QuickStart />
        <CallToAction />
      </main>
    </Layout>
  );
}

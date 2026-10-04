import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

// Placeholder: the home page is replaced when the new design lands.
export default function Home(): ReactNode {
  return (
    <Layout title="Xenon">
      <main className="container margin-vert--xl">
        <h1>Xenon</h1>
        <Link to="/docs/">Read the docs</Link>
      </main>
    </Layout>
  );
}

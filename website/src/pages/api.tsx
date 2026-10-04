import { lazy, Suspense, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { useColorMode } from '@docusaurus/theme-common';
import Layout from '@theme/Layout';

// The API reference: Scalar, reading the OpenAPI document that
// scripts/generate.mjs writes to static/openapi.json. It is read-only; the site
// has no server of its own to send a request to.
//
// Scalar is large (several MB of script and 229 KB of CSS), so it is
// loaded here and nowhere else: the import()s below are chunks of their own
// that only this page asks for, once the page is in the browser. Its CSS is kept
// out of the site-wide styles.css by apiReferenceStylesOnlyOnItsPage in
// docusaurus.config.ts.
const ApiReference = lazy(async () => {
  const [{ ApiReferenceReact }] = await Promise.all([
    import('@scalar/api-reference-react'),
    import('@scalar/api-reference-react/style.css'),
  ]);
  return { default: ApiReferenceReact };
});

const loading = <p className="container margin-vert--lg">Loading the API reference…</p>;

function Reference(): ReactNode {
  const { colorMode } = useColorMode();
  const url = useBaseUrl('/openapi.json');

  // Scalar marks <body> with the mode it is in and leaves the mark behind when
  // the page goes. Left there, it would keep the browser's own controls and
  // scrollbars in that mode on every page opened afterwards.
  useEffect(
    () => () => {
      document.body.classList.remove('dark-mode', 'light-mode');
    },
    [],
  );

  const configuration = useMemo(
    () => ({
      url,
      // The theme follows the site's. Scalar's own toggle is hidden.
      forceDarkModeState: colorMode,
      hideDarkModeToggle: true,
      hideTestRequestButton: true,
      hideClientButton: true,
      // The site loads Inter itself.
      withDefaultFonts: false,
      // The document's own server is a relative path, which the docs host
      // would answer to: examples would point at this site, not at the
      // reader's Xenon server.
      servers: [
        {
          url: 'https://{host}/xenon',
          description: 'Your Xenon server',
          variables: { host: { default: 'your-xenon-host' } },
        },
      ],
    }),
    [url, colorMode],
  );

  return (
    <Suspense fallback={loading}>
      {/* Scalar reads forceDarkModeState once, when it starts, so a change of
          the site's theme starts it again. */}
      <ApiReference key={colorMode} configuration={configuration} />
    </Suspense>
  );
}

export default function Api(): ReactNode {
  return (
    <Layout
      title="API reference"
      description="The REST API of a Xenon server: devices, sessions, device control, recordings, selector health and administration."
    >
      <BrowserOnly fallback={loading}>{() => <Reference />}</BrowserOnly>
    </Layout>
  );
}

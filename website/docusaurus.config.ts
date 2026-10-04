import fs from 'node:fs';
import path from 'node:path';
import { themes as prismThemes } from 'prism-react-renderer';
import type { Config, Plugin } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

// The version shown in the navbar is the plugin's own, so it never drifts.
const { version } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
) as { version: string };

const repo = 'https://github.com/Rabindra184/xenon';

// Docusaurus puts every stylesheet into one styles.css that each page loads, so
// Scalar's 229 KB of CSS, imported by the API page only, would still reach all
// of them. This takes Scalar's out of that file: it then travels with the API
// page's own chunk, which only /api asks for.
//
// It leans on how Docusaurus 3.10 splits CSS (a cache group named `styles`), so
// both ends are checked: the group must still be there, and no styles.css in
// the finished build may hold Scalar's rules. A change in Docusaurus then
// fails the build instead of quietly adding 229 KB to every page.
function apiReferenceStylesOnlyOnItsPage(): Plugin {
  return {
    name: 'api-reference-styles-only-on-its-page',
    configureWebpack(config, isServer) {
      if (isServer) return {};
      const groups = config.optimization?.splitChunks
        ? (config.optimization.splitChunks.cacheGroups ?? {})
        : {};
      if (!('styles' in groups)) {
        throw new Error(
          "apiReferenceStylesOnlyOnItsPage: Docusaurus's webpack config has no 'styles' cache " +
            "group any more, so Scalar's CSS can't be kept out of the site-wide styles.css. " +
            'Update this plugin in docusaurus.config.ts.',
        );
      }
      return {
        optimization: {
          splitChunks: {
            cacheGroups: {
              styles: {
                test: (module: { identifier(): string }) =>
                  !module.identifier().includes('@scalar'),
              },
            },
          },
        },
      };
    },
    async postBuild({ outDir }) {
      const cssDir = path.join(outDir, 'assets', 'css');
      const siteWide = fs.readdirSync(cssDir).filter((f) => /^styles\..*\.css$/.test(f));
      if (siteWide.length === 0) {
        throw new Error(`apiReferenceStylesOnlyOnItsPage: no styles.*.css in ${cssDir} to check.`);
      }
      for (const file of siteWide) {
        const css = fs.readFileSync(path.join(cssDir, file), 'utf8');
        // Scalar's own sheet names its root class and its CSS layers; the
        // site's custom.css deliberately uses neither.
        if (css.includes('.scalar-app') || css.includes('@layer scalar-')) {
          throw new Error(
            `apiReferenceStylesOnlyOnItsPage: ${file}, which every page loads, contains ` +
              "Scalar's CSS. It should only be in the API page's own chunk. Check that this " +
              'plugin still matches how Docusaurus splits CSS, and that nothing else imports ' +
              '@scalar/api-reference-react/style.css.',
          );
        }
      }
    },
  };
}

const config: Config = {
  title: 'Xenon',
  tagline: 'Your whole mobile device lab, behind one Appium URL.',
  favicon: 'img/favicon-premium.svg',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
    // 3.10's v4 shortcut also turns on the Rspack bundler, which needs
    // @docusaurus/faster. The site builds with the default bundler.
    faster: false,
  },

  // Set the production url of your site here
  url: 'https://xenon-6e6.pages.dev',
  // Set the /<baseUrl>/ pathname under which your site is served
  baseUrl: '/',

  // GitHub pages deployment config.
  organizationName: 'Rabindra184', // Usually your GitHub org/user name.
  projectName: 'xenon', // Usually your repo name.

  onBrokenLinks: 'throw',

  customFields: {
    version,
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  clientModules: ['./src/clientModules/fonts.ts'],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: `${repo}/tree/main/website/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/docs',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  markdown: {
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  plugins: [
    apiReferenceStylesOnlyOnItsPage,
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          { from: '/docs/setup', to: '/docs/quick-start' },
          { from: '/docs/remote-execution', to: '/docs/hub-and-nodes' },
          { from: '/docs/server-args', to: '/docs/configuration' },
          { from: '/docs/ai-features', to: '/docs/ai-providers' },
          { from: '/docs/omni-inspector', to: '/docs/inspector' },
          { from: '/docs/enterprise-security', to: '/docs/authentication' },
          { from: '/docs/Xenon-Kotlin-SDK-Specs', to: '/docs/kotlin-sdk' },
          { from: '/docs/design-system', to: '/docs/' },
          { from: '/docs/cloud', to: '/docs/' },
          { from: '/markdown-page', to: '/' },
          { from: '/blog', to: '/docs/release-notes' },
          { from: '/blog/xenon-v2', to: '/docs/release-notes' },
          { from: '/blog/archive', to: '/docs/release-notes' },
          { from: '/blog/tags', to: '/docs/release-notes' },
          { from: '/blog/authors', to: '/docs/release-notes' },
        ],
      },
    ],
  ],

  themeConfig: {
    // The social card arrives with the home page; Docusaurus does not link-check it.
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Xenon',
      logo: {
        alt: 'Xenon logo',
        src: 'img/logo-premium.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        { to: '/api', label: 'API', position: 'left' },
        { to: '/docs/release-notes', label: 'Release notes', position: 'left' },
        {
          to: '/docs/release-notes',
          label: `v${version}`,
          position: 'right',
          className: 'navbar-version',
        },
        {
          href: repo,
          label: 'GitHub',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub',
        },
      ],
    },
    footer: {
      style: 'dark',
      logo: {
        alt: 'Xenon logo',
        src: 'img/logo-premium.svg',
        height: 32,
      },
      links: [
        {
          title: 'Get started',
          items: [
            { label: 'Quick start', to: '/docs/quick-start' },
            { label: 'Installation', to: '/docs/installation' },
            { label: 'Upgrading', to: '/docs/upgrading' },
          ],
        },
        {
          title: 'Run the lab',
          items: [
            { label: 'Hub and nodes', to: '/docs/hub-and-nodes' },
            { label: 'Teams', to: '/docs/teams' },
            { label: 'Production deployment', to: '/docs/deployment' },
          ],
        },
        {
          title: 'Reference',
          items: [
            { label: 'Configuration', to: '/docs/configuration' },
            { label: 'Release notes', to: '/docs/release-notes' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: repo },
            { label: 'Issues', href: `${repo}/issues` },
            { label: 'Security policy', href: `${repo}/blob/main/SECURITY.md` },
            {
              label: 'npm package',
              href: 'https://www.npmjs.com/package/@xenon-device-management/xenon',
            },
          ],
        },
      ],
      copyright: `Released under the ISC License · © ${new Date().getFullYear()} Xenon`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'kotlin', 'java', 'python', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

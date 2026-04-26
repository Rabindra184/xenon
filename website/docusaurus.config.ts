import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Xenon',
  tagline: 'Self-Healing Intelligent Mobile Infrastructure',
  favicon: 'img/favicon-premium.svg',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://xenon-6e6.pages.dev',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  organizationName: 'Rabindra184', // Usually your GitHub org/user name.
  projectName: 'xenon', // Usually your repo name.

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Rabindra184/xenon/tree/main/website/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/Rabindra184/xenon/tree/main/website/',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: ['@docusaurus/theme-mermaid'],
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themeConfig: {
    announcementBar: {
      id: 'network_interceptor_launch',
      content:
        'New: <a href="/docs/network-interceptor"><b>Network Interceptor</b></a> — capture, mock, and rewrite device traffic without changing your app or test code.',
      backgroundColor: '#15803D',
      textColor: '#FFFFFF',
      isCloseable: true,
    },
    navbar: {
      title: 'Xenon',
      logo: {
        alt: 'Xenon Logo',
        src: 'img/logo-premium.svg',
      },

      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        { to: '/blog', label: 'Release Notes', position: 'left' },
        {
          href: 'https://github.com/Rabindra184/xenon',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Quick Start',
              to: '/docs/setup',
            },
            {
              label: 'Deployment Guide',
              to: '/docs/deployment',
            },
            {
              label: 'Configuration',
              to: '/docs/server-args',
            },
          ],
        },
        {
          title: 'Intelligence',
          items: [
            {
              label: 'AI Features',
              to: '/docs/ai-features',
            },
            {
              label: 'Self-Healing Engine',
              to: '/docs/self-healing',
            },
            {
              label: 'Omni-Vision',
              to: '/docs/omni-vision',
            },
          ],
        },
        {
          title: 'Community & Support',
          items: [
            {
              label: 'GitHub Issues',
              href: 'https://github.com/Rabindra184/xenon/issues',
            },
            {
              label: 'X (Twitter)',
              href: 'https://x.com/rabindra_biswal',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/Rabindra184/xenon',
            },
          ],
        },
      ],

      copyright: `Copyright © ${new Date().getFullYear()} Xenon Platform. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'kotlin'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

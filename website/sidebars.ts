import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Get started',
      collapsed: false,
      items: ['index', 'quick-start', 'installation', 'xenon-control', 'upgrading'],
    },
    {
      type: 'category',
      label: 'Run the lab',
      collapsed: false,
      items: [
        'devices',
        'hub-and-nodes',
        'teams',
        'device-control',
        'recordings',
        'deployment',
        'retention',
        'notifications',
      ],
    },
    {
      type: 'category',
      label: 'Write tests',
      collapsed: false,
      items: [
        'capabilities',
        'execute-commands',
        'leases',
        'kotlin-sdk',
        'autowait',
        'network-conditioning',
        'network-interceptor',
      ],
    },
    {
      type: 'category',
      label: 'Sessions and evidence',
      collapsed: false,
      items: ['sessions', 'cpu-and-memory', 'failure-analysis'],
    },
    {
      type: 'category',
      label: 'Self-healing',
      collapsed: false,
      items: ['self-healing', 'selector-health', 'ai-providers', 'omni-vision', 'inspector'],
    },
    {
      type: 'category',
      label: 'Security',
      collapsed: false,
      items: ['authentication', 'roles-and-scopes', 'hardening'],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: true,
      items: [
        'configuration',
        'environment-variables',
        'real-time-events',
        'observability',
        'architecture',
        'troubleshooting',
        'release-notes',
      ],
    },
  ],
};

export default sidebars;

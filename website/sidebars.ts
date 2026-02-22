import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'index',
    'setup',
    {
      type: 'category',
      label: 'Core Architecture',
      collapsed: false,
      items: ['architecture', 'design-system', 'server-args', 'capabilities', 'deployment'],
    },
    {
      type: 'category',
      label: 'Intelligence & AI',
      collapsed: false,
      items: ['ai-features', 'omni-inspector', 'self-healing', 'omni-vision'],
    },
    {
      type: 'category',
      label: 'Enterprise Operations',
      items: [
        'remote-execution',
        'enterprise-security',
        'notifications',
        'network-conditioning',
        'retention',
        'cloud',
      ],
    },
    'troubleshooting',
    'Xenon-Kotlin-SDK-Specs',
  ],
};

export default sidebars;

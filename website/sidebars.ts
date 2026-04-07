import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docs: [
    {
      type:  'doc',
      id:    'quick-start',
      label: '⚡ Quick start',
    },
    {
      type:  'category',
      label: 'Core API',
      collapsed: false,
      items: [
        'validation',
        'errors',
        'response',
        'logging',
        'configuration',
      ],
    },
    {
      type:  'category',
      label: 'API Docs',
      items: [
        'openapi',
      ],
    },
    {
      type:  'category',
      label: 'Testing',
      items: [
        'testing',
      ],
    },
    {
      type:  'category',
      label: 'Guides',
      items: [
        {
          type:  'doc',
          id:    'guides/existing-app',
          label: 'Add to an existing app',
        },
        {
          type:  'doc',
          id:    'guides/distributed-rate-limiting',
          label: 'Distributed rate limiting',
        },
        {
          type:  'doc',
          id:    'guides/webhooks',
          label: 'Webhook verification',
        },
        {
          type:  'doc',
          id:    'guides/adapters',
          label: 'Joi / Yup / Winston adapters',
        },
      ],
    },
    {
      type:  'doc',
      id:    'migration',
      label: '🔀 Migration guide',
    },
    {
      type:  'doc',
      id:    'changelog',
      label: '📋 Changelog',
    },
  ],
}

export default sidebars

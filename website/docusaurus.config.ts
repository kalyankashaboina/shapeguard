import { themes as prismThemes } from 'prism-react-renderer'
import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const config: Config = {
  title:       'shapeguard',
  tagline:     'Stop re-writing Express infrastructure. Typed validation, logging, errors, and API docs — wired together.',
  favicon:     'img/favicon.ico',
  url:         'https://kalyankashaboina.github.io',
  baseUrl:     '/shapeguard/',
  organizationName: 'kalyankashaboina',
  projectName: 'shapeguard',
  trailingSlash: false,
  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
        },
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },

  presets: [[
    'classic',
    {
      docs: {
        sidebarPath: './sidebars.ts',
        editUrl: 'https://github.com/kalyankashaboina/shapeguard/tree/main/website/',
      },
      blog: false,
      theme: { customCss: './src/css/custom.css' },
    } satisfies Preset.Options,
  ]],

  themeConfig: {
    image: 'img/shapeguard-og.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'shapeguard',
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        { to: '/docs/quick-start', label: 'Quick Start', position: 'left' },
        { href: 'https://github.com/kalyankashaboina/shapeguard', label: 'GitHub', position: 'right' },
        { href: 'https://npmjs.com/package/shapeguard', label: 'npm', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Quick start',     to: '/docs/quick-start' },
            { label: 'Validation',      to: '/docs/validation' },
            { label: 'Error handling',  to: '/docs/errors' },
            { label: 'OpenAPI / Docs',  to: '/docs/openapi' },
          ],
        },
        {
          title: 'Guides',
          items: [
            { label: 'Add to existing app',        to: '/docs/guides/existing-app' },
            { label: 'Distributed rate limiting',  to: '/docs/guides/distributed-rate-limiting' },
            { label: 'Webhook verification',       to: '/docs/guides/webhooks' },
            { label: 'Joi / Yup / Winston',        to: '/docs/guides/adapters' },
          ],
        },
        {
          title: 'Links',
          items: [
            { label: 'GitHub',     href: 'https://github.com/kalyankashaboina/shapeguard' },
            { label: 'npm',        href: 'https://npmjs.com/package/shapeguard' },
            { label: 'Changelog',  href: 'https://github.com/kalyankashaboina/shapeguard/blob/main/CHANGELOG.md' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Kalyan Kashaboina. MIT License.`,
    },
    prism: {
      theme:     prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
    metadata: [
      { name: 'keywords', content: 'express, middleware, validation, typescript, zod, openapi, swagger, error-handling, nodejs, logging' },
    ],
  } satisfies Preset.ThemeConfig,
}

export default config

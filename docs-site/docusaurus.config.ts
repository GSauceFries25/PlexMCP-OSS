import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'PlexMCP',
  tagline: 'The unified gateway for Model Context Protocol',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://docs.plexmcp.com',
  baseUrl: '/',

  organizationName: 'PlexMCP',
  projectName: 'plexmcp',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

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
          editUrl: 'https://github.com/PlexMCP/plexmcp/tree/main/docs-site/',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/plexmcp-social-card.jpg',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: 'cloud_launch',
      content: 'Start building with PlexMCP for free! <a href="https://dashboard.plexmcp.com/register">Create your account</a>',
      backgroundColor: '#6366f1',
      textColor: '#ffffff',
      isCloseable: true,
    },
    navbar: {
      title: 'PlexMCP',
      logo: {
        alt: 'PlexMCP Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          to: '/api-reference/overview',
          label: 'API Reference',
          position: 'left',
        },
        {
          href: 'https://plexmcp.com#pricing',
          label: 'Pricing',
          position: 'left',
        },
        {
          href: 'https://oss.plexmcp.com',
          label: 'Self-Host',
          position: 'right',
        },
        {
          href: 'https://github.com/PlexMCP/plexmcp',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://dashboard.plexmcp.com',
          label: 'Dashboard',
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
              label: 'Getting Started',
              to: '/getting-started/quickstart',
            },
            {
              label: 'Dashboard Guide',
              to: '/dashboard/overview',
            },
            {
              label: 'API Reference',
              to: '/api-reference/overview',
            },
          ],
        },
        {
          title: 'Product',
          items: [
            {
              label: 'Dashboard',
              href: 'https://dashboard.plexmcp.com',
            },
            {
              label: 'Pricing',
              href: 'https://plexmcp.com#pricing',
            },
            {
              label: 'Status',
              href: 'https://status.plexmcp.com',
            },
          ],
        },
        {
          title: 'Open Source',
          items: [
            {
              label: 'Self-Host Documentation',
              href: 'https://oss.plexmcp.com',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/PlexMCP/plexmcp',
            },
            {
              label: 'Discussions',
              href: 'https://github.com/PlexMCP/plexmcp/discussions',
            },
          ],
        },
        {
          title: 'Company',
          items: [
            {
              label: 'About',
              href: 'https://plexmcp.com/about',
            },
            {
              label: 'Privacy Policy',
              href: 'https://plexmcp.com/privacy',
            },
            {
              label: 'Terms of Service',
              href: 'https://plexmcp.com/terms',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} PlexMCP. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'rust'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

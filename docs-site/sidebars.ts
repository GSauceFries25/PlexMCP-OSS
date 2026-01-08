import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/quickstart',
        'getting-started/dashboard-tour',
        'getting-started/first-mcp',
      ],
    },
    {
      type: 'category',
      label: 'Self-Hosting',
      items: [
        'self-hosting/index',
        'self-hosting/requirements',
        'self-hosting/docker',
        'self-hosting/configuration',
        'self-hosting/manual',
        'self-hosting/upgrading',
        'self-hosting/backup',
      ],
    },
    {
      type: 'category',
      label: 'Dashboard',
      items: [
        'dashboard/overview',
        'dashboard/mcps',
        'dashboard/api-keys',
        'dashboard/team',
        'dashboard/settings',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        {
          type: 'category',
          label: 'Authentication',
          items: [
            'guides/authentication/api-keys',
            'guides/authentication/jwt-auth',
          ],
        },
        {
          type: 'category',
          label: 'Integrations',
          items: [
            'guides/integrations/claude-desktop',
            'guides/integrations/sdk-examples',
          ],
        },
        {
          type: 'category',
          label: 'MCPs',
          items: [
            'guides/mcps/registering-mcps',
            'guides/mcps/invoking-tools',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api-reference/overview',
        'api-reference/authentication',
        'api-reference/organizations',
        'api-reference/mcps',
        'api-reference/api-keys',
        'api-reference/errors',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/security',
      ],
    },
    {
      type: 'category',
      label: 'Support',
      items: [
        'support/faq',
        'support/contact',
      ],
    },
  ],
};

export default sidebars;

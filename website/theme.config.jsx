export default {
  logo: (
    <span style={{ fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.5px' }}>
      🛡️ shapeguard
    </span>
  ),

  project: {
    link: 'https://github.com/kalyankashaboina/shapeguard',
  },

  chat: {
    link: 'https://github.com/kalyankashaboina/shapeguard/discussions',
  },

  docsRepositoryBase:
    'https://github.com/kalyankashaboina/shapeguard/blob/main/website',

  useNextSeoProps() {
    return {
      titleTemplate: '%s – shapeguard',
    }
  },

  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta
        name="description"
        content="FastAPI-style validation, response shaping, and error handling for Node.js + Express. Zero config to start."
      />
      <meta name="og:title" content="shapeguard" />
      <meta
        name="og:description"
        content="FastAPI-style validation, response shaping, and error handling for Node.js + Express."
      />
    </>
  ),

  navigation: true,

  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },

  toc: {
    backToTop: true,
  },

  footer: {
    text: (
      <span>
        MIT {new Date().getFullYear()} ©{' '}
        <a
          href="https://github.com/kalyankashaboina"
          target="_blank"
          rel="noopener noreferrer"
        >
          Kalyan Kashaboina
        </a>
        {' · '}
        <a
          href="https://npmjs.com/package/shapeguard"
          target="_blank"
          rel="noopener noreferrer"
        >
          npm
        </a>
      </span>
    ),
  },

  primaryHue: 220,
}

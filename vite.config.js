import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { execSync } from 'node:child_process'

// <meta name="commit"> con el hash del commit del build (CONVENCIONES §3).
// En desarrollo vale «dev»; un build sin commit que nombrar se para, porque publicaría
// una versión que no se puede rastrear.
function commitMeta (command) {
  let hash = 'dev'
  if (command === 'build') {
    try {
      hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
    } catch (e) {
      throw new Error(`commit-meta: cannot read the commit hash (${e.message})`)
    }
  }
  return {
    name: 'commit-meta',
    transformIndexHtml: (html) => html.replace('</head>', `  <meta name="commit" content="${hash}" />\n  </head>`),
  }
}

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    // Los `dotrino-*` son Web Components, no componentes Vue.
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('dotrino-') } } }),
    // HTTPS autofirmado en desarrollo: WebCrypto y el vault del store piden contexto seguro.
    basicSsl(),
    commitMeta(command),
    VitePWA({
      selfDestroying: command === 'serve',
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'og.jpg', 'robots.txt', 'sitemap.xml', 'fonts/*.woff2'],
      manifest: {
        name: 'Facturero',
        short_name: 'Facturero',
        description: 'Facturación electrónica del SRI de Ecuador: firma en tu aparato y guarda tus facturas en tu almacén.',
        lang: 'es',
        theme_color: '#00658c',
        background_color: '#f7fafc',
        display: 'standalone',
        start_url: './',
        scope: './',
        launch_handler: { client_mode: 'focus-existing' },
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: null,
      },
    }),
  ],
  server: {
    host: true,
    port: 3140,
    allowedHosts: ['.ts.net', '.local', 'localhost'],
  },
}))

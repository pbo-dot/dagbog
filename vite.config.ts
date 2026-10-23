import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// base './' gør at appen virker fra en undermappe, fx GitHub Pages /dagbog/
export default defineConfig({
  base: './',
  // To sider: dagbogen og den neutrale Optager-app (optag/), som deler data på samme adresse
  build: {
    rollupOptions: {
      input: { main: 'index.html', optag: 'optag/index.html' },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Dagbog',
        short_name: 'Dagbog',
        description: 'Personlig, krypteret dagbog',
        lang: 'da',
        start_url: './',
        scope: './',
        display: 'standalone',
        // "Del → Dagbog" fra andre apps (fx Pixel Optager) åbner en ny samtale
        share_target: {
          action: './',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        background_color: '#f7f4ee',
        theme_color: '#f7f4ee',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: 'index.html',
        // Optager har sin egen side og må ikke få dagbogens
        navigateFallbackDenylist: [/\/optag\//],
      },
    }),
    {
      // PWA-pluginnet sætter dagbogens manifest og service worker ind på alle sider.
      // Optager har sit eget manifest, og dagbogens service worker gælder allerede for den.
      name: 'optager-uden-dagbogens-pwa',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.path.includes('optag')) return html;
          return html
            .replace(/<link rel="manifest" href="\.\/manifest\.webmanifest">(?=<script id="vite-plugin-pwa)/, '')
            .replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, '');
        },
      },
    },
  ],
})

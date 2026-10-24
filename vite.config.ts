import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// base './' gør at appen virker fra en undermappe, fx GitHub Pages /dagbog/
export default defineConfig({
  base: './',
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
        // "Del → Dagbog" fra andre apps (fx Pixel Optager) åbner en ny samtale:
        // tekst eller en lydfil. Modtages af public/share-sw.js.
        share_target: {
          action: './del',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'audio', accept: ['audio/*', '.m4a', '.mp3', '.wav', '.ogg', '.opus', '.aac', '.amr', '.3gp', '.webm', '.flac'] }],
          },
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
        importScripts: ['share-sw.js'],
      },
    }),
  ],
})

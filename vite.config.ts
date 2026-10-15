import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'GRB Quick Quote',
        short_name: 'GRB Quote',
        description: 'On-site estimator for GRB Builders (London) Ltd',
        theme_color: '#007060',
        background_color: '#0c1211',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,png,svg,woff2}'],
        // Server routes (Xero sign-in callback etc.) must always reach the network.
        navigateFallbackDenylist: [/^\/api\//],
      },
    })
  ]
})

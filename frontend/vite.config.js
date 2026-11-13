import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// The frontend calls relative `/api` and `/uploads` paths, so in development
// they are proxied to the backend and in production the reverse proxy
// (deploy/nginx.conf) does the same. Nothing in the app code needs to know
// where the API lives, which is what previously made it localhost-only.
  const apiTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:5000'

  // In production the POS is served from a sub-path (deploy/nginx.conf maps
  // /pos/ to this build), so the bundle must reference /pos/assets/... . Left at
  // the default '/', index.html would ask for /assets/index-*.js and nginx would
  // hand back the storefront's bundle instead, leaving the POS blank.
  // Deployments set VITE_BASE=/pos/; local dev keeps the root path.
  const base = process.env.VITE_BASE || '/'

  export default defineConfig({
    base,
    plugins: [
      tailwindcss(),
    ],
  server: {
    host: '0.0.0.0',
    port: 5373,
    allowedHosts: ['lacobookstore-pos.com', 'lacobookstore-pos.local'],
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/uploads': { target: apiTarget, changeOrigin: true },
    },
  },
})

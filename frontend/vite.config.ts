import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// This proxy runs server-side, inside whatever process runs `vite`. Under Docker
// Compose that's the frontend container, where "localhost" means the frontend
// container itself, not the api container — VITE_PROXY_TARGET lets compose point this
// at the api container by its service name instead.
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'
// VITE_API_BASE_URL is a separate, unrelated setting baked into the browser bundle so
// the browser (on the host, not in a container) calls the api container's published
// port directly. Reused here (not hardcoded a second time) to pin the Host header the
// backend sees to that same externally-reachable address: with changeOrigin rewriting
// Host to match PROXY_TARGET, django-allauth would otherwise build its OAuth
// redirect_uri from "api:8000" — an internal Docker hostname Google's OAuth consent
// screen would reject (not a registered redirect URI, and not resolvable outside
// Docker's network even if it were).
const PUBLIC_API_HOST = (process.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/^https?:\/\//, '')

function pinHostHeader(proxy: any) {
  proxy.on('proxyReq', (proxyReq: any) => proxyReq.setHeader('host', PUBLIC_API_HOST))
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
        configure: pinHostHeader,
      },
      // The Google/Zoom "Connect" links (Settings → Integrations) are plain <a href>
      // full-page navigations to /api/auth/{google-calendar,zoom}/connect/, which log
      // the user into a real Django session and then redirect to this path to hand off
      // to django-allauth's OAuth flow. Without this proxied too, that second hop lands
      // back on the Vite dev server, which has no route for it and just serves the SPA
      // shell instead of continuing to Google/Zoom's consent screen.
      '/accounts': {
        target: PROXY_TARGET,
        changeOrigin: true,
        configure: pinHostHeader,
      },
      // Django admin + its CSS/JS (served by runserver under DEBUG) — without these,
      // :5173/django-admin/ gets the SPA shell or renders unstyled.
      '/django-admin': {
        target: PROXY_TARGET,
        changeOrigin: true,
        configure: pinHostHeader,
      },
      '/static': {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
    }
  }
})

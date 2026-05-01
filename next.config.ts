import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@whiskeysockets/baileys'],
  // ESLint runs as a separate CI step (see .github/workflows/ci.yml). Running it
  // during `next build` too would fail on preexisting warnings we haven't cleaned
  // up yet. Ratchet up by removing this once the repo is lint-clean.
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig

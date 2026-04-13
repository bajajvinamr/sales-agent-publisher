import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['whatsapp-web.js', '@whiskeysockets/baileys'],
}

export default nextConfig

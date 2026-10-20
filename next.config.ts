import type { NextConfig } from 'next';

// Headers seguros para la aplicación LOCAL. No agrega CSP incompatible con Next.js.
const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }
      ]
    }];
  }
};
export default nextConfig;

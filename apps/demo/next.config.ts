import type { NextConfig } from 'next';

// Static export: the demo is plain HTML/JS/CSS served from a free static host that never
// sleeps (live_class.md D-016). Everything talks to the Live Class server at runtime.
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@live-class/react', '@live-class/core', '@live-class/shared'],
};

export default nextConfig;

import type { NextConfig } from 'next';

const config: NextConfig = {
  // Self-contained server bundle for the container image.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;

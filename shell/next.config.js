/** @type {import('next').NextConfig} */
let withBundleAnalyzer = (config) => config;
try {
  withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: process.env.ANALYZE === 'true',
  });
} catch {
  // @next/bundle-analyzer not installed — skip
}

const isAppMode = process.env.BUILD_MODE === 'app';

const nextConfig = {
  output: isAppMode ? 'export' : 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@antv/x6'],
  },
  ...(isAppMode && {
    images: { unoptimized: true },
  }),
  ...(!isAppMode && {
    async headers() {
      return [
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          ],
        },
      ];
    },
  }),
};

module.exports = withBundleAnalyzer(nextConfig);

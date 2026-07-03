import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 两种部署路径并存：
  // - Docker/CI（Dockerfile.web）跑 `node apps/web/server.js`，需要 standalone → 构建时设 NEXT_OUTPUT=standalone
  // - 手动 rsync 部署跑 `next start`，与 standalone 不兼容 → 不设该变量（默认非 standalone）
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
  // 安全响应头。CSP 暂未加（Next 内联脚本需 nonce，配错会白屏，单列为后续项）；
  // 先补确定安全、无副作用的几项：HSTS 防降级、SAMEORIGIN 防点击劫持、nosniff、referrer。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

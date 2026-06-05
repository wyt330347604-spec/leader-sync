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
};

export default nextConfig;

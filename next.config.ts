import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Transformers.js 需要跨域隔离以启用 WebGPU / 多线程 WASM
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
  // 屏蔽 Next 内置的遥测提示
  devIndicators: false,
};

export default nextConfig;

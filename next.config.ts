import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 隔离构建目录。
  //
  // 本机 `npm run dev` 长期占着 `.next`，而 `next build` 会清空它 —— 两者共用
  // 同一个目录时，想验证一次生产构建就必须停掉 dev server。
  // 用 `ZJ_DIST_DIR=.next-ci npm run build` 就能在不打扰 dev server 的前提下构建。
  // （安全删除守卫也会拦 `next build` 清 `.next/trace-build` 那类目录，见 HANDOVER §6 B）
  ...(process.env.ZJ_DIST_DIR ? { distDir: process.env.ZJ_DIST_DIR } : {}),
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

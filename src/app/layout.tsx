import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '智简匣 · 本地离线 AI 工具箱',
  description:
    '智简匣是一个本地离线 AI 优先的局域网工具箱：前端可独立运行，后端按需启动，功能通过插件广场自由扩展。',
  applicationName: '智简匣',
  authors: [{ name: '智简匣' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        {/* 壁纸层：由主题包决定，随主题切换平滑过渡 */}
        <div className="zj-wallpaper" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}

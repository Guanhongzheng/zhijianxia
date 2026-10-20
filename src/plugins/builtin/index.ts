/**
 * 预装插件汇总导出
 *
 * 内核通过这里的映射按需加载预装插件。
 * 新增预装插件只需在此登记一个 id -> 加载函数，内核代码无需改动。
 */

import type { PluginModule, PluginModuleLoader } from '../types';

import weatherCard, { manifest as weatherManifest } from './weather-card';
import copywritingCard, { manifest as copywritingManifest } from './copywriting-card';
import memoCard, { manifest as memoManifest } from './memo-card';
import quoteCard, { manifest as quoteManifest } from './quote-card';

/** 预装插件模块集合 */
export const builtinPluginModules: PluginModule[] = [
  { manifest: weatherManifest, Component: weatherCard },
  { manifest: copywritingManifest, Component: copywritingCard },
  { manifest: memoManifest, Component: memoCard },
  { manifest: quoteManifest, Component: quoteCard },
];

/** 预装插件的加载器映射：id -> 动态导入函数 */
export const builtinModules: Record<string, PluginModuleLoader> = {
  'weather-card': async () => {
    const mod = await import('./weather-card');
    return { manifest: mod.manifest, Component: mod.default };
  },
  'copywriting-card': async () => {
    const mod = await import('./copywriting-card');
    return { manifest: mod.manifest, Component: mod.default };
  },
  'memo-card': async () => {
    const mod = await import('./memo-card');
    return { manifest: mod.manifest, Component: mod.default };
  },
  'quote-card': async () => {
    const mod = await import('./quote-card');
    return { manifest: mod.manifest, Component: mod.default };
  },
};

export { weatherManifest, copywritingManifest, memoManifest, quoteManifest };

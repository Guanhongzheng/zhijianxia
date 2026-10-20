/**
 * 可下载插件汇总导出
 *
 * 这些插件随应用打包但默认不安装，用户可从「功能广场」按需启用。
 * 内核通过这里的映射按需加载。
 */

import type { PluginModule, PluginModuleLoader } from '../types';

import pomodoro, { manifest as pomodoroManifest } from './pomodoro';
import musicPlayer, { manifest as musicPlayerManifest } from './music-player';
import textSummary, { manifest as textSummaryManifest } from './text-summary';
import recipeAssistant, { manifest as recipeAssistantManifest } from './recipe-assistant';
import unitConverter, { manifest as unitConverterManifest } from './unit-converter';
import vocabulary, { manifest as vocabularyManifest } from './vocabulary';

/** 可下载插件模块集合 */
export const downloadablePluginModules: PluginModule[] = [
  { manifest: pomodoroManifest, Component: pomodoro },
  { manifest: musicPlayerManifest, Component: musicPlayer },
  { manifest: textSummaryManifest, Component: textSummary },
  { manifest: recipeAssistantManifest, Component: recipeAssistant },
  { manifest: unitConverterManifest, Component: unitConverter },
  { manifest: vocabularyManifest, Component: vocabulary },
];

/** 可下载插件的加载器映射：id -> 动态导入函数 */
export const downloadableModules: Record<string, PluginModuleLoader> = {
  pomodoro: async () => {
    const mod = await import('./pomodoro');
    return { manifest: mod.manifest, Component: mod.default };
  },
  'music-player': async () => {
    const mod = await import('./music-player');
    return { manifest: mod.manifest, Component: mod.default };
  },
  'text-summary': async () => {
    const mod = await import('./text-summary');
    return { manifest: mod.manifest, Component: mod.default };
  },
  'recipe-assistant': async () => {
    const mod = await import('./recipe-assistant');
    return { manifest: mod.manifest, Component: mod.default };
  },
  'unit-converter': async () => {
    const mod = await import('./unit-converter');
    return { manifest: mod.manifest, Component: mod.default };
  },
  vocabulary: async () => {
    const mod = await import('./vocabulary');
    return { manifest: mod.manifest, Component: mod.default };
  },
};

export {
  pomodoroManifest,
  musicPlayerManifest,
  textSummaryManifest,
  recipeAssistantManifest,
  unitConverterManifest,
  vocabularyManifest,
};

'use client';

/**
 * plugin-ai-errors.ts —— 插件 AI 失败原因的中文化
 *
 * 插件的 UI 通常只有一行「AI 调用失败，请稍后重试」，
 * 用户既不知道是模型没加载、还是后端没启动、还是 Key 填错了。
 *
 * 这里把各类底层错误归一化成**可执行的中文提示**，
 * 让插件直接展示即可，无需各自再写一遍判断。
 */

/** 后端已给出可读文案时，直接用（后端做了错误可读化，见 server/src/ai-errors.js） */
const READABLE_PREFIXES = [
  'AI 调用失败',
  'AI 服务返回',
  '无法连接到 AI 服务',
  '后端服务未开启',
  '请先登录',
  '尚未配置',
  '外部 AI 接口请求超时',
];

/**
 * 把插件 AI 调用抛出的错误转成一句可读提示。
 *
 * @param err 底层错误（可能是 Error、裸字符串、裸数字）
 * @returns 中文提示
 */
export function describePluginAiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';

  // 后端已翻译过：原样透出（它比这里更精确，能指出是 401 还是 404）
  if (READABLE_PREFIXES.some((p) => raw.startsWith(p))) {
    return raw.split('\n')[0].slice(0, 220);
  }

  // 本地模型未加载 / 正在加载
  if (/model (is )?not loaded|no pipeline|尚未加载模型|模型未加载/i.test(raw)) {
    return '本地模型尚未加载，请到「系统设置 → AI 引擎」点击「加载模型」';
  }

  // wasm 侧内存分配失败（裸数字错误经过 describeError 后的文案）
  if (/权重体积过大|内存分配失败/.test(raw)) {
    return '模型太大，浏览器内存放不下。请在「系统设置 → AI 引擎」改用更小的模型（如 Qwen2.5 0.5B）';
  }

  // 浏览器不支持 WebGPU 且 WASM 也失败
  if (/WebGPU 推理后端初始化失败/.test(raw)) {
    return 'WebGPU 推理不可用，请到「系统设置 → AI 引擎」改用 WASM 运行时';
  }

  // 网络类
  if (/Failed to fetch|NetworkError|network error|load failed/i.test(raw)) {
    return '网络请求失败，请检查后端服务是否已启动、地址是否正确';
  }

  // 登录态
  if (/BackendRequiredError|未登录|401/.test(raw)) {
    return '请先登录后再使用 AI 能力';
  }

  // 兜底：截断原始信息，总好过一句「AI 调用失败」
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (trimmed) {
    return `AI 调用失败：${trimmed.slice(0, 160)}`;
  }
  return 'AI 调用失败，请稍后重试。若持续失败，请到「系统设置」确认 AI 配置是否完整。';
}
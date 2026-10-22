/**
 * 缓存相关的错误判定 —— 主线程与 Worker 共用。
 *
 * 抽成独立模块的原因：Worker 里不能 import local-engine.ts
 * （那会把 window 相关的代码一起拖进 Worker 的依赖图）。
 */

/**
 * 判断错误是否由「缓存里的坏数据 / 下载不完整」引起。
 *
 * 只有这类错误才值得清缓存重下。
 * EP 初始化失败、显存不足、算子不支持等错误与缓存无关，
 * 清了也白清，只是白白让用户再等一次几百MB 的下载。
 */
export function isCacheRelatedError(err: unknown): boolean {
  const text = describe(err).toLowerCase();

  // 明确指向网络 / 缓存的关键词
  if (
    /failed to fetch|network|networkerror|load failed|aborted|timeout|timed out|断网|网络/.test(
      text,
    )
  ) {
    return true;
  }
  // HTTP 层面的失败（4xx / 5xx）
  if (/http 4\d\d|http 5\d\d|404|403|502|503/.test(text)) {
    return true;
  }
  // 权重文件读不出来 / 解析失败 —— 典型是半截文件
  if (
    /unexpected end of|protobuf|parse|corrupt|invalid data|external data/.test(text)
  ) {
    return true;
  }
  return false;
}

/** 把任意错误转成可读文本（够用即可，不追求完整） */
function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    return `${err.message} ${causeText}`;
  }
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string') return o.error;
    try {
      return JSON.stringify(err) ?? '';
    } catch {
      return '';
    }
  }
  return String(err);
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  Database,
  Download,
  Info,
  KeyRound,
  Network,
  Palette,
  Plug,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { useThemeStore } from '@/store/theme-store';
import { usePluginStore } from '@/store/plugin-store';
import { idbClear } from '@/lib/storage/idb';
import {
  getLocalAiState,
  loadLocalModel,
  unloadLocalModel,
  saveModelSource,
  readModelSource,
  findModelSource,
  purgeModelCache,
  LOCAL_MODEL_OPTIONS,
  MODEL_SOURCES,
  DEFAULT_LOCAL_MODEL,
  readRuntimePref,
  resolveRuntime,
  switchRuntime,
  peekRuntime,
  type ModelSourceId,
  type RuntimeInfo,
  type RuntimePref,
} from '@/lib/ai/local-engine';
import {
  getAllDownloadStates,
  invalidateDownloadState,
  type ModelDownloadState,
} from '@/lib/ai/model-download';
import {
  downloadModel,
  type DownloadProgress,
} from '@/lib/ai/model-downloader';
import { canUseWebGpu, findModelOption, WEBGPU_MAX_Q4_BYTES } from '@/lib/ai/local-models';
import { ProfileSettings } from '@/components/cards/profile-settings';
import { PersonalizationSettings } from '@/components/cards/personalization-settings';
import { ApiCapabilitySettings } from '@/components/cards/api-capability-settings';
import { cn } from '@/lib/utils';

/** 设置项定义（左侧导航） */
const SETTINGS_SECTIONS = [
  { id: 'profile', label: '个人资料', icon: User },
  { id: 'personalization', label: '个性化', icon: Palette },
  { id: 'ai', label: 'AI 引擎', icon: Cpu },
  { id: 'lan', label: '局域网', icon: Network },
  { id: 'api', label: 'API', icon: KeyRound },
  { id: 'general', label: '通用', icon: Database },
  { id: 'about', label: '关于', icon: Info },
] as const;

type SectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** 系统设置面板 —— 左侧导航 + 右侧内容 */
export function SettingsPanel() {
  const [section, setSection] = useState<SectionId>('profile');

  return (
    <div className="flex flex-col gap-4 md:flex-row md:min-h-[60dvh]">
      {/* 左侧导航 */}
      <nav className="w-full shrink-0 space-y-1 overflow-x-auto pr-1 md:w-40 md:overflow-y-auto md:overflow-x-visible">
        {SETTINGS_SECTIONS.map((item) => {
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                active
                  ? 'bg-[var(--zj-accent-soft)] font-medium text-[var(--zj-fg)]'
                  : 'text-[var(--zj-muted-fg)] hover:bg-[var(--zj-muted)] hover:text-[var(--zj-fg)]',
              )}
            >
              <item.icon
                className={cn(
                  'size-3.5 shrink-0',
                  active ? 'text-[var(--zj-accent)]' : '',
                )}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 右侧内容 —— 全屏下自适应高度 */}
      <div className="min-w-0 flex-1 md:max-h-[calc(100dvh-9rem)] md:overflow-y-auto md:pr-1">
        {section === 'profile' && <ProfileSettings />}
        {section === 'personalization' && <PersonalizationSettings />}
        {section === 'ai' && <AiEngineSettings />}
        {section === 'lan' && <LanSettings />}
        {section === 'api' && <ApiCapabilitySettings />}
        {section === 'general' && <GeneralSettings />}
        {section === 'about' && <AboutSettings />}
      </div>
    </div>
  );
}

/** AI 引擎设置 */
function AiEngineSettings() {
  const api = useAppStore((s) => s.api);
  const setApi = useAppStore((s) => s.setApi);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const notify = useAppStore((s) => s.notify);
  const [aiState, setAiState] = useState(getLocalAiState());
  const [warming, setWarming] = useState(false);
  /** 用户选择的模型 id（决定下载哪个模型） */
  const [modelId, setModelId] = useState(DEFAULT_LOCAL_MODEL);
  /** 用户选择的下载源 */
  const [sourceId, setSourceId] = useState<ModelSourceId>(readModelSource());
  /** 推理运行时偏好（自动 / 强制 WebGPU / 强制 WASM） */
  const [runtimePref, setRuntimePref] = useState<RuntimePref>(readRuntimePref());
  /** WebGPU 探测结果 —— 决定是否禁用「强制 WebGPU」选项 */
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | undefined>(
    peekRuntime(),
  );
  /**
   * 各模型的下载状态 —— 用来显示「已下载」标记，
   * 并把「下载」与「加载」两个动作分开。
   */
  const [downloadStates, setDownloadStates] = useState<
    Record<string, ModelDownloadState>
  >({});
  /** 正在下载的模型 id（null = 没在下载） */
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  /** 下载进度 */
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(
    null,
  );

  /**
   * 刷新下载状态。
   * 缓存内容会因下载/清缓存而变，所以监听这几处变化后重新扫描。
   */
  const refreshDownloadStates = useCallback(async () => {
    const states = await getAllDownloadStates();
    setDownloadStates(states);
  }, []);

  useEffect(() => {
    void refreshDownloadStates();
    // 轮询兜底：模型加载后缓存会多出条目，需要刷新「已下载」标记
    const timer = setInterval(() => {
      void refreshDownloadStates();
    }, 4000);
    return () => clearInterval(timer);
  }, [refreshDownloadStates]);

  useEffect(() => {
    // 订阅本地模型加载进度
    let mounted = true;
    const timer = setInterval(() => {
      if (mounted) setAiState(getLocalAiState());
    }, 400);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  // 挂载时探测一次 WebGPU 能力，用于在设置里给出明确提示
  useEffect(() => {
    let cancelled = false;
    void resolveRuntime().then((info) => {
      if (!cancelled) setRuntimeInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 实际生效的运行时：优先用引擎上报的，其次用探测结果。
   *
   * ⚠️ 探测结果要与**当前所选模型**的体积一起看 ——
   * 权重超过 GPU 单缓冲上限时会被改判为 WASM（见 runtime.ts 的实测结论）。
   * 也就是说「WebGPU 可用」≠「这个模型能用 WebGPU」。
   */
  const activeRuntime = aiState.runtime ?? runtimeInfo;
  /** 当前所选模型能否走 WebGPU */
  const selectedGpuOk = canUseWebGpu(findModelOption(modelId));
  /** 面板上应当展示的设备 —— 超限时直接显示 WASM，避免误导 */
  const shownDevice: 'webgpu' | 'wasm' =
    activeRuntime?.device === 'webgpu' && !selectedGpuOk ? 'wasm' : (activeRuntime?.device ?? 'wasm');

  return (
    <div className="space-y-4">
      <SettingRow
        title="推理模式"
        desc="选择 AI 能力的来源。切换后所有插件的 AI 调用都会走新通道。"
      >
        <div className="flex flex-col gap-2">
          <ModeOption
            active={api.mode === 'local'}
            title="前端本地离线 AI"
            desc="浏览器内运行 Transformers.js，无需后端，提示词不出设备"
            onClick={() => setApi({ mode: 'local' })}
          />
          <ModeOption
            active={api.mode === 'backend'}
            title="后端转发外部 API 模型"
            desc="由后端统一接管外部 API 请求，需先启动后端服务"
            disabled={!backendOnline}
            disabledHint="后端服务未开启"
            onClick={() => setApi({ mode: 'backend' })}
          />
        </div>
      </SettingRow>

      <Separator />

      <SettingRow
        title="模型下载源"
        desc="默认走阿里巴巴魔搭社区（国内），下载更快更稳定"
      >
        <div className="flex flex-col gap-1.5">
          {MODEL_SOURCES.map((s) => {
            const active = sourceId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSourceId(s.id);
                  saveModelSource(s.id);
                  notify(
                    active
                      ? '模型源未变化'
                      : `已切换到${s.name}，下次加载模型时生效`,
                    'success',
                  );
                }}
                className={cn(
                  'flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors',
                  active
                    ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                    : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {active ? (
                    <Check className="size-3.5 text-[var(--zj-accent)]" />
                  ) : (
                    <span className="block size-3.5 rounded-full border border-[var(--zj-border)]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{s.name}</span>
                    {s.domestic && (
                      <Badge variant="success" className="text-[0.625rem]">
                        推荐
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-[var(--zj-muted-fg)]">
                    {s.desc}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.625rem] text-[var(--zj-muted-fg)] opacity-70">
                    {s.host}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingRow>

      <Separator />

      <SettingRow
        title="选择要下载的模型"
        desc="先下载权重到本地，再加载运行；已下载的模型会标记「已下载」，加载时不再消耗流量"
      >
        <div className="space-y-2">
          <div className="flex flex-col gap-1.5">
            {LOCAL_MODEL_OPTIONS.map((m) => {
              const active = modelId === m.id;
              const loaded = aiState.modelId === m.id && aiState.status === 'ready';
              const dl = downloadStates[m.id];
              const downloaded = dl?.downloaded === true;
              const isDownloading = downloadingId === m.id;
              const gpuOk = canUseWebGpu(m);
              return (
                <div
                  key={m.id}
                  className={cn(
                    'rounded-md border px-2.5 py-2 transition-colors',
                    active
                      ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                      : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setModelId(m.id);
                        if (loaded) {
                          notify('该模型已在运行中', 'info');
                        } else if (downloaded) {
                          notify(`已选择 ${m.name}，点击「加载模型」即可启动`, 'success');
                        } else {
                          notify(`已选择 ${m.name}，点击「下载模型」开始下载`, 'success');
                        }
                      }}
                      className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                    >
                      <span className="mt-0.5 shrink-0">
                        {active ? (
                          <Check className="size-3.5 text-[var(--zj-accent)]" />
                        ) : (
                          <span className="block size-3.5 rounded-full border border-[var(--zj-border)]" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium">{m.name}</span>
                          <Badge variant="outline" className="text-[0.625rem]">
                            {m.size}
                          </Badge>
                          {m.recommended && (
                            <Badge variant="success" className="text-[0.625rem]">
                              推荐
                            </Badge>
                          )}
                          {loaded && (
                            <Badge variant="solid" className="text-[0.625rem]">
                              运行中
                            </Badge>
                          )}
                          {!loaded && downloaded && (
                            <Badge variant="outline" className="text-[0.625rem]">
                              已下载
                            </Badge>
                          )}
                          {!gpuOk && (
                            <Badge
                              variant="outline"
                              className="text-[0.625rem] text-amber-600 dark:text-amber-400"
                            >
                              仅 WASM
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-[var(--zj-muted-fg)]">
                          {m.desc}
                        </span>
                        <span className="mt-0.5 block text-[0.625rem] text-[var(--zj-muted-fg)] opacity-70">
                          {m.approxSize} · {m.id}
                        </span>
                      </span>
                    </button>

                    {/* 每个模型独立的「下载」按钮 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[0.6875rem]"
                      disabled={
                        warming ||
                        isDownloading ||
                        downloadingId !== null ||
                        downloaded
                      }
                      onClick={async () => {
                        setDownloadingId(m.id);
                        setDownloadProgress(null);
                        try {
                          const r = await downloadModel(m, sourceId, (p) =>
                            setDownloadProgress(p),
                          );
                          notify(
                            `${m.name} 下载完成（${(r.ms / 1000).toFixed(1)}s），现在可以加载`,
                            'success',
                          );
                          await refreshDownloadStates();
                        } catch (err) {
                          const reason =
                            err instanceof Error && err.message
                              ? err.message
                              : '未知错误';
                          notify(`下载失败：${reason}`, 'error');
                        } finally {
                          setDownloadingId(null);
                          setDownloadProgress(null);
                        }
                      }}
                    >
                      <Download className="size-3.5" />
                      {isDownloading
                        ? `${Math.round((downloadProgress?.ratio ?? 0) * 100)}%`
                        : downloaded
                          ? '已下载'
                          : '下载'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant={
                aiState.status === 'ready'
                  ? 'success'
                  : aiState.status === 'error'
                    ? 'danger'
                    : 'outline'
              }
            >
              {aiState.status === 'ready'
                ? '已就绪'
                : aiState.status === 'loading'
                  ? '加载中'
                  : aiState.status === 'error'
                    ? '加载失败'
                    : '未加载'}
            </Badge>
            {aiState.status === 'loading' && (
              <span className="text-xs text-[var(--zj-muted-fg)]">
                {Math.round(aiState.progress * 100)}%
              </span>
            )}
          </div>

          {/* 推理运行时：WebGPU / ONNX Runtime Web */}
          <div className="space-y-2 rounded-md border border-[var(--zj-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium">推理运行时</p>
              <div className="flex items-center gap-1.5">
                <Badge variant={shownDevice === 'webgpu' ? 'success' : 'outline'}>
                  {shownDevice === 'webgpu' ? 'WebGPU' : 'WASM'}
                </Badge>
                {activeRuntime && (
                  <span className="text-[0.6875rem] text-[var(--zj-muted-fg)]">
                    {activeRuntime.dtype.toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'auto', label: '自动', hint: '能用WebGPU 就用' },
                  { id: 'webgpu', label: 'WebGPU', hint: 'GPU 加速，通常快一个数量级' },
                  { id: 'wasm', label: 'WASM', hint: '兼容性最好' },
                ] as const
              ).map((opt) => {
                const disabled =
                  opt.id === 'webgpu' &&
                  runtimeInfo !== undefined &&
                  !runtimeInfo.hasWebGpuAdapter;
                const selected = runtimePref === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    title={
                      disabled
                        ? '当前浏览器/设备不支持 WebGPU'
                        : opt.hint
                    }
                    disabled={disabled}
                    onClick={async () => {
                      if (selected) return;
                      setRuntimePref(opt.id);
                      // device 属于 session 创建参数，必须卸载后重新加载才生效
                      await switchRuntime(opt.id);
                      setAiState(getLocalAiState());
                      setRuntimeInfo(await resolveRuntime(opt.id, true));
                      notify(
                        opt.id === 'auto'
                          ? '已切换为自动选择运行时'
                          : `已切换到 ${opt.label} 运行时，下次加载模型时生效`,
                        'info',
                      );
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected
                        ? 'border-[var(--zj-accent)] bg-[var(--zj-accent)]/10 text-[var(--zj-accent-fg)]'
                        : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* 能力说明：把「为什么没能用 WebGPU」讲清楚 */}
            <p className="text-[0.6875rem] leading-relaxed text-[var(--zj-muted-fg)]">
              {shownDevice === 'webgpu'
                ? `已启用 WebGPU 加速${activeRuntime?.adapterInfo ? `（${activeRuntime.adapterInfo}）` : ''}，模型在显卡上推理。`
                : !selectedGpuOk
                  ? `所选模型权重约 ${Math.round((findModelOption(modelId)?.q4Bytes ?? 0) / 1024 / 1024)} MB，超过 GPU 单缓冲上限（${Math.round(WEBGPU_MAX_Q4_BYTES / 1024 / 1024)} MB），只能使用 WASM 推理。`
                  : runtimeInfo && !runtimeInfo.hasWebGpuApi
                    ? '当前浏览器不支持 WebGPU，将使用 WASM 推理。建议使用较新版本的 Edge / Chrome 以启用 GPU 加速。'
                    : runtimeInfo && !runtimeInfo.hasWebGpuAdapter
                      ? '浏览器暴露了 WebGPU 接口，但未能获取到可用的 GPU 适配器（可能是驱动或系统策略限制），将使用 WASM 推理。'
                      : '正在检测 WebGPU 能力…'}
            </p>

            {/* 运行中发生的降级要如实告知 */}
            {activeRuntime?.fallbackReason && (
              <p className="text-[0.6875rem] text-amber-600 dark:text-amber-400">
                {activeRuntime.fallbackReason}
              </p>
            )}
          </div>

          {aiState.status === 'loading' && (
            <div className="zj-skeleton h-1.5 w-full rounded-full" />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={
                warming ||
                aiState.status === 'loading' ||
                downloadingId !== null ||
                // 未下载完不让加载 —— 避免又变成「下载并加载」的一把梭。
                // 注意 downloadStates 初始为空，此时不拦（等扫描结果出来再拦）。
                downloadStates[modelId]?.downloaded === false
              }
              onClick={async () => {
                setWarming(true);
                try {
                  // 切换模型前先卸载旧模型，释放内存
                  if (aiState.modelId !== modelId) {
                    await unloadLocalModel();
                  }
                  await loadLocalModel(modelId);
                  notify('本地模型已就绪', 'success');
                } catch (err) {
                  // 展示真实失败原因（而非笼统的「加载失败」），
                  // 便于区分网络问题、源不可达与文件缺失
                  const reason =
                    err instanceof Error && err.message
                      ? err.message
                      : '未知错误';
                  notify(`模型加载失败：${reason}`, 'error');
                } finally {
                  setWarming(false);
                  setAiState(getLocalAiState());
                  void refreshDownloadStates();
                }
              }}
            >
              {aiState.status === 'ready' && aiState.modelId === modelId ? (
                <RefreshCw className="size-3.5" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {aiState.status === 'ready' && aiState.modelId === modelId
                ? '重新加载模型'
                : `加载模型 ${modelId.split('/').pop()}`}
            </Button>

            {aiState.status === 'ready' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await unloadLocalModel();
                  setAiState(getLocalAiState());
                  notify('已卸载本地模型', 'info');
                }}
              >
                卸载模型
              </Button>
            )}

            {/* 清缓存重试：应对下载中断留下的坏缓存 */}
            {aiState.status === 'error' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={warming}
                onClick={async () => {
                  setWarming(true);
                  try {
                    await purgeModelCache();
                    // 缓存被清空了，「已下载」标记必须跟着失效，
                    // 否则界面会显示「已下载」但其实文件已经没了。
                    invalidateDownloadState();
                    await refreshDownloadStates();
                    await unloadLocalModel();
                    await loadLocalModel(modelId);
                    notify('已清理缓存并重新加载成功', 'success');
                  } catch (err) {
                    const reason =
                      err instanceof Error && err.message ? err.message : '未知错误';
                    notify(`仍然失败：${reason}`, 'error');
                  } finally {
                    setWarming(false);
                    setAiState(getLocalAiState());
                    void refreshDownloadStates();
                  }
                }}
              >
                <Trash2 className="size-3.5" />
                清缓存重试
              </Button>
            )}
          </div>

          {/* 两步流程的说明 + 状态提示 */}
          <p className="text-[0.6875rem] leading-relaxed text-[var(--zj-muted-fg)]">
            {downloadingId
              ? `正在下载 ${downloadingId.split('/').pop()}… ${Math.round((downloadProgress?.ratio ?? 0) * 100)}%${
                  downloadProgress && downloadProgress.total > 0
                    ? ` · ${(downloadProgress.loaded / 1024 / 1024).toFixed(0)} / ${(downloadProgress.total / 1024 / 1024).toFixed(0)} MB`
                    : ''
                }${
                  downloadProgress?.speed
                    ? ` · ${(downloadProgress.speed / 1024 / 1024).toFixed(1)} MB/s`
                    : ''
                }`
              : downloadStates[modelId]?.downloaded === false
                ? '所选模型尚未下载。请先点模型右侧的「下载」按钮把权重存到本地，完成后再点「加载模型」。'
                : '模型权重已存在本地缓存，「加载模型」不再需要下载流量。'}
          </p>

          {/* 失败详情：显示真实错误原因与当前生效的源 */}
          {aiState.status === 'error' && aiState.error && (
            <div className="space-y-1.5 rounded-md border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                加载失败原因
              </p>
              <p className="text-[0.75rem] leading-relaxed break-all text-[var(--zj-muted-fg)]">
                {aiState.error}
              </p>
              <p className="text-[0.6875rem] text-[var(--zj-muted-fg)]">
                当前源：{findModelSource(aiState.sourceId).name} —— 加载失败时会自动改用其它源重试；
                若仍失败可点「清缓存重试」。
              </p>
            </div>
          )}
        </div>
      </SettingRow>
    </div>
  );
}

/** 局域网连接设置 */
function LanSettings() {
  const lan = useAppStore((s) => s.lan);
  const setLan = useAppStore((s) => s.setLan);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const checking = useAppStore((s) => s.checking);
  const checkBackend = useAppStore((s) => s.checkBackend);
  const notify = useAppStore((s) => s.notify);

  return (
    <div className="space-y-4">
      <SettingRow title="后端服务状态" desc="定时轮询后端健康检查接口">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={backendOnline ? 'success' : 'outline'}>
              {checking ? '检测中…' : backendOnline ? '已连接' : '未连接'}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={checking}
            onClick={async () => {
              const ok = await checkBackend();
              notify(ok ? '后端连接成功' : '后端服务未开启，请启动后端服务后再使用该功能', ok ? 'success' : 'error');
            }}
          >
            <RefreshCw className="size-3.5" />
            重新检测
          </Button>
        </div>
      </SettingRow>

      <Separator />

      <SettingRow title="局域网地址" desc="填写运行后端服务的设备 IP，端口默认为 8787">
        <div className="space-y-2.5">
          <div className="space-y-1.5">
            <Label htmlFor="lan-host" className="text-xs">
              后端局域网 IP
            </Label>
            <Input
              id="lan-host"
              value={lan.host}
              onChange={(e) => setLan({ host: e.target.value })}
              placeholder="例如 192.168.1.100，留空则使用 localhost"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lan-port" className="text-xs">
              WebSocket 端口
            </Label>
            <Input
              id="lan-port"
              type="number"
              value={lan.port}
              onChange={(e) => setLan({ port: Number(e.target.value) || 8787 })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-[var(--zj-border)] px-3 py-2">
            <div>
              <p className="text-xs font-medium">自动连接重连</p>
              <p className="text-[0.75rem] text-[var(--zj-muted-fg)]">
                断线后按退避策略自动重试
              </p>
            </div>
            <Switch
              checked={lan.autoReconnect}
              onCheckedChange={(v) => setLan({ autoReconnect: v })}
            />
          </div>
        </div>
      </SettingRow>
    </div>
  );
}

/** API 配置卡片 */

/** 通用设置 */
function GeneralSettings() {
  const notify = useAppStore((s) => s.notify);
  const resetPacks = useThemeStore((s) => s.resetPacks);
  const packs = useThemeStore((s) => s.packs);
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);

  const [clearing, setClearing] = useState(false);

  return (
    <div className="space-y-3">
      <ActionRow
        icon={<Trash2 className="size-4" />}
        title="清空本地缓存"
        desc="清除 LocalStorage 中的临时数据（不影响登录状态）"
        actionLabel="清空"
        onClick={async () => {
          try {
            Object.keys(localStorage)
              .filter((k) => k.startsWith('zhijianxia:plugin:') || k.startsWith('zhijianxia:shared:'))
              .forEach((k) => localStorage.removeItem(k));
            notify('本地缓存已清空', 'success');
          } catch {
            notify('清空失败，请稍后重试', 'error');
          }
        }}
      />

      <ActionRow
        icon={<RotateCcw className="size-4" />}
        title="重置主题包"
        desc={`当前 ${packs.length} 个主题包，重置后仅保留内置预设`}
        actionLabel="重置"
        onClick={() => {
          resetPacks();
          notify('主题包已重置', 'success');
        }}
      />

      <ActionRow
        icon={<Database className="size-4" />}
        title="清除本地 IndexedDB 数据"
        desc="清除插件数据、壁纸与摘要历史等本地数据库内容"
        actionLabel="清除"
        danger
        loading={clearing}
        onClick={async () => {
          setClearing(true);
          try {
            await idbClear();
            notify('本地数据库已清空', 'success');
          } catch {
            notify('清除失败，请稍后重试', 'error');
          } finally {
            setClearing(false);
          }
        }}
      />

      <Separator />

      {/* 插件设置 */}
      <SettingRow
        title="插件设置"
        desc={`已安装 ${installed.length} / ${modules.length} 个插件`}
      >
        <div className="space-y-2">
          {modules
            .filter((m) => installed.includes(m.manifest.id))
            .map((m) => (
              <div
                key={m.manifest.id}
                className="flex items-center justify-between rounded-md border border-[var(--zj-border)] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{m.manifest.preview}</span>
                  <div>
                    <p className="text-xs font-medium">{m.manifest.name}</p>
                    <p className="text-[0.6875rem] text-[var(--zj-muted-fg)]">
                      v{m.manifest.version} · {m.manifest.category}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[0.6875rem]">
                  加载中
                </Badge>
              </div>
            ))}
          <p className="text-[0.75rem] text-[var(--zj-muted-fg)]">
            插件配置信息保存在前端 IndexedDB，可在功能广场导入导出。
          </p>
        </div>
      </SettingRow>

      {/* 管理员权限设置 */}
      <Separator />
      <SettingRow
        title="管理员权限"
        desc="管理员可编辑公告、写入后端 AI 配置"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-[var(--zj-muted-fg)]" />
          <Badge variant="outline">由后端分配角色</Badge>
        </div>
      </SettingRow>
    </div>
  );
}

/** 关于 */
function AboutSettings() {
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-md border border-[var(--zj-border)] p-4">
        <p className="text-sm font-medium">智简匣 v1.0.0</p>
        <p className="mt-1.5 leading-relaxed text-[var(--zj-muted-fg)]">
          本地离线 AI 优先的局域网工具箱。前端可独立运行，后端为可选组件，
          仅在需要好友、群聊、公告与后端转发 AI 时才启动。
        </p>
      </div>

      <div className="rounded-md border border-[var(--zj-border)] p-4">
        <p className="mb-2 font-medium">技术栈</p>
        <ul className="space-y-1 text-[var(--zj-muted-fg)]">
          <li>前端：Next.js 16 · React 19 · TypeScript · Tailwind CSS v4</li>
          <li>UI：shadcn/ui · Framer Motion · Zustand</li>
          <li>AI：Transformers.js（Xenova/Qwen1.5-0.5B-Chat）</li>
          <li>后端：Node.js · Express · ws · node:sqlite</li>
        </ul>
      </div>

      <div className="rounded-md border border-[var(--zj-border)] p-4">
        <p className="mb-2 font-medium">局域网连接说明</p>
        <ol className="list-decimal space-y-1 pl-4 text-[var(--zj-muted-fg)]">
          <li>在后端设备运行 <code>npm run server</code> 启动服务</li>
          <li>启动日志会打印本机局域网 IP</li>
          <li>在「局域网」设置中填写该 IP 与端口 8787</li>
          <li>所有设备处于同一 WiFi 即可互联，无需公网</li>
        </ol>
      </div>

      <div className="rounded-md border border-[var(--zj-border)] p-4">
        <p className="mb-2 font-medium">开源信息</p>
        <p className="text-[var(--zj-muted-fg)]">
          本项目采用 MIT 许可证。插件内核与所有功能插件完全解耦，
          每个插件独立开发、单独打包，新增插件无需修改 AI 核心代码。
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ 内部小组件 ------------------------------ */

/** 设置项行 */
function SettingRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-[46%]">
        <p className="text-sm font-medium">{title}</p>
        {desc && (
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--zj-muted-fg)]">
            {desc}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** 模式选项 */
function ModeOption({
  active,
  title,
  desc,
  disabled,
  disabledHint,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
          : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{title}</p>
        {active && <Badge variant="solid">当前</Badge>}
        {disabled && !active && (
          <Badge variant="warning" className="text-[0.6875rem]">
            {disabledHint}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--zj-muted-fg)]">
        {desc}
      </p>
    </button>
  );
}

/** 操作行 */
function ActionRow({
  icon,
  title,
  desc,
  actionLabel,
  onClick,
  danger,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  actionLabel: string;
  onClick: () => void | Promise<void>;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--zj-border)] px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 text-[var(--zj-muted-fg)]">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-medium">{title}</p>
          <p className="text-[0.75rem] text-[var(--zj-muted-fg)]">{desc}</p>
        </div>
      </div>
      <Button
        size="xs"
        variant={danger ? 'destructive' : 'outline'}
        onClick={() => void onClick()}
        disabled={loading}
        className="shrink-0"
      >
        {loading ? <Skeleton className="size-3" /> : actionLabel}
      </Button>
    </div>
  );
}

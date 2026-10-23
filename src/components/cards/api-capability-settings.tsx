'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Eye,
  Image as ImageIcon,
  KeyRound,
  MessageSquare,
  Mic,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import {
  API_CAPABILITIES,
  API_CATALOG,
  findProvider,
  modelsOf,
  providersFor,
  type ApiCapability,
} from '@/lib/ai/api-providers';
import {
  fetchBackendAiConfig,
  saveCapabilityConfig,
  type CapabilityConfig,
} from '@/lib/backend/api';
import { cn } from '@/lib/utils';

/** 能力分类对应图标 */
const CAP_ICONS = {
  chat: MessageSquare,
  vision: Eye,
  image: ImageIcon,
  speech: Mic,
} as const;

/** 单个能力分类的配置面板 */
function CapabilitySection({
  capability,
  config,
  onSaved,
}: {
  capability: ApiCapability;
  config?: CapabilityConfig;
  onSaved: (cap: ApiCapability, cfg: CapabilityConfig) => void;
}) {
  const lan = useAppStore((s) => s.lan);
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const notify = useAppStore((s) => s.notify);

  const meta = API_CAPABILITIES.find((c) => c.id === capability);
  const providers = useMemo(
    () => providersFor(capability),
    [capability],
  );

  const [providerId, setProviderId] = useState<string>(
    config?.provider ?? providers[0]?.id ?? '',
  );
  const [model, setModel] = useState<string>(config?.model ?? '');
  const [base, setBase] = useState<string>(config?.base ?? '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // 载入后端已有的该能力配置
  useEffect(() => {
    let mounted = true;
    if (!token) {
      setLoading(false);
      return;
    }
    void fetchBackendAiConfig(lan, token)
      .then((cfg) => {
        if (!mounted) return;
        const c = cfg.capabilities?.[capability];
        // 后端未配置该能力时（provider 为空），保持默认服务商，
        // 否则模型列表会因找不到服务商而空掉。
        if (c?.provider) {
          setProviderId(c.provider);
          setModel(c.model);
          setBase(c.base);
        } else {
          const fallback = providers[0];
          if (fallback) {
            setProviderId(fallback.id);
            setBase(fallback.baseUrl);
            setModel(modelsOf(fallback.id, capability)[0]?.id ?? '');
          }
        }
      })
      .catch(() => {
        /* 后端离线时保持默认值 */
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [capability, lan, token, providers]);

  // 切换服务商时，自动带出默认地址与首个模型
  const onPickProvider = (id: string) => {
    setProviderId(id);
    const p = findProvider(id);
    if (p) {
      setBase(p.baseUrl);
      const list = modelsOf(id, capability);
      setModel(list[0]?.id ?? '');
    }
  };

  const modelOptions = modelsOf(providerId, capability);
  const provider = findProvider(providerId);

  const save = async () => {
    if (!token) {
      notify('请先登录后再配置 API', 'error');
      return;
    }
    if (!provider) {
      notify('请先选择服务商', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveCapabilityConfig(lan, token, {
        capability,
        provider: providerId,
        protocol: provider.protocol,
        base: base.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey('');
      onSaved(capability, {
        provider: providerId,
        protocol: provider.protocol,
        base: base.trim(),
        model: model.trim(),
        hasKey: true,
      });
      notify(`${meta?.name ?? capability} 配置已保存`, 'success');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : '保存失败，请检查后端连接',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 服务商选择 */}
      <div className="space-y-1.5">
        <Label className="text-xs">服务商</Label>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {providers.map((p) => {
            const active = providerId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPickProvider(p.id)}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
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
                  <span className="block truncate text-xs font-medium">
                    {p.name}
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] text-[var(--zj-muted-fg)]">
                    {p.protocol === 'openai'
                      ? 'OpenAI 兼容协议'
                      : p.protocol === 'anthropic'
                        ? 'Claude 原生协议'
                        : p.protocol === 'gemini'
                          ? 'Gemini 原生协议'
                          : 'Stability 原生协议'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 模型选择 */}
      <div className="space-y-1.5">
        <Label htmlFor={`model-${capability}`} className="text-xs">
          模型
        </Label>
        {modelOptions.length > 0 ? (
          <div className="grid gap-1.5">
            {modelOptions.map((m) => {
              const active = model === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModel(m.id)}
                  className={cn(
                    'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
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
                    <span className="block truncate text-xs font-medium">
                      {m.name}
                    </span>
                    <span className="mt-0.5 block text-[0.6875rem] text-[var(--zj-muted-fg)]">
                      {m.desc} · {m.id}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <Input
            id={`model-${capability}`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="输入模型名称"
          />
        )}
      </div>

      {/* 接口地址 */}
      <div className="space-y-1.5">
        <Label htmlFor={`base-${capability}`} className="text-xs">
          接口地址
        </Label>
        <Input
          id={`base-${capability}`}
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder={provider?.baseUrl ?? 'https://...'}
        />
        {provider && (
          <a
            href={provider.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[0.6875rem] text-[var(--zj-accent)] hover:underline"
          >
            查看 {provider.name} 密钥申请说明 →
          </a>
        )}
      </div>

      {/* API Key */}
      <div className="space-y-1.5">
        <Label htmlFor={`key-${capability}`} className="text-xs">
          API Key
          {config?.hasKey && (
            <span className="ml-1.5 text-[0.6875rem] text-emerald-500">
              后端已配置
            </span>
          )}
        </Label>
        <Input
          id={`key-${capability}`}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider?.keyHint ?? 'sk-...'}
          disabled={!isAdmin}
        />
        {!isAdmin && (
          <p className="text-[0.6875rem] text-[var(--zj-muted-fg)]">
            仅管理员可修改 API Key
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant="outline"
        disabled={saving || !isAdmin || !provider}
        onClick={save}
      >
        <RefreshCw className="size-3.5" />
        {saving ? '保存中…' : `保存${meta?.name ?? ''}配置`}
      </Button>
    </div>
  );
}

/**
 * API 设置 —— 按能力分类组织。
 * 文本对话 / 多模态模型 / 图像生成 / 语音模型 各自独立选择服务商与模型。
 */
export function ApiCapabilitySettings() {
  const lan = useAppStore((s) => s.lan);
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const notify = useAppStore((s) => s.notify);
  const backendOnline = useAppStore((s) => s.backendOnline);

  const [active, setActive] = useState<ApiCapability>('chat');
  const [configs, setConfigs] = useState<
    Partial<Record<ApiCapability, CapabilityConfig>>
  >({});
  const [loading, setLoading] = useState(true);

  // 一次性载入全部能力配置
  useEffect(() => {
    let mounted = true;
    if (!token) {
      setLoading(false);
      return;
    }
    void fetchBackendAiConfig(lan, token)
      .then((cfg) => {
        if (mounted) setConfigs(cfg.capabilities ?? {});
      })
      .catch(() => {
        /* 后端离线时保持空 */
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [lan, token]);

  const Icon = CAP_ICONS[active];

  return (
    <div className="space-y-4">
      {!backendOnline && (
        <div className="zj-surface bg-[var(--zj-muted)] px-3 py-2.5 text-[0.6875rem] leading-relaxed text-[var(--zj-muted-fg)]">
          后端服务未开启，API 配置仅保存在浏览器本地；启动后端后即可使用转发调用。
        </div>
      )}

      {/* 能力分类切换 */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {API_CAPABILITIES.map((c) => {
          const CapIcon = CAP_ICONS[c.id as ApiCapability];
          const isActive = active === c.id;
          const cfg = configs[c.id];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(c.id)}
              className={cn(
                'flex flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left transition-colors',
                isActive
                  ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                  : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
              )}
            >
              <span className="flex w-full items-center justify-between gap-1">
                <CapIcon
                  className={cn(
                    'size-3.5 shrink-0',
                    isActive ? 'text-[var(--zj-accent)]' : 'text-[var(--zj-muted-fg)]',
                  )}
                />
                {cfg?.hasKey && (
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                )}
              </span>
              <span className="text-[0.6875rem] font-medium">{c.name}</span>
            </button>
          );
        })}
      </div>

      <Separator />

      {/* 当前能力的说明 */}
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Icon className="size-3.5 text-[var(--zj-accent)]" />
          {API_CAPABILITIES.find((c) => c.id === active)?.name}
        </p>
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--zj-muted-fg)]">
          {API_CAPABILITIES.find((c) => c.id === active)?.desc}
        </p>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <CapabilitySection
          key={active}
          capability={active}
          config={configs[active]}
          onSaved={(cap, cfg) =>
            setConfigs((prev) => ({ ...prev, [cap]: cfg }))
          }
        />
      )}

      <Separator />

      {/* 全局参数 */}
      <GlobalApiParams
        onTip={(t) => notify(t, 'info')}
      />
    </div>
  );
}

/** 全局请求参数（超时与温度对所有能力生效） */
function GlobalApiParams({ onTip }: { onTip: (t: string) => void }) {
  const api = useAppStore((s) => s.api);
  const setApi = useAppStore((s) => s.setApi);
  const lan = useAppStore((s) => s.lan);
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [timeout, setTimeoutVal] = useState(String(api.timeout));
  const [temperature, setTemperature] = useState(String(api.temperature));

  const save = async () => {
    const t = Math.max(1000, Math.min(600000, Number(timeout) || 30000));
    const temp = Math.max(0, Math.min(2, Number(temperature) || 0.7));
    setApi({ timeout: t, temperature: temp });
    if (token && isAdmin) {
      try {
        const { saveBackendAiConfig } = await import('@/lib/backend/api');
        await saveBackendAiConfig(lan, token, {
          apiUrl: api.apiUrl,
          model: api.model,
          timeout: t,
          temperature: temp,
        });
        onTip('请求参数已保存到后端');
        return;
      } catch {
        onTip('参数已保存到本地，后端同步失败');
        return;
      }
    }
    onTip('请求参数已保存');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">请求参数</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="api-timeout" className="text-xs">
            请求超时（毫秒）
          </Label>
          <Input
            id="api-timeout"
            value={timeout}
            onChange={(e) => setTimeoutVal(e.target.value)}
            inputMode="numeric"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-temperature" className="text-xs">
            温度
          </Label>
          <Input
            id="api-temperature"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={save}>
        <KeyRound className="size-3.5" />
        保存请求参数
      </Button>
    </div>
  );
}

export { API_CATALOG };

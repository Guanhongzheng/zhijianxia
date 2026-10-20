'use client';

import { useEffect, useState } from 'react';
import {
  Cpu,
  Database,
  Info,
  KeyRound,
  Network,
  Plug,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { useThemeStore } from '@/store/theme-store';
import { usePluginStore } from '@/store/plugin-store';
import {
  fetchBackendAiConfig,
  saveBackendAiConfig,
  testApiConnection,
} from '@/lib/backend/api';
import { idbClear } from '@/lib/storage/idb';
import { getLocalAiState, loadLocalModel } from '@/lib/ai/local-engine';

/** 系统设置面板 */
export function SettingsPanel() {
  return (
    <div className="max-h-[70dvh] overflow-y-auto pr-1">
      <Tabs defaultValue="ai">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5">
          <TabsTrigger value="ai">
            <Cpu className="size-3.5" />
            AI 引擎
          </TabsTrigger>
          <TabsTrigger value="lan">
            <Network className="size-3.5" />
            局域网
          </TabsTrigger>
          <TabsTrigger value="api">
            <KeyRound className="size-3.5" />
            API
          </TabsTrigger>
          <TabsTrigger value="general">
            <Database className="size-3.5" />
            通用
          </TabsTrigger>
          <TabsTrigger value="about">
            <Info className="size-3.5" />
            关于
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
          <AiEngineSettings />
        </TabsContent>
        <TabsContent value="lan">
          <LanSettings />
        </TabsContent>
        <TabsContent value="api">
          <ApiSettings />
        </TabsContent>
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="about">
          <AboutSettings />
        </TabsContent>
      </Tabs>
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
        title="本地模型"
        desc="Xenova/Qwen1.5-0.5B-Chat · 首次使用需下载模型文件，之后完全离线可用"
      >
        <div className="space-y-2">
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

          {aiState.status === 'loading' && (
            <div className="zj-skeleton h-1.5 w-full rounded-full" />
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={warming || aiState.status === 'loading'}
            onClick={async () => {
              setWarming(true);
              try {
                await loadLocalModel();
                notify('本地模型已就绪', 'success');
              } catch {
                notify('模型加载失败，请检查网络后重试', 'error');
              } finally {
                setWarming(false);
                setAiState(getLocalAiState());
              }
            }}
          >
            <RefreshCw className="size-3.5" />
            {aiState.status === 'ready' ? '重新加载模型' : '预热本地模型'}
          </Button>
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
              <p className="text-[11px] text-[var(--zj-muted-fg)]">
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
function ApiSettings() {
  const api = useAppStore((s) => s.api);
  const setApi = useAppStore((s) => s.setApi);
  const lan = useAppStore((s) => s.lan);
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const notify = useAppStore((s) => s.notify);

  const [testing, setTesting] = useState(false);
  const [backendKeySet, setBackendKeySet] = useState(false);
  const [draft, setDraft] = useState({
    apiUrl: api.apiUrl,
    model: api.model,
    timeout: api.timeout,
    temperature: api.temperature,
    apiKey: '',
  });

  useEffect(() => {
    setDraft({
      apiUrl: api.apiUrl,
      model: api.model,
      timeout: api.timeout,
      temperature: api.temperature,
      apiKey: '',
    });
  }, [api.apiUrl, api.model, api.timeout, api.temperature]);

  // 读取后端是否已配置密钥（不返回明文）
  useEffect(() => {
    if (!token) return;
    void fetchBackendAiConfig(lan, token)
      .then((cfg) => setBackendKeySet(cfg.hasKey))
      .catch(() => setBackendKeySet(false));
  }, [lan, token]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[var(--zj-border)] bg-[var(--zj-muted)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--zj-muted-fg)]">
        {api.mode === 'backend'
          ? '当前为后端转发模式：API Key 提交给后端后加密存储，不会回传到前端。'
          : '当前为前端本地模式：API Key 仅保存在浏览器本地加密存储中，不会上传到任何服务器。'}
      </div>

      <div className="space-y-2.5">
        <div className="space-y-1.5">
          <Label htmlFor="api-url" className="text-xs">
            API 地址
          </Label>
          <Input
            id="api-url"
            value={draft.apiUrl}
            onChange={(e) => setDraft({ ...draft, apiUrl: e.target.value })}
            placeholder="https://api.openai.com/v1/chat/completions"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="api-key" className="text-xs">
            API Key
            {api.mode === 'backend' && backendKeySet && (
              <span className="ml-1.5 text-[10px] text-emerald-500">
                后端已配置
              </span>
            )}
          </Label>
          <Input
            id="api-key"
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="api-model" className="text-xs">
            模型名称
          </Label>
          <Input
            id="api-model"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="gpt-4o-mini"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="api-timeout" className="text-xs">
              请求超时（毫秒）
            </Label>
            <Input
              id="api-timeout"
              type="number"
              value={draft.timeout}
              onChange={(e) =>
                setDraft({ ...draft, timeout: Number(e.target.value) || 30000 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">温度：{draft.temperature.toFixed(1)}</Label>
            <Slider
              value={[draft.temperature]}
              min={0}
              max={2}
              step={0.1}
              onValueChange={([v]) => setDraft({ ...draft, temperature: v })}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={async () => {
            setApi({
              apiUrl: draft.apiUrl,
              model: draft.model,
              timeout: draft.timeout,
              temperature: draft.temperature,
              ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
            });

            // 后端转发模式下，管理员可把配置写入后端加密存储
            if (api.mode === 'backend' && isAdmin && token) {
              try {
                await saveBackendAiConfig(lan, token, {
                  apiUrl: draft.apiUrl,
                  model: draft.model,
                  timeout: draft.timeout,
                  temperature: draft.temperature,
                  ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
                });
                setBackendKeySet(true);
              } catch (err) {
                notify(
                  err instanceof Error ? err.message : '后端配置保存失败',
                  'error',
                );
                return;
              }
            }
            notify('配置已保存', 'success');
          }}
        >
          保存配置
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={testing}
          onClick={async () => {
            setTesting(true);
            try {
              const ok = await testApiConnection({
                apiUrl: draft.apiUrl,
                apiKey: draft.apiKey || api.apiKey,
                model: draft.model,
                timeout: draft.timeout,
                temperature: draft.temperature,
              });
              notify(ok ? 'API 连通性正常' : 'API 连通性测试失败', ok ? 'success' : 'error');
            } catch (err) {
              notify(err instanceof Error ? err.message : 'API 测试失败', 'error');
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing ? <Skeleton className="size-3.5" /> : <Plug className="size-3.5" />}
          测试连通性
        </Button>
      </div>

      {api.mode === 'backend' && !isAdmin && (
        <p className="text-[11px] text-[var(--zj-muted-fg)]">
          后端转发配置仅管理员可写入，普通用户的配置保存在本地。
        </p>
      )}
    </div>
  );
}

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
                    <p className="text-[10px] text-[var(--zj-muted-fg)]">
                      v{m.manifest.version} · {m.manifest.category}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  加载中
                </Badge>
              </div>
            ))}
          <p className="text-[11px] text-[var(--zj-muted-fg)]">
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
          <Badge variant="warning" className="text-[10px]">
            {disabledHint}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--zj-muted-fg)]">
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
          <p className="text-[11px] text-[var(--zj-muted-fg)]">{desc}</p>
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

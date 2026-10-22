/**
 * 可下载插件 · 极简随身音乐播放器
 *
 * 特性：
 * - 内置曲目全部由 WebAudio 实时合成，**不依赖任何外部音频 URL**（离线可用）
 * - 支持导入本地音频文件（<input type="file"> + URL.createObjectURL）
 * - 播放 / 暂停 / 上下曲 / 进度拖拽 / 音量 / 循环模式
 * - 与番茄钟联动：读取 shared:pomodoro-state 广播，自动切换曲目
 * - 「AI 按场景推荐背景音乐」调用 ctx.ai.chat
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import {
  Disc3,
  Headphones,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAiTask, useInterval } from '../hooks';
import { cx, formatClock, runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'music-player',
  name: '极简随身音乐播放器',
  version: '1.0.0',
  description: '内置 WebAudio 合成曲库与本地音频导入，支持播放控制、循环模式、AI 场景推荐与番茄钟联动。',
  category: '生活',
  author: '智简匣',
  icon: 'Disc3',
  preview: '🎧',
  tags: ['音乐', '专注', 'AI'],
  minCoreVersion: '1.0.0',
  builtin: false,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 曲目定义                                                                    */
/* -------------------------------------------------------------------------- */

/** 循环模式 */
type LoopMode = 'off' | 'one' | 'all';

/** 曲目 */
interface Track {
  id: string;
  title: string;
  artist: string;
  /** 情绪标签，AI 推荐按此匹配 */
  mood: string;
  /** 合成用音符序列（半音相对值） */
  notes: number[];
  /** 每分钟节拍 */
  bpm: number;
  /** 单个音符时长（秒） */
  noteDuration: number;
}

/** 内置合成曲目 */
const BUILTIN_TRACKS: Track[] = [
  {
    id: 'morning-light',
    title: '晨光',
    artist: '内置合成',
    mood: '清新 专注 早晨',
    notes: [0, 4, 7, 12, 7, 4, 2, 4],
    bpm: 84,
    noteDuration: 0.42,
  },
  {
    id: 'deep-focus',
    title: '深流',
    artist: '内置合成',
    mood: '专注 深度 夜晚',
    notes: [0, 3, 7, 10, 12, 10, 7, 3],
    bpm: 72,
    noteDuration: 0.56,
  },
  {
    id: 'soft-rain',
    title: '细雨',
    artist: '内置合成',
    mood: '放松 雨天 舒缓',
    notes: [0, 5, 9, 12, 9, 5, 2, 5],
    bpm: 66,
    noteDuration: 0.64,
  },
  {
    id: 'warm-afternoon',
    title: '暖午后',
    artist: '内置合成',
    mood: '轻快 午后 治愈',
    notes: [7, 9, 12, 16, 14, 12, 9, 7],
    bpm: 96,
    noteDuration: 0.34,
  },
  {
    id: 'deep-sea',
    title: '深海',
    artist: '内置合成',
    mood: '安静 冥想 睡前',
    notes: [0, 5, 3, 8, 5, 0, 3, 5],
    bpm: 58,
    noteDuration: 0.78,
  },
];

/** 番茄钟广播键（与 pomodoro 插件约定一致） */
const BROADCAST_KEY = 'shared:pomodoro-state';

/** 番茄钟广播内容 */
interface PomodoroBroadcast {
  running: boolean;
  phase: 'focus' | 'break';
  at: number;
}

/* -------------------------------------------------------------------------- */
/* WebAudio 合成引擎                                                           */
/* -------------------------------------------------------------------------- */

/** 半音 -> 频率 */
function semitoneToFreq(semitone: number, base = 261.63): number {
  return base * Math.pow(2, semitone / 12);
}

/**
 * 极简合成器：按节拍调度音符，用包络控制音量。
 * 纯 WebAudio 实现，不请求任何外部资源。
 */
class SynthEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private noteIndex = 0;
  private nextNoteTime = 0;
  private track: Track | null = null;
  private volume = 0.6;

  /** 释放全部资源 */
  dispose(): void {
    this.stopScheduler();
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
      this.master = null;
    }
  }

  /** 停止调度（保持 context） */
  private stopScheduler(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 确保音频上下文与主音量节点就绪 */
  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    if (!this.context) {
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }
    return this.context;
  }

  /** 设置音量 */
  setVolume(value: number): void {
    this.volume = value;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
    }
  }

  /**
   * 播放指定曲目。
   * @param track 曲目
   * @param offset 起始偏移（秒）
   */
  play(track: Track, offset = 0): boolean {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return false;

    this.stopScheduler();
    this.track = track;
    this.noteIndex = Math.floor(offset / track.noteDuration) % track.notes.length;
    this.nextNoteTime = ctx.currentTime + 0.05;

    this.timer = window.setInterval(() => {
      this.schedule();
    }, 40);

    this.schedule();
    return true;
  }

  /** 暂停 */
  pause(): void {
    this.stopScheduler();
    if (this.context) {
      // 快速淡出，避免爆音
      if (this.master) {
        this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.02);
        window.setTimeout(() => {
          if (this.master && this.context) {
            this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
          }
        }, 60);
      }
    }
  }

  /** 调度音符（前瞻 0.3 秒） */
  private schedule(): void {
    const ctx = this.context;
    const master = this.master;
    const track = this.track;
    if (!ctx || !master || !track) return;

    const secondsPerBeat = 60 / track.bpm;
    const stepDuration = track.noteDuration * secondsPerBeat;

    while (this.nextNoteTime < ctx.currentTime + 0.3) {
      const semitone = track.notes[this.noteIndex % track.notes.length] ?? 0;
      const freq = semitoneToFreq(semitone);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const envelope = ctx.createGain();
      const start = this.nextNoteTime;
      const peak = 0.18;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(peak, start + 0.04);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + track.noteDuration * secondsPerBeat * 0.9);

      osc.connect(envelope);
      envelope.connect(master);
      osc.start(start);
      osc.stop(start + track.noteDuration * secondsPerBeat);

      this.noteIndex += 1;
      this.nextNoteTime += stepDuration;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

/** AI 推荐的系统提示词 */
const RECOMMEND_SYSTEM =
  '你是一位音乐策展人。根据用户给出的场景，从以下可用曲库中挑选最合适的曲目，并以 JSON 数组返回。' +
  '可用曲库：晨光(清新 专注 早晨)、深流(专注 深度 夜晚)、细雨(放松 雨天 舒缓)、暖午后(轻快 午后 治愈)、深海(安静 冥想 睡前)。' +
  '每个元素包含：title（曲名，必须来自曲库）、reason（推荐理由，25 字以内）。只输出 JSON 数组。';

export function MusicPlayerCard({ ctx }: PluginComponentProps) {
  const [tracks] = useState<Track[]>(BUILTIN_TRACKS);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.6);
  const [loopMode, setLoopMode] = useState<LoopMode>('all');
  const [imported, setImported] = useState<{ name: string; url: string } | null>(null);
  const [pomodoroPhase, setPomodoroPhase] = useState<'focus' | 'break' | null>(null);

  const engineRef = useRef<SynthEngine | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const task = useAiTask();

  const current = tracks[index];

  /** 单曲总时长（合成曲目按循环计算） */
  const trackDuration = useMemo(() => {
    if (!current) return 0;
    const secondsPerBeat = 60 / current.bpm;
    return current.notes.length * current.noteDuration * secondsPerBeat;
  }, [current]);

  /** 初始化合成引擎 */
  useEffect(() => {
    engineRef.current = new SynthEngine();
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  /** 番茄钟联动：监听共享状态，专注/休息时自动切换曲目 */
  useEffect(() => {
    const unsubscribe = ctx.storage.subscribe<PomodoroBroadcast>(BROADCAST_KEY, (value) => {
      if (!value) return;
      setPomodoroPhase(value.phase);
      if (!value.running) return;
      // 专注 -> 深流；休息 -> 细雨
      const targetId = value.phase === 'focus' ? 'deep-focus' : 'soft-rain';
      const targetIndex = tracks.findIndex((t) => t.id === targetId);
      if (targetIndex >= 0 && targetIndex !== index) {
        setIndex(targetIndex);
        setPosition(0);
        setPlaying(true);
      }
    });
    return unsubscribe;
  }, [ctx, index, tracks]);

  /** 位置心跳：更新进度并处理曲末逻辑 */
  useInterval(
    () => {
      setPosition((prev) => {
        const limit = duration || trackDuration || 1;
        if (prev + 1 < limit) return prev + 1;
        // 到达曲末
        if (loopMode === 'one') {
          setPosition(0);
          return 0;
        }
        if (loopMode === 'all') {
          setIndex((i) => (i + 1) % tracks.length);
          return 0;
        }
        setPlaying(false);
        return limit;
      });
    },
    playing ? 1000 : null,
  );

  /** 播放 / 暂停 */
  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (imported && audioRef.current) {
      const audio = audioRef.current;
      if (playing) {
        audio.pause();
        setPlaying(false);
      } else {
        void audio.play().then(
          () => setPlaying(true),
          () => {
            ctx.notify('浏览器阻止了自动播放，请再次点击播放', 'error');
          },
        );
      }
      return;
    }

    if (playing) {
      engine.pause();
      setPlaying(false);
    } else {
      const ok = engine.play(current, position);
      if (!ok) {
        ctx.notify('当前浏览器不支持 WebAudio 合成', 'error');
        return;
      }
      setPlaying(true);
    }
  }, [current, ctx, imported, playing, position]);

  /** 切换曲目 */
  const selectTrack = useCallback(
    (nextIndex: number) => {
      const next = tracks[nextIndex];
      if (!next) return;
      engineRef.current?.pause();
      setIndex(nextIndex);
      setPosition(0);
      setDuration(0);
      if (playing) {
        engineRef.current?.play(next, 0);
      }
    },
    [playing, tracks],
  );

  /** 上一首 / 下一首 */
  const step = useCallback(
    (delta: number) => {
      selectTrack((index + delta + tracks.length) % tracks.length);
    },
    [index, selectTrack, tracks.length],
  );

  /** 随机播放 */
  const shuffle = useCallback(() => {
    if (tracks.length <= 1) return;
    let next = index;
    while (next === index) {
      next = Math.floor(Math.random() * tracks.length);
    }
    selectTrack(next);
  }, [index, selectTrack, tracks.length]);

  /** 进度拖拽 */
  const seek = useCallback(
    (value: number) => {
      const limit = duration || trackDuration || 1;
      const next = Math.min(Math.max(value, 0), limit);
      setPosition(next);
      if (playing && engineRef.current) {
        engineRef.current.play(current, next);
      }
    },
    [current, duration, playing, trackDuration],
  );

  /** 音量调整 */
  const changeVolume = useCallback((value: number) => {
    setVolume(value);
    engineRef.current?.setVolume(value);
    if (audioRef.current) {
      audioRef.current.volume = value;
    }
  }, []);

  /** 循环模式切换 */
  const cycleLoop = useCallback(() => {
    setLoopMode((prev) => (prev === 'all' ? 'one' : prev === 'one' ? 'off' : 'all'));
  }, []);

  /** 导入本地音频 */
  const importFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      engineRef.current?.pause();
      setPlaying(false);
      const url = URL.createObjectURL(file);
      setImported({ name: file.name, url });
      const audio = audioRef.current;
      if (audio) {
        audio.src = url;
        audio.loop = false;
        audio.volume = volume;
      }
      ctx.notify(`已导入音频：${file.name}`, 'success');
      event.target.value = '';
    },
    [ctx, volume],
  );

  /** 移除导入的音频，回到内置合成曲库 */
  const removeImport = useCallback(() => {
    if (imported) {
      URL.revokeObjectURL(imported.url);
    }
    setImported(null);
    if (audioRef.current) {
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    setPosition(0);
    setDuration(0);
  }, [imported]);

  /** AI 按场景推荐 */
  const recommend = useCallback(async () => {
    const result = await task.run(() =>
      runAi(ctx, {
        system: RECOMMEND_SYSTEM,
        user: '我现在的场景是：坐在电脑前写代码，需要长时间专注，请推荐 2 首曲子。',
        temperature: 0.7,
      }),
    );
    if (!result) {
      ctx.notify(task.error || '推荐失败', 'error');
      return;
    }
    try {
      const parsed = JSON.parse(result.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0] as { title?: string };
        const matchIndex = tracks.findIndex((t) => t.title === first?.title);
        if (matchIndex >= 0) {
          selectTrack(matchIndex);
          ctx.notify(`已为你切到《${tracks[matchIndex].title}》`, 'success');
        } else {
          ctx.notify('推荐曲名不在曲库中，已保留当前曲目', 'info');
        }
      }
    } catch {
      ctx.notify('推荐内容解析失败', 'error');
    }
  }, [ctx, selectTrack, task, tracks]);

  const limit = duration || trackDuration || 1;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Headphones className="h-4 w-4" />
            极简随身音乐播放器
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {imported ? `本地文件：${imported.name}` : `内置合成曲库 · 共 ${tracks.length} 首`}
          </p>
        </div>
        {pomodoroPhase && (
          <Badge variant="outline" className="shrink-0">
            番茄钟：{pomodoroPhase === 'focus' ? '专注' : '休息'}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 当前曲目 */}
        <motion.div
          key={imported ? imported.name : current?.id}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="rounded-lg border border-border/50 bg-gradient-to-br from-muted/50 to-muted/20 p-4 text-center"
        >
          <Disc3
            className={cx(
              'mx-auto mb-2 h-10 w-10 text-muted-foreground',
              playing && 'animate-spin',
            )}
          />
          <p className="text-sm font-medium">{imported ? imported.name : current?.title}</p>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
            {imported ? '本地音频' : current?.artist}
          </p>
        </motion.div>

        {/* 进度条 */}
        <div className="space-y-1.5">
          <Slider
            value={[position]}
            min={0}
            max={limit}
            step={1}
            onValueChange={(v) => seek(v[0] ?? 0)}
            aria-label="播放进度"
          />
          <div className="flex justify-between text-[0.6875rem] tabular-nums text-muted-foreground">
            <span>{formatClock(position)}</span>
            <span>{formatClock(limit)}</span>
          </div>
        </div>

        {/* 主控制 */}
        <div className="flex items-center justify-center gap-3">
          <Button size="icon" variant="ghost" onClick={shuffle} aria-label="随机播放">
            <Shuffle className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => step(-1)} aria-label="上一首">
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button size="lg" className="h-12 w-12 rounded-full" onClick={togglePlay} aria-label="播放或暂停">
            {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => step(1)} aria-label="下一首">
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={cycleLoop} aria-label="循环模式">
            {loopMode === 'one' ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
          </Button>
        </div>

        {/* 音量 */}
        <div className="flex items-center gap-2">
          <Volume2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Slider
            value={[volume]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(v) => changeVolume(v[0] ?? 0.6)}
            className="flex-1"
            aria-label="音量"
          />
          <span className="w-8 shrink-0 text-right text-[0.6875rem] tabular-nums text-muted-foreground">
            {Math.round(volume * 100)}
          </span>
        </div>

        {/* 本地音频（隐藏的 audio 元素） */}
        <audio
          ref={audioRef}
          onTimeUpdate={(e) => {
            const audio = e.currentTarget;
            setPosition(audio.currentTime);
            setDuration(audio.duration || 0);
          }}
          onEnded={() => {
            const audio = audioRef.current;
            if (loopMode === 'all') {
              step(1);
            } else if (loopMode === 'one') {
              if (audio) {
                audio.currentTime = 0;
                void audio.play();
              }
            } else {
              setPlaying(false);
            }
          }}
          className="hidden"
        />

        {/* 曲库 / 推荐 / 导入 */}
        <Tabs defaultValue="library">
          <TabsList className="w-full">
            <TabsTrigger value="library" className="flex-1 text-xs">
              <ListMusic className="mr-1 h-3 w-3" />
              曲库
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex-1 text-xs">
              <Sparkles className="mr-1 h-3 w-3" />
              AI 推荐
            </TabsTrigger>
            <TabsTrigger value="local" className="flex-1 text-xs">
              <Upload className="mr-1 h-3 w-3" />
              本地
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="mt-3">
            <ul className="space-y-1.5">
              {tracks.map((track, i) => (
                <li key={track.id}>
                  <button
                    type="button"
                    onClick={() => selectTrack(i)}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors',
                      i === index
                        ? 'border-primary bg-primary/5'
                        : 'border-border/50 hover:border-primary/40',
                    )}
                  >
                    <span className="w-4 shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{track.title}</span>
                      <span className="block truncate text-[0.6875rem] text-muted-foreground">
                        {track.mood}
                      </span>
                    </span>
                    {i === index && playing && (
                      <span className="flex items-end gap-0.5" aria-hidden>
                        {[0, 1, 2].map((n) => (
                          <motion.span
                            key={n}
                            className="w-0.5 rounded-full bg-primary"
                            animate={{ height: [4, 10, 4] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: n * 0.15 }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="ai" className="mt-3 space-y-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => void recommend()}
              disabled={task.loading}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {task.loading ? '推荐中…' : 'AI 按场景推荐背景音乐'}
            </Button>

            {task.loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : task.error ? (
              <p className="text-xs text-destructive">{task.error}</p>
            ) : task.result ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs leading-relaxed"
              >
                <p className="whitespace-pre-wrap">{task.result}</p>
              </motion.div>
            ) : (
              <p className="rounded-lg border border-dashed border-border/60 p-3 text-center text-[0.75rem] text-muted-foreground">
                让 AI 根据当前场景挑一首合适的曲子
              </p>
            )}
          </TabsContent>

          <TabsContent value="local" className="mt-3 space-y-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 p-4 text-xs text-muted-foreground transition-colors hover:border-primary/50">
              <Upload className="h-3.5 w-3.5" />
              点击导入本地音频文件
              <input type="file" accept="audio/*" className="hidden" onChange={importFile} />
            </label>

            {imported && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 p-2.5">
                <span className="min-w-0 flex-1 truncate text-xs">{imported.name}</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={removeImport}>
                  移除
                </Button>
              </div>
            )}

            <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
              导入的文件只在浏览器内存中播放，不会上传到任何服务器；移除后立即释放。
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default MusicPlayerCard;

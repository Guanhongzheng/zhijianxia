/**
 * 可下载插件 · AI 简易食谱助手
 *
 * 输入现有食材 -> AI 推荐可做的家常菜谱与步骤
 * 食材可自由增删，菜谱结果按需重新生成。
 */

'use client';

import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { ChefHat, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAiTask } from '../hooks';
import { parseJsonLoose, runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'recipe-assistant',
  name: 'AI 简易食谱助手',
  version: '1.0.0',
  description: '输入冰箱里现有的食材，AI 推荐可做的家常菜谱，包含用料、步骤与耗时。',
  category: '生活',
  author: '智简匣',
  icon: 'ChefHat',
  preview: '🍳',
  tags: ['食谱', '做饭', 'AI'],
  minCoreVersion: '1.0.0',
  builtin: false,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 数据模型                                                                    */
/* -------------------------------------------------------------------------- */

/** 菜谱 */
interface Recipe {
  name: string;
  /** 预计耗时（分钟） */
  minutes: number;
  /** 难度 */
  difficulty: '简单' | '中等' | '稍难';
  /** 需要额外补充的食材 */
  missing?: string[];
  /** 制作步骤 */
  steps: string[];
  /** 小贴士 */
  tip?: string;
}

/** 常用食材快捷标签 */
const QUICK_INGREDIENTS = ['鸡蛋', '番茄', '土豆', '青椒', '猪肉', '豆腐', '面条', '米饭', '白菜', '虾'];

/** AI 菜谱生成的系统提示词 */
const RECIPE_SYSTEM =
  '你是一位家常菜厨师。请根据用户现有的食材，推荐 1 道最合适的家常菜，并以 JSON 对象返回。' +
  '字段要求：name（菜名）、minutes（预计耗时分钟数，10-60 的整数）、difficulty（难度，只能是「简单」「中等」「稍难」之一）、' +
  'missing（还需要补充的食材数组，可为空数组）、steps（制作步骤数组，每步 15 字以内，至少 3 步）、tip（一句烹饪小贴士，25 字以内）。' +
  '只输出 JSON 对象，不要解释文字。';

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export function RecipeAssistantCard({ ctx }: PluginComponentProps) {
  const [ingredients, setIngredients] = useState<string[]>(['鸡蛋', '番茄']);
  const [draft, setDraft] = useState('');
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const task = useAiTask();

  /** 添加食材 */
  const addIngredient = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      if (ingredients.includes(value)) {
        ctx.notify('该食材已在列表中', 'info');
        return;
      }
      setIngredients((prev) => [...prev, value]);
      setDraft('');
    },
    [ctx, ingredients],
  );

  /** 移除食材 */
  const removeIngredient = useCallback((value: string) => {
    setIngredients((prev) => prev.filter((item) => item !== value));
  }, []);

  /** 生成菜谱 */
  const generate = useCallback(async () => {
    if (ingredients.length === 0) {
      ctx.notify('请先添加至少一种食材', 'error');
      return;
    }
    const result = await task.run(() =>
      runAi(ctx, {
        system: RECIPE_SYSTEM,
        user: `我现有的食材：${ingredients.join('、')}。请推荐一道菜。`,
        temperature: 0.8,
      }),
    );
    if (!result) {
      ctx.notify('菜谱生成失败，请稍后重试', 'error');
      return;
    }
    const parsed = parseJsonLoose<Partial<Recipe>>(result);
    if (!parsed || !parsed.name) {
      ctx.notify('AI 返回内容无法解析，请重试', 'error');
      return;
    }
    setRecipe({
      name: String(parsed.name),
      minutes: Number(parsed.minutes) || 20,
      difficulty:
        parsed.difficulty === '中等' || parsed.difficulty === '稍难' ? parsed.difficulty : '简单',
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
      steps: Array.isArray(parsed.steps) ? parsed.steps.map((s) => String(s)) : [],
      tip: typeof parsed.tip === 'string' ? parsed.tip : undefined,
    });
  }, [ctx, ingredients, task]);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ChefHat className="h-4 w-4" />
            AI 简易食谱助手
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">已选 {ingredients.length} 种食材</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void generate()} disabled={task.loading}>
          {task.loading ? (
            '生成中…'
          ) : (
            <>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {recipe ? '换一道' : '生成菜谱'}
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 已选食材 */}
        <div className="flex flex-wrap gap-1.5">
          {ingredients.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
            >
              {item}
              <button
                type="button"
                onClick={() => removeIngredient(item)}
                className="hover:text-destructive"
                aria-label={`移除 ${item}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {ingredients.length === 0 && (
            <span className="text-xs text-muted-foreground">还没有食材，先添加一些吧</span>
          )}
        </div>

        {/* 添加食材 */}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addIngredient(draft);
            }}
            placeholder="输入食材后回车"
            className="h-9 text-sm"
          />
          <Button size="sm" className="h-9 shrink-0" onClick={() => addIngredient(draft)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* 快捷标签 */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_INGREDIENTS.filter((item) => !ingredients.includes(item)).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => addIngredient(item)}
              className="rounded-full border border-border/60 px-2.5 py-0.5 text-[0.75rem] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              + {item}
            </button>
          ))}
        </div>

        {/* AI 结果 */}
        {task.loading ? (
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        ) : task.error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {task.error}
          </p>
        ) : recipe ? (
          <motion.div
            key={recipe.name}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{recipe.name}</h3>
              <Badge variant="secondary" className="h-5 px-1.5 text-[0.6875rem]">
                约 {recipe.minutes} 分钟
              </Badge>
              <Badge variant="outline" className="h-5 px-1.5 text-[0.6875rem]">
                {recipe.difficulty}
              </Badge>
            </div>

            {recipe.missing && recipe.missing.length > 0 && (
              <p className="text-[0.75rem] text-muted-foreground">
                还需补充：<span className="text-amber-600 dark:text-amber-400">{recipe.missing.join('、')}</span>
              </p>
            )}

            <ol className="space-y-1.5">
              {recipe.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6875rem] font-medium text-primary">
                    {i + 1}
                  </span>
                  <span className="text-foreground/85">{step}</span>
                </li>
              ))}
            </ol>

            {recipe.tip && (
              <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[0.75rem] text-amber-700 dark:text-amber-300">
                小贴士：{recipe.tip}
              </p>
            )}
          </motion.div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
            <Sparkles className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">选好食材，让 AI 给你推荐一道菜</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RecipeAssistantCard;

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 多行文本输入框。
 * 单独成文件，方便插件通过 `@/components/ui/textarea` 引用。
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-20 w-full rounded-md border border-[var(--zj-border)] bg-[var(--zj-bg)] px-3 py-2 text-sm',
      'text-[var(--zj-fg)] placeholder:text-[var(--zj-muted-fg)]',
      'transition-colors focus-visible:border-[var(--zj-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--zj-accent)]/25',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };

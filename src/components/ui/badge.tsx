import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[var(--zj-accent-soft)] text-[var(--zj-fg)]',
        outline: 'border-[var(--zj-border)] text-[var(--zj-muted-fg)]',
        solid: 'border-transparent bg-[var(--zj-accent)] text-[var(--zj-accent-fg)]',
        secondary: 'border-transparent bg-[var(--zj-accent-soft)] text-[var(--zj-fg)]',
        destructive: 'border-transparent bg-[var(--zj-danger)] text-white',
        success: 'border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
        warning: 'border-transparent bg-amber-500/12 text-amber-600 dark:text-amber-400',
        danger: 'border-transparent bg-red-500/12 text-red-600 dark:text-red-400',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

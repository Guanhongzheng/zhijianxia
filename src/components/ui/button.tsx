import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--zj-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--zj-bg)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-[var(--zj-accent)] text-[var(--zj-accent-fg)] hover:opacity-90',
        secondary:
          'bg-[var(--zj-accent-soft)] text-[var(--zj-fg)] hover:bg-[var(--zj-muted)]',
        outline:
          'border border-[var(--zj-border)] bg-[var(--zj-card)] text-[var(--zj-fg)] hover:bg-[var(--zj-muted)]',
        ghost: 'text-[var(--zj-fg)] hover:bg-[var(--zj-muted)]',
        destructive: 'bg-[var(--zj-danger)] text-white hover:opacity-90',
        link: 'text-[var(--zj-accent)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        xs: 'h-7 rounded px-2 text-xs',
        lg: 'h-11 rounded-md px-6',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

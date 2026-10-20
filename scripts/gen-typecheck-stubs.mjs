/**
 * 生成「仅供类型校验」的 shadcn/ui 组件存根。
 *
 * 背景：主框架同事会提供真实的 @/components/ui/* 组件，
 * 但本目录要做独立类型校验时这些文件尚不存在，
 * 因此在 scripts/typecheck-stubs/ui 下生成一份签名一致的最小实现。
 *
 * 生成结果不参与运行时，仅服务于 tsc --noEmit。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'typecheck-stubs', 'ui');
mkdirSync(outDir, { recursive: true });

/** 每个文件对应一段 TSX 源码 */
const files = {
  'card.tsx': `
import * as React from 'react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export const Card = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={className} {...props} />
));
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={className} {...props} />
));
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={className} {...props} />
));
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={className} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={className} {...props} />
));
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={className} {...props} />
));
CardFooter.displayName = 'CardFooter';
`,

  'button.tsx': `
import * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => (
    <button ref={ref} className={className} {...props} />
  ),
);
Button.displayName = 'Button';
`,

  'input.tsx': `
import * as React from 'react';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={className} {...props} />,
);
Input.displayName = 'Input';
`,

  'textarea.tsx': `
import * as React from 'react';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => <textarea ref={ref} className={className} {...props} />);
Textarea.displayName = 'Textarea';
`,

  'badge.tsx': `
import * as React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
Badge.displayName = 'Badge';
`,

  'skeleton.tsx': `
import * as React from 'react';

export const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
Skeleton.displayName = 'Skeleton';
`,

  'separator.tsx': `
import * as React from 'react';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
}

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation, decorative, ...props }, ref) => (
    <div ref={ref} className={className} {...props} />
  ),
);
Separator.displayName = 'Separator';
`,

  'label.tsx': `
import * as React from 'react';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => <label ref={ref} className={className} {...props} />,
);
Label.displayName = 'Label';
`,

  'progress.tsx': `
import * as React from 'react';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number | null;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
Progress.displayName = 'Progress';
`,

  'avatar.tsx': `
import * as React from 'react';

export const Avatar = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => <span ref={ref} className={className} {...props} />,
);
Avatar.displayName = 'Avatar';

export const AvatarImage = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => <span ref={ref} className={className} {...props} />,
);
AvatarImage.displayName = 'AvatarImage';

export const AvatarFallback = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => <span ref={ref} className={className} {...props} />,
);
AvatarFallback.displayName = 'AvatarFallback';
`,

  'switch.tsx': `
import * as React from 'react';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, defaultChecked, onCheckedChange, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      className={className}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
);
Switch.displayName = 'Switch';
`,

  'slider.tsx': `
import * as React from 'react';

export interface SliderProps {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ className, value, defaultValue, onValueChange, min, max, step, disabled, ...props }, ref) => (
    <div ref={ref} className={className} {...props} />
  ),
);
Slider.displayName = 'Slider';
`,

  'scroll-area.tsx': `
import * as React from 'react';

export const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
ScrollArea.displayName = 'ScrollArea';

export const ScrollBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
ScrollBar.displayName = 'ScrollBar';
`,

  'tabs.tsx': `
import * as React from 'react';

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children?: React.ReactNode;
  orientation?: 'horizontal' | 'vertical';
  dir?: 'ltr' | 'rtl';
}

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, value, defaultValue, onValueChange, children, ...props }, ref) => (
    <div ref={ref} className={className} {...props}>
      {children}
    </div>
  ),
);
Tabs.displayName = 'Tabs';

export const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
TabsList.displayName = 'TabsList';

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, ...props }, ref) => <button ref={ref} className={className} {...props} />,
);
TabsTrigger.displayName = 'TabsTrigger';

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
TabsContent.displayName = 'TabsContent';
`,

  'dialog.tsx': `
import * as React from 'react';

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export const Dialog = ({ children }: DialogProps) => <>{children}</>;
Dialog.displayName = 'Dialog';

export const DialogTrigger = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
DialogTrigger.displayName = 'DialogTrigger';

export const DialogPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
DialogPortal.displayName = 'DialogPortal';

export const DialogOverlay = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
DialogOverlay.displayName = 'DialogOverlay';

export const DialogClose = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => <button ref={ref} className={className} {...props} />,
);
DialogClose.displayName = 'DialogClose';

export const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
DialogHeader.displayName = 'DialogHeader';

export const DialogFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
DialogFooter.displayName = 'DialogFooter';

export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h2 ref={ref} className={className} {...props} />,
);
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => <p ref={ref} className={className} {...props} />);
DialogDescription.displayName = 'DialogDescription';
`,

  'select.tsx': `
import * as React from 'react';

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

export const Select = ({ children }: SelectProps) => <>{children}</>;
Select.displayName = 'Select';

export const SelectGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
SelectGroup.displayName = 'SelectGroup';

export const SelectValue = ({ placeholder }: { placeholder?: string }) => <>{placeholder}</>;
SelectValue.displayName = 'SelectValue';

export const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => <button ref={ref} className={className} {...props} />,
);
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
SelectContent.displayName = 'SelectContent';

export const SelectLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
SelectLabel.displayName = 'SelectLabel';

export interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  disabled?: boolean;
}

export const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, value, disabled, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
SelectItem.displayName = 'SelectItem';
`,

  'tooltip.tsx': `
import * as React from 'react';

export interface TooltipProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
}

export const TooltipProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
TooltipProvider.displayName = 'TooltipProvider';

export const Tooltip = ({ children }: TooltipProps) => <>{children}</>;
Tooltip.displayName = 'Tooltip';

export const TooltipTrigger = ({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) => (
  <>{children}</>
);
TooltipTrigger.displayName = 'TooltipTrigger';

export const TooltipContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
TooltipContent.displayName = 'TooltipContent';
`,

  'toast.tsx': `
import * as React from 'react';

export const Toast = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
Toast.displayName = 'Toast';

export const ToastTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);
ToastTitle.displayName = 'ToastTitle';

export const ToastDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />);
ToastDescription.displayName = 'ToastDescription';
`,

  'sonner.tsx': `
import * as React from 'react';

export interface ToasterProps {
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  richColors?: boolean;
  closeButton?: boolean;
  theme?: 'light' | 'dark' | 'system';
  className?: string;
  children?: React.ReactNode;
}

export const Toaster = ({ className, ...props }: ToasterProps) => (
  <div className={className} {...(props as React.HTMLAttributes<HTMLDivElement>)} />
);
Toaster.displayName = 'Toaster';
`,
};

for (const [name, source] of Object.entries(files)) {
  writeFileSync(resolve(outDir, name), source.trimStart(), 'utf8');
}

console.log(`[typecheck-stubs] 已生成 ${Object.keys(files).length} 个 UI 组件存根 -> ${outDir}`);

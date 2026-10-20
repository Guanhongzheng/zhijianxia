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

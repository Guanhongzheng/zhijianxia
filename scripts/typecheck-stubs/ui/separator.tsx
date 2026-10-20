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

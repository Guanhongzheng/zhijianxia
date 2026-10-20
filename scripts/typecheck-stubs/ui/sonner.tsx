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

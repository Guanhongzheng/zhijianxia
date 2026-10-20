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

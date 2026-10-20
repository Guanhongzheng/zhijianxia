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

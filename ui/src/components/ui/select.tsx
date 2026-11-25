import React from 'react';

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
}

export function Select({ value, defaultValue, onValueChange, children }: SelectProps) {
  return <>{children}</>;
}

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => (
    <button ref={ref} className={className} type="button" {...props}>
      {children}
    </button>
  ),
);
SelectTrigger.displayName = 'SelectTrigger';

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span>{placeholder}</span>;
}

export function SelectContent({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

export interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function SelectItem({ value, className, children, ...props }: SelectItemProps) {
  return (
    <div data-value={value} className={className} {...props}>
      {children}
    </div>
  );
}

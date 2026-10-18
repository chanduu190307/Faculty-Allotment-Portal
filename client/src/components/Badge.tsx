import React from 'react';

export type BadgeVariant = 'forest' | 'sage' | 'warning' | 'error' | 'success';

interface BadgeProps {
  variant?: BadgeVariant;
  style?: React.CSSProperties;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'forest', style, title, className = '', children }) => {
  return (
    <span className={`badge badge-${variant} ${className}`.trim()} style={style} title={title}>
      {children}
    </span>
  );
};

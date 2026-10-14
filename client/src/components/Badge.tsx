import React from 'react';

export type BadgeVariant = 'forest' | 'sage' | 'warning' | 'error' | 'success';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'forest', children }) => {
  return <span className={`badge badge-${variant}`}>{children}</span>;
};

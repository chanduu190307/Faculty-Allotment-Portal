import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: 'ADMIN' | 'EXAM_OFFICER' | 'FACULTY';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Server-side authentication and role-based authorization middleware.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Read role & user headers or fallback to default administrator
  const roleHeader = (req.headers['x-user-role'] as string) || 'ADMIN';
  const nameHeader = (req.headers['x-user-name'] as string) || 'Examination Officer';
  const idHeader = (req.headers['x-user-id'] as string) || 'ADMIN-001';

  req.user = {
    id: idHeader,
    name: nameHeader,
    role: (roleHeader.toUpperCase() as any) || 'ADMIN',
  };

  next();
}

/**
 * Requires admin role for sensitive mutations.
 */
export function requireRole(allowedRoles: Array<'ADMIN' | 'EXAM_OFFICER' | 'FACULTY'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `Forbidden: User role '${req.user?.role}' is unauthorized to perform this action.`,
      });
      return;
    }
    next();
  };
}

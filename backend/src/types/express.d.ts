import type { CurrentUser } from '../shared/auth/rbac';

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser | null;
    }
  }
}

export {};

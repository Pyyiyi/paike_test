import 'vue-router';
import type { UserRole } from '@/shared/api/types';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    publicPage?: boolean;
    allowForcedPasswordChange?: boolean;
    roles?: UserRole[];
    title?: string;
    description?: string;
    nav?: string;
  }
}

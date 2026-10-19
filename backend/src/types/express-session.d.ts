import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    createdAt?: number;
    lastSeenAt?: number;
    absoluteExpiresAt?: number;
  }
}

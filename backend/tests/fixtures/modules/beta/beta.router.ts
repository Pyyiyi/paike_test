import { Router } from 'express';

export function createRouter() {
  const router = Router();
  router.get('/beta-probe', (_request, response) => {
    response.json({ data: { context: 'beta' } });
  });
  return router;
}

import { Router } from 'express';

export const router = Router();

router.get('/alpha-probe', (_request, response) => {
  response.json({ data: { context: 'alpha' } });
});

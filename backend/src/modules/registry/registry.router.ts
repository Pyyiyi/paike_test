import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAdmin } from '../../shared/auth/rbac';
import { asyncHandler } from '../../shared/http/async-handler';
import { validateBody } from '../../shared/validation/common';
import { systemClock, type Clock } from '../../shared/time/clock';
import { createSemesterSchema, updateSemesterSchema } from './dto/semester.schema';
import {
  calendarExceptionSchema,
  createScheduleTemplateSchema,
  createScheduleTemplateVersionSchema,
} from './dto/schedule-template.schema';
import { createRegistryController } from './registry.controller';
import type { ModuleRouterContext } from '../router-contract';

export function createRouter(context: ModuleRouterContext): Router | null {
  if (!context.auth) {
    return null;
  }
  return createRegistryRouter(context.auth.pool, context.clock ?? systemClock);
}

export function createRegistryRouter(pool: Pool, clock: Clock = systemClock): Router {
  const router = Router();
  const controller = createRegistryController(pool, clock);

  router.get('/semesters', requireAdmin, asyncHandler(controller.listSemesters));
  router.get('/semesters/current', requireAdmin, asyncHandler(controller.getCurrentSemester));
  router.post(
    '/semesters',
    requireAdmin,
    validateBody(createSemesterSchema),
    asyncHandler(controller.createSemester),
  );
  router.patch(
    '/semesters/:id',
    requireAdmin,
    validateBody(updateSemesterSchema),
    asyncHandler(controller.updateSemester),
  );
  router.delete('/semesters/:id', requireAdmin, asyncHandler(controller.deleteSemester));

  router.get(
    '/semesters/:id/calendar-exceptions',
    requireAdmin,
    asyncHandler(controller.listCalendarExceptions),
  );
  router.post(
    '/semesters/:id/calendar-exceptions',
    requireAdmin,
    validateBody(calendarExceptionSchema),
    asyncHandler(controller.createCalendarException),
  );
  router.delete(
    '/semesters/:id/calendar-exceptions/:exceptionId',
    requireAdmin,
    asyncHandler(controller.deleteCalendarException),
  );

  router.get('/schedule-templates', requireAdmin, asyncHandler(controller.listScheduleTemplates));
  router.post(
    '/schedule-templates',
    requireAdmin,
    validateBody(createScheduleTemplateSchema),
    asyncHandler(controller.createScheduleTemplate),
  );
  router.get(
    '/schedule-templates/versions/:versionId',
    requireAdmin,
    asyncHandler(controller.getScheduleTemplateVersion),
  );
  router.post(
    '/schedule-templates/versions/:versionId/validate',
    requireAdmin,
    asyncHandler(controller.validateScheduleTemplateVersion),
  );
  router.delete('/schedule-templates/:id', requireAdmin, asyncHandler(controller.deleteScheduleTemplate));
  router.get(
    '/schedule-templates/:id/versions',
    requireAdmin,
    asyncHandler(controller.listScheduleTemplateVersions),
  );
  router.post(
    '/schedule-templates/:id/versions',
    requireAdmin,
    validateBody(createScheduleTemplateVersionSchema),
    asyncHandler(controller.createScheduleTemplateVersion),
  );

  return router;
}

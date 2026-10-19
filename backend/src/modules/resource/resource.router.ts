import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import type { ZodType } from 'zod';
import { ValidationError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/http/async-handler';
import { created, noContent, ok, paginated } from '../../shared/http/envelope';
import { paginationSchema, parseBody, uuidSchema } from '../../shared/validation/common';
import { requireAdmin } from '../../shared/auth/rbac';
import { CombinedClassService } from './combined-class.service';
import { VenueService } from './venue.service';
import { WalkingGroupService } from './walking-group.service';
import {
  createCombinedClassSchema,
  createVenueSchema,
  createWalkingGroupSchema,
  updateCombinedClassSchema,
  updateVenueSchema,
  updateWalkingGroupSchema,
  venueListQuerySchema,
} from './resource.validation';

function parseQuery<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      undefined,
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || undefined,
        message: issue.message,
      })),
      result.error,
    );
  }
  return result.data;
}

function parseId(value: string | undefined): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError('路径参数无效', [{ field: 'id', message: '必须是合法的 UUID' }]);
  }
  return result.data;
}

function actorId(request: Request): string | undefined {
  return request.currentUser?.userId;
}

function pageItems<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

export function createResourceRouter(pool: Pool): Router {
  const router = Router();
  const venues = new VenueService(pool);
  const combinedClasses = new CombinedClassService(pool);
  const walkingGroups = new WalkingGroupService(pool);

  router.use('/venues', requireAdmin);
  router.use('/combined-classes', requireAdmin);
  router.use('/walking-groups', requireAdmin);

  router.get(
    '/venues',
    asyncHandler(async (request, response) => {
      const query = parseQuery(venueListQuerySchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const result = await venues.queries.list({ ...query, page, pageSize });
      paginated(response, result.items, page, pageSize, result.total);
    }),
  );

  router.post(
    '/venues',
    parseBody(createVenueSchema),
    asyncHandler(async (request, response) => {
      const venue = await venues.create(request.body, actorId(request));
      created(response, venue);
    }),
  );

  router.patch(
    '/venues/:id',
    parseBody(updateVenueSchema),
    asyncHandler(async (request, response) => {
      const venue = await venues.update(parseId(request.params.id), request.body, actorId(request));
      ok(response, venue);
    }),
  );

  router.delete(
    '/venues/:id',
    asyncHandler(async (request, response) => {
      await venues.delete(parseId(request.params.id), actorId(request));
      noContent(response);
    }),
  );

  router.get(
    '/combined-classes',
    asyncHandler(async (request, response) => {
      const query = parseQuery(paginationSchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const items = await combinedClasses.list();
      paginated(response, pageItems(items, page, pageSize), page, pageSize, items.length);
    }),
  );

  router.post(
    '/combined-classes',
    parseBody(createCombinedClassSchema),
    asyncHandler(async (request, response) => {
      const combinedClass = await combinedClasses.create(request.body, actorId(request));
      created(response, combinedClass);
    }),
  );

  router.patch(
    '/combined-classes/:id',
    parseBody(updateCombinedClassSchema),
    asyncHandler(async (request, response) => {
      const combinedClass = await combinedClasses.update(
        parseId(request.params.id),
        request.body,
        actorId(request),
      );
      ok(response, combinedClass);
    }),
  );

  router.delete(
    '/combined-classes/:id',
    asyncHandler(async (request, response) => {
      await combinedClasses.delete(parseId(request.params.id), actorId(request));
      noContent(response);
    }),
  );

  router.get(
    '/walking-groups',
    asyncHandler(async (request, response) => {
      const query = parseQuery(paginationSchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const items = await walkingGroups.list();
      paginated(response, pageItems(items, page, pageSize), page, pageSize, items.length);
    }),
  );

  router.post(
    '/walking-groups',
    parseBody(createWalkingGroupSchema),
    asyncHandler(async (request, response) => {
      const walkingGroup = await walkingGroups.create(request.body, actorId(request));
      created(response, walkingGroup);
    }),
  );

  router.patch(
    '/walking-groups/:id',
    parseBody(updateWalkingGroupSchema),
    asyncHandler(async (request, response) => {
      const walkingGroup = await walkingGroups.update(
        parseId(request.params.id),
        request.body,
        actorId(request),
      );
      ok(response, walkingGroup);
    }),
  );

  router.delete(
    '/walking-groups/:id',
    asyncHandler(async (request, response) => {
      await walkingGroups.delete(parseId(request.params.id), actorId(request));
      noContent(response);
    }),
  );

  return router;
}

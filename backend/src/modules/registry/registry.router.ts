import { Router } from 'express';
import { z } from 'zod';
import type { AuthRuntime } from '../../shared/auth/runtime';
import { requireAdmin, requireAuth } from '../../shared/auth/rbac';
import { ValidationError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/http/async-handler';
import { created, noContent, ok, paginated } from '../../shared/http/envelope';
import {
  ClassCreateSchema,
  ClassUpdateSchema,
  GradeCreateSchema,
  GradeUpdateSchema,
  SubjectCreateSchema,
  SubjectPeriodRulePutSchema,
  SubjectUpdateSchema,
  dedupeSlots,
  parsePaginationQuery,
  parseUuidParam,
  parseVocabularyType,
} from './registry.validation';
import {
  createClassItem,
  createGradeItem,
  createSubjectItem,
  deleteClassItem,
  deleteGradeItem,
  deleteSubjectItem,
  getClassItem,
  getGradeItem,
  getSubjectItem,
  listClassItems,
  listGradeItems,
  listSubjectItems,
  listVocabularyItems,
  saveSubjectRuleItem,
  updateClassItem,
  updateGradeItem,
  updateSubjectItem,
} from './registry.service';
import type { RegistryContext } from './registry.types';

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      undefined,
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || undefined,
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function actorOf(request: { currentUser?: { userId: string } | null }): { userId: string } {
  return { userId: request.currentUser?.userId ?? '' };
}

export function createRegistryRouter(runtime: AuthRuntime): Router {
  const router = Router();
  const ctx: RegistryContext = { pool: runtime.pool };

  router.use(['/grades', '/classes', '/subjects', '/controlled-vocabularies'], requireAuth, requireAdmin);

  router.get(
    '/grades',
    asyncHandler(async (request, response) => {
      const { page, pageSize } = parsePaginationQuery(request.query);
      const result = await listGradeItems(ctx, page, pageSize);
      paginated(response, result.items, page, pageSize, result.total);
    }),
  );

  router.post(
    '/grades',
    asyncHandler(async (request, response) => {
      const input = parse(GradeCreateSchema, request.body);
      const grade = await createGradeItem(ctx, actorOf(request), input);
      created(response, grade);
    }),
  );

  router.get(
    '/grades/:id',
    asyncHandler(async (request, response) => {
      const gradeId = parseUuidParam(request.params.id);
      ok(response, await getGradeItem(ctx, gradeId));
    }),
  );

  router.patch(
    '/grades/:id',
    asyncHandler(async (request, response) => {
      const gradeId = parseUuidParam(request.params.id);
      const input = parse(GradeUpdateSchema, request.body);
      ok(response, await updateGradeItem(ctx, gradeId, input));
    }),
  );

  router.delete(
    '/grades/:id',
    asyncHandler(async (request, response) => {
      const gradeId = parseUuidParam(request.params.id);
      await deleteGradeItem(ctx, gradeId);
      noContent(response);
    }),
  );

  router.get(
    '/classes',
    asyncHandler(async (request, response) => {
      const { page, pageSize } = parsePaginationQuery(request.query);
      const gradeId =
        request.query.gradeId === undefined
          ? undefined
          : parseUuidParam(request.query.gradeId, 'gradeId');
      const result = await listClassItems(ctx, page, pageSize, gradeId);
      paginated(response, result.items, page, pageSize, result.total);
    }),
  );

  router.post(
    '/classes',
    asyncHandler(async (request, response) => {
      const input = parse(ClassCreateSchema, request.body);
      const item = await createClassItem(ctx, actorOf(request), input);
      created(response, item);
    }),
  );

  router.get(
    '/classes/:id',
    asyncHandler(async (request, response) => {
      const classId = parseUuidParam(request.params.id);
      ok(response, await getClassItem(ctx, classId));
    }),
  );

  router.patch(
    '/classes/:id',
    asyncHandler(async (request, response) => {
      const classId = parseUuidParam(request.params.id);
      const input = parse(ClassUpdateSchema, request.body);
      ok(response, await updateClassItem(ctx, classId, input));
    }),
  );

  router.delete(
    '/classes/:id',
    asyncHandler(async (request, response) => {
      const classId = parseUuidParam(request.params.id);
      await deleteClassItem(ctx, classId);
      noContent(response);
    }),
  );

  router.get(
    '/subjects',
    asyncHandler(async (request, response) => {
      const { page, pageSize } = parsePaginationQuery(request.query);
      const result = await listSubjectItems(ctx, page, pageSize);
      paginated(response, result.items, page, pageSize, result.total);
    }),
  );

  router.post(
    '/subjects',
    asyncHandler(async (request, response) => {
      const input = parse(SubjectCreateSchema, request.body);
      created(response, await createSubjectItem(ctx, input));
    }),
  );

  router.get(
    '/subjects/:id',
    asyncHandler(async (request, response) => {
      const subjectId = parseUuidParam(request.params.id);
      ok(response, await getSubjectItem(ctx, subjectId));
    }),
  );

  router.patch(
    '/subjects/:id',
    asyncHandler(async (request, response) => {
      const subjectId = parseUuidParam(request.params.id);
      const input = parse(SubjectUpdateSchema, request.body);
      ok(response, await updateSubjectItem(ctx, subjectId, input));
    }),
  );

  router.delete(
    '/subjects/:id',
    asyncHandler(async (request, response) => {
      const subjectId = parseUuidParam(request.params.id);
      await deleteSubjectItem(ctx, subjectId);
      noContent(response);
    }),
  );

  router.put(
    '/subjects/:id/period-rule',
    asyncHandler(async (request, response) => {
      const subjectId = parseUuidParam(request.params.id);
      const input = parse(SubjectPeriodRulePutSchema, request.body);
      const rule = await saveSubjectRuleItem(ctx, actorOf(request), subjectId, {
        weeklyPeriods: input.weeklyPeriods,
        consecutivePreference: input.consecutivePreference ?? 'NONE',
        forbiddenSlots: dedupeSlots(input.forbiddenSlots ?? []),
        timeSlotPreference: input.timeSlotPreference ?? 'NONE',
        periodBalanceEnabled: input.periodBalanceEnabled ?? false,
        amPmBalanceEnabled: input.amPmBalanceEnabled ?? false,
        fixedSlotRuleEnabled: input.fixedSlotRuleEnabled ?? false,
        version: input.version,
      });
      ok(response, rule);
    }),
  );

  router.get(
    '/controlled-vocabularies',
    asyncHandler(async (request, response) => {
      const type = parseVocabularyType(request.query.type);
      const { page, pageSize } = parsePaginationQuery(request.query);
      const result = await listVocabularyItems(ctx, type, page, pageSize);
      paginated(response, result.items, page, pageSize, result.total);
    }),
  );

  return router;
}

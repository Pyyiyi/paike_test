import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { NotFoundError } from '../../shared/errors/app-error';
import { created, noContent, ok, paginated } from '../../shared/http/envelope';
import { systemClock, type Clock } from '../../shared/time/clock';
import type { CreateSemesterInput, UpdateSemesterInput } from './dto/semester.schema';
import type { CalendarExceptionInput, CreateScheduleTemplateInput, CreateScheduleTemplateVersionInput } from './dto/schedule-template.schema';
import type { ServiceActor } from './registry.types';
import * as semesterService from './semester/semester.service';
import * as calendarService from './calendar/calendar-exception.service';
import * as templateService from './template/schedule-template.service';

function readVersion(request: Request): number | undefined {
  const raw = request.body?.version ?? request.query.version;
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function requireActor(request: Request): ServiceActor {
  const user = request.currentUser;
  if (!user) {
    throw new NotFoundError('登录已失效，请重新登录');
  }
  return { userId: user.userId, username: user.username, displayName: user.displayName };
}

function pageOf<T>(response: Response, items: T[]): void {
  paginated(response, items, 1, Math.max(items.length, 1), items.length);
}

export function createRegistryController(pool: Pool, clock: Clock = systemClock) {
  return {
    async listSemesters(request: Request, response: Response): Promise<void> {
      const includeArchived = request.query.includeArchived === 'true';
      pageOf(response, await semesterService.listSemesters(pool, includeArchived, clock));
    },

    async getCurrentSemester(_request: Request, response: Response): Promise<void> {
      const current = await semesterService.getCurrentSemester(pool, clock);
      if (!current) {
        throw new NotFoundError('尚未设置当前学期');
      }
      ok(response, current);
    },

    async getSemester(request: Request, response: Response): Promise<void> {
      ok(response, await semesterService.getSemester(pool, request.params.id ?? '', clock));
    },

    async createSemester(request: Request, response: Response): Promise<void> {
      const input = request.body as CreateSemesterInput;
      created(response, await semesterService.createSemester(pool, input, requireActor(request), clock));
    },

    async updateSemester(request: Request, response: Response): Promise<void> {
      const input = request.body as UpdateSemesterInput;
      ok(
        response,
        await semesterService.updateSemester(pool, request.params.id ?? '', input, requireActor(request), clock),
      );
    },

    async deleteSemester(request: Request, response: Response): Promise<void> {
      await semesterService.deleteSemester(
        pool,
        request.params.id ?? '',
        readVersion(request),
        requireActor(request),
        clock,
      );
      noContent(response);
    },

    async listCalendarExceptions(request: Request, response: Response): Promise<void> {
      pageOf(response, await calendarService.listCalendarExceptions(pool, request.params.id ?? ''));
    },

    async createCalendarException(request: Request, response: Response): Promise<void> {
      const input = request.body as CalendarExceptionInput;
      created(
        response,
        await calendarService.createCalendarException(pool, request.params.id ?? '', input, clock),
      );
    },

    async deleteCalendarException(request: Request, response: Response): Promise<void> {
      await calendarService.deleteCalendarException(
        pool,
        request.params.id ?? '',
        request.params.exceptionId ?? '',
        clock,
      );
      noContent(response);
    },

    async listScheduleTemplates(_request: Request, response: Response): Promise<void> {
      pageOf(response, await templateService.listTemplates(pool));
    },

    async createScheduleTemplate(request: Request, response: Response): Promise<void> {
      const input = request.body as CreateScheduleTemplateInput;
      created(response, await templateService.createTemplate(pool, input, requireActor(request), clock));
    },

    async deleteScheduleTemplate(request: Request, response: Response): Promise<void> {
      await templateService.deleteTemplate(
        pool,
        request.params.id ?? '',
        readVersion(request),
        requireActor(request),
        clock,
      );
      noContent(response);
    },

    async listScheduleTemplateVersions(request: Request, response: Response): Promise<void> {
      pageOf(response, await templateService.listVersions(pool, request.params.id ?? ''));
    },

    async createScheduleTemplateVersion(request: Request, response: Response): Promise<void> {
      const input = request.body as CreateScheduleTemplateVersionInput;
      created(
        response,
        await templateService.createVersion(pool, request.params.id ?? '', input, requireActor(request), clock),
      );
    },

    async getScheduleTemplateVersion(request: Request, response: Response): Promise<void> {
      ok(response, await templateService.getVersion(pool, request.params.versionId ?? ''));
    },

    async validateScheduleTemplateVersion(request: Request, response: Response): Promise<void> {
      ok(response, await templateService.validateVersion(pool, request.params.versionId ?? ''));
    },
  };
}

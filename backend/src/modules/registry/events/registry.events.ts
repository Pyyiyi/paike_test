import { randomUUID } from 'node:crypto';
import type { Tx } from '../../../shared/db/transaction';
import { appendEvent } from '../../../shared/events/outbox';
import { systemClock, type Clock } from '../../../shared/time/clock';

export async function emitSemesterCreated(
  tx: Tx,
  input: {
    semesterId: string;
    name: string;
    scheduleTemplateVersionId: string;
    occurredBy?: string;
  },
  clock: Clock = systemClock,
): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = clock.now();
  await appendEvent(
    tx,
    {
      eventName: 'bc.registry.semester.created',
      aggregateType: 'Semester',
      aggregateId: input.semesterId,
      occurredBy: input.occurredBy,
      occurredAt,
      payload: {
        eventId,
        occurredAt: occurredAt.toISOString(),
        occurredBy: input.occurredBy ?? null,
        semesterId: input.semesterId,
        name: input.name,
        scheduleTemplateVersionId: input.scheduleTemplateVersionId,
      },
    },
    clock,
  );
}

export async function emitSemesterStatusChanged(
  tx: Tx,
  input: {
    semesterId: string;
    fromStatus: string;
    toStatus: string;
    occurredBy?: string;
  },
  clock: Clock = systemClock,
): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = clock.now();
  await appendEvent(
    tx,
    {
      eventName: 'bc.registry.semester.status-changed',
      aggregateType: 'Semester',
      aggregateId: input.semesterId,
      occurredBy: input.occurredBy,
      occurredAt,
      payload: {
        eventId,
        occurredAt: occurredAt.toISOString(),
        occurredBy: input.occurredBy ?? null,
        semesterId: input.semesterId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
      },
    },
    clock,
  );
}

export async function emitTemplateVersionCreated(
  tx: Tx,
  input: {
    templateId: string;
    versionId: string;
    versionNo: number;
    occurredBy?: string;
  },
  clock: Clock = systemClock,
): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = clock.now();
  await appendEvent(
    tx,
    {
      eventName: 'bc.registry.schedule-template.version-created',
      aggregateType: 'ScheduleTemplateVersion',
      aggregateId: input.versionId,
      occurredBy: input.occurredBy,
      occurredAt,
      payload: {
        eventId,
        occurredAt: occurredAt.toISOString(),
        occurredBy: input.occurredBy ?? null,
        templateId: input.templateId,
        versionId: input.versionId,
        versionNo: input.versionNo,
      },
    },
    clock,
  );
}

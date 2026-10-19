import type { Pool, QueryResultRow } from 'pg';
import { asQueryable, type Queryable } from './resource.support';
import type { Venue, VenueStatus, VenueType } from './resource.types';

export interface VenueListOptions {
  page: number;
  pageSize: number;
  q?: string;
  type?: VenueType;
  status?: VenueStatus;
}

export interface VenueListResult {
  items: Venue[];
  total: number;
}

export interface VenueRow extends QueryResultRow {
  venue_id: string;
  name: string;
  type: VenueType;
  capacity: number;
  status: VenueStatus;
  version: number;
}

export function mapVenue(row: VenueRow): Venue {
  return {
    venueId: row.venue_id,
    name: row.name,
    type: row.type,
    capacity: row.capacity,
    status: row.status,
    version: row.version,
  };
}

export class VenueQueryService {
  private readonly queryable: Queryable;

  constructor(source: Pool | Queryable) {
    this.queryable = asQueryable(source);
  }

  async list(options: VenueListOptions): Promise<VenueListResult> {
    const params: unknown[] = [];
    const conditions = ['deleted_at IS NULL'];
    if (options.q) {
      params.push(`%${options.q}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }
    if (options.type) {
      params.push(options.type);
      conditions.push(`type = $${params.length}::venue_type`);
    }
    if (options.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}::venue_status`);
    }
    const where = conditions.join(' AND ');
    const countRows = await this.queryable.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM venue WHERE ${where}`,
      params,
    );
    params.push(options.pageSize, (options.page - 1) * options.pageSize);
    const rows = await this.queryable.query<VenueRow>(
      `SELECT venue_id, name, type, capacity, status, version
         FROM venue
        WHERE ${where}
        ORDER BY lower(name), venue_id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.map(mapVenue), total: countRows[0]?.total ?? 0 };
  }

  async getById(venueId: string): Promise<Venue | null> {
    const rows = await this.queryable.query<VenueRow>(
      `SELECT venue_id, name, type, capacity, status, version
         FROM venue
        WHERE venue_id = $1 AND deleted_at IS NULL`,
      [venueId],
    );
    return rows[0] ? mapVenue(rows[0]) : null;
  }

  async getCapacity(venueId: string): Promise<number | null> {
    const rows = await this.queryable.query<{ capacity: number }>(
      'SELECT capacity FROM venue WHERE venue_id = $1 AND deleted_at IS NULL',
      [venueId],
    );
    return rows[0]?.capacity ?? null;
  }
}

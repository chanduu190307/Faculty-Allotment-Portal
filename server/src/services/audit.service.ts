import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

export interface AuditLogEntry {
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  oldValues?: any;
  newValues?: any;
  reason?: string;
}

export interface AuditLogFilter {
  entity?: string;
  entityId?: string;
  action?: string;
  actor?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export class AuditService {
  public static log(entry: AuditLogEntry, dbInstance?: Database.Database): void {
    const db = dbInstance || getDatabase();
    const stmt = db.prepare(`
      INSERT INTO audit_logs (entity, entity_id, action, actor, old_values, new_values, reason, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.entity,
      entry.entityId,
      entry.action,
      entry.actor,
      entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      entry.newValues ? JSON.stringify(entry.newValues) : null,
      entry.reason || null,
      new Date().toISOString()
    );
  }

  public static getLogs(entity?: string, entityId?: string, limit = 100): any[] {
    const db = getDatabase();
    if (entity && entityId) {
      return db
        .prepare('SELECT * FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT ?')
        .all(entity, entityId, limit);
    } else if (entity) {
      return db
        .prepare('SELECT * FROM audit_logs WHERE entity = ? ORDER BY id DESC LIMIT ?')
        .all(entity, limit);
    }
    return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
  }

  /**
   * Filtered audit log query with server-side pagination, date ranges, and sanitization.
   */
  public static getLogsFiltered(filter: AuditLogFilter = {}): { data: any[]; total: number } {
    const db = getDatabase();
    let whereClauses = ['1=1'];
    const params: any[] = [];

    if (filter.entity) {
      whereClauses.push('entity = ?');
      params.push(filter.entity);
    }

    if (filter.entityId) {
      whereClauses.push('entity_id = ?');
      params.push(filter.entityId);
    }

    if (filter.action) {
      whereClauses.push('action = ?');
      params.push(filter.action);
    }

    if (filter.actor) {
      whereClauses.push('actor LIKE ?');
      params.push(`%${filter.actor}%`);
    }

    if (filter.startDate) {
      whereClauses.push('timestamp >= ?');
      params.push(filter.startDate);
    }

    if (filter.endDate) {
      whereClauses.push('timestamp <= ?');
      params.push(filter.endDate);
    }

    if (filter.search) {
      whereClauses.push('(entity LIKE ? OR entity_id LIKE ? OR action LIKE ? OR actor LIKE ? OR reason LIKE ?)');
      const s = `%${filter.search}%`;
      params.push(s, s, s, s, s);
    }

    const whereSql = whereClauses.join(' AND ');
    const countRow = db.prepare(`SELECT count(*) as count FROM audit_logs WHERE ${whereSql}`).get(...params) as { count: number };
    const total = countRow.count;

    const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 200) : 50;
    const offset = filter.offset && filter.offset >= 0 ? filter.offset : 0;

    const query = `SELECT * FROM audit_logs WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(query).all(...params, limit, offset) as any[];

    // Sanitize records to ensure no sensitive tokens/secrets are exposed
    const sanitized = rows.map((r) => {
      let oldVals = r.old_values;
      let newVals = r.new_values;

      try {
        if (typeof oldVals === 'string') oldVals = JSON.parse(oldVals);
        if (typeof newVals === 'string') newVals = JSON.parse(newVals);
      } catch (e) {}

      const maskSensitive = (obj: any): any => {
        if (!obj || typeof obj !== 'object') return obj;
        const copy = Array.isArray(obj) ? [...obj] : { ...obj };
        for (const k of Object.keys(copy)) {
          if (/(password|token|secret|auth|api_key|key)/i.test(k)) {
            copy[k] = '***REDACTED***';
          } else if (typeof copy[k] === 'object') {
            copy[k] = maskSensitive(copy[k]);
          }
        }
        return copy;
      };

      return {
        id: r.id,
        entity: r.entity,
        entityId: r.entity_id,
        action: r.action,
        actor: r.actor,
        oldValues: maskSensitive(oldVals),
        newValues: maskSensitive(newVals),
        reason: r.reason,
        timestamp: r.timestamp,
      };
    });

    return { data: sanitized, total };
  }
}

import Database from 'better-sqlite3';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { Faculty, Room } from '../domain/scheduling/types';

export interface RowValidationError {
  field: string;
  message: string;
}

export interface RowValidationWarning {
  field: string;
  message: string;
}

export interface ValidatedRow<T> {
  rowNumber: number;
  data: T;
  isValid: boolean;
  errors: RowValidationError[];
  warnings: RowValidationWarning[];
}

export interface ImportPreviewResult<T> {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  canCommit: boolean;
  rows: ValidatedRow<T>[];
}

export interface FacultyImportRow {
  id: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  phone?: string;
  active?: boolean;
  exempt?: boolean;
  maxDutyOverride?: number | null;
}

export interface RoomImportRow {
  id: string;
  name: string;
  building: string;
  floor: number;
  capacity: number;
  examDepartment?: string | null;
  active?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s_-]+/g, '');
}

function parseBooleanVal(val: any, defaultVal = true): boolean {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'active'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'inactive'].includes(s)) return false;
  return defaultVal;
}

export class ImportService {
  /**
   * Parses raw file buffer (CSV or XLSX) into raw row objects.
   */
  public static async parseFileToRows(
    fileBuffer: Buffer,
    fileType: 'csv' | 'xlsx'
  ): Promise<Array<{ rowNumber: number; raw: Record<string, any> }>> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('Uploaded file is empty.');
    }

    if (fileType === 'csv') {
      let records: any[];
      try {
        const text = fileBuffer.toString('utf-8');
        records = parseCsv(text, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });
      } catch (err: any) {
        throw new Error(`Malformed CSV file: ${err.message}`);
      }

      return records.map((rec, idx) => ({
        rowNumber: idx + 2, // 1-based, header is row 1
        raw: rec,
      }));
    } else {
      // ExcelJS
      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(fileBuffer as any);
      } catch (err: any) {
        throw new Error(`Malformed Excel file: ${err.message}`);
      }

      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount < 2) {
        return [];
      }

      // Find header row (first populated row)
      let headerRowNumber = 1;
      let headers: string[] = [];

      sheet.eachRow({ includeEmpty: false }, (row, rNum) => {
        if (headers.length === 0) {
          headerRowNumber = rNum;
          row.eachCell((cell, colNum) => {
            headers[colNum] = String(cell.value || '').trim();
          });
        }
      });

      const results: Array<{ rowNumber: number; raw: Record<string, any> }> = [];
      sheet.eachRow({ includeEmpty: false }, (row, rNum) => {
        if (rNum <= headerRowNumber) return; // skip header
        const raw: Record<string, any> = {};
        let hasValue = false;
        row.eachCell((cell, colNum) => {
          const header = headers[colNum];
          if (header) {
            let val = cell.value;
            if (val && typeof val === 'object' && 'text' in val) {
              val = (val as any).text;
            }
            raw[header] = val !== null && val !== undefined ? String(val).trim() : '';
            if (raw[header]) hasValue = true;
          }
        });
        if (hasValue) {
          results.push({ rowNumber: rNum, raw });
        }
      });

      return results;
    }
  }

  /**
   * Previews and thoroughly validates faculty records before database commit.
   */
  public static async previewFacultyImport(
    fileBuffer: Buffer,
    fileType: 'csv' | 'xlsx',
    options: { allowUpdateExisting?: boolean } = {}
  ): Promise<ImportPreviewResult<FacultyImportRow>> {
    const rawRows = await this.parseFileToRows(fileBuffer, fileType);
    const db = getDatabase();

    const existingFaculty = (db.prepare('SELECT id, email, name, department FROM faculty').all() as Array<{
      id: string;
      email: string;
      name: string;
      department: string;
    }>);

    const existingIdMap = new Map(existingFaculty.map((f) => [f.id.toLowerCase(), f]));
    const existingEmailMap = new Map(existingFaculty.map((f) => [f.email.toLowerCase(), f]));

    const seenFileIds = new Map<string, number>();
    const seenFileEmails = new Map<string, number>();

    const rows: ValidatedRow<FacultyImportRow>[] = [];

    for (const item of rawRows) {
      const { rowNumber, raw } = item;
      const errors: RowValidationError[] = [];
      const warnings: RowValidationWarning[] = [];

      // Flexible column mapping
      const mapped: Partial<FacultyImportRow> = {};
      for (const [key, val] of Object.entries(raw)) {
        const norm = normalizeHeader(key);
        if (['id', 'facultyid', 'facultyno', 'empid', 'code'].includes(norm)) {
          mapped.id = String(val).trim();
        } else if (['name', 'facultyname', 'fullname'].includes(norm)) {
          mapped.name = String(val).trim();
        } else if (['email', 'emailid', 'mail'].includes(norm)) {
          mapped.email = String(val).trim();
        } else if (['department', 'dept', 'branch'].includes(norm)) {
          mapped.department = String(val).trim();
        } else if (['designation', 'desig', 'role', 'title'].includes(norm)) {
          mapped.designation = String(val).trim();
        } else if (['phone', 'mobile', 'contact'].includes(norm)) {
          mapped.phone = String(val).trim();
        } else if (['active', 'status', 'isactive'].includes(norm)) {
          mapped.active = parseBooleanVal(val, true);
        } else if (['exempt', 'isexempt', 'exemption'].includes(norm)) {
          mapped.exempt = parseBooleanVal(val, false);
        } else if (['maxdutyoverride', 'maxduties', 'dutycap', 'maxlimit'].includes(norm)) {
          const num = Number(val);
          mapped.maxDutyOverride = !isNaN(num) && val !== '' ? num : null;
        }
      }

      // Default values
      const rowData: FacultyImportRow = {
        id: mapped.id || '',
        name: mapped.name || '',
        email: mapped.email || '',
        department: mapped.department || '',
        designation: mapped.designation || '',
        phone: mapped.phone || undefined,
        active: mapped.active !== undefined ? mapped.active : true,
        exempt: mapped.exempt !== undefined ? mapped.exempt : false,
        maxDutyOverride: mapped.maxDutyOverride !== undefined ? mapped.maxDutyOverride : null,
      };

      // 1. Required fields
      if (!rowData.id) {
        errors.push({ field: 'id', message: 'Missing required field: Faculty ID' });
      }
      if (!rowData.name) {
        errors.push({ field: 'name', message: 'Missing required field: Faculty Name' });
      }
      if (!rowData.email) {
        errors.push({ field: 'email', message: 'Missing required field: Email' });
      } else if (!EMAIL_REGEX.test(rowData.email)) {
        errors.push({ field: 'email', message: `Invalid email address format: "${rowData.email}"` });
      }
      if (!rowData.department) {
        errors.push({ field: 'department', message: 'Missing required field: Department' });
      }
      if (!rowData.designation) {
        errors.push({ field: 'designation', message: 'Missing required field: Designation' });
      }

      // 2. Data type validation
      if (mapped.maxDutyOverride !== undefined && mapped.maxDutyOverride !== null) {
        if (!Number.isInteger(mapped.maxDutyOverride) || mapped.maxDutyOverride < 0) {
          errors.push({ field: 'maxDutyOverride', message: 'Max duty override must be a non-negative integer' });
        }
      }

      // 3. In-file duplicate validation
      if (rowData.id) {
        const idLower = rowData.id.toLowerCase();
        if (seenFileIds.has(idLower)) {
          errors.push({
            field: 'id',
            message: `Duplicate Faculty ID "${rowData.id}" within file (first seen on row ${seenFileIds.get(idLower)})`,
          });
        } else {
          seenFileIds.set(idLower, rowNumber);
        }
      }

      if (rowData.email && EMAIL_REGEX.test(rowData.email)) {
        const emailLower = rowData.email.toLowerCase();
        if (seenFileEmails.has(emailLower)) {
          errors.push({
            field: 'email',
            message: `Duplicate Email "${rowData.email}" within file (first seen on row ${seenFileEmails.get(emailLower)})`,
          });
        } else {
          seenFileEmails.set(emailLower, rowNumber);
        }
      }

      // 4. Database conflicts & Approved Schedule Safety
      if (rowData.id) {
        const existing = existingIdMap.get(rowData.id.toLowerCase());
        if (existing) {
          if (options.allowUpdateExisting) {
            // Guard: Cannot deactivate or exempt faculty assigned in approved schedules
            if (!rowData.active || rowData.exempt) {
              const activeDuty = db.prepare(`
                SELECT s.id as scheduleId, s.state
                FROM assignments a
                JOIN schedules s ON a.schedule_id = s.id
                WHERE a.faculty_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
                LIMIT 1
              `).get(existing.id) as any;
              if (activeDuty) {
                errors.push({
                  field: !rowData.active ? 'active' : 'exempt',
                  message: `Cannot ${!rowData.active ? 'deactivate' : 'exempt'} faculty "${rowData.id}" (${existing.name}): Faculty is assigned to active duties in ${activeDuty.state.toLowerCase()} schedule "${activeDuty.scheduleId}". Reassign duties before updating eligibility.`,
                });
              }
            }

            // Guard: Cannot change department if assigned to room restricted to that department
            if (rowData.department && existing.department && rowData.department.trim().toLowerCase() !== existing.department.trim().toLowerCase()) {
              const deptConflict = db.prepare(`
                SELECT s.id as scheduleId, r.id as roomId, r.name as roomName, r.exam_department
                FROM assignments a
                JOIN schedules s ON a.schedule_id = s.id
                JOIN rooms r ON a.room_id = r.id
                WHERE a.faculty_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
                  AND LOWER(TRIM(r.exam_department)) = LOWER(TRIM(?))
                LIMIT 1
              `).get(existing.id, rowData.department.trim()) as any;
              if (deptConflict) {
                errors.push({
                  field: 'department',
                  message: `Cannot change department to "${rowData.department}" for faculty "${rowData.id}": Faculty is assigned to room ${deptConflict.roomId} (${deptConflict.roomName}) in approved schedule "${deptConflict.scheduleId}" which is restricted to that department.`,
                });
              }
            }

            if (errors.length === 0) {
              warnings.push({
                field: 'id',
                message: `Existing record for "${rowData.id}" (${existing.name}) will be updated.`,
              });
            }
          } else {
            errors.push({
              field: 'id',
              message: `Faculty ID "${rowData.id}" already exists in system (${existing.name}). Enable update mode to overwrite.`,
            });
          }
        }
      }

      if (rowData.email && EMAIL_REGEX.test(rowData.email)) {
        const existing = existingEmailMap.get(rowData.email.toLowerCase());
        if (existing && existing.id.toLowerCase() !== rowData.id.toLowerCase()) {
          errors.push({
            field: 'email',
            message: `Email "${rowData.email}" is already used by another faculty member (${existing.id}: ${existing.name}).`,
          });
        }
      }

      rows.push({
        rowNumber,
        data: rowData,
        isValid: errors.length === 0,
        errors,
        warnings,
      });
    }

    const totalRows = rows.length;
    const validRows = rows.filter((r) => r.isValid).length;
    const errorRows = rows.filter((r) => !r.isValid).length;
    const warningRows = rows.filter((r) => r.warnings.length > 0).length;

    return {
      totalRows,
      validRows,
      errorRows,
      warningRows,
      canCommit: totalRows > 0 && errorRows === 0,
      rows,
    };
  }

  /**
   * Commits validated faculty rows using an atomic database transaction.
   */
  public static commitFacultyImport(
    rows: ValidatedRow<FacultyImportRow>[],
    actor = 'System Admin',
    allowUpdateExisting = false
  ): { imported: number; updated: number } {
    if (!rows || rows.length === 0) {
      throw new Error('No rows provided for import.');
    }

    const invalidRow = rows.find((r) => !r.isValid || r.errors.length > 0);
    if (invalidRow) {
      throw new Error(
        `Cannot commit import: Row ${invalidRow.rowNumber} contains errors: ${invalidRow.errors.map((e) => e.message).join('; ')}`
      );
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO faculty (id, name, email, department, designation, phone, active, exempt, max_duty_override, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
      UPDATE faculty
      SET name = ?, email = ?, department = ?, designation = ?, phone = ?, active = ?, exempt = ?, max_duty_override = ?, updated_at = ?
      WHERE id = ?
    `);

    const checkStmt = db.prepare('SELECT id FROM faculty WHERE id = ?');

    let imported = 0;
    let updated = 0;

    const commitTx = db.transaction(() => {
      for (const row of rows) {
        const f = row.data;
        const exists = checkStmt.get(f.id);

        if (exists) {
          if (!allowUpdateExisting) {
            throw new Error(`Conflict: Faculty ID ${f.id} already exists.`);
          }
          if (!f.active || f.exempt) {
            const activeDuty = db.prepare(`
              SELECT s.id as scheduleId, s.state
              FROM assignments a
              JOIN schedules s ON a.schedule_id = s.id
              WHERE a.faculty_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
              LIMIT 1
            `).get(f.id) as any;
            if (activeDuty) {
              throw new Error(`Cannot commit import: Faculty "${f.id}" is assigned to active duties in ${activeDuty.state.toLowerCase()} schedule "${activeDuty.scheduleId}". Deactivating or exempting assigned faculty violates approved schedules.`);
            }
          }
          if (f.department) {
            const deptConflict = db.prepare(`
              SELECT s.id as scheduleId, r.id as roomId, r.name as roomName, r.exam_department
              FROM assignments a
              JOIN schedules s ON a.schedule_id = s.id
              JOIN rooms r ON a.room_id = r.id
              WHERE a.faculty_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
                AND LOWER(TRIM(r.exam_department)) = LOWER(TRIM(?))
              LIMIT 1
            `).get(f.id, f.department.trim()) as any;
            if (deptConflict) {
              throw new Error(`Cannot commit import: Changing department to "${f.department}" for faculty "${f.id}" conflicts with room ${deptConflict.roomId} in approved schedule "${deptConflict.scheduleId}".`);
            }
          }
          updateStmt.run(
            f.name,
            f.email,
            f.department,
            f.designation,
            f.phone || null,
            f.active ? 1 : 0,
            f.exempt ? 1 : 0,
            f.maxDutyOverride !== undefined ? f.maxDutyOverride : null,
            now,
            f.id
          );
          updated++;
        } else {
          insertStmt.run(
            f.id,
            f.name,
            f.email,
            f.department,
            f.designation,
            f.phone || null,
            f.active ? 1 : 0,
            f.exempt ? 1 : 0,
            f.maxDutyOverride !== undefined ? f.maxDutyOverride : null,
            now,
            now
          );
          imported++;
        }
      }

      AuditService.log(
        {
          entity: 'faculty',
          entityId: `BATCH_IMPORT_${Date.now()}`,
          action: 'FACULTY_IMPORTED',
          actor,
          newValues: {
            total: rows.length,
            imported,
            updated,
            ids: rows.map((r) => r.data.id),
          },
          reason: `Batch faculty import of ${rows.length} rows (${imported} new, ${updated} updated)`,
        },
        db
      );
    });

    commitTx();

    return { imported, updated };
  }

  /**
   * Previews and validates room records before database commit.
   */
  public static async previewRoomImport(
    fileBuffer: Buffer,
    fileType: 'csv' | 'xlsx',
    options: { allowUpdateExisting?: boolean } = {}
  ): Promise<ImportPreviewResult<RoomImportRow>> {
    const rawRows = await this.parseFileToRows(fileBuffer, fileType);
    const db = getDatabase();

    const existingRooms = (db.prepare('SELECT id, name FROM rooms').all() as Array<{
      id: string;
      name: string;
    }>);

    const existingIdMap = new Map(existingRooms.map((r) => [r.id.toLowerCase(), r]));
    const seenFileIds = new Map<string, number>();

    const rows: ValidatedRow<RoomImportRow>[] = [];

    for (const item of rawRows) {
      const { rowNumber, raw } = item;
      const errors: RowValidationError[] = [];
      const warnings: RowValidationWarning[] = [];

      const mapped: Partial<RoomImportRow> = {};
      for (const [key, val] of Object.entries(raw)) {
        const norm = normalizeHeader(key);
        if (['id', 'roomid', 'roomno', 'roomnumber', 'code'].includes(norm)) {
          mapped.id = String(val).trim();
        } else if (['name', 'roomname'].includes(norm)) {
          mapped.name = String(val).trim();
        } else if (['building', 'block', 'buildingname'].includes(norm)) {
          mapped.building = String(val).trim();
        } else if (['floor', 'level'].includes(norm)) {
          const num = Number(val);
          mapped.floor = !isNaN(num) ? num : undefined;
        } else if (['capacity', 'seats', 'seatingcapacity'].includes(norm)) {
          const num = Number(val);
          mapped.capacity = !isNaN(num) ? num : undefined;
        } else if (['examdepartment', 'department', 'exclusivefor', 'exclusivedept'].includes(norm)) {
          mapped.examDepartment = String(val).trim() || null;
        } else if (['active', 'status', 'isactive'].includes(norm)) {
          mapped.active = parseBooleanVal(val, true);
        }
      }

      const rowData: RoomImportRow = {
        id: mapped.id || '',
        name: mapped.name || (mapped.id ? `Room ${mapped.id}` : ''),
        building: mapped.building || '',
        floor: mapped.floor !== undefined ? mapped.floor : 1,
        capacity: mapped.capacity !== undefined ? mapped.capacity : 30,
        examDepartment: mapped.examDepartment || null,
        active: mapped.active !== undefined ? mapped.active : true,
      };

      // 1. Required fields
      if (!rowData.id) {
        errors.push({ field: 'id', message: 'Missing required field: Room ID / Number' });
      }
      if (!rowData.name) {
        errors.push({ field: 'name', message: 'Missing required field: Room Name' });
      }
      if (!rowData.building) {
        errors.push({ field: 'building', message: 'Missing required field: Building' });
      }

      // 2. Data types
      if (mapped.floor !== undefined && (!Number.isInteger(mapped.floor) || mapped.floor < 0)) {
        errors.push({ field: 'floor', message: 'Floor must be a non-negative integer' });
      }
      if (mapped.capacity !== undefined && (!Number.isInteger(mapped.capacity) || mapped.capacity <= 0)) {
        errors.push({ field: 'capacity', message: 'Capacity must be a positive integer greater than 0' });
      }

      // 3. In-file duplicate validation
      if (rowData.id) {
        const idLower = rowData.id.toLowerCase();
        if (seenFileIds.has(idLower)) {
          errors.push({
            field: 'id',
            message: `Duplicate Room ID "${rowData.id}" within file (first seen on row ${seenFileIds.get(idLower)})`,
          });
        } else {
          seenFileIds.set(idLower, rowNumber);
        }
      }

      // 4. Database conflict & Approved Schedule Safety
      if (rowData.id) {
        const existing = existingIdMap.get(rowData.id.toLowerCase());
        if (existing) {
          if (options.allowUpdateExisting) {
            // Guard: Cannot deactivate room assigned in approved schedules
            if (!rowData.active) {
              const activeRoomDuty = db.prepare(`
                SELECT s.id as scheduleId, s.state
                FROM assignments a
                JOIN schedules s ON a.schedule_id = s.id
                WHERE a.room_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
                LIMIT 1
              `).get(existing.id) as any;
              if (activeRoomDuty) {
                errors.push({
                  field: 'active',
                  message: `Cannot deactivate room "${rowData.id}" (${existing.name}): Room has active duties in ${activeRoomDuty.state.toLowerCase()} schedule "${activeRoomDuty.scheduleId}". Reassign duties before deactivating room.`,
                });
              }
            }

            // Guard: Cannot set examDepartment if assigned faculty is in that department
            if (rowData.examDepartment && rowData.examDepartment.trim().length > 0) {
              const deptConflict = db.prepare(`
                SELECT s.id as scheduleId, f.id as facultyId, f.name as facultyName, f.department
                FROM assignments a
                JOIN schedules s ON a.schedule_id = s.id
                JOIN faculty f ON a.faculty_id = f.id
                WHERE a.room_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
                  AND LOWER(TRIM(f.department)) = LOWER(TRIM(?))
                LIMIT 1
              `).get(existing.id, rowData.examDepartment.trim()) as any;
              if (deptConflict) {
                errors.push({
                  field: 'examDepartment',
                  message: `Cannot set examination department "${rowData.examDepartment}" for room "${rowData.id}": Assigned faculty ${deptConflict.facultyName} (${deptConflict.facultyId}) in approved schedule "${deptConflict.scheduleId}" is from the same department.`,
                });
              }
            }

            if (errors.length === 0) {
              warnings.push({
                field: 'id',
                message: `Existing room "${rowData.id}" will be updated.`,
              });
            }
          } else {
            errors.push({
              field: 'id',
              message: `Room ID "${rowData.id}" already exists in database. Enable update mode to overwrite.`,
            });
          }
        }
      }

      rows.push({
        rowNumber,
        data: rowData,
        isValid: errors.length === 0,
        errors,
        warnings,
      });
    }

    const totalRows = rows.length;
    const validRows = rows.filter((r) => r.isValid).length;
    const errorRows = rows.filter((r) => !r.isValid).length;
    const warningRows = rows.filter((r) => r.warnings.length > 0).length;

    return {
      totalRows,
      validRows,
      errorRows,
      warningRows,
      canCommit: totalRows > 0 && errorRows === 0,
      rows,
    };
  }

  /**
   * Commits validated room rows using an atomic database transaction.
   */
  public static commitRoomImport(
    rows: ValidatedRow<RoomImportRow>[],
    actor = 'System Admin',
    allowUpdateExisting = false
  ): { imported: number; updated: number } {
    if (!rows || rows.length === 0) {
      throw new Error('No rows provided for import.');
    }

    const invalidRow = rows.find((r) => !r.isValid || r.errors.length > 0);
    if (invalidRow) {
      throw new Error(
        `Cannot commit import: Row ${invalidRow.rowNumber} contains errors: ${invalidRow.errors.map((e) => e.message).join('; ')}`
      );
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO rooms (id, name, building, floor, capacity, exam_department, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
      UPDATE rooms
      SET name = ?, building = ?, floor = ?, capacity = ?, exam_department = ?, active = ?, updated_at = ?
      WHERE id = ?
    `);

    const checkStmt = db.prepare('SELECT id FROM rooms WHERE id = ?');

    let imported = 0;
    let updated = 0;

    const commitTx = db.transaction(() => {
      for (const row of rows) {
        const r = row.data;
        const exists = checkStmt.get(r.id);

        if (exists) {
          if (!allowUpdateExisting) {
            throw new Error(`Conflict: Room ID ${r.id} already exists.`);
          }
          if (!r.active) {
            const activeRoomDuty = db.prepare(`
              SELECT s.id as scheduleId, s.state
              FROM assignments a
              JOIN schedules s ON a.schedule_id = s.id
              WHERE a.room_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
              LIMIT 1
            `).get(r.id) as any;
            if (activeRoomDuty) {
              throw new Error(`Cannot commit import: Room "${r.id}" has active duties in ${activeRoomDuty.state.toLowerCase()} schedule "${activeRoomDuty.scheduleId}". Deactivating assigned rooms violates approved schedules.`);
            }
          }
          if (r.examDepartment && r.examDepartment.trim().length > 0) {
            const deptConflict = db.prepare(`
              SELECT s.id as scheduleId, f.id as facultyId, f.name as facultyName, f.department
              FROM assignments a
              JOIN schedules s ON a.schedule_id = s.id
              JOIN faculty f ON a.faculty_id = f.id
              WHERE a.room_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
                AND LOWER(TRIM(f.department)) = LOWER(TRIM(?))
              LIMIT 1
            `).get(r.id, r.examDepartment.trim()) as any;
            if (deptConflict) {
              throw new Error(`Cannot commit import: Setting exam department "${r.examDepartment}" for room "${r.id}" conflicts with assigned faculty ${deptConflict.facultyName} in approved schedule "${deptConflict.scheduleId}".`);
            }
          }
          updateStmt.run(
            r.name,
            r.building,
            r.floor,
            r.capacity,
            r.examDepartment || null,
            r.active ? 1 : 0,
            now,
            r.id
          );
          updated++;
        } else {
          insertStmt.run(
            r.id,
            r.name,
            r.building,
            r.floor,
            r.capacity,
            r.examDepartment || null,
            r.active ? 1 : 0,
            now,
            now
          );
          imported++;
        }
      }

      AuditService.log(
        {
          entity: 'rooms',
          entityId: `BATCH_IMPORT_${Date.now()}`,
          action: 'ROOMS_IMPORTED',
          actor,
          newValues: {
            total: rows.length,
            imported,
            updated,
            ids: rows.map((r) => r.data.id),
          },
          reason: `Batch rooms import of ${rows.length} rows (${imported} new, ${updated} updated)`,
        },
        db
      );
    });

    commitTx();

    return { imported, updated };
  }
}

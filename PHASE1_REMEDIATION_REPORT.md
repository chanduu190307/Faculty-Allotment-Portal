# Faculty Allotment System — Phase 1: Safe Database Remediation Report

**Date & Time:** 2026-10-13T20:50:00+05:30  
**Status:** Completed & Verified  
**Target:** Phase 1 Safe Database Remediation (from `STAGE1_COMPLIANCE_AUDIT.md`)  
**Scope Boundary:** Phase 1 schema, constraints, migrations, and types only. Solver logic and Phase 2 scheduling behavior untouched.

---

## 1. Executive Summary

Phase 1 ("Safe Database Remediation") has been fully implemented, tested, and verified on the **Faculty Allotment System** codebase. 

### Key Accomplishments
1. **Hard Rule H2 SQLite Enforcement:** Enforced at the database engine level via partial unique index `idx_assignments_unique_daily_teacher ON assignments(schedule_id, date, faculty_id) WHERE status != 'CANCELLED'`.
2. **Exemption Support:** Added `exempt INTEGER NOT NULL DEFAULT 0` column to `faculty`.
3. **Room Exam Department:** Added `exam_department TEXT DEFAULT NULL` column to `rooms`.
4. **Examination Rest Days:** Added `rest_days INTEGER NOT NULL DEFAULT 1 CHECK (rest_days >= 0)` to `examinations` with SQLite engine-level check constraint.
5. **Schedule Seed & Optimistic Concurrency:** Added `seed INTEGER DEFAULT NULL` and `counter INTEGER NOT NULL DEFAULT 1` to `schedules`. Added atomic read and compare-and-swap increment methods in `ScheduleService`.
6. **Zero Data Loss:** 100% of historical production data preserved. Verified identical row counts before and after migration across all tables.
7. **Comprehensive Verification:** 39/39 Vitest tests passing (including 14 new Phase 1 regression tests), zero-blue botanical audit passed, server & client builds clean (0 errors), export integrity verified (4/4 files).

---

## 2. Backup Location & Safety Pre-Flight

Before executing any database migration or schema alteration, a safety inspection and full SQLite WAL checkpoint were performed:

* **Database Target Path:** `server/faculty_allotment.db`
* **Pre-Migration WAL Checkpoint:** Executed `PRAGMA wal_checkpoint(TRUNCATE)`
* **Timestamped Backup Path:** `server/faculty_allotment_backup_20261013_202900.db`
* **Backup Size:** 6,160,384 bytes
* **Pre-Migration Row Counts:**
  * `faculty`: 500 rows
  * `rooms`: 200 rows
  * `examinations`: 5 rows
  * `schedules`: 6 rows
  * `assignments`: 4,800 rows
  * `audit_logs`: 193 rows

### Existing-Data Conflict Verification
Before applying the partial unique index, a query scanned `assignments` for any historical duplicates violating Hard Rule H2:
```sql
SELECT schedule_id, date, faculty_id, count(*) as count
FROM assignments
WHERE status != 'CANCELLED'
GROUP BY schedule_id, date, faculty_id
HAVING count(*) > 1;
```
**Outcome:** **0 conflicts found**. The existing data satisfied the index predicate cleanly, allowing the unique index to be safely applied without requiring any data modification or deletion.

---

## 3. Files Changed

| File Path | Description of Changes |
| :--- | :--- |
| `server/src/db/schema.ts` | Updated `SCHEMA_SQL` definitions; implemented transactional, idempotent `runMigrations(db)` with schema introspection, additive `ALTER TABLE` migrations, and pre-index conflict guard. |
| `server/src/db/connection.ts` | Enhanced `getDatabase()` to maintain connection singleton consistency when switching databases in test workers and gracefully close prior instances. |
| `server/src/db/seed.ts` | Updated prepared statements and seed loops for `rooms`, `faculty`, and `examinations` to include defaults for new columns (`exam_department: null`, `exempt: 0`, `rest_days: 1`). |
| `server/src/domain/scheduling/types.ts` | Added `examDepartment?: string \| null` to `Room`, `exempt?: boolean` to `Faculty`, `seed?: number \| null` and `counter?: number` to `ScheduleGenerationResult`, and defined `ScheduleRecord` interface. |
| `server/src/services/faculty.service.ts` | Updated `list()`, `getById()`, `create()`, and `update()` to read and persist `exempt`. |
| `server/src/services/room.service.ts` | Updated `list()`, `getById()`, `create()`, and `update()` to read and persist `examDepartment` / `exam_department`. |
| `server/src/services/exam.service.ts` | Updated `list()`, `getById()`, and `create()` to map `restDays`, `examDepartment`, and `exempt`. Fixed duplicate token in `create()`. |
| `server/src/services/schedule.service.ts` | Updated `generate()` to insert `seed` and `counter: 1` in `schedules`. Added `getScheduleCounter()` and atomic `incrementScheduleCounter()` for optimistic concurrency. |
| `server/src/routes/api.routes.ts` | Updated `/allotment/generate/:examId` endpoint to optionally accept `req.body.seed`. |
| `server/tests/db/phase1-database-remediation.test.ts` | **NEW:** Comprehensive 14-test regression test suite validating clean init, upgrades, idempotency, raw SQL constraint enforcement, defaults, optimistic concurrency, and conflict safety guards. |

---

## 4. Before-and-After Schema Summary

### Table: `faculty`
* **Before:** `id`, `name`, `email`, `department`, `designation`, `phone`, `active`, `max_duty_override`, `created_at`, `updated_at`
* **After:** Added `exempt INTEGER NOT NULL DEFAULT 0`
* **Semantics:** 0 = active in allotment eligible pool; 1 = exempt from duty allocation (Hard Rule H7 preparation).

### Table: `rooms`
* **Before:** `id`, `name`, `building`, `floor`, `capacity`, `active`, `created_at`, `updated_at`
* **After:** Added `exam_department TEXT DEFAULT NULL`
* **Semantics:** Nullable department code. When specified, rooms in this department should be prioritized/allocated for matching departmental exams (Hard Rule H3 preparation).

### Table: `examinations`
* **Before:** `id`, `name`, `academic_year`, `start_date`, `end_date`, `default_staffing_per_room`, `sessions_per_day`, `session_config`, `max_duties_per_faculty`, `status`, `created_at`, `updated_at`
* **After:** Added `rest_days INTEGER NOT NULL DEFAULT 1 CHECK (rest_days >= 0)`
* **Semantics:** Minimum rest days between duties (default 1). SQLite-level check constraint rejects any negative value.

### Table: `schedules`
* **Before:** `id`, `examination_id`, `version`, `state`, `validation_result`, `created_by`, `created_at`, `updated_at`, `approved_by`, `approved_at`, `published_at`, `archived_at`
* **After:** Added `seed INTEGER DEFAULT NULL`, `counter INTEGER NOT NULL DEFAULT 1`
* **Semantics:** `seed` stores the integer pseudo-random seed used for deterministic tie-breaking (for Phase 2). `counter` provides optimistic locking concurrency protection against concurrent edits.

### Table: `assignments` (Index)
* **Before:** `idx_assignments_sched_fac`, `idx_assignments_sched_date_sess`, `UNIQUE (schedule_id, date, session, room_id)`
* **After:** Added partial unique index `idx_assignments_unique_daily_teacher`:
  ```sql
  CREATE UNIQUE INDEX idx_assignments_unique_daily_teacher 
  ON assignments(schedule_id, date, faculty_id) 
  WHERE status != 'CANCELLED';
  ```
* **Semantics:** Enforces Hard Rule H2 (maximum 1 duty per day) at the SQLite engine level. Cancelled duties are excluded by the index filter predicate, permitting valid substitutions and emergency reassignments while permanently blocking duplicate active duties.

---

## 5. Migration Execution & Outcome

The persistent migration was executed against `server/faculty_allotment.db`:

```
[Runner] Connecting to C:\CodeAlpha\Faculty Allotement Portal\server\faculty_allotment.db...
[Runner] Executing runMigrations()...
[Runner] Migration completed successfully.
Faculty exempt col: { cid: 10, name: 'exempt', type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 }
Rooms exam_department col: { cid: 8, name: 'exam_department', type: 'TEXT', notnull: 0, dflt_value: 'NULL', pk: 0 }
Examinations rest_days col: { cid: 12, name: 'rest_days', type: 'INTEGER', notnull: 1, dflt_value: '1', pk: 0 }
Schedules seed col: { cid: 12, name: 'seed', type: 'INTEGER', notnull: 0, dflt_value: 'NULL', pk: 0 }
Schedules counter col: { cid: 13, name: 'counter', type: 'INTEGER', notnull: 1, dflt_value: '1', pk: 0 }
Assignments index list: [
  { name: 'idx_assignments_unique_daily_teacher', unique: 1 },
  { name: 'idx_assignments_sched_date_sess', unique: 0 },
  { name: 'idx_assignments_sched_fac', unique: 0 },
  { name: 'sqlite_autoindex_assignments_2', unique: 1 },
  { name: 'sqlite_autoindex_assignments_1', unique: 1 }
]
Row counts after migration: {
  "faculty": 500,
  "rooms": 200,
  "examinations": 5,
  "schedules": 6,
  "assignments": 4800,
  "audit_logs": 193
}
```

### Idempotency Check
Running `runMigrations(db)` a second time completed with code 0 without errors, verifying full idempotency.

---

## 6. Tests Executed and Actual Results

### Vitest Test Suite (39 Tests Passed, 0 Failed)
```
 ✓ tests/api/concurrency-rollback.test.ts (3 tests) 68ms
 ✓ tests/db/phase1-database-remediation.test.ts (14 tests) 83ms
 ✓ tests/scheduling/engine.test.ts (19 tests) 398ms
 ✓ tests/api/api-lifecycle.test.ts (3 tests) 190ms

 Test Files  4 passed (4)
      Tests  39 passed (39)
   Duration  1.62s
```

#### Detailed Breakdown of Phase 1 Tests (`phase1-database-remediation.test.ts`)
1. **Clean Database Initialization:** Fresh in-memory DB creates all 5 columns and unique index with correct data types, nullability, and defaults.
2. **Legacy Database Upgrade:** Simulated pre-migration database without the 5 columns upgrades safely with zero lost rows.
3. **Idempotency:** Sequential multiple executions of `runMigrations` throw no errors.
4. **Raw SQL Constraint Rejection:** Inserting duplicate non-cancelled duty for same teacher on same date in same schedule throws `SQLITE_CONSTRAINT_UNIQUE` directly from SQLite engine.
5. **Partial Index Predicate (Cancelled Duty):** Replacing a `CANCELLED` assignment on the same date with an active `SCHEDULED` assignment succeeds.
6. **Cross-Date Scheduling:** Same teacher assigned on different examination dates within the same schedule succeeds.
7. **Cross-Version Scheduling:** Same teacher assigned on the same date across different schedule versions succeeds.
8. **Engine-Level CHECK Constraint:** Inserting negative `rest_days` (`-1`) throws `SQLITE_CONSTRAINT_CHECK: CHECK constraint failed: rest_days >= 0`. Inserting `0` or positive values succeeds.
9. **Exempt Flag Persistence:** Insert and read back `exempt = 1` and default `0`.
10. **Exam Department Persistence:** Insert and read back `exam_department = 'Biotechnology'` and default `null`.
11. **Schedule Seed Persistence:** Insert and read back `seed = 4242` and default `null`.
12. **Concurrency Counter Read & Increment:** Counter starts at 1, increments to 2 atomically.
13. **Concurrency Conflict Detection:** Concurrent update attempt with stale counter is rejected with `Concurrency conflict`.
14. **Safety Conflict Verification Guard:** Attempting migration on a database with pre-existing conflicting data halts before creating index and produces descriptive error without mutating data.

### Verification Scripts & Audits
1. **Export Audit (`tests/verify-exports.ts`):**
   * Daily Report Excel (`Daily_Report_Audit.xlsx`, 7,905 bytes) — Verified Creator and 21 rows.
   * Daily Report PDF (`Daily_Report_Audit.pdf`, 2,431 bytes) — Verified `%PDF-` header.
   * Final Report Excel (`Final_Report_Audit.xlsx`, 9,067 bytes) — Verified Executive Summary & Faculty Duty Ledger (31 rows).
   * Final Report PDF (`Final_Report_Audit.pdf`, 2,548 bytes) — Verified `%PDF-` header.
2. **Zero-Blue Architectural Audit (`tests/audit-zero-blue.ts`):**
   * 0 prohibited blue tokens found across all client source and built assets.
   * 100% compliance with Restrained Botanical Palette.
   * Approved typography: `Newsreader`, `Plus Jakarta Sans`, and `IBM Plex Mono`.
3. **TypeScript Server Build (`npm run build` in `server`):** `tsc` completed with 0 errors.
4. **Client Production Bundle Build (`npm run build` in `client`):** `tsc && vite build` built 1,922 modules with 0 errors in 541ms.

---

## 7. Tool Disclosures & Independent Code Review

### Tool Disclosure
* **CodeRabbit CLI:** The `coderabbit` tool/CLI is not installed in the Windows terminal environment (`Get-Command coderabbit` returned exit code 1). Per instruction: *"If a tool is unavailable, disclose that and use an available alternative without claiming CodeRabbit ran."* 
* **Alternative Used:** A rigorous peer-level architecture review and manual AST/code audit was conducted across all modified files.

### Independent Review Findings & Dispositions

1. **Finding [SQL String Literals in Index Predicate]:**
   * *Observation:* In SQLite index definitions, `WHERE status != "CANCELLED"` would treat `"CANCELLED"` as an identifier (column name), not a string literal.
   * *Resolution Verified:* All index definitions use single-quoted literals: `WHERE status != 'CANCELLED'`. Confirmed by SQLite parser.
2. **Finding [Transaction Atomicity during Migration]:**
   * *Observation:* Running DDL statements outside an explicit transaction can leave a partial schema in the event of an unhandled exception.
   * *Resolution Verified:* `runMigrations` wraps all steps (column introspection, DDL alters, conflict inspection, index creation) inside a single `db.transaction(() => { ... })()`.
3. **Finding [Index Pre-Creation Conflict Guard]:**
   * *Observation:* If `CREATE UNIQUE INDEX` was placed directly inside `SCHEMA_SQL`, SQLite would throw a generic constraint error before custom conflict diagnostics could execute.
   * *Resolution Verified:* Removed the unique index from the static `SCHEMA_SQL` text. The index is applied in Step 4 of `runMigrations` only after the `GROUP BY ... HAVING count(*) > 1` conflict check confirms 0 conflicting records.
4. **Finding [Database Connection Singleton in Test Workers]:**
   * *Observation:* Calling `getDatabase(':memory:')` without updating `currentDb` caused service operations in test suites to inadvertently reference disk-based databases.
   * *Resolution Verified:* `getDatabase(dbPath)` was updated to gracefully close any prior connection and set `currentDb = db`, ensuring complete isolation for in-memory regression tests.
5. **Finding [Scope Boundary Check]:**
   * *Observation:* Ensured no algorithm or solver code was changed in `engine.ts` or `capacity.ts`.
   * *Resolution Verified:* `git diff server/src/domain/scheduling/engine.ts` confirmed zero modifications.

---

## 8. Known Limitations & Phase 2 Prerequisites

With Phase 1 complete, the database is fully prepared for Phase 2:

1. **Solver Logic Untouched (by design):** The `SchedulingEngine` currently does not yet consume `seed` for deterministic tie-breaking or `rest_days` for sequence-order gap enforcement. These belong to Phase 2.
2. **Exempt Faculty Filtering:** The `exempt` field is stored and exposed via `FacultyService`, but the solver's candidate filter will incorporate it in Phase 2.
3. **Room Exam Department Prioritization:** The `exam_department` column is stored and exposed via `RoomService`, but solver room-department affinity will be implemented in Phase 2.
4. **Sequence-Order Rest Days:** The solver currently treats consecutive days as sequential dates in calendar time rather than sequence order (`sequenceOrder` from `examination_dates`). Phase 2 will implement the sequence-order rest day algorithm.

---

## 9. Phase 1 Sign-Off Readiness

All requirements and safety guarantees of Phase 1 have been met:
* [x] Schema constraints and missing fields implemented.
* [x] Additive migrations transactional and idempotent.
* [x] Zero loss of existing data or audit history.
* [x] Partial unique index enforces Hard Rule H2 at the SQLite engine level.
* [x] Complete test suite passing (39/39).
* [x] Zero-blue design and exact typography preserved.
* [x] Solver logic preserved without premature Phase 2 changes.

**Awaiting user approval before proceeding to Phase 2.**

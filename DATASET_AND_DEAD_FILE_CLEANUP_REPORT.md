# DATASET & DEAD-FILE CLEANUP REPORT

**Project:** Faculty Allotment Portal  
**Priority Area:** Safe Dataset Removal, Dead-Code Elimination & Dependency Verification  
**Status:** **COMPLETED & VERIFIED**  

---

## 1. Executive Summary

This report documents the identification and elimination of automatic bundled demonstration data from normal application startup and runtime flow, as well as an evidence-based audit of unused files, abandoned prototypes, scratch artifacts, and obsolete scripts.

Crucially, all database schemas, migration histories, user-created institutional records, test fixtures (`ttt.pdf`), and required post-allotment Excel export templates (`excel file.xlsx` at root and in `server/src/assets/templates/excel file.xlsx`) have been strictly protected and preserved.

---

## 2. Sample Datasets and Demo-Seeding Behavior Identified

### 2.1 The Automatic Startup Seeder Defect
- **Identified Location:** `server/src/server.ts` (lines 12–17) and `server/src/db/init.ts` (line 11).
- **Previous Behavior:**
  ```typescript
  const facCount = (db.prepare('SELECT count(*) as count FROM faculty').get() as { count: number }).count;
  if (facCount === 0) {
    console.log('[Server] Seeding initial defaults...');
    seedDatabase(db);
  }
  ```
  Whenever the application started up with an empty database, it automatically called `seedDatabase(db)`, generating:
  - 500 fake faculty members across 6 departments.
  - 200 dummy rooms across 4 blocks.
  - Dummy examinations, dummy dates, dummy room assignments, and dummy leave requests.
- **Remediation Applied:**
  - Removed `seedDatabase(db)` call from `server/src/server.ts`.
  - Replaced it with clean initialization of essential institutional setting defaults (`default_room_count: 20`, `default_faculty_count: 50`, `default_max_duties: 6`, `sessions_per_day: 2`, `institution_name: 'Faculty Allotment Portal'`).
  - Tables `faculty`, `rooms`, `examinations`, `examination_dates`, `examination_rooms`, `examination_faculty`, `schedules`, and `assignments` remain completely clean on startup (count = 0).
  - Maintained `seedDatabase` in `server/src/db/seed.ts` purely as an on-demand test fixture helper and added explicit CLI script `npm run db:seed`.

### 2.2 First-Run Clean Installation & Guided Empty States
- When a fresh installation begins, all management pages (`FacultyManagement.tsx`, `ExaminationManagement.tsx`, `RoomManagement.tsx`) display helpful botanical-themed empty states that guide the user to:
  1. Configure expected room and teacher targets in Settings.
  2. Upload and confirm faculty records via PDF directory or Excel/CSV spreadsheet.
  3. Register or import rooms.
  4. Upload and confirm the official examination timetable PDF.
  5. Review preflight capacity and generate valid schedules.

---

## 3. Evidence-Based Cleanup Manifest

| Item Removed | Path | Category | Evidence & Rationale for Removal |
|---|---|---|---|
| `spec_text.txt` | `spec_text.txt` | Binary Corrupted Text File | 30KB binary font data (`Georgia - Bold`) accidentally written as a `.txt` file; completely unreferenced in codebase. |
| `migrate-phase3.ts` | `server/migrate-phase3.ts` | Obsolete Migration Script | One-time standalone runner from Phase 3; all migrations are now executed automatically via `runMigrations()` in `server/src/db/schema.ts`. |
| `prototype-parser.ts` | `server/scratch/prototype-parser.ts` | Abandoned Prototype | 16KB experimental parser prototype superseded by `server/src/services/pdf-timetable-parser.service.ts`. |
| `test-large.ts` | `server/scratch/test-large.ts` | Temporary Scratch Script | Experimental benchmark script; benchmark tests are formalized in `server/tests/scheduling/engine.test.ts`. |
| `test-splice.ts` | `server/scratch/test-splice.ts` | Temporary Scratch Script | Ad-hoc testing script; replaced by Vitest integration suites. |
| `inspect-excel.ts` | `server/scratch/inspect-excel.ts` | Temporary Inspection Script | Diagnostic script for inspecting cell types in Excel files. |
| `inspect-pdf.ts` | `server/scratch/inspect-pdf.ts` | Temporary Inspection Script | Diagnostic script for inspecting PDF tokens. |
| `check-note.ts` | `server/scratch/check-note.ts` | Temporary Inspection Script | Diagnostic script for inspecting note cells. |
| `run-migration.ts` | `server/scratch/run-migration.ts` | Temporary Scratch Script | Ad-hoc migration runner superseded by `schema.ts`. |
| `verify-excel-fidelity.ts`| `server/scratch/verify-excel-fidelity.ts`| Temporary Scratch Script | Replaced by `server/tests/verify-exports.ts` and automated test suites. |
| `audit-excel-com.ps1` | `server/scratch/audit-excel-com.ps1` | Temporary PowerShell Script | Local COM inspection script not used by any automated workflow. |
| Scratch Excel Outputs | `server/scratch/*.xlsx` (6 files) | Generated Test Artifacts | Temporary output workbooks (`allotment-fidelity-*.xlsx`, `Daily_Report_Audit.xlsx`, `Final_Report_Audit.xlsx`, `test-*.xlsx`). |
| Scratch PDF Outputs | `server/scratch/*.pdf` (4 files) | Generated Test Artifacts | Temporary output PDFs (`allotment-fidelity-*.pdf`, `Daily_Report_Audit.pdf`, `Final_Report_Audit.pdf`). |

---

## 4. Protected Items Retained and Safeguards Verified

| Item Retained | Path | Preservation Rationale | Safeguard Status |
|---|---|---|:---:|
| **Working SQLite Database** | `server/faculty_allotment.db` | Contains the user's live database, existing audit logs, and settings. | **PROTECTED** (Never reset or deleted) |
| **Database Migration History** | `server/src/db/schema.ts` | Contains `runMigrations()` with automated `PRAGMA` schema checks and foreign keys. | **PROTECTED** (100% Intact) |
| **Post-Allotment Excel Template (Root)** | `excel file.xlsx` | Required master post-allotment Excel template used to preserve exact formatting and logos. | **PROTECTED** (45,287 bytes intact) |
| **Post-Allotment Excel Template (Server Asset)** | `server/src/assets/templates/excel file.xlsx` | Runtime fallback template loaded by `report.service.ts`. | **PROTECTED** (45,287 bytes intact) |
| **Real Timetable Fixture** | `server/tests/fixtures/ttt.pdf` | Real-world 3-page test fixture required for automated parser regression tests. | **PROTECTED** (429,055 bytes intact) |
| **Database Backups** | `server/*.bak`, `server/*backup*.db` | Preserved previous migration backups as safety snapshots without exposing them to runtime. | **PROTECTED** (Ignored by `.gitignore`) |
| **All Test Suites** | `server/tests/**/*.test.ts` (13 files) | All 128 tests retained; no assertions weakened or removed. | **PROTECTED** (128/128 passing) |

---

## 5. Dependency Audit & Changes

- **Server Dependencies (`server/package.json`):**
  - Confirmed all 11 production dependencies (`better-sqlite3`, `cors`, `csv-parse`, `csv-stringify`, `dotenv`, `exceljs`, `express`, `pdf-parse`, `pdfkit`, `zod`, `@types/pdf-parse`) are actively imported and required by production services.
  - Added npm script `"db:seed": "tsx src/db/seed.ts"` to enable explicit test dataset seeding without polluting normal startup.
- **Client Dependencies (`client/package.json`):**
  - Confirmed only essential packages are installed (`lucide-react`, `react`, `react-dom`). Zero unused or bloated packages.
- **Reproducible Lockfiles:**
  - Both `server/package-lock.json` and client dependencies build cleanly with zero warnings or missing peer dependencies.

---

## 6. Verification Summary

1. `npm --prefix server run build`: **PASS** (Zero TypeScript compilation errors).
2. `npm --prefix client run build`: **PASS** (Zero Vite build errors; production bundle created in 1.1s).
3. `npm --prefix server run audit:zero-blue`: **PASS** (Strict 0-blue tokens verified across all client source and built assets).
4. `npm --prefix server run test`: **PASS** (128 passed across 13 test files in 2.9s).
5. Clean-install test in `phase1-database-remediation.test.ts`: **PASS** (0 sample records on clean startup).

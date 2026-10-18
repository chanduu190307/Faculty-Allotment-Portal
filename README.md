# Faculty Allotment System

A comprehensive, production-grade examination invigilation management platform that automates dual-role faculty duty scheduling across examination sessions, strictly enforces hard institutional constraints, safeguards data with immutable approved versions, prevents stale concurrent updates, and produces pixel-faithful report exports including the authoritative reference Excel workbook (`excel file.xlsx`) and print-ready room invigilation sheets with dual signature lines.

---

## 1. Problem & Solution Overview

### The Problem
Educational institutions face significant administrative challenges during major examination terms:
- Coordinating hundreds of faculty members across dozens of rooms and multi-day exam sessions.
- Enforcing non-negotiable dual-role staffing: every examination room requires **two distinct teachers** per session (an **Invigilator** for hall supervision and a **Frisking Teacher** for candidate verification and entry security).
- Calculating true staffing demand: $\text{Required Duties} = \text{Active Rooms} \times \text{Confirmed Sessions} \times 2\text{ Roles}$, and detecting capacity infeasibility before schedule generation.
- Enforcing complex scheduling rules: at most one duty per faculty per day across all sessions, sequence-based rest intervals between duties, room rotation across duties, department exclusions, duty caps, and approved leaves.
- Parsing complex multi-semester examination timetables with multiple online slots and cohort splits, and ensuring all semesters remain visible and persistent across page refreshes.
- Managing college physical hierarchy: Block A, Block B, and Block C across multiple floors with default standards of 25 rooms per floor.
- Accidental overwriting or in-place corruption of published duty rosters.
- Concurrent modifications resulting in stale overwrites or inconsistent duty assignments.
- Template divergence when exporting rosters to external spreadsheets, breaking downstream physical signature collection.

### The Solution
The **Faculty Allotment System** provides:
- **Dual-Role Deterministic Scheduling Engine:** Allocates two distinct active faculty members (Invigilator + Frisking Teacher) per room-session under Hard Rules H1–H7 with 32-bit MurmurHash3 deterministic seeded tie-breaking and authoritative preflight capacity evaluation.
- **Multi-Semester Timetable PDF Parsing & Visibility:** High-fidelity spatial coordinate parser extracting multiline courses, online test slots (e.g. 08:30–10:00), and cohort groups (CSE/AIML vs ECE/EEE) across all pages. UI features dedicated semester tabs (Semesters I, III, V, All Semesters) with transactional database persistence.
- **Hierarchical Room Management (Blocks & Floors):** Models Block A, Block B, Block C and Floors 1–4 with 25 rooms per floor default numbering (`A-101` to `A-125`). Features bulk room generation with duplicate prevention and live diagnostics of expected versus registered rooms.
- **Comprehensive Faculty CRUD & Multi-Format Imports:** Add, edit, view details, and safe delete faculty. Handles deletion conflicts via HTTP 409 with safe deactivation prompt to preserve historical rosters. Supports CSV, XLSX, and PDF faculty roster imports with in-memory preview and zero DB writes on preview.
- **Strict Version Lifecycle & Immutability:** New schedules initialize in `DRAFT`, undergo automated and authoritative validation, transition to `APPROVED` or `PUBLISHED`, and remain completely immutable. Any approved reassignment creates an isolated, lineage-tracked revision (`${baseId}-REV${n}`) with a mandatory reason.
- **Role-Aware Reassignment:** Allows reassigning the Invigilator or Frisking Teacher individually while strictly enforcing dual-role distinctness ($\text{Invigilator} \neq \text{Frisking Teacher}$).
- **Optimistic Concurrency Control:** Every schedule version tracks a monotonic transaction `counter` for atomic compare-and-swap operations, returning HTTP 409 conflict diagnostics on stale edits.
- **Dual-Role Master Excel & PDF Exports:** Exports daily reports containing dedicated columns for both Invigilator and Frisking Teacher, preserves the authoritative 6-column reference Excel template (`excel file.xlsx`), and generates vector A4 PDF room sheets with dual handwriting signature blocks.
- **Clean First-Run Initialization:** Clear separation between clean schema initialization (0 sample faculty/rooms) and optional manual demo seeding.
- **Permissioned Audit Logging:** Tamper-proof event logs with recursive masking of sensitive tokens, passwords, and API keys.

---

## 2. Technology Stack

### Backend
- **Runtime:** Node.js 24 LTS with TypeScript in strict mode
- **Server Framework:** Express 5 with modular REST routers and centralized error handling
- **Database Engine:** SQLite via `better-sqlite3` with Write-Ahead Logging (`WAL`), synchronous `NORMAL`, foreign keys enabled (`PRAGMA foreign_keys = ON`), and atomic transactions (`db.transaction()`)
- **Document & Spreadsheet Engines:** `exceljs` for template fidelity preservation; `pdfkit` for vector A4 PDF generation; `pdf-parse` for spatial coordinate extraction
- **Data Parsing:** `csv-parse` and `csv-stringify`
- **Validation:** Shared server-side domain validator ensuring zero constraint leakage

### Frontend
- **Framework:** React 19 with Vite 8 and TypeScript
- **Design System:** Restrained Botanical Palette (**Strict Zero-Blue Policy**)
  - Canvas: `#F7F5EF` | Card: `#FFFEFA` | Forest: `#244C3A` | Sage: `#879B83`
  - Text: `#242923` | Secondary: `#6D736B` | Border: `#E2E0D7` | Amber: `#C18A32` | Error: `#B94B45` | Success: `#3F7855`
- **Typography:** Exactly three approved Google font families:
  - `--font-editorial`: **Newsreader** (Headings & titles)
  - `--font-ui`: **Plus Jakarta Sans** (Navigation, forms, buttons, tables)
  - `--font-data`: **IBM Plex Mono** (Codes, IDs, counters, metrics)
- **Icons:** `lucide-react` rendered in botanical tones

---

## 3. Architecture & Project Structure

```
Faculty Allotement Portal/
├── .coderabbit.yaml                       # CodeRabbit automated review configuration
├── .env.example                           # Sanitized environment configuration template
├── .gitignore                             # Excludes node_modules, build outputs, local DBs, scratch
├── excel file.xlsx                        # Authoritative reference Excel template (45,287 bytes)
├── package.json                           # Root script orchestrator
├── README.md                              # Authoritative project documentation
│
├── DATA_CLEANUP_AND_FACULTY_CRUD_REPORT.md         # Phase 1 & 3 acceptance report
├── MULTI_SEMESTER_TIMETABLE_VISIBILITY_REPORT.md   # Phase 2 acceptance report
├── BLOCK_FLOOR_ROOM_MANAGEMENT_REPORT.md           # Phase 4 acceptance report
├── DUAL_ROLE_SCHEDULING_AND_CAPACITY_REPORT.md     # Phase 5 acceptance report
├── FINAL_END_TO_END_ACCEPTANCE_REPORT.md           # Full system acceptance report
│
├── client/                                # React 19 + Vite Frontend
│   ├── src/
│   │   ├── api/client.ts                  # Typed API client with counter passing
│   │   ├── components/Navigation.tsx      # Botanical navigation bar
│   │   ├── pages/
│   │   │   ├── AllotmentEngine.tsx        # Dual-role scheduling, preflight, revisions
│   │   │   ├── ExaminationManagement.tsx  # Multi-semester timetable tabs, dates, rest days
│   │   │   ├── FacultyManagement.tsx      # Faculty CRUD, View Details & PDF/CSV/XLSX import
│   │   │   ├── RoomManagement.tsx         # Block A/B/C tabs, floor filter, bulk generator
│   │   │   ├── Reports.tsx                # Dual-role Excel exports & Room sheets
│   │   │   ├── Settings.tsx               # Configuration, clean demo preview & reset
│   │   │   └── AuditLog.tsx               # Filtered audit log viewer
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── scripts/
│   └── dev.js                             # Concurrent backend and frontend launcher
│
└── server/                                # Express + SQLite Backend
    ├── src/
    │   ├── assets/templates/excel file.xlsx # Server template mirror
    │   ├── db/
    │   │   ├── connection.ts              # SQLite singleton with WAL & FK enforcement
    │   │   ├── schema.ts                  # Relational schema, dual-role columns & migrations
    │   │   ├── init.ts                    # Clean schema initialization (0 sample records)
    │   │   └── seed.ts                    # Optional manual test fixture generator
    │   ├── domain/scheduling/
    │   │   ├── capacity.ts                # Dual-role preflight capacity & shortfall diagnostics
    │   │   ├── engine.ts                  # Two-pass solver with MurmurHash3 tie-breaker
    │   │   ├── types.ts                   # Domain types & interfaces
    │   │   └── validator.ts               # Authoritative H1-H7 domain validation engine
    │   ├── middleware/
    │   │   ├── auth.ts                    # Authentication & role-based access control
    │   │   └── error.ts                   # Centralized error handler
    │   ├── routes/api.routes.ts           # REST API endpoints
    │   ├── services/
    │   │   ├── audit.service.ts           # Audit logging & recursive redaction
    │   │   ├── cleanup.service.ts         # Safe demo cleanup & institutional reset
    │   │   ├── exam.service.ts            # Examination lifecycle service
    │   │   ├── export.service.ts          # Dual-role Excel exports & PDF room sheets
    │   │   ├── faculty.service.ts         # Faculty CRUD, checkDeletable & deactivation
    │   │   ├── import.service.ts          # CSV/XLSX preflight import pipeline
    │   │   ├── pdf-faculty-parser.service.ts   # Faculty roster PDF parser
    │   │   ├── pdf-timetable-parser.service.ts # Multi-semester timetable PDF parser
    │   │   ├── report.service.ts          # Dual-role daily/final report snapshots
    │   │   ├── room.service.ts            # Block/floor rooms, bulk generate & diagnostics
    │   │   ├── schedule.service.ts        # Schedule lifecycle, CAS & dual-role revisions
    │   │   ├── settings.service.ts        # Institutional settings service
    │   │   └── timetable.service.ts       # Timetable persistence & multi-semester queries
    │   ├── app.ts                         # Express application factory
    │   └── server.ts                      # Application entrypoint (clean startup)
    ├── tests/                             # Vitest Automated Test Suites (16 files, 143 tests)
    │   ├── api/                           # API lifecycle, timetable, rooms, cleanup, imports
    │   ├── db/                            # SQLite migrations & schema integrity
    │   ├── fixtures/                      # Test fixtures (e.g. ttt.pdf)
    │   ├── scheduling/                    # Engine constraints H1-H7 & lifecycle
    │   ├── audit-zero-blue.ts             # Strict zero-blue & typography validator
    │   └── verify-exports.ts              # End-to-end report export validator
    ├── package.json
    └── tsconfig.json
```

---

## 4. Scheduling Engine & Hard Constraints (Rules H1 – H7)

The core scheduler (`server/src/domain/scheduling/engine.ts`) allocates two distinct teachers per active room-session and enforces all mandatory institutional rules:

| Hard Rule | Constraint Specification | Implementation & Verification |
|---|---|---|
| **H1 (Rule A)** | **Complete Room Coverage (Dual-Role)** | Every active examination room receives required staffing: exactly **two distinct teachers** per room per session (**Invigilator** + **Frisking Teacher**). |
| **H2 (Rule B)** | **Max 1 Duty per Day** | A teacher may perform at most one duty (Invigilator or Frisking) on any given calendar day across all sessions. Enforced at SQLite level via partial unique index `idx_assignments_unique_daily_teacher` and `idx_assignments_unique_daily_frisking`. |
| **H3 (Rule C)** | **Sequence-Based Rest Days** | Uses ordered examination sequence indices rather than calendar days: $|\text{index}(d_1) - \text{index}(d_2)| \le \text{rest\_days}$. Supports configurable `rest_days` (default: 1 intervening rest exam day). |
| **H4 (Rule D)** | **Independent Room Rotation** | Tracks chronologically ordered duties per faculty member; rejects assigning a teacher to the same room as their previous duty, independent of intervening unassigned dates. |
| **H5 (Rule F)** | **Maximum Duty Limits** | Respects per-examination maximum duty limits (default: 6) and individual faculty overrides (`max_duty_override`). Both Invigilation and Frisking duties count toward the faculty member's limit. |
| **H6 (Eligibility)**| **Comprehensive Eligibility** | Excludes inactive faculty, approved leaves matching session scope, exempt faculty (`exempt = true`, e.g. Principals, HODs, Exam Officers), and faculty from departments matching room-restricted examination departments (`exam_department`). |
| **H7 (Rule Unique)**| **Dual-Role Distinctness & Slot Exclusivity** | For every room-session, the allocated Invigilator and Frisking Teacher must be two distinct individuals: $\text{Invigilator} \neq \text{Frisking Teacher}$. Neither role may be left unassigned. |

### Two-Pass Dual-Role Allocation Algorithm
1. **Pass 1 — Invigilator Allocation:** Selects the optimal eligible candidate from the faculty pool under H1–H6 constraints, balancing cumulative workload and honoring room rotation.
2. **Pass 2 — Frisking Teacher Allocation:** Selects a second, distinct candidate from the remaining pool:
   $$\text{Frisking Candidate} \neq \text{Allocated Invigilator}$$
   Enforces Rule B (no other duty today), Rule C (rest interval), Rule F (duty cap), and Rule H6 (leave and departmental exclusions).

### Seeded Deterministic Tie-Breaking
Ties among equally eligible candidates are resolved using a 32-bit MurmurHash3 algorithm combining faculty ID and a reproducible integer seed. Generation with the same seed produces slot-for-slot identical schedules.

### Pre-Flight Dual-Role Capacity Analysis & Shortfall Diagnostics
Before creating any database records, the system calculates authoritative demand:
$$\text{Required Duties} = \text{Active Rooms} \times \text{Confirmed Sessions} \times 2\text{ Roles}$$

The system evaluates feasibility across 4 tiers:
1. Daily active staffing requirements vs. available eligible faculty ($2 \times \text{rooms} \le \text{eligible faculty}$).
2. Adjacent examination-date pair capacity under Rule H3 sequence spacing.
3. Total aggregate duty caps vs. total required dual-role slots.
4. Departmental exclusion headroom.

If capacity is insufficient, schedule generation **halts immediately with zero database writes**, and returns structured failure diagnostics explaining the mathematical shortfall along with 3 actionable remedies:
- **Option 1:** Register at least $K$ additional eligible faculty members.
- **Option 2:** Designate an examination date as a non-exam rest day.
- **Option 3:** Adjust duty caps or grant approved duty limit overrides.

---

## 5. College Room Management (Blocks A, B, C & Floors)

The platform models the physical structure of the institution:
- **Block Hierarchy:** Rooms are organized by academic block (`Block A`, `Block B`, `Block C`) and floor (`Floor 1`, `Floor 2`, `Floor 3`, `Floor 4`).
- **Default 25 Rooms per Floor Standard:** Floors default to 25 rooms with standardized institutional numbering:
  - Floor 1: `A-101` to `A-125` (Block A)
  - Floor 2: `B-201` to `B-225` (Block B)
  - Floor 3: `C-301` to `C-325` (Block C)
- **Hierarchy Diagnostics (`GET /api/rooms/diagnostics`):** Compares mathematical target (e.g. 3 blocks $\times$ 4 floors $\times$ 25 rooms = 300 expected rooms) against active registered rooms, providing clear coverage indicators.
- **Bulk Room Generator with Duplicate Prevention:**
  1. **Preview (`POST /api/rooms/bulk-generate/preview`):** Evaluates proposed 25 rooms for a block and floor, categorizing each room as `New` or `Already Exists`.
  2. **Commit (`POST /api/rooms/bulk-generate/commit`):** Inserts only genuinely new rooms inside an atomic transaction. Repeated generation skips existing rooms (`skippedCount = 25`, `createdCount = 0`), preventing duplicate records.
- **Safe Room Deactivation & 409 Conflict Protection:** Deleting a room with active or historical assignments is blocked with HTTP 409 Conflict, prompting the user for safe deactivation (`PUT /api/rooms/:id/deactivate`) to preserve historical data.

---

## 6. Multi-Semester Timetable PDF Parsing & Visibility

The examination timetable system handles complex institutional schedules (such as `ttt.pdf`):
- **Spatial PDF Layout Extraction:** `PdfTimetableParserService` extracts multiline subject titles, examination dates, session timings, and program cohort groupings.
- **Multi-Semester Support:** Timetables containing multiple semesters (e.g. Semester I, Semester III, Semester V) are fully extracted across multiple pages.
- **Online Test Slots:** Parses both standard exam shifts and dedicated online test slots (e.g. `08:30 AM – 10:00 AM`, `10:30 AM – 12:00 PM`).
- **Cohort Group Separation:** Correctly distinguishes split sessions across departments (e.g. `CSE / AIML / AIDS / CSE-DS` vs `ECE / EEE`).
- **Semester Selector Tabs:** The UI in `ExaminationManagement.tsx` provides instant filtering tabs:
  - `All Semesters`
  - `Semester I`
  - `Semester III`
  - `Semester V`
- **Transactional Persistence:** Once previewed and confirmed, timetable records commit atomically to SQLite (`examination_timetable`) and remain persistent across page refreshes.

---

## 7. Faculty Management CRUD & Multi-Format Imports

The faculty management subsystem (`/faculty`) provides complete administration:
- **Add Faculty Member:** Validates required fields and auto-generates clean institutional IDs (`FAC-XXX`) when left blank.
- **Edit Faculty Member:** Updates email, department, designation, phone, duty limit overrides, and exemption status.
- **View Faculty Details Modal:** Inspects full operational details, active duty counts, leave records, and audit timestamps.
- **Safe Deletion vs. Conflict Deactivation (HTTP 409):** If a faculty member is assigned to historical or active schedules, deletion is rejected with HTTP 409 Conflict. The UI prompts:
  > *"Faculty member is referenced in X duty assignment(s). Would you like to safely DEACTIVATE this faculty member instead? This preserves historical records."*
  Confirming calls `PUT /api/faculty/:id/deactivate`.
- **Multi-Format Roster Imports:** In-memory parsing for **CSV**, **XLSX**, and **PDF** faculty rosters via `ImportService` and `PdfFacultyParserService`. Previews all rows before commit with zero database mutations during preview.

---

## 8. Schedule Lifecycle, Revisions & Immutability

```
    [ Generate ]
         │
         ▼
     ┌───────┐      Validate
     │ DRAFT │────────────────────► ┌───────────┐
     └───────┘                      │ VALIDATED │
         │                          └─────┬─────┘
         │                                │ Approve (H1-H7 Verified)
         ▼                                ▼
┌─────────────────┐             ┌──────────────────┐
│   CANCELLED /   │             │     APPROVED     │ (IMMUTABLE BASE VERSION)
│     FAILED      │             └─────────┬────────┘
└─────────────────┘                       │
                                          ├────────────────────────────┐
                                          │ Publish                    │ Reassign Role
                                          ▼                            ▼ (Requires Reason)
                                   ┌───────────┐              ┌──────────────────┐
                                   │ PUBLISHED │              │ REVISION (DRAFT) │
                                   └───────────┘              │ base_id linked   │
                                                              └────────┬─────────┘
                                                                       │ Approve
                                                                       ▼
                                                              ┌──────────────────┐
                                                              │ APPROVED REVISION│
                                                              └──────────────────┘
```

- **Draft Isolation:** Newly generated schedules begin in `DRAFT` (counter 1).
- **Authoritative Approval Gate:** Approving a schedule triggers complete re-validation against rules H1–H7. Invalid schedules cannot be approved.
- **Approved Immutability:** Once approved, base schedule assignments are never modified in place.
- **Revision Branching:** Reassignments on an approved schedule require a non-empty reason and fork into an isolated revision (`${baseId}-REV${n}`) copying existing duties and updating the target slot.
- **Role-Aware Reassignment:** Supports reassigning either the **Invigilator** or the **Frisking Teacher** individually (`roleTarget: 'INVIGILATOR' | 'FRISKING'`). The domain validator enforces dual-role distinctness on mutation.
- **Optimistic Concurrency Control:** Every mutation validates `expectedCounter` against the current schedule `counter`. Concurrent or stale updates are rejected with HTTP 409 Conflict.

---

## 9. Reports & Master Export Templates

### Master Daily Allotment Excel
Exposed via `GET /api/reports/daily/excel`:
- Columns: `Session`, `Room ID`, `Room Name`, `Building / Block`, `Floor`, `Invigilator ID`, `Invigilator Name`, `Invigilator Dept`, `Frisking Teacher ID`, `Frisking Teacher Name`, `Frisking Dept`, `Duty Status`.

### Reference Excel Template Preservation (`excel file.xlsx`)
Exposed via `GET /api/reports/:scheduleId/export/excel`:
- Uses the authoritative 45,287-byte reference workbook `excel file.xlsx`.
- Strictly preserves template headers, cell styles, borders, column widths, row heights, and embedded institutional logos.

### Print-Ready Room Invigilation Sheets (PDF)
Exposed via `GET /api/reports/:scheduleId/room-sheets/pdf`:
- Generates vector A4 invigilation sheets for each room and session.
- Displays both the **Invigilator** and the **Frisking Staff** with their faculty IDs and departments.
- Features dedicated handwriting sections with dual signature blocks:
  - `Invigilator Sign`
  - `Frisking Teacher Sign`
  - `Control Room Verification` (Examination Officer Signature)

---

## 10. Clean Installation & First-Run Setup

The system strictly distinguishes clean schema initialization from manual demo seeding.

### Prerequisites
- **Node.js:** Version 20+ LTS (Tested and verified on Node.js 24)
- **Package Manager:** npm 10+
- **Operating System:** Windows, macOS, or Linux

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/chanduu190307/Faculty-Allotment-Portal.git
   cd "Faculty Allotement Portal"
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Install dependencies:**
   ```bash
   cd server && npm install
   cd ../client && npm install
   cd ..
   ```

4. **Clean Schema Initialization (Recommended for Production):**
   ```bash
   npm --prefix server run db:init
   ```
   *Creates the relational SQLite schema and applies migrations. Initializes essential institutional settings (`default_room_count: 20`, `default_faculty_count: 50`, `default_max_duties: 6`, `sessions_per_day: 2`) with **0 sample faculty, 0 sample rooms, and 0 sample schedules** (clean slate).*

5. **Optional Manual Demo Seeding (For Testing/Evaluation Only):**
   ```bash
   npm --prefix server run db:seed
   ```
   *Populates sample faculty, rooms, examinations, and dummy leave records for development evaluation. Normal server startup never triggers this automatically.*

---

## 11. Running the Application

### Concurrent Development Mode
Launch both the backend server and frontend client with a single command:
```bash
npm run dev
# or: npm start
```

### Separate Process Mode
```bash
# Terminal 1: Backend Server (Port 5000)
npm run dev:server

# Terminal 2: Frontend Client (Port 5173)
npm run dev:client
```

Open your browser to: **http://localhost:5173/**

---

## 12. Verification & Automated Test Commands

All commands below exist, run natively, and pass with zero errors:

```bash
# 1. Run Complete Regression Suite (16 Vitest Test Files, 143 Tests + Zero-Blue Audit)
npm test

# 2. Run Vitest Test Suite Only (16 Test Files, 143 Tests)
npm --prefix server run test

# 3. Run Strict Zero-Blue Palette & 3-Font Typography Audit
npm run audit:zero-blue

# 4. Verify Server TypeScript Compilation (Zero Type Errors)
npm run build:server

# 5. Verify Client TypeScript Compilation & Production Build
npm run build:client

# 6. Verify End-to-End Report & Template Exports
npx tsx server/tests/verify-exports.ts
```

### Verified Test Suite Breakdown (143/143 Tests Green)
| Test File | Tests | Focus Area |
|---|---|---|
| `tests/api/ttt-real-timetable.test.ts` | 2 | Real multi-semester timetable PDF (`ttt.pdf`) parsing across all 3 pages |
| `tests/api/timetable-pdf-parser.test.ts` | 9 | Spatial timetable extraction, multiline titles, online test slots |
| `tests/api/timetable-import-lifecycle.test.ts` | 6 | Timetable preview, confirmation, transactional commit & retrieval |
| `tests/api/faculty-pdf-import.test.ts` | 12 | Faculty roster PDF extraction and multi-format validation |
| `tests/api/room-management-bulk.test.ts` | 5 | Block A/B/C, floor filtering, 25 rooms/floor bulk generation & diagnostics |
| `tests/api/dual-role-scheduling.test.ts` | 6 | Dual-role allocation, capacity formula, distinctness & H7 validation |
| `tests/api/data-cleanup-service.test.ts` | 4 | Safe demo cleanup preview, foreign key protection & guarded reset |
| `tests/api/configuration-counts.test.ts` | 5 | Institutional target counts and settings persistence |
| `tests/api/concurrency-rollback.test.ts` | 3 | Optimistic locking, CAS counter, atomic transaction rollback |
| `tests/api/api-lifecycle.test.ts` | 3 | Full HTTP lifecycle for exams, rooms, faculty & schedules |
| `tests/api/phase4-import-export-audit.test.ts` | 18 | Excel template fidelity, PDF room sheets & audit trail |
| `tests/scheduling/engine.test.ts` | 19 | Dual-role scheduling engine, Hard Rules H1–H7, benchmark scale tests |
| `tests/scheduling/phase2-scheduling-remediation.test.ts` | 18 | Rest day calculation, room rotation, leave exclusions |
| `tests/scheduling/phase3-version-lifecycle.test.ts` | 10 | Immutability, revision lineage (`REVn`), concurrency protection |
| `tests/scheduling/timetable-scheduling-integration.test.ts` | 8 | End-to-end integration: timetable import to dual-role schedule generation |
| `tests/db/phase1-database-remediation.test.ts` | 15 | Relational constraints, WAL mode, foreign keys, partial unique indexes |

---

## 13. Acceptance & Verification Reports

Detailed documentation of all repairs and acceptance verification is available in the root directory:
- [DATA_CLEANUP_AND_FACULTY_CRUD_REPORT.md](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/DATA_CLEANUP_AND_FACULTY_CRUD_REPORT.md) — Safe demo data cleanup, provenance classification, and faculty CRUD repairs.
- [MULTI_SEMESTER_TIMETABLE_VISIBILITY_REPORT.md](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/MULTI_SEMESTER_TIMETABLE_VISIBILITY_REPORT.md) — Multi-semester timetable PDF extraction, visible semester tabs (I, III, V), and persistent storage.
- [BLOCK_FLOOR_ROOM_MANAGEMENT_REPORT.md](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/BLOCK_FLOOR_ROOM_MANAGEMENT_REPORT.md) — Block A/B/C and floor hierarchy, 25 rooms/floor default standard, bulk generation, and room diagnostics.
- [DUAL_ROLE_SCHEDULING_AND_CAPACITY_REPORT.md](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/DUAL_ROLE_SCHEDULING_AND_CAPACITY_REPORT.md) — Two distinct teachers per room (Invigilator + Frisking Teacher), capacity demand calculation, and reports.
- [FINAL_END_TO_END_ACCEPTANCE_REPORT.md](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/FINAL_END_TO_END_ACCEPTANCE_REPORT.md) — End-to-end acceptance matrix across all operational domains.

---

## 14. Security & Deployment Notes

- **Zero Hardcoded Secrets:** No API keys, passwords, or secrets exist in the codebase.
- **Audit Token Redaction:** The audit logging service recursively redacts sensitive fields (`password`, `token`, `secret`, `api_key`) to `***REDACTED***`.
- **Role-Based Authorization:** Administrative mutations (imports, approvals, publishing, reassignments) enforce `requireRole(['ADMIN', 'EXAM_OFFICER'])`.
- **SQL Injection Prevention:** 100% of queries use prepared statements with parameterized inputs.
- **Database Backups:** SQLite in WAL mode allows hot online backups:
  ```bash
  sqlite3 server/faculty_allotment.db ".backup 'backup_$(date +%Y%m%d).db'"
  ```

---

## 15. Known Limitations

- **Single-Host SQLite Engine:** SQLite provides single-writer concurrency. For distributed multi-node horizontal scaling, a client-server database adapter would be required.
- **Deterministic Tie-Breaking:** Seeded pseudo-randomness guarantees reproducibility for identical inputs; altering faculty or room counts alters the tie-break sequence.
- **Excel Desktop Rendering Verification:** Exact pixel rendering verified using Microsoft Excel 16.0 COM on Windows. Third-party spreadsheet viewers (e.g. mobile viewers) may render fonts based on client-installed typefaces.

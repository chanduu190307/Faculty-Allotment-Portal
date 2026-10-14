# Faculty Allotment System

A comprehensive, production-grade examination invigilation management platform that automates faculty duty scheduling across examination sessions, strictly enforces hard institutional constraints, safeguards data with immutable approved versions, prevents stale concurrent updates, and produces pixel-faithful report exports including the authoritative 6-column reference Excel workbook (`excel file.xlsx`) and print-ready room invigilation sheets.

---

## 1. Problem & Solution Overview

### The Problem
Educational institutions face significant administrative challenges during major examination terms:
- Coordinating hundreds of faculty members across dozens of rooms and multi-day exam sessions.
- Enforcing complex, non-negotiable scheduling rules: one duty per faculty per day, minimum rest intervals between duties, room rotation across duties, department-specific restrictions, duty caps, and approved faculty leaves.
- Accidental overwriting or in-place corruption of published duty rosters.
- Concurrent modifications resulting in stale overwrites or inconsistent duty assignments.
- Template divergence when exporting rosters to external spreadsheets, breaking downstream physical signature collection.

### The Solution
The **Faculty Allotment System** provides:
- **Deterministic Scheduling Engine:** Enforces Hard Rules H1–H7 with 32-bit MurmurHash3 deterministic seeded tie-breaking and pre-flight capacity evaluation.
- **Strict Version Lifecycle & Immutability:** New schedules initialize in `DRAFT`, undergo automated and authoritative validation, transition to `APPROVED` or `PUBLISHED`, and remain completely immutable. Any approved reassignment creates an isolated, lineage-tracked revision (`${baseId}-REV${n}`) with a mandatory reason.
- **Optimistic Concurrency Control:** Every schedule version tracks a monotonic transaction `counter` for atomic compare-and-swap operations, returning HTTP 409 conflict diagnostics on stale edits.
- **Exact Reference Template Preservation:** Exports post-allotment rosters into the authoritative 6-column reference workbook (`excel file.xlsx`), strictly preserving original headers, column widths, row heights, cell styles, fonts, embedded logos, and print settings.
- **Print-Ready Room Sheets:** Generates room-by-room invigilation sheets with session timings, handwriting placeholders (`Time In`, `Signature`), and print media layouts.
- **Safe CSV & XLSX Import Pipeline:** In-memory preflight validation, duplicate detection, DB conflict diagnostics, transactional batch commits with automatic rollback, and approved-schedule protection.
- **Permissioned Audit Logging:** Tamper-proof event logs with recursive masking of sensitive tokens, passwords, and API keys.

---

## 2. Technology Stack

### Backend
- **Runtime:** Node.js 24 LTS with TypeScript in strict mode
- **Server Framework:** Express 5 with modular REST routers and centralized error handling
- **Database Engine:** SQLite via `better-sqlite3` with Write-Ahead Logging (`WAL`), synchronous `NORMAL`, foreign keys enabled (`PRAGMA foreign_keys = ON`), and atomic transactions (`db.transaction()`)
- **Document & Spreadsheet Engines:** `exceljs` for template fidelity preservation; `pdfkit` for vector A4 PDF generation
- **CSV Parsing:** `csv-parse` and `csv-stringify`
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
├── .coderabbit.yaml             # CodeRabbit automated review configuration
├── .env.example                 # Sanitized environment configuration template
├── .gitignore                   # Excludes node_modules, build outputs, local DBs
├── excel file.xlsx              # Authoritative reference Excel template (45,287 bytes)
├── package.json                 # Root script orchestrator
├── README.md                    # Project documentation
├── STAGE1_COMPLIANCE_AUDIT.md   # Initial compliance audit baseline
├── PHASE1_REMEDIATION_REPORT.md # Database integrity & constraints remediation
├── PHASE2_SCHEDULING_REMEDIATION_REPORT.md # Scheduling engine & rules H1-H7
├── PHASE3_VERSIONING_REMEDIATION_REPORT.md # Version lifecycle & revision immutability
├── PHASE4_REMEDIATION_REPORT.md # Excel template, imports, room sheets & audit
│
├── client/                      # React 19 + Vite Frontend
│   ├── src/
│   │   ├── api/client.ts        # Typed API client with counter passing
│   │   ├── components/Navigation.tsx # Botanical navigation bar
│   │   ├── pages/
│   │   │   ├── AllotmentEngine.tsx       # Scheduling, preflight, revisions
│   │   │   ├── ExaminationManagement.tsx # Exam setup, dates, rest days
│   │   │   ├── FacultyManagement.tsx     # Faculty CRUD & CSV/XLSX import
│   │   │   ├── RoomManagement.tsx        # Room CRUD & CSV/XLSX import
│   │   │   ├── Reports.tsx               # Excel exports & Room sheets
│   │   │   └── AuditLog.tsx              # Filtered audit log viewer
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
└── server/                      # Express + SQLite Backend
    ├── src/
    │   ├── assets/templates/excel file.xlsx # Server template mirror
    │   ├── db/
    │   │   ├── connection.ts    # SQLite singleton with WAL & FK enforcement
    │   │   ├── schema.ts        # Relational schema & idempotent migrations
    │   │   └── seed.ts          # Default seed data generator
    │   ├── domain/scheduling/
    │   │   ├── capacity.ts      # Pre-flight capacity & sequence spacing
    │   │   ├── engine.ts        # Pure solver with MurmurHash3 tie-breaker
    │   │   ├── types.ts         # Domain types & interfaces
    │   │   └── validator.ts     # Authoritative H1-H7 validation engine
    │   ├── middleware/
    │   │   ├── auth.ts          # Authentication & role-based access control
    │   │   └── error.ts         # Centralized error handler
    │   ├── routes/api.routes.ts # REST API endpoints
    │   ├── services/
    │   │   ├── audit.service.ts      # Audit logging & recursive redaction
    │   │   ├── exam.service.ts       # Examination lifecycle service
    │   │   ├── export.service.ts     # Exact Excel template & PDF generator
    │   │   ├── faculty.service.ts    # Faculty management service
    │   │   ├── import.service.ts     # Preflight CSV/XLSX import pipeline
    │   │   ├── operations.service.ts # Attendance & substitution service
    │   │   ├── report.service.ts     # Daily/final reports & room sheets
    │   │   ├── room.service.ts       # Room management service
    │   │   ├── schedule.service.ts   # Schedule lifecycle, CAS & revisions
    │   │   └── settings.service.ts   # Institutional settings service
    │   ├── app.ts               # Express application factory
    │   └── server.ts            # Application entrypoint
    ├── tests/                   # Vitest Automated Test Suites
    │   ├── api/                 # API lifecycle, concurrency, imports & exports
    │   ├── db/                  # SQLite migrations & schema integrity
    │   ├── scheduling/          # Engine constraints H1-H7 & lifecycle
    │   ├── audit-zero-blue.ts   # Design token & typography validator
    │   └── verify-exports.ts    # End-to-end report export validator
    ├── package.json
    └── tsconfig.json
```

---

## 4. Scheduling Engine & Hard Constraints (Rules H1 – H7)

The core scheduler (`server/src/domain/scheduling/engine.ts`) enforces all mandatory constraints:

| Hard Rule | Constraint Specification | Implementation & Verification |
|---|---|---|
| **H1 (Rule A)** | Complete Room Coverage | Every active examination room receives required staffing (default: 1 invigilator per room per session). |
| **H2 (Rule B)** | Max 1 Duty per Day | Enforced at SQLite level via partial unique index `idx_assignments_unique_daily_teacher ON assignments(schedule_id, date, faculty_id) WHERE status != 'CANCELLED'`. |
| **H3 (Rule C)** | Sequence-Based Rest Days | Uses ordered examination sequence indices rather than calendar days: $|\text{index}(d_1) - \text{index}(d_2)| \le \text{rest\_days}$. Supports configurable `rest_days` (default: 1). |
| **H4 (Rule D)** | Independent Room Rotation | Tracks chronologically ordered duties per faculty member; rejects assigning a teacher to the same room as their previous duty, independent of intervening unassigned dates. |
| **H5 (Rule F)** | Maximum Duty Limits | Respects per-examination maximum duty limits (default: 6) and individual faculty overrides (`max_duty_override`). |
| **H6 (Eligibility)**| Comprehensive Eligibility | Excludes inactive faculty, approved leaves matching session scope, exempt faculty (`exempt = true`), and faculty from departments matching room-restricted examination departments (`exam_department`). |
| **H7 (Rule Unique)**| Exactly One Invigilator | Enforced by SQLite composite unique index `UNIQUE(schedule_id, date, session, room_id)`. |

### Seeded Deterministic Tie-Breaking
Ties among eligible candidates are resolved using a 32-bit MurmurHash3 algorithm combining faculty ID and a reproducible integer seed. Generation with the same seed produces slot-for-slot identical schedules.

### Pre-Flight Capacity Analysis & Actionable Remedies
Before creating any database records, the system analyzes feasibility across 4 tiers:
1. Daily active staffing requirements vs. available eligible faculty.
2. Adjacent examination-date pair capacity under Rule H3 spacing.
3. Total aggregate duty caps vs. required slots.
4. Departmental exclusion headroom.

If infeasible, schedule creation halts immediately, 0 records are written, and 3 actionable remedies are returned:
- **Option 1:** Add at least $K$ eligible faculty members.
- **Option 2:** Designate an examination date as a non-exam rest day.
- **Option 3:** Adjust duty caps or grant approved duty waivers.

---

## 5. Schedule Lifecycle, Revisions & Immutability

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
                                          │ Publish                    │ Reassign Duty
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
- **Optimistic Concurrency Control:** Every mutation validates `expectedCounter` against the current schedule `counter`. Concurrent or stale updates are rejected with HTTP 409 Conflict.

---

## 6. Prerequisites & Installation

### Prerequisites
- **Node.js:** Version 20+ LTS (Tested and verified on Node.js 24)
- **Package Manager:** npm 10+
- **Operating System:** Windows, macOS, or Linux

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
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

4. **Initialize database schema & default seed:**
   ```bash
   npm --prefix server run db:init
   ```

---

## 7. Running the Application

### Development Mode

Run the backend server and frontend client in separate terminals:

```bash
# Terminal 1: Backend Server (Port 5000)
npm run dev:server

# Terminal 2: Frontend Client (Port 5173)
npm run dev:client
```

Open your browser to: **http://localhost:5173/**

---

## 8. Verification & Test Commands

All commands below exist, run natively, and pass with zero errors:

```bash
# 1. Run Complete Automated Test Suite (All 85 Vitest Tests + Zero-Blue Audit)
npm test

# 2. Run Vitest Tests Only
npm --prefix server run test

# 3. Run Strict Zero-Blue Palette & Typography Audit
npm run audit:zero-blue

# 4. Verify Server TypeScript Compilation
npm run build:server

# 5. Verify Client TypeScript Compilation & Production Build
npm run build:client

# 6. Verify Post-Allotment Report & Template Exports
npx tsx server/tests/verify-exports.ts
```

---

## 9. User Workflows

### A. Faculty & Room Imports
1. Navigate to **Faculty Management** (`/faculty`) or **Room Management** (`/rooms`).
2. Click **Import CSV/XLSX**.
3. Upload a file. The system parses the file in memory and presents an interactive preview table showing valid rows, errors, and warnings with row numbers.
4. If existing records are detected, enable the **Overwrite Existing Records** toggle.
5. Protection Guarantee: The system blocks deactivating or exempting faculty or deactivating rooms that have scheduled duties in active approved schedules.
6. Click **Confirm & Commit**. All rows are committed inside an atomic SQLite transaction.

### B. Scheduling Preflight & Generation
1. Navigate to **Allotment Engine** (`/allotment`).
2. Select an examination.
3. Review **Pre-Flight Capacity Analysis**. If capacity is insufficient, review the 3 actionable policy remedies.
4. Enter an optional **Random Seed** for deterministic reproduction.
5. Click **Generate Allotment**. The draft schedule is created and validated.
6. Inspect faculty duty counts, session allocations, and accounting categories.
7. Click **Approve Draft**. The schedule is promoted to `APPROVED` and locked against in-place edits.

### C. Reassignments & Lineage Revisions
1. To change an assignment in an approved schedule, click **Reassign**.
2. Select an eligible substitute faculty member.
3. Provide a mandatory **Revision Reason**.
4. Submit. The system creates a revision schedule (`${baseId}-REV1`) while preserving the approved base intact.

### D. Exporting Authoritative Excel & Room Sheets
1. Navigate to **Reports & Exports** (`/reports`).
2. On an approved schedule, click **Export Allotment Excel (Template)**.
3. The system generates a workbook derived from `excel file.xlsx` preserving exact 6 columns, headings, merges, row heights, and embedded logos.
4. Switch to **Print-Ready Room Sheets** tab to preview individual invigilation room sheets with handwritten signature boxes, or click **Download All Room Sheets PDF** for vector A4 printing.

---

## 10. Security & Deployment Notes

- **Zero Hardcoded Secrets:** No API keys, passwords, or secrets exist in the codebase.
- **Audit Token Redaction:** The audit logging service recursively redacts sensitive fields (`password`, `token`, `secret`, `api_key`) to `***REDACTED***`.
- **Role-Based Authorization:** Administrative mutations (imports, approvals, publishing, reassignments) enforce `requireRole(['ADMIN', 'EXAM_OFFICER'])`.
- **SQL Injection Prevention:** 100% of queries use prepared statements with parameterized inputs.
- **Database Backups:** SQLite in WAL mode allows hot online backups:
  ```bash
  sqlite3 faculty_allotment.db ".backup 'backup_$(date +%Y%m%d).db'"
  ```

---

## 11. Known Limitations

- **Single-Host SQLite Engine:** SQLite provides single-writer concurrency. For distributed multi-node horizontal scaling, a client-server database adapter would be required.
- **Deterministic Tie-Breaking:** Seeded pseudo-randomness guarantees reproducibility for identical inputs; altering faculty or room counts alters the tie-break sequence.
- **Excel Desktop Rendering Verification:** Exact pixel rendering verified using Microsoft Excel 16.0 COM on Windows. Third-party spreadsheet viewers (e.g. mobile viewers) may render fonts based on client-installed typefaces.

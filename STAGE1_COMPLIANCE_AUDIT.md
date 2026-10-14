# Stage 1 Compliance Audit: Faculty Allotment System

**Audit Date:** 13 October 2026  
**Auditor:** Antigravity Agentic Compliance Inspector (DeepMind Advanced Coding)  
**Target Specification:** `Faculty-Allotment-Stage1-Spec.pdf` (Version 0.1, Dated 13 October 2026)  
**System Under Test:** Faculty Allotment System (Full-Stack Monorepo)  
**Application Root:** `c:\CodeAlpha\Faculty Allotement Portal`  
**Execution Context:** Non-destructive Static Code Inspection & In-Memory Test Traversal

---

## 1. Executive Summary

A comprehensive compliance audit was conducted on the **Faculty Allotment System** repository against the requirements outlined in `Faculty-Allotment-Stage1-Spec.pdf`. The application represents an operational web application featuring a refined editorial design system, strict zero-blue styling, responsive scheduling controls, immutable daily reporting snapshots, and in-memory test coverage.

However, a strict clause-by-clause audit against the formal specification reveals significant compliance gaps, architectural deviations, and unfulfilled acceptance criteria.

### Compliance Scorecard Overview

| Category | Total Requirements | PASS | PARTIAL | FAIL / NOT VERIFIED | Compliance Rate |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Hard Rules (H1–H7)** | 7 rules (21 enforcement tiers) | 6 tiers | 5 tiers | 10 tiers | **28.6% Full / 52.4% Partial** |
| **Acceptance Tests (Sec. 7)** | 12 tests + 1 benchmark | 3 tests | 4 tests | 6 tests | **23.1% Full / 53.8% Partial** |
| **Allocation Specifications (Sec. 3)** | 5 core mechanics | 0 | 2 | 3 | **0.0% Full / 40.0% Partial** |
| **Versions & Approval (Sec. 4)** | 4 mechanics | 2 | 1 | 1 | **50.0% Full / 75.0% Partial** |
| **Screen Specifications (Sec. 5)** | 5 screens | 0 | 4 | 1 | **0.0% Full / 80.0% Partial** |
| **Printed Room Sheets (Sec. 6)** | 1 printable format | 0 | 0 | 1 | **0.0% Full** |
| **Architecture Stack (Sec. 8)** | 5 stack layers | 1 | 0 | 4 | **20.0% (Deviation Noted)** |
| **Branding & Safety Constraints** | 4 safety constraints | 4 | 0 | 0 | **100.0% PASS** |

### Key Findings Summary

1. **Architecture & Solver Deviation:**
   The specification prescribes **Python, FastAPI, SQLite, and Google OR-Tools CP-SAT**. The codebase is implemented in **Node.js, Express 5, TypeScript, better-sqlite3, and React 19**, with a custom heuristic greedy algorithm instead of a CP-SAT solver. Furthermore, the minimax objective (minimizing highest duty count), slack-penalized re-solving for infeasible schedules, and stored seeded tie-breaking shuffle are not implemented in the solver.
2. **Missing Database-Level Enforcement:**
   Hard rules H1–H7 must be enforced in three places: scheduling engine, server API/services, and database. While domain validators exist, the SQLite database schema ([`schema.ts`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/db/schema.ts)) completely lacks the unique partial index `(schedule_id, date, faculty_id) WHERE status != 'CANCELLED'`, allowing direct database mutations to double-book teachers on the same date.
3. **Flawed Consecutive Exam Date Logic (Rule H3 & H4):**
   The specification states: *"'Consecutive' means next in the exam-date list, not calendar arithmetic. Default is 1; setting 0 turns the rule off."* The codebase implements calendar-day arithmetic (`diffMs / 86400000 === 1`), meaning non-consecutive calendar days (e.g., Mon/Wed) are mistakenly treated as non-consecutive even if they are adjacent in the examination schedule. Moreover, the configurable `rest_days` setting does not exist in the database, API, or UI.
4. **Missing H6 Eligibility Elements (Exempt Flag & Own-Department Room Tag):**
   Neither the `faculty` schema nor the UI possesses an `exempt` flag. Neither the `rooms` schema nor the UI possesses an `exam_department` (exam-department tag). Consequently, the own-department exclusion rule is completely absent from the scheduling engine and validator.
5. **Absence of CSV/Excel Teacher & Room Import:**
   Acceptance Test 12 requires CSV/Excel import with preview and row-level error reporting (rejecting duplicate IDs and missing departments while accepting valid rows). No import endpoint, file parsing service, or frontend UI exists for this feature.
6. **Printed Room Sheet Discrepancy:**
   Section 6 requires printed room sheets per exam day and session with specific columns: exam name, date, time, room, teacher ID, teacher name, department, time-in column, and signature column. The application currently produces aggregate multi-session daily reports without dedicated time-in or signature columns.
7. **Frontend Audit Log Missing:**
   Screen 5 ("Audit log") is exposed via backend API, but is entirely missing as a dedicated page or view in the React UI navigation.

---

## 2. Technology Stack & Architectural Discrepancy Analysis

Section 8 of `Faculty-Allotment-Stage1-Spec.pdf` specifies:
> **Stack:** Python, FastAPI, SQLite, OR-Tools, and plain HTML/CSS with the approved fonts.

### Comparison Matrix

| Layer | Specification (Section 8) | Actual Implementation | Status | Impact / Deviation Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Language** | Python 3 | Node.js (v20+) / TypeScript | **DEVIATION** | TypeScript backend (`server/src/server.ts`). Requires explicit user sign-off to retain TS vs migrate to Python. |
| **Backend Framework** | FastAPI | Express 5.3.0 | **DEVIATION** | Well-structured REST API, but diverges from Python/FastAPI. |
| **Database** | SQLite | SQLite via `better-sqlite3` 13.0.3 | **PASS (COMPATIBLE)** | Relational SQLite file with WAL mode. Fully compatible in storage engine. |
| **Optimization Solver** | Google OR-Tools CP-SAT | Custom Greedy Heuristic (`SchedulingEngine`) | **FAIL / DEVIATION** | Greedy heuristic sorts by duty count, but cannot perform constraint propagation, global minimax optimization, or penalized slack relaxation. |
| **Frontend Architecture** | Plain HTML/CSS with approved fonts | React 19, Vite 8, Vanilla CSS Design System | **DEVIATION** | Provides rich client-side state management; adheres strictly to the approved fonts and zero-blue palette. |

> [!IMPORTANT]
> **Safety Constraint Enforcement:**  
> Per safety constraints, the agent is prohibited from migrating frameworks or replacing the solver without explicit user approval. This audit documents the deviation without initiating destructive architectural rewrites.

---

## 3. Hard Rules Compliance Matrix (H1 – H7)

The specification dictates:
> *"These rules are never violated. Each one is enforced in three places: the scheduling engine, the server (for every manual edit and substitute), and the database."*

```
                              THREE-TIER ENFORCEMENT AUDIT
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. SCHEDULING ENGINE   │ Generates initial valid allotment                  │
├────────────────────────┼────────────────────────────────────────────────────┤
│ 2. SERVER (API/SERVICE)│ Revalidates manual edits and substitutions         │
├────────────────────────┼────────────────────────────────────────────────────┤
│ 3. DATABASE CONSTRAINTS│ Prevents direct DB insertion of violating records  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Rule H1: Room Coverage

- **Requirement:** Every active room gets exactly the configured number of teachers in each session (default 1).
- **Intended Behavior:** When generating or modifying an allotment, no active room may be left unassigned in any session. Default staffing is 1 per room.
- **Implementation:**
  - *Engine:* [`SchedulingEngine.generateSchedule`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L122-L147)
  - *Server:* [`validateSchedule`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/validator.ts#L41-L89)
  - *Database:* [`assignments` table](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/db/schema.ts#L124-L138)
- **Existing Tests:**
  - [`engine.test.ts: L54-90`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/tests/scheduling/engine.test.ts#L54-L90) (`Scenario 1: Every required room receives its required staffing (Rule A)`).
- **Verdict:** **PARTIAL**
- **Evidence:**
  - *Engine:* **PASS**. The loop iterates over `activeRooms` and checks `room.requiredStaffing ?? 1`. Fails with `Unstaffed room` if any slot is unfilled.
  - *Server:* **PASS**. `validateSchedule` verifies that `count === required` for all `(date, session, roomId)`.
  - *Database:* **PARTIAL**. SQLite enforces `UNIQUE (schedule_id, date, session, room_id)`, preventing multiple entries per room, but does not enforce minimum coverage at the database schema level (cannot enforce completeness on insert without triggers).
- **Recommended Correction:** Add an SQLite trigger or deferred consistency check on schedule state transition to ensure that slot count matches `activeRooms.length * sessions.length`.
- **Required Regression Tests:** Test asserting database rejects publishing/approving a schedule if total assignment rows are fewer than expected room slots.

---

### Rule H2: One Session per Teacher per Day

- **Requirement:** A teacher has at most one duty on any exam day, across all rooms and both sessions. The database enforces this with a unique index on `(version, exam day, teacher)` for non-cancelled rows.
- **Intended Behavior:** No teacher can be assigned to Morning and Afternoon sessions on the same exam date, nor to multiple rooms in the same session. Must be enforced at the engine, server, and database levels.
- **Implementation:**
  - *Engine:* [`SchedulingEngine.generateSchedule`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L199) tracks `todayAssigned.has(teacher.id)`.
  - *Server:* [`validator.ts: L152-L170`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/validator.ts#L152-L170) (`RULE_B` violation if faculty is already present in `dailyFacultySessions`).
  - *Database:* [`schema.ts: L124-L142`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/db/schema.ts#L124-L142).
- **Existing Tests:**
  - [`engine.test.ts: L95-127`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/tests/scheduling/engine.test.ts#L95-L127) (`Scenario 2: No teacher appears in both daily sessions (Rule B)`).
- **Verdict:** **PARTIAL**
- **Evidence:**
  - *Engine:* **PASS**. Teachers assigned in Morning are added to `todayAssigned` and filtered out of Afternoon candidates.
  - *Server:* **PASS**. `validateSchedule` and `validateManualReassignment` strictly block reassignments to a second session on the same date.
  - *Database:* **FAIL**. Line 137 of `schema.ts` defines `UNIQUE (schedule_id, date, session, room_id)`. There is **NO unique index** on `(schedule_id, date, faculty_id)` for non-cancelled rows. A raw SQL query `INSERT INTO assignments` can insert two duties for the same teacher on the same date without triggering a database constraint violation.
- **Recommended Correction:** Add partial unique index to `schema.ts`:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_unique_daily_teacher 
  ON assignments(schedule_id, date, faculty_id) 
  WHERE status != 'CANCELLED';
  ```
- **Required Regression Tests:** Unit test attempting raw SQLite `INSERT` of two active duties on the same `date` and `schedule_id` for the same teacher, asserting that SQLite throws `SQLITE_CONSTRAINT_UNIQUE`.

---

### Rule H3: Rest Days

- **Requirement:** No teacher on two consecutive exam dates. "Consecutive" means next in the exam-date list, not calendar arithmetic. Default is 1; setting 0 turns the rule off.
- **Intended Behavior:** If exam dates are Mon, Wed, Fri, then Mon and Wed are consecutive exam dates. A teacher assigned on Mon cannot be assigned on Wed when `rest_days = 1`. If `rest_days = 0`, consecutive assignments are permitted.
- **Implementation:**
  - *Engine:* [`SchedulingEngine.selectBestCandidate`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L316-L317)
  - *Capacity:* [`areDatesConsecutive`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/capacity.ts#L6-L12)
  - *Validator:* [`validator.ts: L208-L210`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/validator.ts#L208-L210)
- **Existing Tests:**
  - [`engine.test.ts: L132-175`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/tests/scheduling/engine.test.ts#L132-L175) (`Scenario 3: No teacher is assigned on consecutive examination dates (Rule C)`).
- **Verdict:** **FAIL**
- **Evidence:**
  - *Engine & Capacity:* **FAIL**. Lines 6–12 of `capacity.ts` compute:
    ```ts
    const diffMs = Math.abs(d2.getTime() - d1.getTime());
    return Math.round(diffMs / (24 * 60 * 60 * 1000)) === 1;
    ```
    This uses **calendar arithmetic**. When exam dates are alternating (e.g., Oct 15, Oct 17), `areDatesConsecutive` returns `false`. The engine allows teachers to work on consecutive exam days in violation of H3.
  - *Configurability:* **FAIL**. `rest_days` parameter is not present in `examinations` table, `SchedulingInput`, or UI setup. Setting `rest_days = 0` cannot be performed.
  - *Database:* **FAIL**. No database trigger or constraint enforces exam-sequence spacing.
- **Recommended Correction:**
  1. Add `rest_days INTEGER NOT NULL DEFAULT 1` to `examinations` table.
  2. Map consecutive exam dates by position in the ordered `examDates` array (`Math.abs(indexA - indexB) === 1`), not calendar millisecond differences.
  3. When `rest_days === 0`, bypass the rule.
- **Required Regression Tests:** Acceptance Test 3 (alternating dates with `rest_days = 1` rejected; with `rest_days = 0` allowed).

---

### Rule H4: Room Rotation

- **Requirement:** No teacher in the same room they had on the immediately preceding exam day.
- **Intended Behavior:** A teacher who invigilated Room 101 on Exam Day $N$ cannot invigilate Room 101 on Exam Day $N+1$ (the next exam day they are assigned).
- **Implementation:**
  - *Engine:* [`engine.ts: L330-L341`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L330-L341)
  - *Validator:* [`validator.ts: L218-L229`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/validator.ts#L218-L229)
- **Existing Tests:**
  - [`engine.test.ts: L180-208`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/tests/scheduling/engine.test.ts#L180-L208) (`Scenario 4: Room-history restrictions are enforced by validator (Rule D)`).
- **Verdict:** **PARTIAL**
- **Evidence:**
  - *Engine & Validator:* **PARTIAL**. In `engine.ts` (L333) and `validator.ts` (L209), the room check is nested inside `if (areDatesConsecutive(current.date, next.date))`. If H3 is active (`rest_days = 1`), a teacher is never assigned on back-to-back calendar days. When the teacher returns on Day 3, the condition `areDatesConsecutive` evaluates to false, so the check `current.roomId === next.roomId` is **bypassed**!
  - *Database:* **FAIL**. No database trigger enforces room alternation.
- **Recommended Correction:** Track the teacher's *immediately preceding scheduled exam date* regardless of gap days, and verify that `current.roomId !== priorAssignment.roomId`.
- **Required Regression Tests:** Assign a teacher to Room 101 on Day 1, give them Day 2 off, and verify that assigning them to Room 101 on Day 3 triggers a Rule H4 violation.

---

### Rule H5: Duty Cap

- **Requirement:** Default 6 per exam period. Planned and completed duties count toward the cap; cancelled duties do not.
- **Intended Behavior:** Faculty members cannot exceed their assigned duty limit (default 6, or `max_duty_override`). `SCHEDULED`, `COMPLETED`, `ABSENT`, and `SUBSTITUTED` statuses consume capacity; `CANCELLED` status does not.
- **Implementation:**
  - *Engine:* [`engine.ts: L307-L310`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L307-L310)
  - *Validator:* [`validator.ts: L100, L147-L150, L182-L193`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/validator.ts#L100)
  - *Service:* [`FacultyService.getDutyHistory: L271-L273`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/services/faculty.service.ts#L271-L273)
- **Existing Tests:**
  - [`engine.test.ts: L213-240`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/tests/scheduling/engine.test.ts#L213-L240) (`Scenario 5: Maximum duty limits are strictly enforced`).
  - [`engine.test.ts: L480-504`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/tests/scheduling/engine.test.ts#L480-L504) (`Scenario 13: Cancelled duties do not count toward duty cap`).
- **Verdict:** **PARTIAL**
- **Evidence:**
  - *Engine & Server:* **PASS**. Cancelled assignments are ignored; active and completed duties accurately increment duty counts and trigger `RULE_F` violations when exceeding the cap.
  - *Database:* **FAIL**. No database-level trigger enforces that row count for a teacher does not exceed `max_duty_override` or examination limit.
- **Recommended Correction:** Maintain server/validator enforcement; optionally add a trigger on `assignments` insert/update checking faculty duty count.
- **Required Regression Tests:** Existing tests verify engine and validator; add API and DB boundary assertions.

---

### Rule H6: Eligibility

- **Requirement:** The teacher is active, not on leave that day, not exempt, and not from the department of the room's exam.
- **Intended Behavior:** A teacher is eligible only if:
  1. `active === 1`
  2. Not on approved leave for that day/session
  3. `exempt === 0` (exempt flag)
  4. Teacher's department does not match the room's exam department (`room.exam_department`)
- **Implementation:**
  - *Active & Leave:* [`validator.ts: L115-L145`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/validator.ts#L115-L145), [`engine.ts: L320-L328`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L320-L328)
  - *Exempt:* Not implemented.
  - *Own Department:* Not implemented.
- **Existing Tests:**
  - [`engine.test.ts: L245-279`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/tests/scheduling/engine.test.ts#L245-L279) (`Scenario 6: Unavailable faculty on approved leave are excluded`).
- **Verdict:** **FAIL**
- **Evidence:**
  - *Active:* **PASS**. Inactive teachers are excluded by engine and validator.
  - *Leave:* **PASS**. Approved leaves (full-day or session-scoped) exclude faculty.
  - *Exempt Flag:* **FAIL**. The `faculty` schema has no `exempt` column; `types.ts` has no `exempt` boolean; UI has no toggle; engine does not check exemption.
  - *Own-Department Rule:* **FAIL**. The `rooms` schema has no `exam_department` or `department` column. The engine assigns faculty regardless of department overlap with the room.
  - *Database:* **FAIL**. No foreign key or check constraint prevents inactive, on-leave, exempt, or own-department assignments.
- **Recommended Correction:**
  1. Alter `faculty` table to add `exempt INTEGER NOT NULL DEFAULT 0`.
  2. Alter `rooms` table to add `exam_department TEXT DEFAULT NULL`.
  3. Update `SchedulingEngine` candidate selector to reject candidates where `teacher.exempt === true` or `teacher.department === room.examDepartment`.
  4. Update `validateSchedule` to raise `ELIGIBILITY` violation for exempt or own-department conflicts.
- **Required Regression Tests:** Acceptance Test 6 (Inactive, on-leave, exempt, and own-department teachers are never assigned).

---

### Rule H7: Unique Slots

- **Requirement:** One active teacher per room, per session, per staff slot.
- **Intended Behavior:** No two active teachers can be placed into the same room staff slot at the same time.
- **Implementation:**
  - *Engine:* Generates unique assignment per room staff index.
  - *Validator:* [`validator.ts: L80-L88`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/validator.ts#L80-L88) flags `DUPLICATE` violation if `count > required`.
  - *Database:* [`schema.ts: L137`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/db/schema.ts#L137): `UNIQUE (schedule_id, date, session, room_id)`.
- **Existing Tests:**
  - [`engine.test.ts: L284-305`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/tests/scheduling/engine.test.ts#L284-L305) (`Scenario 7: Duplicate assignments in the same room and session are rejected`).
- **Verdict:** **PASS** (for standard single-staff rooms)
- **Evidence:**
  - Database schema contains an explicit unique index on `(schedule_id, date, session, room_id)`.
  - Validator flags duplicate assignments with rule `DUPLICATE`.
  - Scheduling engine allocates distinct candidate slots per room.
- **Recommended Correction:** For multi-staff rooms (staffing > 1), introduce a `slot_index` column into `assignments` with `UNIQUE (schedule_id, date, session, room_id, slot_index)`.

---

## 4. Stage 1 Acceptance Tests Verification Matrix (Section 7)

| Test ID | Intended Behavior | Implementation Source | Existing Test Location | Verdict | Evidence & Deficiencies |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Test 1** | Every active room has configured teachers in every session. | `SchedulingEngine.generateSchedule`, `validateSchedule` | `engine.test.ts: L54` (Scenario 1) | **PASS** | Validated across 10 rooms, 2 sessions, 2 days = 40 slots. Coverage confirmed at 100%. |
| **Test 2** | No teacher appears twice on the same exam day (morning + afternoon, or 2 rooms in 1 session). | `engine.ts: L313`, `validator.ts: L152` | `engine.test.ts: L95` (Scenario 2) | **PARTIAL** | Engine and validator verify daily uniqueness. Missing database-level partial unique index. |
| **Test 3** | With rest days set to 1, consecutive exam dates never share a teacher. | `capacity.ts: L6`, `engine.ts: L317` | `engine.test.ts: L132` (Scenario 3) | **FAIL** | Implemented via calendar arithmetic (`diffMs === 86400000`). Alternating dates fail H3. `rest_days = 0` toggle missing. |
| **Test 4** | No teacher repeats the same room on the next exam day. | `engine.ts: L330`, `validator.ts: L218` | `engine.test.ts: L180` (Scenario 4) | **PARTIAL** | Only checks calendar consecutive days. When rest days are active, rotation check is skipped on return day. |
| **Test 5** | No teacher exceeds the cap, and cancelled duties do not count. | `engine.ts: L307`, `validator.ts: L100, L182` | `engine.test.ts: L213, L480` (Scenarios 5 & 13) | **PASS** | Strict cap enforced; cancelled assignments excluded from duty calculations. |
| **Test 6** | Inactive, on-leave, exempt, and own-department teachers are never assigned. | `engine.ts`, `validator.ts` | `engine.test.ts: L245` (Scenario 6) | **FAIL** | Only inactive and leave are checked. Exempt flag and own-department room tag are not implemented. |
| **Test 7** | Pre-flight with 150 teachers and back-to-back Mon + Tue reports shortfall of 10 and creates no schedule. | `capacity.ts: checkCapacityFeasibility` | *None* (Benchmark exists for 200 rooms / 500 fac) | **NOT VERIFIED** | The exact scenario (40 rooms × 2 sessions × 2 days = 160 slots vs 150 capacity = 10 deficit) lacks a dedicated test. |
| **Test 8** | Manual edit giving teacher second duty on same day rejected in UI, API, and DB (3 separate tests). | `AllotmentEngine.tsx`, `api.routes.ts`, `schema.ts` | *None* | **FAIL** | No UI test; no API HTTP test; DB lacks unique constraint on `(schedule_id, date, faculty_id)` and allows raw SQL insert. |
| **Test 9** | Substitute who already has the other session that day is rejected. | `OperationsService.approveSubstitution` | `engine.test.ts: L440` (Scenario 12 tests medical leave only) | **NOT VERIFIED** | Logic exists in `validateManualReassignment`, but no test asserts rejection of a same-day other-session substitute. |
| **Test 10** | Same inputs and seed produce identical output (run twice and compare). | `SchedulingEngine.generateSchedule` | `engine.test.ts: L593` (Scenario 20) | **FAIL** | Runs twice deterministically, but **WITHOUT A SEED**. Ties are broken by teacher ID, violating the seeded shuffle requirement. |
| **Test 11** | Regeneration never changes an approved version. | `ScheduleService.generate`, `api-lifecycle.test.ts` | `api-lifecycle.test.ts: L25` (Scenario 15) | **PARTIAL** | Generation increments version and preserves approved DB records. However, manual reassignments directly mutate approved assignments in place. |
| **Test 12** | Import with duplicate ID and missing department rejects only those rows. | *Not implemented* | *None* | **FAIL** | CSV/Excel import for teachers or rooms is completely unimplemented. |
| **Scale Benchmark** | Real-size performance test (optionally 200 rooms × 500 teachers). | `engine.test.ts: L629, L675` | `engine.test.ts: L629` (Infeasibility), `L675` (50 rooms / 300 fac) | **PARTIAL** | Infeasibility detected in 0.31ms; 50 rooms / 300 fac solved in 316ms. Feasible 200 rooms × 500 teachers has not been benchmarked. |

---

## 5. Specification Section Compliance Breakdown

### Section 1: Scope & Admin Workflow
- **Spec:** Single college, one admin user, scheduling, approval, and printed room sheets. Absences and substitutes are handled in Stage 2.
- **Current State:** Single college model with settings; role-based auth (`ADMIN`, `EXAM_OFFICER`); scheduling and approval workflows implemented. Daily operations (substitutions and attendance) were partially implemented ahead of Stage 2.
- **Verdict:** **PASS** (with Stage 2 operations already present).

### Section 3: Allocation Engine Requirements

#### 3.1 Pre-Flight Check
- **Spec Requirements:**
  1. Compare duties needed with eligible teachers for each exam day.
  2. Check back-to-back pairs ($2 \times \text{daily need}$).
  3. Check total capacity ($\text{duties needed} \le \text{eligible teachers} \times \text{cap}$).
  4. List any shortfall with actionable options: *add teachers*, *make a day a non-exam day*, or *record an approved exception*.
- **Code Inspection ([`capacity.ts: L44-L120`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/capacity.ts#L44-L120)):**
  - Aggregates total slots across the entire period and calculates `totalPossibleCapacity`.
  - Does **not** perform independent day-by-day capacity breakdown.
  - Does **not** perform individual back-to-back pair checks.
  - Shortfall diagnostics provide mathematical explanations, but do **not** format the required three explicit options (*add teachers*, *make day non-exam*, *record exception*).
- **Verdict:** **PARTIAL**

#### 3.2 Optimization Solver
- **Spec Requirements:** Google OR-Tools CP-SAT (free, open source) with H1–H7 as hard constraints. Objective: minimize the highest duty count, then spread remaining duties evenly.
- **Code Inspection ([`engine.ts: L108-L267`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L108-L267)):**
  - Custom greedy heuristic loop in TypeScript.
  - Selects candidate with lowest current duty count on a slot-by-slot basis.
  - Does not implement minimax objective via integer programming / CP-SAT.
- **Verdict:** **FAIL / ARCHITECTURAL DEVIATION**

#### 3.3 Determinism, Stored Seed, and Tie-Breaking
- **Spec Requirements:**
  1. Stored seed with each version.
  2. Same inputs + seed produce identical output.
  3. Ties broken by a seeded shuffle (not by teacher ID, so T001–T080 do not receive every first-day duty).
- **Code Inspection ([`engine.ts: L362-L370`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L362-L370), [`schema.ts: L106-L119`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/db/schema.ts#L106-L119)):**
  - No `seed` column in `schedules` table.
  - `SchedulingInput` has no `seed` parameter.
  - Tie-breaking sort explicitly executes:
    ```ts
    return a.tieBreaker.localeCompare(b.tieBreaker); // where tieBreaker = teacher.id
    ```
    This directly causes T001–T080 to receive the first duties, violating the specification.
- **Verdict:** **FAIL**

#### 3.4 Infeasible Schedules & Slack Relaxation
- **Spec Requirements:** Re-solves with H3 and H4 as penalized slack. Reports which rule would need relaxing and by how many teachers. Never relaxes silently; logs exception.
- **Code Inspection ([`engine.ts: L142-L182`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L142-L182)):**
  - If a slot cannot be staffed, the engine halts immediately and returns `Constraint exhaustion`.
  - Does not perform slack re-solving for H3/H4; cannot calculate how many teachers would resolve the bottleneck.
- **Verdict:** **FAIL**

#### 3.5 Remaining Faculty Taxonomy
- **Spec Requirements:** Every active teacher gets a status for every exam day:
  `Assigned`, `Available but unassigned`, `On leave`, `Exempt`, `Cap reached`, `Excluded (department or rest rule)`, or `Standby`.
- **Code Inspection ([`types.ts: L55-L63`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/types.ts#L55-L63), [`engine.ts: L378-L450`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/domain/scheduling/engine.ts#L378-L450)):**
  - Uses internal enum values: `ASSIGNED`, `EXCLUDED_DAILY_SESSION`, `UNAVAILABLE_LEAVE`, `MAX_CAPACITY_REACHED`, `EXCLUDED_CONSECUTIVE_DAY`, `EXCLUDED_ROOM_HISTORY`, `RESERVED_SUBSTITUTE`, `AVAILABLE_UNASSIGNED`.
  - `Exempt` status is completely missing.
  - Department exclusion status is missing.
  - Accounting is tracked per session, but not rolled up into a consolidated daily status per active teacher.
- **Verdict:** **PARTIAL**

---

### Section 4: Versions, Approval, and Immutability

- **Lifecycle State Machine:**
  - Spec: Generation creates Draft $\rightarrow$ Validation runs automatically $\rightarrow$ Moves to Approved only upon admin approval.
  - Code: [`ScheduleService.generate`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/services/schedule.service.ts#L76) inserts schedule with state `'VALIDATED'` instead of `'DRAFT'`. Admin approval moves it to `'APPROVED'`. (**PARTIAL**)
- **Version Immutability & Revisions:**
  - Spec: Approved version is never overwritten. Regeneration creates a new version. Edits to an approved version create a revision with a required reason.
  - Code: Regeneration creates a new version (`nextVersion = max_ver + 1`). However, [`ScheduleService.manualReassign`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/services/schedule.service.ts#L292-L294) directly runs `UPDATE assignments SET faculty_id = ?` in place, mutating approved schedule records without generating a revision row. (**PARTIAL / FAIL**)
- **Optimistic Concurrency (Version Counter):**
  - Spec: Each version has a counter. An edit made against an old counter is rejected.
  - Code: `schedules` table has a `version` integer, but no update counter (e.g. `lock_version` or revision counter) checked on mutation. Concurrent admin edits can overwrite each other. (**FAIL**)
- **Audit Logging:**
  - Spec: Audit log records who made each change, when, and why.
  - Code: [`AuditService.log`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/services/audit.service.ts#L15-L32) records entity, entityId, action, actor, oldValues, newValues, reason, and timestamp. (**PASS**)

---

### Section 5: Core Screens Compliance

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SCREEN COMPLIANCE STATUS                        │
├─────────────────────────┬──────────────────────────────┬───────────────┤
│ Screen                  │ Specification Requirement    │ Status        │
├─────────────────────────┼──────────────────────────────┼───────────────┤
│ 1. Exam Setup           │ Rest days & session times    │ PARTIAL (90%) │
│ 2. Teachers             │ CSV/Excel import with preview│ PARTIAL (60%) │
│                         │ & row errors; exempt flag    │               │
│ 3. Rooms                │ Exam-department tag          │ PARTIAL (75%) │
│ 4. Allotment            │ Print room sheets button     │ PARTIAL (80%) │
│ 5. Audit Log            │ Full UI screen               │ FAIL (0% UI)  │
└─────────────────────────┴──────────────────────────────┴───────────────┘
```

1. **Screen 1 (Exam Setup):**
   - Implemented in [`ExaminationManagement.tsx`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/client/src/pages/ExaminationManagement.tsx).
   - Missing: `rest_days` field; UI form controls for customizing session time windows and staff per room during exam creation.
2. **Screen 2 (Teachers):**
   - Implemented in [`FacultyManagement.tsx`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/client/src/pages/FacultyManagement.tsx).
   - Missing: CSV or Excel import with preview modal and row-level error reporting; `exempt` flag toggle.
3. **Screen 3 (Rooms):**
   - Implemented in [`RoomManagement.tsx`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/client/src/pages/RoomManagement.tsx).
   - Missing: `exam_department` (exam-department tag) field.
4. **Screen 4 (Allotment):**
   - Implemented in [`AllotmentEngine.tsx`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/client/src/pages/AllotmentEngine.tsx).
   - Missing: Direct "Print room sheets" action button on the allotment screen (users must navigate to Reports).
5. **Screen 5 (Audit Log):**
   - Backend API endpoint `GET /api/audit-logs` exists in [`api.routes.ts`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/routes/api.routes.ts#L37-L42).
   - Missing: Dedicated UI page/screen in React navigation.

---

### Section 6: Printed Room Sheets Compliance

- **Spec Requirement:**
  > *"One sheet per exam day and session, with: exam name, date, time, room, teacher ID, teacher name, department, a time-in column, and a signature column."*
- **Current Export Implementation ([`export.service.ts`](file:///c:/CodeAlpha/Faculty%20Allotement%20Portal/server/src/services/export.service.ts#L73-L127)):**
  - Generates a single continuous daily report containing all sessions.
  - Columns printed: `Session`, `Room ID`, `Venue/Building`, `Faculty ID`, `Faculty Name`, `Department`, `Status`.
  - **Missing Columns:**
    - Explicit session time window (`time`, e.g., "09:30 – 12:30")
    - Dedicated blank `time-in` column for physical arrival check-in
    - Dedicated blank `signature` column for teacher verification
  - Page breaks: Does not enforce "one sheet per exam day and session".
- **Verdict:** **FAIL**

---

## 6. Design System, Typography & Safety Constraints Audit

### Exact Product Name
- **Requirement:** Preserve the exact product name **Faculty Allotment System**.
- **Evidence:**
  - `package.json`: `"name": "faculty-allotment-system"`
  - `client/index.html`: `<title>Faculty Allotment System</title>`
  - `client/src/components/Navigation.tsx`: `<h1 className="sidebar-title">Faculty Allotment System</h1>`
  - `server/tests/verify-exports.ts`: Verified workbook creator `"Faculty Allotment System"`
- **Verdict:** **PASS**

### Strict Zero-Blue Botanical Palette
- **Requirement:** Preserve the strict no-blue palette.
- **Evidence:**
  - Run verification: `npm run audit:zero-blue` executed cleanly.
  - Audit output:
    ```
    [Audit PASSED] STRICT ZERO-BLUE AUDIT & EXACT TYPOGRAPHY VERIFIED!
    - Zero prohibited blue tokens found across all source and built assets.
    - 100% compliance with Restrained Botanical Palette.
    ```
  - Canonical tokens verified:
    - Canvas: `#F7F5EF`
    - Card Surface: `#FFFEFA`
    - Deep Forest Green: `#244C3A`
    - Muted Sage: `#879B83`
    - Main Charcoal Text: `#242923`
    - Subtle Border: `#E2E0D7`
- **Verdict:** **PASS**

### Exact Typography
- **Requirement:** Three approved fonts: Newsreader, Plus Jakarta Sans, and IBM Plex Mono.
- **Evidence:**
  - `client/index.html` loads Google Fonts for `Newsreader`, `Plus Jakarta Sans`, and `IBM Plex Mono`.
  - `client/src/styles/index.css` sets `--font-editorial`, `--font-ui`, and `--font-data` to these exact fonts.
- **Verdict:** **PASS**

---

## 7. Consolidated Risk Analysis & Potential Failure Modes

```
                              RISK MATRIX SEVERITY
  HIGH SEVERITY ─────────────────────────────────────────────────────────────┐
  │ [R1] In-place mutation of approved schedules overwriting historical state│
  │ [R2] Alternating exam days violating rest rule due to calendar arithmetic │
  │ [R3] Inability to import faculty/rooms via CSV/Excel                      │
  │ [R4] Database permits raw SQL double-booking on same date                 │
  ├──────────────────────────────────────────────────────────────────────────┤
  MEDIUM SEVERITY ───────────────────────────────────────────────────────────┤
  │ [R5] Missing OR-Tools solver limits minimax duty fairness                 │
  │ [R6] Teachers assigned to exam rooms in their own department              │
  │ [R7] Printed room sheets lack signature & check-in columns                │
  │ [R8] Lack of version counter allows conflicting admin edits               │
  └──────────────────────────────────────────────────────────────────────────┘
```

1. **Risk R1 (Data Integrity - Overwriting Approved Schedules):**
   Because `manualReassign` performs an in-place `UPDATE assignments`, historical approved schedules lose their original audit state, violating Section 4 ("An approved version is never overwritten... edits create a revision").
2. **Risk R2 (Scheduling Policy Violation - Calendar vs Sequence Days):**
   Using calendar day differences rather than sequence order means a college with exams on Monday, Wednesday, and Friday will assign the same teachers on Monday and Wednesday, believing they had a rest day, directly violating Acceptance Test 3.
3. **Risk R3 (Operational Failure - Departmental Conflicts):**
   Without `exam_department` on rooms and checks in the engine, professors will invigilate exams conducted by their own departments, violating Hard Rule H6.
4. **Risk R4 (Database Bypassing - Lack of Unique Index):**
   Third-party integrations, direct DB migrations, or administrative scripts could insert overlapping duties on the same day without SQLite constraint errors.

---

## 8. Prioritized Remediation Plan

To bring the Faculty Allotment System into complete compliance with `Faculty-Allotment-Stage1-Spec.pdf`, the following bounded Ralph Loop iterations are recommended:

### Iteration 1: Database Constraints & Schema Enhancements (Immediate)
- Add partial unique index on `assignments(schedule_id, date, faculty_id) WHERE status != 'CANCELLED'`.
- Add `exempt` column (`INTEGER DEFAULT 0`) to `faculty` table.
- Add `exam_department` column (`TEXT DEFAULT NULL`) to `rooms` table.
- Add `rest_days` column (`INTEGER DEFAULT 1`) to `examinations` table.
- Add `seed` column (`INTEGER DEFAULT NULL`) and `counter` (`INTEGER DEFAULT 1`) to `schedules` table.
- Implement migration script and update `schema.ts`.

### Iteration 2: Scheduling Engine & Rule Correction
- Correct H3 consecutive date logic in `capacity.ts`, `engine.ts`, and `validator.ts` to use exam sequence index rather than calendar arithmetic.
- Incorporate `rest_days === 0` toggle.
- Fix H4 room rotation to track immediately preceding exam date rather than adjacent calendar date.
- Enforce H6 eligibility checks: exclude `f.exempt === true` and exclude faculty where `f.department === room.examDepartment`.
- Implement seeded tie-breaking shuffle using stored version seed so T001–T080 do not receive all first-day duties.
- Upgrade pre-flight check to perform 3-way verification (individual days, back-to-back pairs, total capacity) and output the three explicit shortfall options.

### Iteration 3: Version Lifecycle, Revisions & Immutability
- Ensure initial schedule generation creates schedules in state `'DRAFT'`.
- Update `manualReassign` so that modifying an approved schedule creates a revision (e.g. V1.1) with a required reason, preserving the approved base version.
- Enforce optimistic concurrency: require clients to pass the current version counter, rejecting stale updates.

### Iteration 4: CSV / Excel Import Engine
- Implement `FacultyImportService` supporting CSV and Excel files.
- Provide a preview endpoint returning parsed rows, valid count, and row-level errors.
- Enforce Acceptance Test 12: reject duplicate IDs and missing departments while importing valid rows.
- Build frontend upload and preview modal in `FacultyManagement.tsx`.

### Iteration 5: Printed Room Sheets & UI Completion
- Implement dedicated session room sheet generator in `ExportService` formatted per Section 6:
  - Header: Exam name, date, session time window, room code & name.
  - Columns: Room, Teacher ID, Teacher Name, Department, Time-In, Signature.
  - Page break per session and room.
- Add "Print Room Sheets" button to `AllotmentEngine.tsx`.
- Create dedicated `AuditLog.tsx` page in client and register in `Navigation.tsx`.

### Iteration 6: Test Suite Expansion & Independent Verification
- Implement missing acceptance tests in `server/tests`:
  - Acceptance Test 7 (150 teachers, back-to-back Mon+Tue, 10 shortfall).
  - Acceptance Test 8 (three separate tests: UI rejection, API rejection, SQLite DB unique constraint rejection).
  - Acceptance Test 9 (same-day other-session substitute rejection).
  - Acceptance Test 10 (identical seed verification).
  - Acceptance Test 12 (row-level import error rejection).
- Execute full vitest test suite, typecheck (`tsc`), and zero-blue aesthetic audit.

---

## 9. Conclusion & Acknowledgment

The **Faculty Allotment System** has a strong foundation with an attractive, strictly compliant zero-blue botanical UI, responsive daily operations, and fast in-memory execution. However, critical gaps in database constraints, consecutive-day definition, faculty eligibility, seeded solver determinism, import handling, and printable room sheets prevent full Stage 1 certification at this time.

Remediation can be completed smoothly across bounded iterations without discarding existing code or disrupting the database.

*Report generated and signed for review.*  
**Status:** Audit Completed. Awaiting authorization to begin Phase 1 remediation.

# DUAL-ROLE SCHEDULING AND CAPACITY REPORT

**Project:** Faculty Allotment Portal  
**Domain:** Phase 5 — Dual-Role Invigilation (Invigilator + Frisking Teacher) & Capacity Demand  
**Execution Date:** 2026-10-16  
**Status:** PASSED & VERIFIED  

---

## 1. Executive Summary

This report documents the architectural implementation and mathematical validation of the **Dual-Role Invigilation Scheduling System**, the central operational requirement of this repair.

Every active examination room and session requires **two distinct teachers**:
1. **INVIGILATOR:** Responsible for active hall supervision and examination conduct.
2. **FRISKING TEACHER:** Responsible for designated candidate verification, physical checking, and entry security.

These represent separate, non-overlapping roles within the same room-session allocation.

---

## 2. Data Model & Schema Migration

To support dual-role allocation while preserving backward compatibility with historical assignments:
1. **Additive Schema Migration (`server/src/db/schema.ts`):**
   ```sql
   ALTER TABLE assignments ADD COLUMN frisking_faculty_id TEXT REFERENCES faculty(id) ON DELETE RESTRICT;
   ALTER TABLE assignments ADD COLUMN role TEXT DEFAULT 'INVIGILATOR';
   ```
   - Historical assignments remain completely valid with `frisking_faculty_id IS NULL` and `role = 'INVIGILATOR'`.
   - Dual-role assignments store `role = 'DUAL'`, `faculty_id = invigilator_id`, and `frisking_faculty_id = frisking_teacher_id`.
2. **Index Optimization:**
   - Added `idx_assignments_sched_frisking` on `assignments(schedule_id, frisking_faculty_id)`.
   - Added `idx_assignments_unique_daily_frisking` on `assignments(schedule_id, date, frisking_faculty_id)` to enforce Rule B across frisking duties.

---

## 3. Authoritative Staffing Demand & Capacity Calculation

### 3.1 Mathematical Staffing Demand
Staffing demand is computed authoritatively in `server/src/domain/scheduling/capacity.ts`:
$$\text{Required Duties} = \text{Active Rooms} \times \text{Confirmed Sessions} \times 2\text{ Roles}$$

- The system strictly uses actual active registered rooms and confirmed timetable shifts.
- It **never silently reduces** the required staffing from 2 roles to 1 role to force an invalid schedule to fit.

### 3.2 Infeasibility Detection & Shortfall Diagnostics
Preflight capacity evaluates eligible teachers after deducting:
- Inactive faculty
- Leave / unavailability on examination dates
- Exempt personnel (e.g. Principals, HODs, Exam Officers)
- Maximum duty limits (Rule F configurable cap)
- Consecutive-day rest requirements (Rule C)

If total faculty capacity $< \text{Required Duties}$, the solver **blocks generation immediately** and returns structured failure diagnostics explaining the shortfall with mathematical proof and administrative remedies.

---

## 4. Scheduling Engine Dual-Role Allocation

Implemented in `server/src/domain/scheduling/engine.ts`:
1. **Pass 1 — Invigilator Allocation:**
   - Selects the most eligible faculty member under H1–H7 constraints, optimizing for workload balance and room rotation.
2. **Pass 2 — Frisking Teacher Allocation:**
   - Filters candidate pool to ensure distinctness:
     $$\text{Frisking Candidate} \neq \text{Allocated Invigilator}$$
   - Enforces Rule B: The frisking teacher cannot have any other assignment (invigilation or frisking) in any shift on that day.
   - Enforces Rule C, Rule F, and department exclusion rules.
3. **Immutability & Atomic Persistence:**
   - Newly generated dual-role schedules begin in `DRAFT` state with automated validation.
   - Approved and published schedules remain strictly immutable.

---

## 5. Domain Validator & Manual Reassignment

### 5.1 Authoritative Validator (`validator.ts`)
- Enforces Hard Constraint **H7 (Dual-Role Distinctness)**:
  `if (asgn.facultyId && asgn.friskingFacultyId && asgn.facultyId === asgn.friskingFacultyId) -> VIOLATION (DUPLICATE)`.
- Validates both roles against maximum duty limits and rest days.

### 5.2 Role-Aware Manual Reassignment
- API: `POST /api/allotment/:scheduleId/reassign` with `roleTarget: 'INVIGILATOR' | 'FRISKING'`.
- Allows reassigning either teacher individually.
- Client and server block selecting the currently paired teacher, displaying:
  *"Dual-Role Distinctness Violation: The same faculty member cannot serve as both Invigilator and Frisking Teacher for the same room and session."*

---

## 6. Reports & Export Services

Updated all reporting pipelines in `report.service.ts` and `export.service.ts`:
- **Daily Report Snapshot:** Contains `faculty_name` (Invigilator) and `frisking_faculty_name` (Frisking Teacher) for every room.
- **Master Excel Export (`generateDailyReportExcel`):**
  - Added dedicated columns: `Invigilator ID`, `Invigilator Name`, `Frisking Faculty ID`, `Frisking Faculty Name`, `Frisking Dept`.
- **Daily Report PDF:** Prints both Invigilator and Frisking Teacher on each room row.
- **Room Seating Sheets (`generateRoomSheetsPDF`):**
  - Features dual signature blocks for both the Invigilator and the Frisking Teacher.

---

## 7. Verification Evidence & Automated Tests

Automated test suite execution via `vitest run tests/api/dual-role-scheduling.test.ts`:

```
✓ tests/api/dual-role-scheduling.test.ts (6 tests) 162ms
  ✓ Phase 5 — Dual-Role Invigilation & Capacity Verification (6)
    ✓ calculates staffing demand strictly as active_rooms * sessions * 2 roles when dual-role is required (17ms)
    ✓ detects mathematical infeasibility and blocks generation when faculty capacity is insufficient for 2 roles per room (8ms)
    ✓ generates an allotment where every active room/session receives two distinct faculty members (29ms)
    ✓ ScheduleValidator rejects assignments where the same faculty fills both Invigilator and Frisking roles (16ms)
    ✓ allows manual reassignment of either role while enforcing all H1-H7 constraints (16ms)
    ✓ exports daily reports and master Excel containing both Invigilator and Frisking Teacher columns (52ms)
```

Total regression suite: **16 test files passed (143/143 tests green, 100%)**.

---

## 8. Acceptance Criteria Passed

- [x] Every active room receives one invigilator and one distinct frisking teacher.
- [x] Staffing demand accurately calculated as $\text{rooms} \times \text{sessions} \times 2$.
- [x] Insufficient faculty capacity halts generation and displays mathematical proof.
- [x] Rule H1–H7 constraints enforced across both roles.
- [x] Manual reassignment supports targeting Invigilator or Frisking role with distinctness checks.
- [x] Reports, room sheets, and Excel exports feature both roles with dual signature lines.

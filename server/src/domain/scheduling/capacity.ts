import { ExamDate, ExamSession, Faculty, FacultyLeave, Room, PreflightCheckResult } from './types';

/**
 * Returns filtered and sorted examination dates (isExamDay === true),
 * ordered by sequenceOrder ascending and date string ascending.
 */
export function getOrderedExamDates(dates: ExamDate[]): ExamDate[] {
  return dates
    .filter((d) => d.isExamDay)
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder || a.date.localeCompare(b.date));
}

/**
 * Maps each examination date string (YYYY-MM-DD) to its 0-based sequence index.
 */
export function getExamDateIndexMap(orderedExamDates: ExamDate[]): Map<string, number> {
  const map = new Map<string, number>();
  orderedExamDates.forEach((d, idx) => map.set(d.date, idx));
  return map;
}

/**
 * Legacy calendar arithmetic check: checks whether two dates are consecutive calendar days.
 * Maintained for backwards-compatibility.
 */
export function areDatesConsecutive(dateStr1: string, dateStr2: string): boolean {
  const d1 = new Date(dateStr1 + 'T00:00:00Z');
  const d2 = new Date(dateStr2 + 'T00:00:00Z');
  const diffMs = Math.abs(d2.getTime() - d1.getTime());
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round(diffMs / oneDayMs) === 1;
}

/**
 * Checks whether two examination dates are consecutive in the examination sequence,
 * respecting the configured rest_days parameter (Rule H3).
 *
 * Definition:
 * - With rest_days = 0: restriction is disabled (returns false).
 * - With rest_days = 1: adjacent examination dates (index diff === 1) are forbidden.
 * - With rest_days = k (k > 1): any two dates with index difference <= k are forbidden
 *   (requiring at least k intervening rest examination dates).
 */
export function areExamDatesConsecutive(
  dateStr1: string,
  dateStr2: string,
  dateIndexMap?: Map<string, number>,
  restDays: number = 1
): boolean {
  if (restDays <= 0) return false;
  if (!dateIndexMap) {
    // Fallback if no sequence map provided: use calendar day difference
    return areDatesConsecutive(dateStr1, dateStr2);
  }
  const idx1 = dateIndexMap.get(dateStr1);
  const idx2 = dateIndexMap.get(dateStr2);
  if (idx1 === undefined || idx2 === undefined) return false;
  if (idx1 === idx2) return false;
  return Math.abs(idx1 - idx2) <= restDays;
}

/**
 * Calculates the maximum independent set of non-consecutive working days
 * for an ordered list of examination dates under Rule H3 and rest_days.
 *
 * Mathematical proof:
 * For N ordered examination dates where duties must be separated by at least
 * `restDays` non-duty examination dates, the maximum number of working days is:
 * - When restDays <= 0: N
 * - When restDays >= 1: Math.ceil(N / (restDays + 1))
 */
export function calculateMaxWorkingDays(
  orderedExamDates: Array<string | ExamDate>,
  restDays: number = 1
): number {
  const n = orderedExamDates.length;
  if (n === 0) return 0;
  if (restDays <= 0) return n;
  return Math.ceil(n / (restDays + 1));
}

/**
 * Runs a comprehensive pre-flight capacity and feasibility check (Section 3 of Stage 1 spec):
 * 1. Calculate required staffing for each examination date.
 * 2. Check each day's eligible faculty supply.
 * 3. Check adjacent examination-date pairs against the no-consecutive-date rule (Rule H3).
 * 4. Check aggregate duty capacity against faculty duty caps.
 * 5. Account for inactive, leave, exempt, and own-department exclusions (Rule H6).
 * 6. Explain the source of any shortage and identify affected dates and required staffing.
 * 7. Offer the 3 documented remedies: add eligible faculty, designate a date as a non-exam day,
 *    or record an explicitly approved exception.
 */
export function checkCapacityFeasibility(
  dates: ExamDate[],
  sessions: ExamSession[],
  rooms: Room[],
  faculty: Faculty[],
  leaves: FacultyLeave[],
  defaultMaxDuties: number,
  restDays: number = 1
): PreflightCheckResult {
  const examDates = getOrderedExamDates(dates);
  const dateIndexMap = getExamDateIndexMap(examDates);
  const activeRooms = rooms.filter((r) => r.active !== false);

  // Eligible faculty pool: active === true and exempt !== true (Rule H6)
  const activeFaculty = faculty.filter((f) => f.active && !f.exempt);

  // 1. Calculate required staffing for each examination date & aggregate
  let totalRequiredSlots = 0;
  const dailyRequired = new Map<string, number>();
  for (const dateObj of examDates) {
    let daySlots = 0;
    for (const _session of sessions) {
      for (const room of activeRooms) {
        daySlots += room.requiredStaffing ?? 1;
      }
    }
    dailyRequired.set(dateObj.date, daySlots);
    totalRequiredSlots += daySlots;
  }

  // 2. Check daily eligible faculty supply for each examination date (Rule H2: max 1 duty per day)
  const dailyShortfalls: Array<{
    date: string;
    required: number;
    available: number;
    shortfall: number;
  }> = [];

  for (const dateObj of examDates) {
    const currentDate = dateObj.date;
    const req = dailyRequired.get(currentDate) || 0;

    // Faculty eligible on this date: active, not exempt, and not on full-day leave
    const eligibleToday = activeFaculty.filter((f) => {
      // Check full-day approved leave
      const onFullDayLeave = leaves.some(
        (l) =>
          l.facultyId === f.id &&
          l.date === currentDate &&
          l.approvalStatus !== 'REJECTED' &&
          l.sessionScope === 'FULL_DAY'
      );
      if (onFullDayLeave) return false;

      // Check own-department exclusion: if all active rooms belong to this teacher's department
      const allRoomsMatchTeacherDept =
        activeRooms.length > 0 &&
        activeRooms.every(
          (r) =>
            r.examDepartment &&
            f.department &&
            r.examDepartment.trim().toLowerCase() === f.department.trim().toLowerCase()
        );
      if (allRoomsMatchTeacherDept) return false;

      return true;
    });

    if (eligibleToday.length < req) {
      dailyShortfalls.push({
        date: currentDate,
        required: req,
        available: eligibleToday.length,
        shortfall: req - eligibleToday.length,
      });
    }
  }

  // 3. Check adjacent examination-date pairs against no-consecutive-date rule (Rule H3)
  const pairShortfalls: Array<{
    date1: string;
    date2: string;
    required: number;
    available: number;
    shortfall: number;
  }> = [];

  if (restDays >= 1 && examDates.length >= 2) {
    for (let i = 0; i < examDates.length - 1; i++) {
      const d1 = examDates[i].date;
      const d2 = examDates[i + 1].date;
      const req1 = dailyRequired.get(d1) || 0;
      const req2 = dailyRequired.get(d2) || 0;
      const pairRequired = req1 + req2;

      // Since teachers cannot work on both d1 and d2 (Rule H3), and each teacher can work at most once per day (Rule H2),
      // we need at least pairRequired distinct teachers available across {d1, d2}.
      const availableForPair = activeFaculty.filter((f) => {
        // Teacher must be available on at least one of the two dates
        const leaveD1 = leaves.some(
          (l) =>
            l.facultyId === f.id &&
            l.date === d1 &&
            l.approvalStatus !== 'REJECTED' &&
            l.sessionScope === 'FULL_DAY'
        );
        const leaveD2 = leaves.some(
          (l) =>
            l.facultyId === f.id &&
            l.date === d2 &&
            l.approvalStatus !== 'REJECTED' &&
            l.sessionScope === 'FULL_DAY'
        );
        return !(leaveD1 && leaveD2);
      });

      if (availableForPair.length < pairRequired) {
        pairShortfalls.push({
          date1: d1,
          date2: d2,
          required: pairRequired,
          available: availableForPair.length,
          shortfall: pairRequired - availableForPair.length,
        });
      }
    }
  }

  // 4. Check aggregate duty capacity against faculty duty caps
  const maxWorkingDays = calculateMaxWorkingDays(examDates, restDays);

  let totalPossibleCapacity = 0;
  for (const teacher of activeFaculty) {
    const dutyCap = teacher.maxDutyOverride ?? defaultMaxDuties;
    // Under Rule B, max 1 session per day. Under Rule C, max working days.
    const effectiveCap = Math.min(dutyCap, maxWorkingDays);
    totalPossibleCapacity += effectiveCap;
  }

  const aggregateDeficit = Math.max(0, totalRequiredSlots - totalPossibleCapacity);
  const maxPairDeficit = pairShortfalls.reduce((max, p) => Math.max(max, p.shortfall), 0);
  const maxDailyDeficit = dailyShortfalls.reduce((max, d) => Math.max(max, d.shortfall), 0);

  const deficit = Math.max(aggregateDeficit, maxPairDeficit, maxDailyDeficit);
  const isFeasible = deficit === 0;

  const reasons: string[] = [];
  const remedies: string[] = [];

  if (!isFeasible) {
    reasons.push(
      `Mathematical Infeasibility Proven: Total required slots (${totalRequiredSlots}) exceed available capacity (${totalPossibleCapacity}). Expected shortfall is ${deficit}.`
    );

    if (restDays >= 1) {
      reasons.push(
        `Across ${examDates.length} examination dates, the no-consecutive-date rule (Rule H3, rest_days = ${restDays}) restricts each teacher to at most ${maxWorkingDays} working day(s).`
      );
    }

    reasons.push(
      `Combined with the daily limit of 1 session per day (Rule H2), ${activeFaculty.length} eligible teachers provide at most ${totalPossibleCapacity} total assignments.`
    );

    if (pairShortfalls.length > 0) {
      for (const p of pairShortfalls) {
        reasons.push(
          `Consecutive examination date pair ${p.date1} and ${p.date2} requires ${p.required} distinct teacher duties, but only ${p.available} eligible teachers are available (shortfall of ${p.shortfall}).`
        );
      }
    }

    if (dailyShortfalls.length > 0) {
      for (const d of dailyShortfalls) {
        reasons.push(
          `Examination date ${d.date} requires ${d.required} duties, but only ${d.available} eligible teachers are available (shortfall of ${d.shortfall}).`
        );
      }
    }

    // Three documented remedies per Stage 1 Spec Section 3.1
    remedies.push(
      `Option 1 (Add Eligible Faculty): Register at least ${deficit} additional active, non-exempt faculty members to resolve the shortfall.`
    );
    remedies.push(
      `Option 2 (Designate Non-Exam Day): Designate one examination date as a non-exam day (e.g. study break) to reduce required staffing.`
    );
    remedies.push(
      `Option 3 (Approved Exception): Record an explicitly approved administrative exception: set rest_days to 0 (relaxing the consecutive date rule) or increase duty cap overrides.`
    );
  }

  return {
    isFeasible,
    totalRequiredSlots,
    totalPossibleCapacity,
    deficit,
    consecutiveExamDaysCount: examDates.length,
    maxWorkingDaysPerTeacher: maxWorkingDays,
    reasons,
    remedies,
    dailyShortfalls: dailyShortfalls.length > 0 ? dailyShortfalls : undefined,
    pairShortfalls: pairShortfalls.length > 0 ? pairShortfalls : undefined,
    diagnosticDetails: {
      roomCount: activeRooms.length,
      facultyCount: activeFaculty.length,
      examDatesCount: examDates.length,
      sessionsPerDay: sessions.length,
      defaultMaxDuties,
      effectiveMaxDutiesPerTeacher: Math.min(defaultMaxDuties, maxWorkingDays),
      theoreticalMaxCapacity: totalPossibleCapacity,
    },
  };
}

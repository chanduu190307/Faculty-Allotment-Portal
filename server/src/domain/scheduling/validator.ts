import {
  Assignment,
  ExamDate,
  ExamSession,
  Faculty,
  FacultyLeave,
  Room,
  ScheduleValidationResult,
  ValidationViolation,
} from './types';
import { getOrderedExamDates, getExamDateIndexMap, areExamDatesConsecutive } from './capacity';

export interface ValidationContext {
  dates: ExamDate[];
  sessions: ExamSession[];
  rooms: Room[];
  faculty: Faculty[];
  leaves?: FacultyLeave[];
  defaultMaxDuties: number;
  restDays?: number;
}

/**
 * Shared authoritative domain validator for complete schedules and manual mutations.
 * Enforces Hard Constraints H1–H7:
 * - H1 (Rule A): Complete room coverage
 * - H2 (Rule B): At most 1 duty per faculty per examination date across all sessions
 * - H3 (Rule C): Respect configured examination-sequence rest days (rest_days)
 * - H4 (Rule D): Room rotation (no faculty in the same room on consecutive scheduled duties)
 * - H5 (Rule F): Maximum duty limits strictly enforced
 * - H6 (Eligibility): Active only, no approved leave, not exempt, and no own-department room invigilation
 * - H7 (Rule Unique): Exactly 1 active faculty member per room staff slot
 */
export function validateSchedule(
  assignments: Assignment[],
  context: ValidationContext
): ScheduleValidationResult {
  const violations: ValidationViolation[] = [];
  const { dates, sessions, rooms, faculty, leaves = [], defaultMaxDuties, restDays = 1 } = context;

  const facultyMap = new Map(faculty.map((f) => [f.id, f]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));

  const examDates = getOrderedExamDates(dates);
  const dateIndexMap = getExamDateIndexMap(examDates);
  const activeRooms = rooms.filter((r) => r.active !== false);

  // 1. Calculate Required Slots & Check H1 / H7 (Room Coverage & Unique Slots)
  let totalRequiredSlots = 0;
  const coverageMap = new Map<string, number>(); // key: `${date}|${session}|${roomId}` -> count

  for (const dateObj of examDates) {
    for (const session of sessions) {
      for (const room of activeRooms) {
        const required = room.requiredStaffing ?? 1;
        totalRequiredSlots += required;
        const key = `${dateObj.date}|${session.name}|${room.id}`;
        coverageMap.set(key, 0);
      }
    }
  }

  // Count active scheduled assignments
  let totalAssignedSlots = 0;
  for (const asgn of assignments) {
    if (asgn.status === 'CANCELLED') continue;
    const key = `${asgn.date}|${asgn.session}|${asgn.roomId}`;
    if (coverageMap.has(key)) {
      coverageMap.set(key, (coverageMap.get(key) || 0) + 1);
      totalAssignedSlots++;
    }
  }

  // Verify coverage (H1 and H7)
  for (const [key, count] of coverageMap.entries()) {
    const [date, session, roomId] = key.split('|');
    const room = roomMap.get(roomId);
    const required = room?.requiredStaffing ?? 1;
    if (count < required) {
      violations.push({
        rule: 'RULE_A',
        message: `Room ${roomId} (${room?.name || 'Unknown'}) is understaffed on ${date} session ${session}. Required: ${required}, Assigned: ${count}`,
        date,
        session,
        roomId,
      });
    } else if (count > required) {
      violations.push({
        rule: 'DUPLICATE',
        message: `Room ${roomId} has over-allocated staff on ${date} session ${session}. Required: ${required}, Assigned: ${count}`,
        date,
        session,
        roomId,
      });
    }
  }

  // 2. Track Faculty Duty Counts, Daily Sessions, and Room History
  const dutyCounts = new Map<string, number>();
  // date -> facultyId -> session
  const dailyFacultySessions = new Map<string, Map<string, string>>();
  // facultyId -> array of { date, roomId, session } ordered chronologically
  const facultyHistory = new Map<string, Array<{ date: string; roomId: string; session: string }>>();

  // Check Eligibility (H6), Daily Uniqueness (H2), and Duty Cap (H5)
  for (const asgn of assignments) {
    if (asgn.status === 'CANCELLED') continue;

    const teacher = facultyMap.get(asgn.facultyId);
    const room = roomMap.get(asgn.roomId);

    // H6: Unknown faculty check
    if (!teacher) {
      violations.push({
        rule: 'ELIGIBILITY',
        message: `Unknown faculty ID ${asgn.facultyId} assigned to Room ${asgn.roomId} on ${asgn.date}`,
        date: asgn.date,
        session: asgn.session,
        roomId: asgn.roomId,
        facultyId: asgn.facultyId,
      });
      continue;
    }

    // H6: Inactive faculty check
    if (!teacher.active) {
      violations.push({
        rule: 'ELIGIBILITY',
        message: `Inactive faculty ${teacher.name} (${teacher.id}) assigned to Room ${asgn.roomId} on ${asgn.date}`,
        date: asgn.date,
        session: asgn.session,
        roomId: asgn.roomId,
        facultyId: teacher.id,
      });
    }

    // H6: Exempt faculty check
    if (teacher.exempt) {
      violations.push({
        rule: 'ELIGIBILITY',
        message: `Exempt faculty ${teacher.name} (${teacher.id}) assigned to Room ${asgn.roomId} on ${asgn.date}. Faculty is marked exempt from duty allocation.`,
        date: asgn.date,
        session: asgn.session,
        roomId: asgn.roomId,
        facultyId: teacher.id,
      });
    }

    // H6: Own-department room check (if room has configured exam_department)
    if (
      room?.examDepartment &&
      room.examDepartment.trim().length > 0 &&
      teacher.department &&
      room.examDepartment.trim().toLowerCase() === teacher.department.trim().toLowerCase()
    ) {
      violations.push({
        rule: 'ELIGIBILITY',
        message: `Faculty ${teacher.name} (${teacher.id}) from department "${teacher.department}" assigned to Room ${asgn.roomId} with matching examination department "${room.examDepartment}".`,
        date: asgn.date,
        session: asgn.session,
        roomId: asgn.roomId,
        facultyId: teacher.id,
      });
    }

    // H6: Approved leave check
    const leaveConflict = leaves.find((l) => {
      if (l.facultyId !== asgn.facultyId || l.date !== asgn.date) return false;
      if (l.approvalStatus === 'REJECTED') return false;
      if (l.sessionScope === 'FULL_DAY') return true;
      if (l.sessionScope === 'MORNING' && asgn.session.toLowerCase().includes('morn')) return true;
      if (l.sessionScope === 'AFTERNOON' && asgn.session.toLowerCase().includes('after')) return true;
      return false;
    });

    if (leaveConflict) {
      violations.push({
        rule: 'ELIGIBILITY',
        message: `Faculty ${teacher.name} (${teacher.id}) is on approved leave (${leaveConflict.reason}) on ${asgn.date} (${leaveConflict.sessionScope})`,
        date: asgn.date,
        session: asgn.session,
        roomId: asgn.roomId,
        facultyId: teacher.id,
      });
    }

    // Track Duty Count (H5: Rule F)
    const currentDuties = (dutyCounts.get(asgn.facultyId) || 0) + 1;
    dutyCounts.set(asgn.facultyId, currentDuties);

    // H2: Rule B — At most 1 duty per faculty per day across all sessions
    if (!dailyFacultySessions.has(asgn.date)) {
      dailyFacultySessions.set(asgn.date, new Map());
    }
    const dayMap = dailyFacultySessions.get(asgn.date)!;
    if (dayMap.has(asgn.facultyId)) {
      const priorSession = dayMap.get(asgn.facultyId)!;
      violations.push({
        rule: 'RULE_B',
        message: `Faculty ${teacher.name} (${teacher.id}) is assigned to multiple sessions on ${asgn.date} (${priorSession} and ${asgn.session})`,
        date: asgn.date,
        session: asgn.session,
        roomId: asgn.roomId,
        facultyId: teacher.id,
      });
    } else {
      dayMap.set(asgn.facultyId, asgn.session);
    }

    // Collect history for H3 and H4
    if (!facultyHistory.has(asgn.facultyId)) {
      facultyHistory.set(asgn.facultyId, []);
    }
    facultyHistory.get(asgn.facultyId)!.push({
      date: asgn.date,
      roomId: asgn.roomId,
      session: asgn.session,
    });
  }

  // 3. Verify H5: Rule F (Max Duty Limits)
  for (const [facId, count] of dutyCounts.entries()) {
    const teacher = facultyMap.get(facId);
    const maxLimit = teacher?.maxDutyOverride ?? defaultMaxDuties;
    if (count > maxLimit) {
      violations.push({
        rule: 'RULE_F',
        message: `Faculty ${teacher?.name || facId} (${facId}) exceeded maximum duty limit: ${count} assigned > ${maxLimit} max allowed`,
        facultyId: facId,
      });
    }
  }

  // 4. Verify H3 (Sequence Rest Days) and H4 (Room Rotation)
  for (const [facId, hist] of facultyHistory.entries()) {
    const teacher = facultyMap.get(facId);

    // Sort chronologically according to examination date sequence
    hist.sort((a, b) => {
      const idxA = dateIndexMap.get(a.date);
      const idxB = dateIndexMap.get(b.date);
      if (idxA !== undefined && idxB !== undefined) {
        return idxA - idxB;
      }
      return a.date.localeCompare(b.date);
    });

    for (let i = 0; i < hist.length - 1; i++) {
      const current = hist[i];
      const next = hist[i + 1];

      // If dates are identical, Rule B already handled it.
      if (current.date === next.date) continue;

      // H3: Sequence Rest Days (No consecutive examination-date duties)
      if (restDays > 0 && areExamDatesConsecutive(current.date, next.date, dateIndexMap, restDays)) {
        violations.push({
          rule: 'RULE_C',
          message: `Faculty ${teacher?.name || facId} (${facId}) assigned on consecutive examination dates: ${current.date} and ${next.date} (rest_days = ${restDays})`,
          date: next.date,
          session: next.session,
          facultyId: facId,
        });
      }

      // H4: Room Rotation (Independent of calendar date difference or rest_days)
      // A teacher must not return to the same room they occupied on their immediately preceding duty
      if (current.roomId === next.roomId) {
        violations.push({
          rule: 'RULE_D',
          message: `Faculty ${teacher?.name || facId} (${facId}) assigned to the same room (${current.roomId}) on subsequent examination duties ${current.date} and ${next.date} without room rotation`,
          date: next.date,
          session: next.session,
          roomId: next.roomId,
          facultyId: facId,
        });
      }
    }
  }

  const coveragePercentage = totalRequiredSlots > 0 ? (totalAssignedSlots / totalRequiredSlots) * 100 : 100;

  return {
    isValid: violations.length === 0,
    violations,
    coveragePercentage,
    totalRequiredSlots,
    totalAssignedSlots,
  };
}

/**
 * Validates a single manual reassignment or substitution against existing assignments
 * using the authoritative domain validator.
 */
export function validateManualReassignment(
  candidateAssignment: Assignment,
  existingAssignments: Assignment[],
  context: ValidationContext
): { valid: boolean; violations: ValidationViolation[] } {
  // Filter out any assignment being replaced (same roomId, date, session)
  const modified = existingAssignments.filter(
    (a) =>
      !(
        a.date === candidateAssignment.date &&
        a.session === candidateAssignment.session &&
        a.roomId === candidateAssignment.roomId
      )
  );

  modified.push(candidateAssignment);
  const result = validateSchedule(modified, context);

  // Filter violations specifically relevant to candidateAssignment
  const specificViolations = result.violations.filter(
    (v) =>
      v.facultyId === candidateAssignment.facultyId ||
      (v.roomId === candidateAssignment.roomId &&
        v.date === candidateAssignment.date &&
        v.session === candidateAssignment.session)
  );

  return {
    valid: specificViolations.length === 0,
    violations: specificViolations,
  };
}

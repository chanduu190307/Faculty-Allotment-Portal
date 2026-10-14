import {
  Assignment,
  ExamDate,
  ExamSession,
  Faculty,
  FacultyAccountingRecord,
  FacultyAccountingStatus,
  FacultyLeave,
  Room,
  ScheduleGenerationResult,
  SchedulingInput,
  SessionAccounting,
  WorkloadStats,
} from './types';
import {
  checkCapacityFeasibility,
  getOrderedExamDates,
  getExamDateIndexMap,
  areExamDatesConsecutive,
} from './capacity';
import { validateSchedule } from './validator';

/**
 * 32-bit MurmurHash3-style deterministic hash for seeded tie-breaking.
 * Maps any string key and integer seed to an unsigned 32-bit integer.
 */
function computeSeededScore(key: string, seed: number): number {
  let h = (seed ^ 0x5bd1e995) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0xcc9e2d51);
    h = ((h << 13) | (h >>> 19)) >>> 0;
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export class SchedulingEngine {
  /**
   * Generates a fully validated faculty allotment schedule adhering to Hard Rules H1–H7.
   * If a valid schedule cannot be found or is mathematically infeasible, returns
   * a structured failure result with actionable diagnostics without mutating production records.
   */
  public static generateSchedule(input: SchedulingInput): ScheduleGenerationResult {
    const {
      examinationId,
      dates,
      sessions,
      rooms,
      faculty,
      leaves,
      defaultMaxDuties,
      restDays = 1,
      seed = null,
      existingDuties = {},
      pastRoomHistory = {},
    } = input;

    // Persisted seed for deterministic tie-breaking (defaults to 42 if omitted)
    const effectiveSeed = seed !== undefined && seed !== null ? seed : 42;

    // 1. Run Comprehensive Pre-flight Capacity & Feasibility Check
    const preflight = checkCapacityFeasibility(
      dates,
      sessions,
      rooms,
      faculty,
      leaves,
      defaultMaxDuties,
      restDays
    );

    // If mathematically infeasible, return structured failure immediately
    if (!preflight.isFeasible) {
      return {
        success: false,
        assignments: [],
        seed: effectiveSeed,
        preflight,
        validation: {
          isValid: false,
          violations: preflight.reasons.map((r) => ({
            rule: 'RULE_A',
            message: r,
          })),
          coveragePercentage: 0,
          totalRequiredSlots: preflight.totalRequiredSlots,
          totalAssignedSlots: 0,
        },
        failureDiagnostics: {
          provenInfeasible: true,
          reason: 'Mathematical infeasibility detected during pre-flight capacity evaluation.',
          details: preflight.reasons,
        },
      };
    }

    // 2. Prepare Ordered Data Structures & Date Index Map
    const examDates = getOrderedExamDates(dates);
    const dateIndexMap = getExamDateIndexMap(examDates);

    const activeRooms = rooms
      .filter((r) => r.active !== false)
      .sort((a, b) => a.id.localeCompare(b.id));

    // Exclude inactive and exempt faculty from candidate pool (Rule H6)
    const activeFaculty = faculty
      .filter((f) => f.active && !f.exempt)
      .sort((a, b) => a.id.localeCompare(b.id));

    // Pre-compute seeded tie-breaking scores for all active faculty
    const facultySeedScores = new Map<string, number>();
    for (const f of activeFaculty) {
      facultySeedScores.set(f.id, computeSeededScore(f.id, effectiveSeed));
    }

    // Track state during allocation
    // facultyId -> current total duties
    const currentDutyCounts = new Map<string, number>();
    for (const f of activeFaculty) {
      currentDutyCounts.set(f.id, existingDuties[f.id] || 0);
    }

    // facultyId -> last assigned date (YYYY-MM-DD)
    const lastAssignedDate = new Map<string, string>();

    // facultyId -> last assigned roomId (for Rule H4 room rotation)
    const lastAssignedRoom = new Map<string, string>();

    // facultyId -> Map of date -> roomId
    const facultyRoomHistory = new Map<string, Map<string, string>>();
    for (const [facId, hist] of Object.entries(pastRoomHistory)) {
      const roomMap = new Map(Object.entries(hist));
      facultyRoomHistory.set(facId, roomMap);

      // If prior room history provided, set last assigned room from the latest date
      const sortedPriorDates = Object.keys(hist).sort();
      if (sortedPriorDates.length > 0) {
        const latestPriorDate = sortedPriorDates[sortedPriorDates.length - 1];
        lastAssignedRoom.set(facId, hist[latestPriorDate]);
      }
    }

    // Date -> Set of facultyIds assigned on that date
    const dailyAssignedFaculty = new Map<string, Set<string>>();

    const generatedAssignments: Assignment[] = [];
    const sessionAccountings: SessionAccounting[] = [];

    // 3. Sequential Session-by-Session Allocation
    for (let dateIdx = 0; dateIdx < examDates.length; dateIdx++) {
      const dateObj = examDates[dateIdx];
      const currentDate = dateObj.date;

      if (!dailyAssignedFaculty.has(currentDate)) {
        dailyAssignedFaculty.set(currentDate, new Set());
      }
      const todayAssigned = dailyAssignedFaculty.get(currentDate)!;

      for (const session of sessions) {
        const sessionAssignedFaculty = new Set<string>();
        const sessionAssignments: Assignment[] = [];

        // For each active room, allocate required staff
        for (const room of activeRooms) {
          const requiredStaff = room.requiredStaffing ?? 1;

          for (let s = 0; s < requiredStaff; s++) {
            // Find eligible candidate
            const candidate = SchedulingEngine.selectBestCandidate({
              faculty: activeFaculty,
              currentDate,
              session: session.name,
              targetRoom: room,
              currentDutyCounts,
              lastAssignedDate,
              lastAssignedRoom,
              todayAssigned,
              leaves,
              defaultMaxDuties,
              restDays,
              dateIndexMap,
              facultySeedScores,
              facultyRoomHistory,
            });

            if (!candidate) {
              // Allocation stalled: could not find an eligible candidate for this room
              const totalRequired = preflight.totalRequiredSlots;
              const totalAssigned = generatedAssignments.length;
              const missingSlots = totalRequired - totalAssigned;

              return {
                success: false,
                assignments: generatedAssignments,
                seed: effectiveSeed,
                preflight,
                validation: {
                  isValid: false,
                  violations: [
                    {
                      rule: 'RULE_A',
                      message: `Unstaffed room: Room ${room.id} on ${currentDate} session ${session.name} has no eligible candidates under active constraints.`,
                      date: currentDate,
                      session: session.name,
                      roomId: room.id,
                    },
                  ],
                  coveragePercentage: (totalAssigned / totalRequired) * 100,
                  totalRequiredSlots: totalRequired,
                  totalAssignedSlots: totalAssigned,
                },
                failureDiagnostics: {
                  provenInfeasible: false,
                  reason: `Constraint exhaustion: Unable to staff room ${room.id} on ${currentDate} ${session.name}.`,
                  details: [
                    `Search budget exhausted at date ${currentDate}, session ${session.name}, room ${room.id}.`,
                    `Total slots required: ${totalRequired}, assigned before exhaustion: ${totalAssigned} (${missingSlots} unfilled).`,
                    `All active teachers were either at capacity, assigned earlier today, assigned on a consecutive examination date, on leave, exempt, or excluded by room department.`,
                  ],
                  bottleneck: {
                    date: currentDate,
                    session: session.name,
                    required: requiredStaff,
                    available: 0,
                  },
                },
              };
            }

            // Record assignment
            const asgnId = `ASGN-${examinationId}-${currentDate.replace(/-/g, '')}-${session.name.substring(0, 1)}-${room.id}-${candidate.id}`;
            const asgn: Assignment = {
              id: asgnId,
              date: currentDate,
              session: session.name,
              roomId: room.id,
              facultyId: candidate.id,
              status: 'SCHEDULED',
            };

            generatedAssignments.push(asgn);
            sessionAssignments.push(asgn);
            sessionAssignedFaculty.add(candidate.id);
            todayAssigned.add(candidate.id);

            // Update state
            currentDutyCounts.set(candidate.id, (currentDutyCounts.get(candidate.id) || 0) + 1);
            lastAssignedDate.set(candidate.id, currentDate);
            lastAssignedRoom.set(candidate.id, room.id);

            if (!facultyRoomHistory.has(candidate.id)) {
              facultyRoomHistory.set(candidate.id, new Map());
            }
            facultyRoomHistory.get(candidate.id)!.set(currentDate, room.id);
          }
        }

        // 4. Generate Rule H Accounting for this Session
        const sessionAccounting = SchedulingEngine.accountForFacultyInSession({
          allFaculty: faculty.filter((f) => f.active),
          currentDate,
          session: session.name,
          sessionAssigned: sessionAssignedFaculty,
          todayAssigned,
          currentDutyCounts,
          lastAssignedDate,
          leaves,
          defaultMaxDuties,
          restDays,
          dateIndexMap,
        });

        sessionAccountings.push(sessionAccounting);
      }
    }

    // 5. Run Independent Full Schedule Validation using Authoritative Validator
    const validationResult = validateSchedule(generatedAssignments, {
      dates,
      sessions,
      rooms,
      faculty,
      leaves,
      defaultMaxDuties,
      restDays,
    });

    if (!validationResult.isValid) {
      return {
        success: false,
        assignments: generatedAssignments,
        seed: effectiveSeed,
        preflight,
        validation: validationResult,
        failureDiagnostics: {
          provenInfeasible: false,
          reason: 'Post-generation schedule validation failed with rule violations.',
          details: validationResult.violations.map((v) => `[${v.rule}] ${v.message}`),
        },
      };
    }

    // 6. Compute Workload Fairness Statistics (Rule G)
    const stats = SchedulingEngine.computeWorkloadStats(activeFaculty, currentDutyCounts);

    return {
      success: true,
      scheduleId: `SCHED-${examinationId}-${Date.now()}`,
      seed: effectiveSeed,
      assignments: generatedAssignments,
      preflight,
      validation: validationResult,
      workloadStats: stats,
      sessionAccountings,
    };
  }

  /**
   * Selects the best eligible candidate for a room assignment.
   * Breaks ties among equally eligible candidates using seeded deterministic scores.
   */
  private static selectBestCandidate(params: {
    faculty: Faculty[];
    currentDate: string;
    session: string;
    targetRoom: Room;
    currentDutyCounts: Map<string, number>;
    lastAssignedDate: Map<string, string>;
    lastAssignedRoom: Map<string, string>;
    todayAssigned: Set<string>;
    leaves: FacultyLeave[];
    defaultMaxDuties: number;
    restDays: number;
    dateIndexMap: Map<string, number>;
    facultySeedScores: Map<string, number>;
    facultyRoomHistory: Map<string, Map<string, string>>;
  }): Faculty | null {
    const {
      faculty,
      currentDate,
      session,
      targetRoom,
      currentDutyCounts,
      lastAssignedDate,
      lastAssignedRoom,
      todayAssigned,
      leaves,
      defaultMaxDuties,
      restDays,
      dateIndexMap,
      facultySeedScores,
      facultyRoomHistory,
    } = params;

    const candidates: Array<{
      teacher: Faculty;
      duties: number;
      roomPenalty: number;
      leaveUrgency: number;
      seedScore: number;
    }> = [];

    for (const teacher of faculty) {
      // 1. Eligibility Check (Rule H6: Active & Exempt)
      if (!teacher.active || teacher.exempt) continue;

      // 2. Departmental Room Exclusion (Rule H6: Own-department room)
      if (
        targetRoom.examDepartment &&
        targetRoom.examDepartment.trim().length > 0 &&
        teacher.department &&
        targetRoom.examDepartment.trim().toLowerCase() === teacher.department.trim().toLowerCase()
      ) {
        continue;
      }

      // 3. Max Duty Check (Rule H5 / Rule F)
      const maxLimit = teacher.maxDutyOverride ?? defaultMaxDuties;
      const currentDuties = currentDutyCounts.get(teacher.id) || 0;
      if (currentDuties >= maxLimit) continue;

      // 4. Daily Session Limit (Rule H2 / Rule B: at most 1 duty per day)
      if (todayAssigned.has(teacher.id)) continue;

      // 5. Sequence Rest Days (Rule H3 / Rule C: no consecutive examination dates)
      if (restDays > 0) {
        const lastDate = lastAssignedDate.get(teacher.id);
        if (lastDate && areExamDatesConsecutive(lastDate, currentDate, dateIndexMap, restDays)) {
          continue;
        }
      }

      // 6. Leave Exclusion (Rule H6 / Approved Leave)
      const onLeave = leaves.some((l) => {
        if (l.facultyId !== teacher.id || l.date !== currentDate) return false;
        if (l.approvalStatus === 'REJECTED') return false;
        if (l.sessionScope === 'FULL_DAY') return true;
        if (l.sessionScope === 'MORNING' && session.toLowerCase().includes('morn')) return true;
        if (l.sessionScope === 'AFTERNOON' && session.toLowerCase().includes('after')) return true;
        return false;
      });
      if (onLeave) continue;

      // 7. Room Rotation (Rule H4 / Rule D: no same room on consecutive scheduled duties)
      // Independent of calendar date difference or rest_days
      const priorRoom = lastAssignedRoom.get(teacher.id);
      if (priorRoom && priorRoom === targetRoom.id) {
        continue;
      }

      // Calculate room preference: penalize returning to any previously used room
      const teacherHistory = facultyRoomHistory.get(teacher.id);
      const everUsedThisRoom =
        teacherHistory && Array.from(teacherHistory.values()).includes(targetRoom.id);
      const roomPenalty = everUsedThisRoom ? 1 : 0;

      // Leave urgency (Most Constrained Variable First heuristic):
      // If candidate is on approved leave on an adjacent examination date (within restDays),
      // they cannot serve on that adjacent date, so prioritize assigning them on currentDate.
      let leaveUrgency = 0;
      if (restDays > 0) {
        const hasAdjacentLeave = leaves.some((l) => {
          if (l.facultyId !== teacher.id || l.approvalStatus === 'REJECTED') return false;
          return areExamDatesConsecutive(currentDate, l.date, dateIndexMap, restDays);
        });
        if (hasAdjacentLeave) leaveUrgency = 1;
      }

      const seedScore = facultySeedScores.get(teacher.id) ?? 0;

      candidates.push({
        teacher,
        duties: currentDuties,
        roomPenalty,
        leaveUrgency,
        seedScore,
      });
    }

    if (candidates.length === 0) return null;

    // Sorting Order:
    // 1. Duties ascending (Fairness: fewest duties first)
    // 2. Leave urgency descending (Most constrained variable first)
    // 3. Room penalty ascending (Prefer fresh rooms)
    // 4. Seeded tie-breaking (Deterministic pseudo-random score from stored seed)
    // 5. Stable ID ascending fallback
    candidates.sort((a, b) => {
      if (a.duties !== b.duties) {
        return a.duties - b.duties;
      }
      if (a.leaveUrgency !== b.leaveUrgency) {
        return b.leaveUrgency - a.leaveUrgency;
      }
      if (a.roomPenalty !== b.roomPenalty) {
        return a.roomPenalty - b.roomPenalty;
      }
      if (a.seedScore !== b.seedScore) {
        return a.seedScore - b.seedScore;
      }
      return a.teacher.id.localeCompare(b.teacher.id);
    });

    return candidates[0].teacher;
  }

  /**
   * Categorizes every active faculty member into mutually exclusive statuses for a session (Rule H / Stage 1 Sec 3.5).
   */
  public static accountForFacultyInSession(params: {
    allFaculty: Faculty[];
    currentDate: string;
    session: string;
    sessionAssigned: Set<string>;
    todayAssigned: Set<string>;
    currentDutyCounts: Map<string, number>;
    lastAssignedDate: Map<string, string>;
    leaves: FacultyLeave[];
    defaultMaxDuties: number;
    restDays: number;
    dateIndexMap: Map<string, number>;
  }): SessionAccounting {
    const {
      allFaculty,
      currentDate,
      session,
      sessionAssigned,
      todayAssigned,
      currentDutyCounts,
      lastAssignedDate,
      leaves,
      defaultMaxDuties,
      restDays,
      dateIndexMap,
    } = params;

    const breakdown: Record<FacultyAccountingStatus, number> = {
      ASSIGNED: 0,
      EXCLUDED_DAILY_SESSION: 0,
      UNAVAILABLE_LEAVE: 0,
      MAX_CAPACITY_REACHED: 0,
      EXCLUDED_CONSECUTIVE_DAY: 0,
      EXCLUDED_ROOM_HISTORY: 0,
      RESERVED_SUBSTITUTE: 0,
      AVAILABLE_UNASSIGNED: 0,
      EXEMPT: 0,
      EXCLUDED_DEPARTMENT: 0,
    };

    const facultyDetails: FacultyAccountingRecord[] = [];

    for (const teacher of allFaculty) {
      let status: FacultyAccountingStatus;
      let reason: string;

      // 1. Exempt (Rule H6)
      if (teacher.exempt) {
        status = 'EXEMPT';
        reason = `Exempt from examination invigilation duties.`;
      }
      // 2. Assigned in this session
      else if (sessionAssigned.has(teacher.id)) {
        status = 'ASSIGNED';
        reason = `Assigned to an examination room in this session.`;
      }
      // 3. Already assigned in another session on the same date (Rule H2)
      else if (todayAssigned.has(teacher.id)) {
        status = 'EXCLUDED_DAILY_SESSION';
        reason = `Already assigned to another session on ${currentDate} (Rule H2: max 1 session per day).`;
      }
      // 4. Unavailable on approved leave (Rule H6)
      else if (
        leaves.some((l) => {
          if (l.facultyId !== teacher.id || l.date !== currentDate) return false;
          if (l.approvalStatus === 'REJECTED') return false;
          if (l.sessionScope === 'FULL_DAY') return true;
          if (l.sessionScope === 'MORNING' && session.toLowerCase().includes('morn')) return true;
          if (l.sessionScope === 'AFTERNOON' && session.toLowerCase().includes('after')) return true;
          return false;
        })
      ) {
        status = 'UNAVAILABLE_LEAVE';
        const leave = leaves.find((l) => l.facultyId === teacher.id && l.date === currentDate);
        reason = `On approved leave: ${leave?.reason || 'Personal/Medical'} (${leave?.sessionScope || 'FULL_DAY'}).`;
      }
      // 5. Reached maximum duty capacity (Rule H5)
      else if (
        (currentDutyCounts.get(teacher.id) || 0) >= (teacher.maxDutyOverride ?? defaultMaxDuties)
      ) {
        status = 'MAX_CAPACITY_REACHED';
        const count = currentDutyCounts.get(teacher.id) || 0;
        const maxLimit = teacher.maxDutyOverride ?? defaultMaxDuties;
        reason = `Reached maximum duty capacity (${count}/${maxLimit} duties).`;
      }
      // 6. Excluded by sequence rest days rule (Rule H3)
      else if (
        restDays > 0 &&
        lastAssignedDate.has(teacher.id) &&
        areExamDatesConsecutive(lastAssignedDate.get(teacher.id)!, currentDate, dateIndexMap, restDays)
      ) {
        status = 'EXCLUDED_CONSECUTIVE_DAY';
        const lastDate = lastAssignedDate.get(teacher.id);
        reason = `Assigned on consecutive examination date (${lastDate}) (Rule H3: rest_days = ${restDays}).`;
      }
      // 7. Available but unassigned (or reserved standby substitute)
      else {
        if (breakdown.RESERVED_SUBSTITUTE < 2) {
          status = 'RESERVED_SUBSTITUTE';
          reason = `Eligible and designated as reserved standby substitute for this session.`;
        } else {
          status = 'AVAILABLE_UNASSIGNED';
          reason = `Fully eligible for duty; unassigned because all rooms are staffed.`;
        }
      }

      breakdown[status]++;
      facultyDetails.push({
        facultyId: teacher.id,
        facultyName: teacher.name,
        department: teacher.department,
        status,
        reason,
      });
    }

    return {
      date: currentDate,
      session,
      breakdown,
      facultyDetails,
    };
  }

  /**
   * Computes workload fairness statistics (Rule G).
   */
  public static computeWorkloadStats(
    faculty: Faculty[],
    dutyCounts: Map<string, number>
  ): WorkloadStats {
    if (faculty.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        median: 0,
        variance: 0,
        stdDev: 0,
        distribution: {},
      };
    }

    const counts: number[] = [];
    const distribution: Record<number, number> = {};

    for (const f of faculty) {
      const c = dutyCounts.get(f.id) || 0;
      counts.push(c);
      distribution[c] = (distribution[c] || 0) + 1;
    }

    counts.sort((a, b) => a - b);

    const min = counts[0];
    const max = counts[counts.length - 1];
    const sum = counts.reduce((a, b) => a + b, 0);
    const avg = sum / counts.length;

    const mid = Math.floor(counts.length / 2);
    const median = counts.length % 2 !== 0 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2;

    const variance =
      counts.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    return {
      min,
      max,
      avg: Number(avg.toFixed(2)),
      median: Number(median.toFixed(2)),
      variance: Number(variance.toFixed(4)),
      stdDev: Number(stdDev.toFixed(2)),
      distribution,
    };
  }
}

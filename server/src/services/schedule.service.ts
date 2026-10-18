import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { ExamService } from './exam.service';
import { FacultyService } from './faculty.service';
import { TimetableService } from './timetable.service';
import { SchedulingEngine } from '../domain/scheduling/engine';
import { validateSchedule, validateManualReassignment } from '../domain/scheduling/validator';
import {
  Assignment,
  ScheduleGenerationResult,
  ScheduleValidationResult,
} from '../domain/scheduling/types';

export class ScheduleService {
  /**
   * Generates a new schedule version for an examination.
   * New schedules begin in DRAFT.
   * Validates the generated draft automatically.
   * If generation fails, existing approved schedules are completely untouched!
   */
  public static generate(
    examinationId: string,
    actor = 'System Admin',
    seed: number | null = null,
    options?: { requireDualRole?: boolean }
  ): ScheduleGenerationResult {
    const exam = ExamService.getById(examinationId);
    if (!exam) {
      throw new Error(`Examination ${examinationId} not found.`);
    }

    const leaves = FacultyService.getLeaves();
    const timetableRecords = TimetableService.getTimetable(examinationId);
    const timetableSessions = timetableRecords.length > 0
      ? timetableRecords.map((t) => ({ date: t.examDate, session: t.session }))
      : undefined;

    // Use passed seed or generate a reproducible deterministic seed
    const finalSeed =
      seed !== undefined && seed !== null ? seed : Math.floor(Math.random() * 900000) + 100000;

    const requireDualRole = options?.requireDualRole !== undefined 
      ? options.requireDualRole 
      : (exam.defaultStaffingPerRoom >= 2);

    // Call pure SchedulingEngine with restDays and finalSeed
    const result = SchedulingEngine.generateSchedule({
      examinationId: exam.id,
      dates: exam.dates || [],
      sessions: exam.sessionConfig,
      rooms: exam.rooms || [],
      faculty: exam.faculty || [],
      leaves,
      defaultMaxDuties: exam.maxDutiesPerFaculty,
      restDays: exam.restDays ?? 1,
      seed: finalSeed,
      timetableSessions,
      requireDualRole,
    });

    if (!result.success) {
      // PRESERVE EXISTING APPROVED SCHEDULES - do not touch DB assignments!
      AuditService.log({
        entity: 'schedule_generation',
        entityId: examinationId,
        action: 'FAILED_GENERATION',
        actor,
        newValues: result.failureDiagnostics,
        reason: 'Generation halted due to capacity or constraint violations',
      });
      return result;
    }

    // Generation succeeded: persist in DB inside atomic transaction
    const db = getDatabase();
    const now = new Date().toISOString();

    let scheduleId = '';
    let nextVersion = 1;

    const tx = db.transaction(() => {
      // Determine next version number inside atomic transaction (base schedules have base_schedule_id IS NULL)
      const lastSched = db
        .prepare('SELECT MAX(version) as max_ver FROM schedules WHERE examination_id = ? AND base_schedule_id IS NULL')
        .get(examinationId) as { max_ver: number | null };
      nextVersion = (lastSched?.max_ver || 0) + 1;
      scheduleId = `SCHED-${examinationId}-V${nextVersion}`;

      // Create new schedule record in 'DRAFT' state with seed, counter, revision_number = 0, base_schedule_id = null
      db.prepare(`
        INSERT INTO schedules (
          id, examination_id, version, revision_number, base_schedule_id,
          state, seed, counter, validation_result, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        scheduleId,
        examinationId,
        nextVersion,
        0,
        null,
        'DRAFT',
        finalSeed,
        1,
        JSON.stringify({
          validation: result.validation,
          workloadStats: result.workloadStats,
          sessionAccountings: result.sessionAccountings,
          preflight: result.preflight,
        }),
        actor,
        now,
        now
      );

      // Insert all generated assignments (including both Invigilator and Frisking Teacher)
      const insertAsgn = db.prepare(`
        INSERT INTO assignments (
          id, schedule_id, date, session, room_id, faculty_id,
          frisking_faculty_id, role, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const asgn of result.assignments) {
        const uniqueAsgnId = `${scheduleId}-${asgn.date.replace(/-/g, '')}-${asgn.session.substring(0, 1)}-${asgn.roomId}-${asgn.facultyId}`;
        asgn.id = uniqueAsgnId;
        insertAsgn.run(
          uniqueAsgnId,
          scheduleId,
          asgn.date,
          asgn.session,
          asgn.roomId,
          asgn.facultyId,
          asgn.friskingFacultyId || null,
          asgn.role || (asgn.friskingFacultyId ? 'DUAL' : 'INVIGILATOR'),
          'SCHEDULED',
          now,
          now
        );
      }

      AuditService.log({
        entity: 'schedule',
        entityId: scheduleId,
        action: 'GENERATE',
        actor,
        newValues: {
          version: nextVersion,
          revisionNumber: 0,
          seed: finalSeed,
          counter: 1,
          state: 'DRAFT',
          totalAssignments: result.assignments.length,
          coverage: result.validation.coveragePercentage,
        },
      }, db);
    });

    tx();

    result.scheduleId = scheduleId;
    result.seed = finalSeed;
    result.counter = 1;
    result.state = 'DRAFT';
    result.version = nextVersion;
    result.revisionNumber = 0;
    result.baseScheduleId = null;
    return result;
  }

  /**
   * Retrieves the current optimistic concurrency counter for a schedule.
   */
  public static getScheduleCounter(scheduleId: string): number | null {
    const db = getDatabase();
    const row = db.prepare('SELECT counter FROM schedules WHERE id = ?').get(scheduleId) as { counter: number } | undefined;
    return row ? (row.counter ?? 1) : null;
  }

  /**
   * Atomically increments the optimistic concurrency counter for a schedule.
   * Returns failure if expectedCounter does not match the current database value.
   */
  public static incrementScheduleCounter(
    scheduleId: string,
    expectedCounter: number
  ): { success: boolean; newCounter?: number; error?: string } {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE schedules
      SET counter = counter + 1, updated_at = ?
      WHERE id = ? AND counter = ?
    `).run(new Date().toISOString(), scheduleId, expectedCounter);

    if (result.changes === 0) {
      return {
        success: false,
        error: 'Concurrency conflict: schedule has been modified by another concurrent transaction.',
      };
    }

    return {
      success: true,
      newCounter: expectedCounter + 1,
    };
  }

  public static getLatestSchedule(examinationId: string): any | null {
    const db = getDatabase();
    const sched = db
      .prepare(`
        SELECT * FROM schedules 
        WHERE examination_id = ? 
        ORDER BY 
          CASE WHEN state IN ('APPROVED', 'PUBLISHED') THEN 2 ELSE 1 END DESC,
          version DESC, 
          revision_number DESC 
        LIMIT 1
      `)
      .get(examinationId) as any;
    if (!sched) return null;

    return ScheduleService.getScheduleDetails(sched.id);
  }

  public static getScheduleDetails(scheduleId: string): any | null {
    const db = getDatabase();
    const sched = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    if (!sched) return null;

    const assignments = db
      .prepare(`
        SELECT a.*,
               f.name as faculty_name, f.department, f.designation,
               ff.name as frisking_faculty_name, ff.department as frisking_department, ff.designation as frisking_designation,
               r.name as room_name, r.building, r.floor
        FROM assignments a
        JOIN faculty f ON a.faculty_id = f.id
        LEFT JOIN faculty ff ON a.frisking_faculty_id = ff.id
        JOIN rooms r ON a.room_id = r.id
        WHERE a.schedule_id = ?
        ORDER BY a.date ASC, a.session ASC, a.room_id ASC
      `)
      .all(scheduleId) as any[];

    return {
      ...sched,
      validationResult: sched.validation_result ? JSON.parse(sched.validation_result) : null,
      assignments,
    };
  }

  public static listSchedules(examinationId: string): any[] {
    const db = getDatabase();
    return db
      .prepare(`
        SELECT * FROM schedules 
        WHERE examination_id = ? 
        ORDER BY version DESC, revision_number DESC
      `)
      .all(examinationId);
  }

  /**
   * Explicitly validates a draft schedule using the authoritative domain validator
   * and updates its state to VALIDATED if no hard rule violations exist.
   */
  public static validateDraft(scheduleId: string, actor = 'System Admin'): {
    success: boolean;
    validation: ScheduleValidationResult;
    schedule: any;
  } {
    const db = getDatabase();
    const sched = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    if (!sched) throw new Error('Schedule not found');

    if (sched.state === 'APPROVED' || sched.state === 'PUBLISHED' || sched.state === 'CANCELLED' || sched.state === 'ARCHIVED') {
      throw new Error(`Invalid state transition: Cannot validate a schedule in ${sched.state} state.`);
    }

    const exam = ExamService.getById(sched.examination_id);
    if (!exam) throw new Error('Examination not found');

    const rawAssignments = db.prepare('SELECT * FROM assignments WHERE schedule_id = ?').all(scheduleId) as any[];
    const assignments: Assignment[] = rawAssignments.map((a) => ({
      id: a.id,
      scheduleId: a.schedule_id,
      date: a.date,
      session: a.session,
      roomId: a.room_id,
      facultyId: a.faculty_id,
      friskingFacultyId: a.frisking_faculty_id || null,
      role: a.role || (a.frisking_faculty_id ? 'DUAL' : 'INVIGILATOR'),
      status: a.status,
      markedAt: a.marked_at,
      markedBy: a.marked_by,
      notes: a.notes,
    }));
    const leaves = FacultyService.getLeaves();
    const timetableRecords = TimetableService.getTimetable(sched.examination_id);
    const timetableSessions = timetableRecords.length > 0
      ? timetableRecords.map((t) => ({ date: t.examDate, session: t.session }))
      : undefined;

    const isDual = rawAssignments.some((a) => a.role === 'DUAL' || a.frisking_faculty_id);
    const validation = validateSchedule(assignments, {
      dates: exam.dates || [],
      sessions: exam.sessionConfig,
      rooms: exam.rooms || [],
      faculty: exam.faculty || [],
      leaves,
      defaultMaxDuties: exam.maxDutiesPerFaculty,
      restDays: exam.restDays ?? 1,
      timetableSessions,
      requireDualRole: isDual,
    });

    const now = new Date().toISOString();
    const newState = validation.isValid ? 'VALIDATED' : 'DRAFT';

    const existingResult = sched.validation_result ? JSON.parse(sched.validation_result) : {};
    const updatedResult = { ...existingResult, validation };

    db.prepare(`
      UPDATE schedules
      SET state = ?, validation_result = ?, updated_at = ?
      WHERE id = ?
    `).run(newState, JSON.stringify(updatedResult), now, scheduleId);

    AuditService.log({
      entity: 'schedule',
      entityId: scheduleId,
      action: 'VALIDATE_DRAFT',
      actor,
      newValues: {
        state: newState,
        isValid: validation.isValid,
        violationCount: validation.violations.length,
      },
    });

    return {
      success: validation.isValid,
      validation,
      schedule: ScheduleService.getScheduleDetails(scheduleId),
    };
  }

  /**
   * Approves a validated schedule or draft.
   * Authoritative validation is strictly enforced; rejects invalid schedules.
   * Verifies optimistic concurrency counter if supplied.
   */
  public static approve(scheduleId: string, actor = 'Dean Academic', expectedCounter?: number): any {
    const db = getDatabase();
    const sched = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    if (!sched) throw new Error('Schedule not found');

    // Reject invalid state transitions
    if (sched.state === 'APPROVED') {
      throw new Error(`Invalid schedule state transition: Schedule ${scheduleId} is already APPROVED.`);
    }
    if (sched.state === 'PUBLISHED') {
      throw new Error(`Invalid schedule state transition: Schedule ${scheduleId} is already PUBLISHED.`);
    }
    if (sched.state === 'CANCELLED' || sched.state === 'ARCHIVED') {
      throw new Error(`Invalid schedule state transition: Cannot approve a ${sched.state} schedule.`);
    }

    // Stale version check:
    if (sched.base_schedule_id) {
      // This is a revision. Check if a newer base version exists for the exam:
      const latestBase = db
        .prepare('SELECT MAX(version) as max_ver FROM schedules WHERE examination_id = ? AND base_schedule_id IS NULL')
        .get(sched.examination_id) as { max_ver: number | null };
      if (latestBase?.max_ver && sched.version < latestBase.max_ver) {
        throw new Error(
          `Stale schedule version rejected: Version ${sched.version} has been superseded by Version ${latestBase.max_ver}. Only the latest validated schedule may be approved.`
        );
      }
      // Also check if a newer revision exists for this base schedule:
      const latestRev = db
        .prepare('SELECT MAX(revision_number) as max_rev FROM schedules WHERE base_schedule_id = ?')
        .get(sched.base_schedule_id) as { max_rev: number | null };
      if (latestRev?.max_rev && (sched.revision_number || 0) < latestRev.max_rev) {
        throw new Error(
          `Stale schedule version rejected: Revision ${sched.revision_number} has been superseded by Revision ${latestRev.max_rev}. Only the latest revision may be approved.`
        );
      }
    } else {
      // Base schedule: check if newer base version exists
      const latest = db
        .prepare('SELECT MAX(version) as max_ver FROM schedules WHERE examination_id = ? AND base_schedule_id IS NULL')
        .get(sched.examination_id) as { max_ver: number | null };
      if (latest?.max_ver && sched.version < latest.max_ver) {
        throw new Error(
          `Stale schedule version rejected: Version ${sched.version} has been superseded by Version ${latest.max_ver}. Only the latest validated schedule may be approved.`
        );
      }
    }

    // Optimistic concurrency counter check
    if (expectedCounter !== undefined && expectedCounter !== null && sched.counter !== expectedCounter) {
      throw new Error(
        `Concurrency conflict: schedule counter mismatch (expected: ${expectedCounter}, current: ${sched.counter}). Refresh schedule and retry.`
      );
    }

    // Authoritative hard-rule validation check (H1-H7)
    const exam = ExamService.getById(sched.examination_id);
    if (!exam) throw new Error('Examination not found');

    const rawAssignments = db
      .prepare('SELECT * FROM assignments WHERE schedule_id = ?')
      .all(scheduleId) as any[];

    const assignments: Assignment[] = rawAssignments.map((a) => ({
      id: a.id,
      scheduleId: a.schedule_id,
      date: a.date,
      session: a.session,
      roomId: a.room_id,
      facultyId: a.faculty_id,
      friskingFacultyId: a.frisking_faculty_id || null,
      role: a.role || (a.frisking_faculty_id ? 'DUAL' : 'INVIGILATOR'),
      status: a.status,
      markedAt: a.marked_at,
      markedBy: a.marked_by,
      notes: a.notes,
    }));

    const leaves = FacultyService.getLeaves();
    const timetableRecords = TimetableService.getTimetable(sched.examination_id);
    const timetableSessions = timetableRecords.length > 0
      ? timetableRecords.map((t) => ({ date: t.examDate, session: t.session }))
      : undefined;

    const isDual = rawAssignments.some((a) => a.role === 'DUAL' || a.frisking_faculty_id);
    const valResult = validateSchedule(assignments, {
      dates: exam.dates || [],
      sessions: exam.sessionConfig,
      rooms: exam.rooms || [],
      faculty: exam.faculty || [],
      leaves,
      defaultMaxDuties: exam.maxDutiesPerFaculty,
      restDays: exam.restDays ?? 1,
      timetableSessions,
      requireDualRole: isDual,
    });

    if (!valResult.isValid || valResult.violations.length > 0) {
      const violationSummary = valResult.violations.map((v) => `[${v.rule}] ${v.message}`).join('; ');
      throw new Error(
        `Approval rejected: Schedule has ${valResult.violations.length} authoritative validation violation(s). Hard rules H1–H7 must be satisfied. ${violationSummary}`
      );
    }

    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      // Atomic compare-and-swap counter increment and state transition
      let updateRes;
      if (expectedCounter !== undefined && expectedCounter !== null) {
        updateRes = db.prepare(`
          UPDATE schedules 
          SET state = 'APPROVED', approved_by = ?, approved_at = ?, counter = counter + 1, updated_at = ?
          WHERE id = ? AND counter = ?
        `).run(actor, now, now, scheduleId, expectedCounter);
      } else {
        updateRes = db.prepare(`
          UPDATE schedules 
          SET state = 'APPROVED', approved_by = ?, approved_at = ?, counter = counter + 1, updated_at = ?
          WHERE id = ?
        `).run(actor, now, now, scheduleId);
      }

      if (updateRes.changes === 0) {
        throw new Error(`Concurrency conflict: schedule ${scheduleId} was modified by another transaction.`);
      }

      // If approving a revision, update base schedule state to REVISED while preserving its approval metadata and assignments
      if (sched.base_schedule_id) {
        db.prepare(`
          UPDATE schedules 
          SET state = 'REVISED', updated_at = ?
          WHERE id = ? AND state = 'APPROVED'
        `).run(now, sched.base_schedule_id);
      }

      // Update examination status to SCHEDULED
      db.prepare(`UPDATE examinations SET status = 'SCHEDULED', updated_at = ? WHERE id = ?`).run(
        now,
        sched.examination_id
      );

      // Audit logging inside atomic transaction
      AuditService.log({
        entity: 'schedule',
        entityId: scheduleId,
        action: 'APPROVE',
        actor,
        oldValues: { state: sched.state, counter: sched.counter },
        newValues: { state: 'APPROVED', counter: sched.counter + 1, approvedBy: actor, approvedAt: now },
      }, db);
    });

    tx();

    return ScheduleService.getScheduleDetails(scheduleId);
  }

  public static publish(scheduleId: string, actor = 'Dean Academic', expectedCounter?: number): any {
    const db = getDatabase();
    const sched = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    if (!sched) throw new Error('Schedule not found');

    if (expectedCounter !== undefined && expectedCounter !== null && sched.counter !== expectedCounter) {
      throw new Error(`Concurrency conflict: schedule counter mismatch (expected: ${expectedCounter}, current: ${sched.counter}).`);
    }

    if (sched.state !== 'APPROVED' && sched.state !== 'PUBLISHED') {
      throw new Error(`Schedule must be APPROVED before publication (current state: ${sched.state}).`);
    }

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      let updateRes;
      if (expectedCounter !== undefined && expectedCounter !== null) {
        updateRes = db.prepare(`
          UPDATE schedules 
          SET state = 'PUBLISHED', published_at = ?, counter = counter + 1, updated_at = ?
          WHERE id = ? AND counter = ?
        `).run(now, now, scheduleId, expectedCounter);
      } else {
        updateRes = db.prepare(`
          UPDATE schedules 
          SET state = 'PUBLISHED', published_at = ?, counter = counter + 1, updated_at = ?
          WHERE id = ?
        `).run(now, now, scheduleId);
      }

      if (updateRes.changes === 0) {
        throw new Error(`Concurrency conflict: schedule ${scheduleId} was modified by another transaction.`);
      }

      AuditService.log({
        entity: 'schedule',
        entityId: scheduleId,
        action: 'PUBLISH',
        actor,
        oldValues: { state: sched.state, counter: sched.counter },
        newValues: { state: 'PUBLISHED', counter: sched.counter + 1, publishedAt: now },
      }, db);
    });

    tx();

    return ScheduleService.getScheduleDetails(scheduleId);
  }

  /**
   * Performs manual reassignment with mandatory shared domain validation.
   * If modifying an APPROVED or PUBLISHED schedule, creates a distinct immutable revision
   * linked to the base schedule, strictly preserving original assignments and snapshots.
   * Requires a non-empty reason.
   */
  public static manualReassign(
    scheduleId: string,
    assignmentId: string,
    newFacultyId: string,
    reason: string,
    actor = 'System Admin',
    expectedCounter?: number,
    roleTarget: 'INVIGILATOR' | 'FRISKING' = 'INVIGILATOR'
  ): {
    success: boolean;
    isRevision?: boolean;
    revisionScheduleId?: string;
    newCounter?: number;
    error?: string;
    violations?: any[];
  } {
    // 1. Validate required non-empty reason
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return {
        success: false,
        error: 'A non-empty revision reason is required.',
      };
    }

    const db = getDatabase();
    const sched = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    if (!sched) return { success: false, error: 'Schedule not found' };

    const currentAsgn = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as any;
    if (!currentAsgn) return { success: false, error: 'Assignment not found' };

    const exam = ExamService.getById(sched.examination_id);
    if (!exam) return { success: false, error: 'Examination not found' };

    // 2. Concurrency Counter Check (if expectedCounter supplied)
    if (expectedCounter !== undefined && expectedCounter !== null && sched.counter !== expectedCounter) {
      return {
        success: false,
        error: `Concurrency conflict: schedule counter mismatch (expected: ${expectedCounter}, current: ${sched.counter}). Refresh schedule and retry.`,
      };
    }

    // 3. Authoritative Domain Validation (H1–H7)
    const rawExisting = db
      .prepare('SELECT * FROM assignments WHERE schedule_id = ?')
      .all(scheduleId) as any[];

    const existingAssignments: Assignment[] = rawExisting.map((a) => ({
      id: a.id,
      scheduleId: a.schedule_id,
      date: a.date,
      session: a.session,
      roomId: a.room_id,
      facultyId: a.faculty_id,
      friskingFacultyId: a.frisking_faculty_id || null,
      role: a.role || (a.frisking_faculty_id ? 'DUAL' : 'INVIGILATOR'),
      status: a.status,
      markedAt: a.marked_at,
      markedBy: a.marked_by,
      notes: a.notes,
    }));

    const isDual = rawExisting.some((a) => a.role === 'DUAL' || a.frisking_faculty_id);
    const candidate: Assignment = {
      id: currentAsgn.id,
      scheduleId: currentAsgn.schedule_id,
      date: currentAsgn.date,
      session: currentAsgn.session,
      roomId: currentAsgn.room_id,
      facultyId: roleTarget === 'INVIGILATOR' ? newFacultyId : currentAsgn.faculty_id,
      friskingFacultyId: roleTarget === 'FRISKING' ? newFacultyId : currentAsgn.frisking_faculty_id,
      role: currentAsgn.role || (isDual ? 'DUAL' : 'INVIGILATOR'),
      status: currentAsgn.status || 'SCHEDULED',
    };

    // Check distinctness: Invigilator and Frisking teacher cannot be the same person
    if (candidate.facultyId && candidate.friskingFacultyId && candidate.facultyId === candidate.friskingFacultyId) {
      return {
        success: false,
        error: `The same faculty member cannot serve as both Invigilator and Frisking Teacher for Room ${candidate.roomId}.`,
        violations: [
          {
            rule: 'DUPLICATE',
            message: `Faculty ${newFacultyId} cannot fill both Invigilator and Frisking Teacher roles simultaneously for Room ${candidate.roomId}.`,
            date: candidate.date,
            session: candidate.session,
            roomId: candidate.roomId,
            facultyId: newFacultyId,
          },
        ],
      };
    }

    const leaves = FacultyService.getLeaves();
    const timetableRecords = TimetableService.getTimetable(sched.examination_id);
    const timetableSessions = timetableRecords.length > 0
      ? timetableRecords.map((t) => ({ date: t.examDate, session: t.session }))
      : undefined;

    const valResult = validateManualReassignment(
      candidate,
      existingAssignments,
      {
        dates: exam.dates || [],
        sessions: exam.sessionConfig,
        rooms: exam.rooms || [],
        faculty: exam.faculty || [],
        leaves,
        defaultMaxDuties: exam.maxDutiesPerFaculty,
        restDays: exam.restDays ?? 1,
        timetableSessions,
        requireDualRole: isDual,
      },
      roleTarget
    );

    if (!valResult.valid) {
      return {
        success: false,
        error: 'Manual reassignment violates scheduling rules.',
        violations: valResult.violations,
      };
    }

    // Also run full validateSchedule across the complete modified assignment set
    const proposedAssignments = existingAssignments.map((a) => {
      if (a.id !== assignmentId) return a;
      return {
        ...a,
        facultyId: roleTarget === 'INVIGILATOR' ? newFacultyId : a.facultyId,
        friskingFacultyId: roleTarget === 'FRISKING' ? newFacultyId : a.friskingFacultyId,
      };
    });

    const fullVal = validateSchedule(proposedAssignments, {
      dates: exam.dates || [],
      sessions: exam.sessionConfig,
      rooms: exam.rooms || [],
      faculty: exam.faculty || [],
      leaves,
      defaultMaxDuties: exam.maxDutiesPerFaculty,
      restDays: exam.restDays ?? 1,
      timetableSessions,
      requireDualRole: isDual,
    });

    if (!fullVal.isValid) {
      return {
        success: false,
        error: 'Manual reassignment violates scheduling rules.',
        violations: fullVal.violations,
      };
    }

    const now = new Date().toISOString();
    const isApprovedOrPublished = sched.state === 'APPROVED' || sched.state === 'PUBLISHED' || sched.state === 'REVISED';

    if (isApprovedOrPublished) {
      // =========================================================================
      // IMMUTABLE APPROVED VERSION: CREATE A DISTINCT REVISION
      // Original assignments and approval metadata are preserved untouched!
      // =========================================================================
      const baseScheduleId = sched.base_schedule_id || sched.id;

      // Find next revision number for this base version
      const revRow = db
        .prepare(`
          SELECT MAX(revision_number) as max_rev 
          FROM schedules 
          WHERE id = ? OR base_schedule_id = ?
        `)
        .get(baseScheduleId, baseScheduleId) as { max_rev: number | null };
      const nextRevNumber = (revRow?.max_rev || 0) + 1;
      const revScheduleId = `${baseScheduleId}-REV${nextRevNumber}`;

      let createdRevisionId = '';

      const tx = db.transaction(() => {
        // Increment source schedule counter (CAS check if expectedCounter supplied)
        let updateRes;
        if (expectedCounter !== undefined && expectedCounter !== null) {
          updateRes = db.prepare(`
            UPDATE schedules SET counter = counter + 1, updated_at = ?
            WHERE id = ? AND counter = ?
          `).run(now, sched.id, expectedCounter);
        } else {
          updateRes = db.prepare(`
            UPDATE schedules SET counter = counter + 1, updated_at = ?
            WHERE id = ?
          `).run(now, sched.id);
        }

        if (updateRes.changes === 0) {
          throw new Error(`Concurrency conflict: schedule ${sched.id} was modified by another concurrent transaction.`);
        }

        // Insert new revision schedule record in VALIDATED state
        db.prepare(`
          INSERT INTO schedules (
            id, examination_id, version, revision_number, base_schedule_id,
            state, validation_result, seed, counter, created_by, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          revScheduleId,
          sched.examination_id,
          sched.version,
          nextRevNumber,
          baseScheduleId,
          'VALIDATED',
          JSON.stringify({ validation: fullVal }),
          sched.seed,
          1,
          actor,
          `Revision ${sched.version}.${nextRevNumber}: ${reason.trim()}`,
          now,
          now
        );

        // Copy assignments to revision schedule with candidate modification
        const insertAsgn = db.prepare(`
          INSERT INTO assignments (
            id, schedule_id, date, session, room_id, faculty_id,
            frisking_faculty_id, role, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const asgn of existingAssignments) {
          const facId = asgn.id === assignmentId && roleTarget === 'INVIGILATOR' ? newFacultyId : asgn.facultyId;
          const friskFacId = asgn.id === assignmentId && roleTarget === 'FRISKING' ? newFacultyId : asgn.friskingFacultyId;
          const newAsgnId = `${revScheduleId}-${asgn.date.replace(/-/g, '')}-${asgn.session.substring(0, 1)}-${asgn.roomId}-${facId}`;
          insertAsgn.run(
            newAsgnId,
            revScheduleId,
            asgn.date,
            asgn.session,
            asgn.roomId,
            facId,
            friskFacId || null,
            asgn.role || (friskFacId ? 'DUAL' : 'INVIGILATOR'),
            asgn.status || 'SCHEDULED',
            now,
            now
          );
        }

        // Log audit inside transaction
        AuditService.log({
          entity: 'schedule',
          entityId: revScheduleId,
          action: 'CREATE_REVISION',
          actor,
          oldValues: {
            baseScheduleId,
            sourceScheduleId: sched.id,
            assignmentId,
            facultyId: currentAsgn.faculty_id,
            friskingFacultyId: currentAsgn.frisking_faculty_id,
            roleTarget,
            counter: sched.counter,
          },
          newValues: {
            revisionScheduleId: revScheduleId,
            version: sched.version,
            revisionNumber: nextRevNumber,
            assignmentId,
            facultyId: roleTarget === 'INVIGILATOR' ? newFacultyId : currentAsgn.faculty_id,
            friskingFacultyId: roleTarget === 'FRISKING' ? newFacultyId : currentAsgn.frisking_faculty_id,
            roleTarget,
            counter: 1,
          },
          reason: reason.trim(),
        }, db);

        createdRevisionId = revScheduleId;
      });

      tx();

      return {
        success: true,
        isRevision: true,
        revisionScheduleId: createdRevisionId,
        newCounter: sched.counter + 1,
      };
    } else {
      // =========================================================================
      // DRAFT / VALIDATED SCHEDULE: IN-PLACE UPDATE WITHIN UNAPPROVED DRAFT
      // =========================================================================
      const tx = db.transaction(() => {
        // Increment schedule counter (CAS check if expectedCounter supplied)
        let updateRes;
        if (expectedCounter !== undefined && expectedCounter !== null) {
          updateRes = db.prepare(`
            UPDATE schedules SET counter = counter + 1, validation_result = ?, updated_at = ?
            WHERE id = ? AND counter = ?
          `).run(JSON.stringify({ validation: fullVal }), now, sched.id, expectedCounter);
        } else {
          updateRes = db.prepare(`
            UPDATE schedules SET counter = counter + 1, validation_result = ?, updated_at = ?
            WHERE id = ?
          `).run(JSON.stringify({ validation: fullVal }), now, sched.id);
        }

        if (updateRes.changes === 0) {
          throw new Error(`Concurrency conflict: schedule ${sched.id} was modified by another concurrent transaction.`);
        }

        // In-place update of assignment according to target role
        if (roleTarget === 'FRISKING') {
          db.prepare(`
            UPDATE assignments SET frisking_faculty_id = ?, role = 'DUAL', updated_at = ? WHERE id = ?
          `).run(newFacultyId, now, assignmentId);
        } else {
          db.prepare(`
            UPDATE assignments SET faculty_id = ?, updated_at = ? WHERE id = ?
          `).run(newFacultyId, now, assignmentId);
        }

        // Log audit
        AuditService.log({
          entity: 'assignment',
          entityId: assignmentId,
          action: 'MANUAL_REASSIGN',
          actor,
          oldValues: {
            facultyId: currentAsgn.faculty_id,
            friskingFacultyId: currentAsgn.frisking_faculty_id,
            roleTarget,
            counter: sched.counter,
          },
          newValues: {
            facultyId: roleTarget === 'INVIGILATOR' ? newFacultyId : currentAsgn.faculty_id,
            friskingFacultyId: roleTarget === 'FRISKING' ? newFacultyId : currentAsgn.frisking_faculty_id,
            roleTarget,
            counter: sched.counter + 1,
          },
          reason: reason.trim(),
        }, db);
      });

      tx();

      return {
        success: true,
        isRevision: false,
        newCounter: sched.counter + 1,
      };
    }
  }
}

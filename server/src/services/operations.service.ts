import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { ExamService } from './exam.service';
import { FacultyService } from './faculty.service';
import { validateManualReassignment } from '../domain/scheduling/validator';
import { Assignment, Faculty } from '../domain/scheduling/types';

export interface AttendanceUpdate {
  assignmentId: string;
  status: 'COMPLETED' | 'ABSENT';
  notes?: string;
  actor?: string;
}

export interface SubstitutionRequest {
  assignmentId: string;
  substituteFacultyId: string;
  reason: string;
  actor?: string;
}

export class OperationsService {
  /**
   * Marks attendance for an examination assignment (COMPLETED or ABSENT).
   */
  public static markAttendance(params: AttendanceUpdate): any {
    const { assignmentId, status, notes, actor = 'Exam Superintendent' } = params;
    const db = getDatabase();

    const asgn = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as any;
    if (!asgn) throw new Error('Assignment not found');

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE assignments
      SET status = ?, marked_at = ?, marked_by = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, actor, notes || null, now, assignmentId);

    AuditService.log({
      entity: 'assignment',
      entityId: assignmentId,
      action: 'ATTENDANCE_' + status,
      actor,
      oldValues: { status: asgn.status },
      newValues: { status, notes },
    });

    return db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  }

  /**
   * Recommends eligible standby substitutes for an unstaffed or absent assignment.
   */
  public static recommendSubstitutes(assignmentId: string): Array<{
    faculty: Faculty;
    currentDuties: number;
    eligibilityReason: string;
  }> {
    const db = getDatabase();
    const asgn = db.prepare(`
      SELECT a.*, s.examination_id
      FROM assignments a
      JOIN schedules s ON a.schedule_id = s.id
      WHERE a.id = ?
    `).get(assignmentId) as any;

    if (!asgn) throw new Error('Assignment not found');

    const exam = ExamService.getById(asgn.examination_id);
    if (!exam) throw new Error('Examination not found');

    const leaves = FacultyService.getLeaves();
    const existingAssignments = db
      .prepare('SELECT * FROM assignments WHERE schedule_id = ?')
      .all(asgn.schedule_id) as Assignment[];

    // Candidate faculty must be active and not original teacher
    const candidateFaculty = (exam.faculty || []).filter(
      (f) => f.active && f.id !== asgn.faculty_id
    );

    const recommendations: Array<{
      faculty: Faculty;
      currentDuties: number;
      eligibilityReason: string;
    }> = [];

    for (const cand of candidateFaculty) {
      const candidateAsgn: Assignment = {
        ...asgn,
        facultyId: cand.id,
      };

      const check = validateManualReassignment(candidateAsgn, existingAssignments, {
        dates: exam.dates || [],
        sessions: exam.sessionConfig,
        rooms: exam.rooms || [],
        faculty: exam.faculty || [],
        leaves,
        defaultMaxDuties: exam.maxDutiesPerFaculty,
        restDays: exam.restDays ?? 1,
      });

      if (check.valid) {
        const dutyStats = FacultyService.getDutyHistory(cand.id);
        recommendations.push({
          faculty: cand,
          currentDuties: dutyStats.totalDuties,
          eligibilityReason: `Eligible: Has ${dutyStats.totalDuties} duties (max: ${cand.maxDutyOverride ?? exam.maxDutiesPerFaculty}), no session/leave/consecutive conflict.`,
        });
      }
    }

    // Sort by fewest duties first (fairness preference)
    recommendations.sort((a, b) => a.currentDuties - b.currentDuties);
    return recommendations;
  }

  /**
   * Approves a faculty substitution with full domain revalidation.
   */
  public static approveSubstitution(params: SubstitutionRequest): {
    success: boolean;
    error?: string;
    violations?: any[];
  } {
    const { assignmentId, substituteFacultyId, reason, actor = 'Exam Superintendent' } = params;
    const db = getDatabase();

    const asgn = db.prepare(`
      SELECT a.*, s.examination_id
      FROM assignments a
      JOIN schedules s ON a.schedule_id = s.id
      WHERE a.id = ?
    `).get(assignmentId) as any;

    if (!asgn) return { success: false, error: 'Assignment not found' };

    const exam = ExamService.getById(asgn.examination_id);
    if (!exam) return { success: false, error: 'Examination not found' };

    const leaves = FacultyService.getLeaves();
    const existingAssignments = db
      .prepare('SELECT * FROM assignments WHERE schedule_id = ?')
      .all(asgn.schedule_id) as Assignment[];

    const candidateAsgn: Assignment = {
      ...asgn,
      facultyId: substituteFacultyId,
      status: 'SUBSTITUTED',
    };

    // Revalidate via shared domain validator
    const check = validateManualReassignment(candidateAsgn, existingAssignments, {
      dates: exam.dates || [],
      sessions: exam.sessionConfig,
      rooms: exam.rooms || [],
      faculty: exam.faculty || [],
      leaves,
      defaultMaxDuties: exam.maxDutiesPerFaculty,
      restDays: exam.restDays ?? 1,
    });

    if (!check.valid) {
      return {
        success: false,
        error: 'Proposed substitute fails scheduling constraint rules.',
        violations: check.violations,
      };
    }

    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      // 1. Record in substitutions table
      db.prepare(`
        INSERT INTO substitutions (assignment_id, original_faculty_id, substitute_faculty_id, reason, approved_by, approved_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(assignmentId, asgn.faculty_id, substituteFacultyId, reason, actor, now, 'APPROVED');

      // 2. Update assignment record
      db.prepare(`
        UPDATE assignments
        SET faculty_id = ?, status = 'SUBSTITUTED', notes = ?, updated_at = ?
        WHERE id = ?
      `).run(substituteFacultyId, `Substituted for ${asgn.faculty_id}: ${reason}`, now, assignmentId);
    });

    tx();

    AuditService.log({
      entity: 'substitution',
      entityId: assignmentId,
      action: 'APPROVE_SUBSTITUTION',
      actor,
      oldValues: { facultyId: asgn.faculty_id },
      newValues: { substituteFacultyId },
      reason,
    });

    return { success: true };
  }
}

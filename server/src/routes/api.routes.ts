import { Router, Request, Response } from 'express';
import { FacultyService } from '../services/faculty.service';
import { RoomService } from '../services/room.service';
import { ExamService } from '../services/exam.service';
import { ScheduleService } from '../services/schedule.service';
import { OperationsService } from '../services/operations.service';
import { ReportService } from '../services/report.service';
import { SettingsService } from '../services/settings.service';
import { AuditService } from '../services/audit.service';
import { ExportService } from '../services/export.service';
import { ImportService } from '../services/import.service';
import { TimetableService } from '../services/timetable.service';
import { CleanupService } from '../services/cleanup.service';
import { checkCapacityFeasibility } from '../domain/scheduling/capacity';
import { requireRole } from '../middleware/auth';

export const apiRouter = Router();

function p(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || '';
  return param || '';
}

// ==========================================
// 1. SETTINGS & SYSTEM CONFIGURATION
// ==========================================
apiRouter.get('/settings', (_req: Request, res: Response) => {
  const data = SettingsService.getAll();
  res.json({ success: true, data });
});

apiRouter.get('/settings/summary', (_req: Request, res: Response) => {
  const summary = SettingsService.getSystemCountsSummary();
  res.json({ success: true, data: summary });
});

apiRouter.put('/settings', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    SettingsService.updateMany(req.body, req.user?.name);
    res.json({ success: true, data: SettingsService.getAll(), summary: SettingsService.getSystemCountsSummary() });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Invalid settings payload.' });
  }
});

// ==========================================
// 2. AUDIT LOGS
// ==========================================
apiRouter.get('/audit-logs', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const filter = {
    entity: req.query.entity as string | undefined,
    entityId: req.query.entityId as string | undefined,
    action: req.query.action as string | undefined,
    actor: req.query.actor as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    search: req.query.search as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : 50,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  };
  const result = AuditService.getLogsFiltered(filter);
  res.json({ success: true, data: result.data, total: result.total });
});

// ==========================================
// 3. FACULTY MANAGEMENT
// ==========================================
apiRouter.get('/faculty', (req: Request, res: Response) => {
  const filter = {
    department: req.query.department as string | undefined,
    active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
    search: req.query.search as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  };
  const result = FacultyService.list(filter);
  res.json({ success: true, data: result.data, total: result.total });
});

apiRouter.get('/faculty/leaves', (req: Request, res: Response) => {
  const facultyId = req.query.facultyId as string | undefined;
  const date = req.query.date as string | undefined;
  const leaves = FacultyService.getLeaves(facultyId, date);
  res.json({ success: true, data: leaves });
});

apiRouter.post('/faculty/leaves', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const leaveId = FacultyService.addLeave(req.body, req.user?.name);
  res.json({ success: true, id: leaveId });
});

apiRouter.delete('/faculty/leaves/:id', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const ok = FacultyService.deleteLeave(Number(p(req.params.id)), req.user?.name);
  res.json({ success: ok });
});

apiRouter.get('/faculty/:id', (req: Request, res: Response) => {
  const faculty = FacultyService.getById(p(req.params.id));
  if (!faculty) {
    res.status(404).json({ success: false, error: 'Faculty member not found' });
    return;
  }
  res.json({ success: true, data: faculty });
});

apiRouter.get('/faculty/:id/history', (req: Request, res: Response) => {
  const history = FacultyService.getDutyHistory(p(req.params.id));
  res.json({ success: true, data: history });
});

apiRouter.post('/faculty', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const created = FacultyService.create(req.body, req.user?.name);
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.put('/faculty/:id', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const updated = FacultyService.update(p(req.params.id), req.body, req.user?.name);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Faculty member not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/faculty/:id', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const id = p(req.params.id);
    const deletableCheck = FacultyService.checkDeletable(id);
    if (!deletableCheck.canDelete) {
      res.status(409).json({
        success: false,
        error: deletableCheck.message,
        canDeactivate: true,
      });
      return;
    }
    const ok = FacultyService.delete(id, req.user?.name);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.put('/faculty/:id/deactivate', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const faculty = FacultyService.deactivate(p(req.params.id), req.user?.name);
    res.json({ success: true, data: faculty });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. ROOM MANAGEMENT
// ==========================================
apiRouter.get('/rooms/diagnostics', (_req: Request, res: Response) => {
  try {
    const diag = RoomService.getRoomHierarchyDiagnostics();
    res.json({ success: true, data: diag });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/rooms/bulk-generate/preview', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const { block, floor, count, prefix } = req.body;
    if (!block || floor === undefined) {
      res.status(400).json({ success: false, error: 'Block and floor are required.' });
      return;
    }
    const preview = RoomService.bulkGeneratePreview({ block, floor, count, prefix });
    res.json({ success: true, data: preview });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.post('/rooms/bulk-generate/commit', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const { block, floor, rooms } = req.body;
    if (!block || floor === undefined || !Array.isArray(rooms)) {
      res.status(400).json({ success: false, error: 'Block, floor, and rooms array are required.' });
      return;
    }
    const result = RoomService.bulkGenerateCommit({ block, floor, rooms }, req.user?.name);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.get('/rooms', (req: Request, res: Response) => {
  const filter = {
    building: req.query.building as string | undefined,
    floor: req.query.floor ? Number(req.query.floor) : undefined,
    active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
    search: req.query.search as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  };
  const result = RoomService.list(filter);
  res.json({ success: true, data: result.data, total: result.total });
});

apiRouter.get('/rooms/:id', (req: Request, res: Response) => {
  const room = RoomService.getById(p(req.params.id));
  if (!room) {
    res.status(404).json({ success: false, error: 'Room not found' });
    return;
  }
  res.json({ success: true, data: room });
});

apiRouter.post('/rooms', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const created = RoomService.create(req.body, req.user?.name);
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.put('/rooms/:id', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const updated = RoomService.update(p(req.params.id), req.body, req.user?.name);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Room not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/rooms/:id', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const id = p(req.params.id);
    const deletableCheck = RoomService.checkDeletable(id);
    if (!deletableCheck.canDelete) {
      res.status(409).json({
        success: false,
        error: deletableCheck.message,
        canDeactivate: true,
      });
      return;
    }
    const ok = RoomService.delete(id, req.user?.name);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.put('/rooms/:id/deactivate', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const room = RoomService.deactivate(p(req.params.id), req.user?.name);
    res.json({ success: true, data: room });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 5. EXAMINATION MANAGEMENT
// ==========================================
apiRouter.get('/examinations', (_req: Request, res: Response) => {
  const exams = ExamService.list();
  res.json({ success: true, data: exams });
});

apiRouter.get('/examinations/:id', (req: Request, res: Response) => {
  const exam = ExamService.getById(p(req.params.id));
  if (!exam) {
    res.status(404).json({ success: false, error: 'Examination not found' });
    return;
  }
  res.json({ success: true, data: exam });
});

apiRouter.post('/examinations', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const created = ExamService.create(req.body, req.user?.name);
  res.status(201).json({ success: true, data: created });
});

apiRouter.put('/examinations/:id', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  try {
    const updated = ExamService.update(p(req.params.id), req.body, req.user?.name);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Examination not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.put('/examinations/:id/dates', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  ExamService.updateDates(p(req.params.id), req.body.dates, req.user?.name);
  res.json({ success: true, data: ExamService.getById(p(req.params.id)) });
});

apiRouter.put('/examinations/:id/status', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  ExamService.updateStatus(p(req.params.id), req.body.status, req.user?.name);
  res.json({ success: true });
});

apiRouter.get('/examinations/:id/timetable', (req: Request, res: Response) => {
  const timetable = TimetableService.getTimetable(p(req.params.id));
  res.json({ success: true, data: timetable });
});

apiRouter.delete('/examinations/:id/timetable', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  try {
    TimetableService.deleteTimetable(p(req.params.id), req.user?.name);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. SCHEDULING & ALLOTMENT ENGINE
// ==========================================

// Pre-flight capacity & diagnostics check
apiRouter.post('/allotment/preflight/:examId', (req: Request, res: Response) => {
  const exam = ExamService.getById(p(req.params.examId));
  if (!exam) {
    res.status(404).json({ success: false, error: 'Examination not found' });
    return;
  }

  const leaves = FacultyService.getLeaves();
  const expectedRoomCount = SettingsService.getExpectedRoomCount();
  const expectedFacultyCount = SettingsService.getExpectedFacultyCount();
  const timetableRecords = TimetableService.getTimetable(exam.id);
  const timetableSessions = timetableRecords.length > 0
    ? timetableRecords.map((t) => ({ date: t.examDate, session: t.session }))
    : undefined;

  const requireDualRole = req.body?.requireDualRole !== undefined
    ? Boolean(req.body.requireDualRole)
    : (exam.defaultStaffingPerRoom >= 2);

  const preflight = checkCapacityFeasibility(
    exam.dates || [],
    exam.sessionConfig,
    exam.rooms || [],
    exam.faculty || [],
    leaves,
    exam.maxDutiesPerFaculty,
    exam.restDays ?? 1,
    {
      expectedRoomCount,
      expectedFacultyCount,
      timetableSessions,
      timetableRecordsCount: timetableRecords.length,
      requireDualRole,
    }
  );

  res.json({ success: true, data: preflight });
});

// Generate Allotment
apiRouter.post('/allotment/generate/:examId', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const seed = req.body && typeof req.body.seed === 'number' ? req.body.seed : null;
  const requireDualRole = req.body && typeof req.body.requireDualRole === 'boolean'
    ? req.body.requireDualRole
    : undefined;
  const result = ScheduleService.generate(p(req.params.examId), req.user?.name, seed, { requireDualRole });
  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'Schedule generation failed due to constraint violations or capacity deficit.',
      diagnostics: result.failureDiagnostics,
      validation: result.validation,
      preflight: result.preflight,
    });
    return;
  }
  res.json({ success: true, data: result });
});

// Get latest schedule
apiRouter.get('/allotment/latest/:examId', (req: Request, res: Response) => {
  const sched = ScheduleService.getLatestSchedule(p(req.params.examId));
  if (!sched) {
    res.status(404).json({ success: false, error: 'No schedule found for this examination' });
    return;
  }
  res.json({ success: true, data: sched });
});

// List all schedule versions
apiRouter.get('/allotment/schedules/:examId', (req: Request, res: Response) => {
  const list = ScheduleService.listSchedules(p(req.params.examId));
  res.json({ success: true, data: list });
});

// Get schedule by ID
apiRouter.get('/allotment/schedule/:scheduleId', (req: Request, res: Response) => {
  const sched = ScheduleService.getScheduleDetails(p(req.params.scheduleId));
  if (!sched) {
    res.status(404).json({ success: false, error: 'Schedule not found' });
    return;
  }
  res.json({ success: true, data: sched });
});

// Validate draft schedule
apiRouter.post('/allotment/:scheduleId/validate', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  try {
    const result = ScheduleService.validateDraft(p(req.params.scheduleId), req.user?.name);
    if (!result.success) {
      res.status(400).json({ success: false, validation: result.validation, schedule: result.schedule });
      return;
    }
    res.json({ success: true, data: result.schedule, validation: result.validation });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Approve schedule
apiRouter.post('/allotment/:scheduleId/approve', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  try {
    const expectedCounter =
      req.body?.expectedCounter !== undefined && req.body?.expectedCounter !== null
        ? Number(req.body.expectedCounter)
        : undefined;
    const updated = ScheduleService.approve(p(req.params.scheduleId), req.user?.name, expectedCounter);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    const isConflict = err.message && err.message.toLowerCase().includes('concurrency conflict');
    res.status(isConflict ? 409 : 400).json({
      success: false,
      error: err.message,
      conflict: isConflict,
    });
  }
});

// Publish schedule
apiRouter.post('/allotment/:scheduleId/publish', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  try {
    const expectedCounter =
      req.body?.expectedCounter !== undefined && req.body?.expectedCounter !== null
        ? Number(req.body.expectedCounter)
        : undefined;
    const updated = ScheduleService.publish(p(req.params.scheduleId), req.user?.name, expectedCounter);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    const isConflict = err.message && err.message.toLowerCase().includes('concurrency conflict');
    res.status(isConflict ? 409 : 400).json({
      success: false,
      error: err.message,
      conflict: isConflict,
    });
  }
});

// Manual Reassignment with domain validator & revision support
apiRouter.post('/allotment/:scheduleId/reassign', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const { assignmentId, newFacultyId, reason, expectedCounter, roleTarget } = req.body;
  const parsedCounter =
    expectedCounter !== undefined && expectedCounter !== null ? Number(expectedCounter) : undefined;

  try {
    const result = ScheduleService.manualReassign(
      p(req.params.scheduleId),
      assignmentId,
      newFacultyId,
      reason,
      req.user?.name,
      parsedCounter,
      roleTarget === 'FRISKING' ? 'FRISKING' : 'INVIGILATOR'
    );
    if (!result.success) {
      const isConflict = result.error && result.error.toLowerCase().includes('concurrency conflict');
      res.status(isConflict ? 409 : 400).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    const isConflict = err.message && err.message.toLowerCase().includes('concurrency conflict');
    res.status(isConflict ? 409 : 400).json({
      success: false,
      error: err.message,
      conflict: isConflict,
    });
  }
});

// ==========================================
// 7. DAILY OPERATIONS & ATTENDANCE
// ==========================================
apiRouter.post('/operations/attendance', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const { assignmentId, status, notes } = req.body;
  const updated = OperationsService.markAttendance({
    assignmentId,
    status,
    notes,
    actor: req.user?.name,
  });
  res.json({ success: true, data: updated });
});

apiRouter.get('/operations/substitutes/:assignmentId', (req: Request, res: Response) => {
  const recs = OperationsService.recommendSubstitutes(p(req.params.assignmentId));
  res.json({ success: true, data: recs });
});

apiRouter.post('/operations/substitute', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const { assignmentId, substituteFacultyId, reason } = req.body;
  const result = OperationsService.approveSubstitution({
    assignmentId,
    substituteFacultyId,
    reason,
    actor: req.user?.name,
  });
  if (!result.success) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

// ==========================================
// 8. REPORTS & EXPORTS
// ==========================================
// Daily report JSON
apiRouter.get('/reports/daily/:examId/:date', (req: Request, res: Response) => {
  const isProvisional = req.query.provisional === 'true';
  const report = ReportService.generateDailyReport(
    p(req.params.examId),
    p(req.params.date),
    isProvisional,
    req.user?.name
  );
  res.json({ success: true, data: report });
});

// Daily report Excel
apiRouter.get('/reports/daily/:examId/:date/excel', async (req: Request, res: Response) => {
  const isProvisional = req.query.provisional === 'true';
  const report = ReportService.generateDailyReport(
    p(req.params.examId),
    p(req.params.date),
    isProvisional,
    req.user?.name
  );
  const buffer = await ExportService.generateDailyReportExcel(report);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Daily_Report_${p(req.params.examId)}_${p(req.params.date)}.xlsx"`
  );
  res.send(buffer);
});

// Daily report PDF
apiRouter.get('/reports/daily/:examId/:date/pdf', async (req: Request, res: Response) => {
  const isProvisional = req.query.provisional === 'true';
  const report = ReportService.generateDailyReport(
    p(req.params.examId),
    p(req.params.date),
    isProvisional,
    req.user?.name
  );
  const buffer = await ExportService.generateDailyReportPDF(report);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Daily_Report_${p(req.params.examId)}_${p(req.params.date)}.pdf"`
  );
  res.send(buffer);
});

// Final report JSON
apiRouter.get('/reports/final/:examId', (req: Request, res: Response) => {
  const report = ReportService.generateFinalReport(p(req.params.examId));
  res.json({ success: true, data: report });
});

// Final report Excel
apiRouter.get('/reports/final/:examId/excel', async (req: Request, res: Response) => {
  const report = ReportService.generateFinalReport(p(req.params.examId));
  const buffer = await ExportService.generateFinalReportExcel(report);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Final_Report_${p(req.params.examId)}.xlsx"`
  );
  res.send(buffer);
});

// Final report PDF
apiRouter.get('/reports/final/:examId/pdf', async (req: Request, res: Response) => {
  const report = ReportService.generateFinalReport(p(req.params.examId));
  const buffer = await ExportService.generateFinalReportPDF(report);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Final_Report_${p(req.params.examId)}.pdf"`
  );
  res.send(buffer);
});

// Historical daily reports
apiRouter.get('/reports/historical/:examId', (req: Request, res: Response) => {
  const list = ReportService.listHistoricalDailyReports(p(req.params.examId));
  res.json({ success: true, data: list });
});

// Post-Allotment Excel Template Export (Authoritative 6-column template: "excel file.xlsx")
apiRouter.get('/reports/allotment-excel/:scheduleId', async (req: Request, res: Response) => {
  const scheduleId = p(req.params.scheduleId);
  const date = req.query.date as string | undefined;
  const session = req.query.session as string | undefined;
  const reportingTime = req.query.reportingTime as string | undefined;

  const buffer = await ExportService.generatePostAllotmentExcel(scheduleId, {
    date,
    session,
    reportingTime,
  });

  const filenameDate = date ? `_${date}` : '';
  const filenameSession = session ? `_${session}` : '';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Allotment${filenameDate}${filenameSession}.xlsx"`
  );
  res.send(buffer);
});

// Print-Ready Examination Room Sheets (JSON)
apiRouter.get('/reports/room-sheets/:scheduleId', (req: Request, res: Response) => {
  const scheduleId = p(req.params.scheduleId);
  const date = req.query.date as string | undefined;
  const session = req.query.session as string | undefined;
  const roomId = req.query.roomId as string | undefined;

  const data = ReportService.getRoomSheetsData(scheduleId, { date, session, roomId });
  res.json({ success: true, data });
});

// Print-Ready Examination Room Sheets (PDF)
apiRouter.get('/reports/room-sheets/:scheduleId/pdf', async (req: Request, res: Response) => {
  const scheduleId = p(req.params.scheduleId);
  const date = req.query.date as string | undefined;
  const session = req.query.session as string | undefined;
  const roomId = req.query.roomId as string | undefined;

  const roomSheets = ReportService.getRoomSheetsData(scheduleId, { date, session, roomId });
  const buffer = await ExportService.generateRoomSheetsPDF(roomSheets);

  const filenameDate = date ? `_${date}` : '';
  const filenameSession = session ? `_${session}` : '';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Room_Sheets_${scheduleId}${filenameDate}${filenameSession}.pdf"`
  );
  res.send(buffer);
});

// ==========================================
// 9. CSV & EXCEL DATA IMPORT
// ==========================================
// Preview Faculty Import (CSV/XLSX)
apiRouter.post('/import/faculty/preview', async (req: Request, res: Response) => {
  const { fileBase64, fileType, allowUpdateExisting } = req.body;
  if (!fileBase64 || !fileType) {
    res.status(400).json({ success: false, error: 'Missing fileBase64 or fileType (csv|xlsx).' });
    return;
  }
  const buffer = Buffer.from(fileBase64, 'base64');
  const preview = await ImportService.previewFacultyImport(buffer, fileType, { allowUpdateExisting });
  res.json({ success: true, preview });
});

// Preview Faculty PDF Import
apiRouter.post('/import/faculty/pdf/preview', async (req: Request, res: Response) => {
  const { fileBase64, filename, allowUpdateExisting } = req.body;
  if (!fileBase64) {
    res.status(400).json({ success: false, error: 'Missing fileBase64 in request body.' });
    return;
  }
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const preview = await ImportService.previewFacultyPdfImport(
      buffer,
      filename || 'faculty_roster.pdf',
      { allowUpdateExisting }
    );
    res.json({ success: true, preview });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to parse faculty PDF.',
    });
  }
});

// Commit Faculty Import (CSV/XLSX)
apiRouter.post('/import/faculty/commit', requireRole(['ADMIN']), (req: Request, res: Response) => {
  const { rows, allowUpdateExisting } = req.body;
  if (!rows || !Array.isArray(rows)) {
    res.status(400).json({ success: false, error: 'Missing rows array to commit.' });
    return;
  }
  const result = ImportService.commitFacultyImport(rows, req.user?.name, allowUpdateExisting);
  res.json({ success: true, ...result });
});

// Commit Faculty PDF Import
apiRouter.post('/import/faculty/pdf/commit', requireRole(['ADMIN']), (req: Request, res: Response) => {
  const { records, allowUpdateExisting } = req.body;
  if (!records || !Array.isArray(records)) {
    res.status(400).json({ success: false, error: 'Missing records array to commit.' });
    return;
  }
  try {
    const result = ImportService.commitFacultyPdfImport(records, req.user?.name, allowUpdateExisting);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to commit faculty PDF import.',
    });
  }
});

// Preview Rooms Import
apiRouter.post('/import/rooms/preview', async (req: Request, res: Response) => {
  const { fileBase64, fileType, allowUpdateExisting } = req.body;
  if (!fileBase64 || !fileType) {
    res.status(400).json({ success: false, error: 'Missing fileBase64 or fileType (csv|xlsx).' });
    return;
  }
  const buffer = Buffer.from(fileBase64, 'base64');
  const preview = await ImportService.previewRoomImport(buffer, fileType, { allowUpdateExisting });
  res.json({ success: true, preview });
});

// Commit Rooms Import
apiRouter.post('/import/rooms/commit', requireRole(['ADMIN']), (req: Request, res: Response) => {
  const { rows, allowUpdateExisting } = req.body;
  if (!rows || !Array.isArray(rows)) {
    res.status(400).json({ success: false, error: 'Missing rows array to commit.' });
    return;
  }
  const result = ImportService.commitRoomImport(rows, req.user?.name, allowUpdateExisting);
  res.json({ success: true, ...result });
});

// ==========================================
// 10. TIMETABLE PDF IMPORT
// ==========================================
// Preview Timetable PDF Import (in-memory, zero writes)
apiRouter.post('/import/timetable/pdf/preview', async (req: Request, res: Response) => {
  const { fileBase64, filename, examinationId } = req.body;
  if (!fileBase64) {
    res.status(400).json({ success: false, error: 'Missing fileBase64 in request body.' });
    return;
  }
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const preview = await TimetableService.previewTimetablePdf(
      buffer,
      filename || 'exam_timetable.pdf',
      examinationId
    );
    res.json({ success: true, preview });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to parse timetable PDF.',
    });
  }
});

// Commit Timetable PDF Import (transactional persistence)
apiRouter.post('/import/timetable/pdf/commit', requireRole(['ADMIN', 'EXAM_OFFICER']), (req: Request, res: Response) => {
  const { examinationId, records } = req.body;
  if (!examinationId) {
    res.status(400).json({ success: false, error: 'Missing examinationId.' });
    return;
  }
  if (!records || !Array.isArray(records)) {
    res.status(400).json({ success: false, error: 'Missing records array to commit.' });
    return;
  }
  try {
    const result = TimetableService.commitTimetable(examinationId, records, req.user?.name);
    res.json({ ...result });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to commit timetable import.',
    });
  }
});

// ==========================================
// 11. DATA CLEANUP & RESET
// ==========================================
apiRouter.get('/cleanup/preview', requireRole(['ADMIN']), (_req: Request, res: Response) => {
  try {
    const preview = CleanupService.getDeletionPreview();
    res.json({ success: true, data: preview });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/cleanup/execute', requireRole(['ADMIN']), (req: Request, res: Response) => {
  try {
    const result = CleanupService.executeSafeCleanup(req.user?.name);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.post('/cleanup/reset', requireRole(['ADMIN']), (req: Request, res: Response) => {
  const { confirmation } = req.body;
  if (confirmation !== 'RESET_DATABASE_CONFIRMED') {
    res.status(400).json({
      success: false,
      error: 'Explicit confirmation string "RESET_DATABASE_CONFIRMED" is required to reset database.',
    });
    return;
  }
  try {
    const result = CleanupService.resetDatabaseToCleanInstitutional(confirmation, req.user?.name);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


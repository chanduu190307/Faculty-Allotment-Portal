const API_BASE = '/api';

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    'x-user-role': 'ADMIN',
    'x-user-name': 'Examination Officer',
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorMsg = data?.error || data?.message || `Request failed with status ${response.status}`;
    const err = new Error(errorMsg) as any;
    err.status = response.status;
    err.conflict = data?.conflict || response.status === 409;
    err.diagnostics = data?.diagnostics;
    err.validation = data?.validation;
    err.preflight = data?.preflight;
    err.violations = data?.violations;
    throw err;
  }

  return data;
}

export const api = {
  // Settings
  getSettings: () => request<{ success: boolean; data: Record<string, string> }>('/settings'),
  getSettingsSummary: () =>
    request<{
      success: boolean;
      data: {
        expectedRooms: number;
        registeredRoomsTotal: number;
        registeredRoomsActive: number;
        roomsMismatch: boolean;
        expectedFaculty: number;
        registeredFacultyTotal: number;
        registeredFacultyActive: number;
        registeredFacultyExempt: number;
        registeredFacultyUnavailable: number;
        eligibleFacultyCount: number;
        facultyMismatch: boolean;
        defaultMaxDuties: number;
        sessionsPerDay: number;
        institutionName: string;
      };
    }>('/settings/summary'),
  updateSettings: (settings: Record<string, string>) =>
    request<{ success: boolean; data: Record<string, string>; summary?: any }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  // Audit Logs
  getAuditLogs: (entity?: string) =>
    request<{ success: boolean; data: any[] }>(entity ? `/audit-logs?entity=${entity}` : '/audit-logs'),

  // Faculty
  getFaculty: (params: { search?: string; department?: string; active?: boolean; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.department) q.set('department', params.department);
    if (params.active !== undefined) q.set('active', String(params.active));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    return request<{ success: boolean; data: any[]; total: number }>(`/faculty?${q.toString()}`);
  },
  getFacultyById: (id: string) => request<{ success: boolean; data: any }>(`/faculty/${id}`),
  getFacultyHistory: (id: string) => request<{ success: boolean; data: any }>(`/faculty/${id}/history`),
  createFaculty: (faculty: any) =>
    request<{ success: boolean; data: any }>('/faculty', {
      method: 'POST',
      body: JSON.stringify(faculty),
    }),
  updateFaculty: (id: string, faculty: any) =>
    request<{ success: boolean; data: any }>(`/faculty/${id}`, {
      method: 'PUT',
      body: JSON.stringify(faculty),
    }),
  deleteFaculty: (id: string) =>
    request<{ success: boolean }>(`/faculty/${id}`, {
      method: 'DELETE',
    }),
  deactivateFaculty: (id: string) =>
    request<{ success: boolean; data: any }>(`/faculty/${id}/deactivate`, {
      method: 'PUT',
    }),

  // Faculty Leaves
  getLeaves: (facultyId?: string, date?: string) => {
    const q = new URLSearchParams();
    if (facultyId) q.set('facultyId', facultyId);
    if (date) q.set('date', date);
    return request<{ success: boolean; data: any[] }>(`/faculty/leaves?${q.toString()}`);
  },
  addLeave: (leave: any) =>
    request<{ success: boolean; id: number }>('/faculty/leaves', {
      method: 'POST',
      body: JSON.stringify(leave),
    }),
  deleteLeave: (id: number) =>
    request<{ success: boolean }>(`/faculty/leaves/${id}`, {
      method: 'DELETE',
    }),

  // Rooms
  getRooms: (params: { search?: string; building?: string; floor?: number; active?: boolean; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.building) q.set('building', params.building);
    if (params.floor !== undefined) q.set('floor', String(params.floor));
    if (params.active !== undefined) q.set('active', String(params.active));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    return request<{ success: boolean; data: any[]; total: number }>(`/rooms?${q.toString()}`);
  },
  getRoomById: (id: string) => request<{ success: boolean; data: any }>(`/rooms/${id}`),
  createRoom: (room: any) =>
    request<{ success: boolean; data: any }>('/rooms', {
      method: 'POST',
      body: JSON.stringify(room),
    }),
  updateRoom: (id: string, room: any) =>
    request<{ success: boolean; data: any }>(`/rooms/${id}`, {
      method: 'PUT',
      body: JSON.stringify(room),
    }),
  deleteRoom: (id: string) =>
    request<{ success: boolean }>(`/rooms/${id}`, {
      method: 'DELETE',
    }),
  deactivateRoom: (id: string) =>
    request<{ success: boolean; data: any }>(`/rooms/${id}/deactivate`, {
      method: 'PUT',
    }),
  getRoomDiagnostics: () =>
    request<{ success: boolean; data: any }>('/rooms/diagnostics'),
  bulkGenerateRoomsPreview: (payload: { block: string; floor: number; count?: number; prefix?: string }) =>
    request<{ success: boolean; data: any }>('/rooms/bulk-generate/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  bulkGenerateRoomsCommit: (payload: { block: string; floor: number; rooms: any[] }) =>
    request<{ success: boolean; data: any }>('/rooms/bulk-generate/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Examinations
  getExaminations: () => request<{ success: boolean; data: any[] }>('/examinations'),
  getExaminationById: (id: string) => request<{ success: boolean; data: any }>(`/examinations/${id}`),
  createExamination: (exam: any) =>
    request<{ success: boolean; data: any }>('/examinations', {
      method: 'POST',
      body: JSON.stringify(exam),
    }),
  updateExamination: (id: string, exam: any) =>
    request<{ success: boolean; data: any }>(`/examinations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(exam),
    }),
  updateExamDates: (id: string, dates: any[]) =>
    request<{ success: boolean; data: any }>(`/examinations/${id}/dates`, {
      method: 'PUT',
      body: JSON.stringify({ dates }),
    }),
  updateExamStatus: (id: string, status: string) =>
    request<{ success: boolean }>(`/examinations/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Scheduling & Allotment
  getPreflight: (examId: string, requireDualRole?: boolean) =>
    request<{ success: boolean; data: any }>(`/allotment/preflight/${examId}`, {
      method: 'POST',
      body: JSON.stringify({ requireDualRole }),
    }),
  generateAllotment: (examId: string, seed?: number | null, requireDualRole?: boolean) =>
    request<{ success: boolean; data: any }>(`/allotment/generate/${examId}`, {
      method: 'POST',
      body: JSON.stringify({ seed, requireDualRole }),
    }),
  getLatestSchedule: (examId: string) =>
    request<{ success: boolean; data: any }>(`/allotment/latest/${examId}`),
  getScheduleById: (scheduleId: string) =>
    request<{ success: boolean; data: any }>(`/allotment/schedule/${scheduleId}`),
  listSchedules: (examId: string) =>
    request<{ success: boolean; data: any[] }>(`/allotment/schedules/${examId}`),
  validateDraftSchedule: (scheduleId: string) =>
    request<{ success: boolean; data: any; validation: any }>(`/allotment/${scheduleId}/validate`, {
      method: 'POST',
    }),
  approveSchedule: (scheduleId: string, expectedCounter?: number) =>
    request<{ success: boolean; data: any }>(`/allotment/${scheduleId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ expectedCounter }),
    }),
  publishSchedule: (scheduleId: string, expectedCounter?: number) =>
    request<{ success: boolean; data: any }>(`/allotment/${scheduleId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ expectedCounter }),
    }),
  manualReassign: (
    scheduleId: string,
    payload: {
      assignmentId: string;
      newFacultyId: string;
      reason: string;
      expectedCounter?: number;
      roleTarget?: 'INVIGILATOR' | 'FRISKING';
    }
  ) =>
    request<{ success: boolean; isRevision?: boolean; revisionScheduleId?: string; newCounter?: number }>(
      `/allotment/${scheduleId}/reassign`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Daily Operations
  markAttendance: (payload: { assignmentId: string; status: 'COMPLETED' | 'ABSENT'; notes?: string }) =>
    request<{ success: boolean; data: any }>('/operations/attendance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getSubstituteRecommendations: (assignmentId: string) =>
    request<{ success: boolean; data: any[] }>(`/operations/substitutes/${assignmentId}`),
  approveSubstitution: (payload: { assignmentId: string; substituteFacultyId: string; reason: string }) =>
    request<{ success: boolean }>('/operations/substitute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Reports
  getDailyReport: (examId: string, date: string, provisional = false) =>
    request<{ success: boolean; data: any }>(`/reports/daily/${examId}/${date}?provisional=${provisional}`),
  getFinalReport: (examId: string) =>
    request<{ success: boolean; data: any }>(`/reports/final/${examId}`),
  getHistoricalReports: (examId: string) =>
    request<{ success: boolean; data: any[] }>(`/reports/historical/${examId}`),
  getRoomSheets: (scheduleId: string, params: { date?: string; session?: string; roomId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.date) q.set('date', params.date);
    if (params.session) q.set('session', params.session);
    if (params.roomId) q.set('roomId', params.roomId);
    return request<{ success: boolean; data: any[] }>(`/reports/room-sheets/${scheduleId}?${q.toString()}`);
  },

  // Audit Logs
  getFilteredAuditLogs: (params: {
    entity?: string;
    entityId?: string;
    action?: string;
    actor?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const q = new URLSearchParams();
    if (params.entity) q.set('entity', params.entity);
    if (params.entityId) q.set('entityId', params.entityId);
    if (params.action) q.set('action', params.action);
    if (params.actor) q.set('actor', params.actor);
    if (params.startDate) q.set('startDate', params.startDate);
    if (params.endDate) q.set('endDate', params.endDate);
    if (params.search) q.set('search', params.search);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    return request<{ success: boolean; data: any[]; total: number }>(`/audit-logs?${q.toString()}`);
  },

  // Import Services
  previewFacultyImport: (payload: { fileBase64: string; fileType: 'csv' | 'xlsx'; allowUpdateExisting?: boolean }) =>
    request<{ success: boolean; preview: any }>('/import/faculty/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  previewFacultyPdfImport: (payload: { fileBase64: string; filename?: string; allowUpdateExisting?: boolean }) =>
    request<{ success: boolean; preview: any }>('/import/faculty/pdf/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  commitFacultyImport: (payload: { rows: any[]; allowUpdateExisting?: boolean }) =>
    request<{ success: boolean; imported: number; updated: number }>('/import/faculty/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  commitFacultyPdfImport: (payload: { records: any[]; allowUpdateExisting?: boolean }) =>
    request<{ success: boolean; imported: number; updated: number; skipped: number; failed: number }>(
      '/import/faculty/pdf/commit',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  previewRoomImport: (payload: { fileBase64: string; fileType: 'csv' | 'xlsx'; allowUpdateExisting?: boolean }) =>
    request<{ success: boolean; preview: any }>('/import/rooms/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  commitRoomImport: (payload: { rows: any[]; allowUpdateExisting?: boolean }) =>
    request<{ success: boolean; imported: number; updated: number }>('/import/rooms/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Timetable PDF Import Services
  previewTimetablePdfImport: (payload: { fileBase64: string; filename?: string; examinationId: string }) =>
    request<{ success: boolean; preview: any }>('/import/timetable/pdf/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  commitTimetablePdfImport: (payload: { examinationId: string; records: any[] }) =>
    request<{
      success: boolean;
      imported: number;
      updated: number;
      skipped: number;
      rejected: number;
      distinctDates: string[];
      distinctSessions: string[];
    }>('/import/timetable/pdf/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getExamTimetable: (examinationId: string) =>
    request<{ success: boolean; data: any[]; count: number }>(`/examinations/${examinationId}/timetable`),
  deleteExamTimetable: (examinationId: string) =>
    request<{ success: boolean; message: string }>(`/examinations/${examinationId}/timetable`, {
      method: 'DELETE',
    }),

  // Cleanup & Reset Services
  getCleanupPreview: () =>
    request<{ success: boolean; data: any }>('/cleanup/preview'),
  executeCleanup: () =>
    request<{ success: boolean; data: any }>('/cleanup/execute', {
      method: 'POST',
    }),
  resetDatabase: (confirmation: string) =>
    request<{ success: boolean; data: any }>('/cleanup/reset', {
      method: 'POST',
      body: JSON.stringify({ confirmation }),
    }),
};

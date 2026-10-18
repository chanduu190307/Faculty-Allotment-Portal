export interface ExamDate {
  date: string; // YYYY-MM-DD
  sequenceOrder: number;
  isExamDay: boolean;
}

export interface ExamSession {
  name: string; // e.g. "Morning", "Afternoon"
  startTime: string; // e.g. "09:30"
  endTime: string; // e.g. "12:30"
}

export interface Room {
  id: string;
  name: string;
  building: string;
  floor: number;
  capacity?: number;
  examDepartment?: string | null;
  requiredStaffing?: number;
  active?: boolean;
}

export interface Faculty {
  id: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  active: boolean;
  exempt?: boolean;
  maxDutyOverride?: number | null;
}

export interface FacultyLeave {
  id?: number;
  facultyId: string;
  date: string;
  sessionScope: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
  reason: string;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface Assignment {
  id: string;
  scheduleId?: string;
  date: string;
  session: string;
  roomId: string;
  facultyId: string;
  facultyName?: string;
  department?: string;
  friskingFacultyId?: string | null;
  friskingFacultyName?: string | null;
  friskingDepartment?: string | null;
  role?: string; // 'INVIGILATOR', 'FRISKING', or 'DUAL'
  status: 'SCHEDULED' | 'COMPLETED' | 'ABSENT' | 'CANCELLED' | 'SUBSTITUTED';
  markedAt?: string;
  markedBy?: string;
  notes?: string;
}

export type FacultyAccountingStatus =
  | 'ASSIGNED'
  | 'EXCLUDED_DAILY_SESSION'
  | 'UNAVAILABLE_LEAVE'
  | 'MAX_CAPACITY_REACHED'
  | 'EXCLUDED_CONSECUTIVE_DAY'
  | 'EXCLUDED_ROOM_HISTORY'
  | 'RESERVED_SUBSTITUTE'
  | 'AVAILABLE_UNASSIGNED'
  | 'EXEMPT'
  | 'EXCLUDED_DEPARTMENT';

export interface FacultyAccountingRecord {
  facultyId: string;
  facultyName: string;
  department: string;
  status: FacultyAccountingStatus;
  reason: string;
}

export interface SessionAccounting {
  date: string;
  session: string;
  breakdown: Record<FacultyAccountingStatus, number>;
  facultyDetails: FacultyAccountingRecord[];
}

export interface WorkloadStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  variance: number;
  stdDev: number;
  distribution: Record<number, number>; // dutyCount -> numberOfFaculty
}

export interface PreflightCheckResult {
  isFeasible: boolean;
  totalRequiredSlots: number;
  totalPossibleCapacity: number;
  deficit: number;
  consecutiveExamDaysCount: number;
  maxWorkingDaysPerTeacher: number;
  reasons: string[];
  remedies: string[];
  warnings?: string[];
  dailyShortfalls?: Array<{
    date: string;
    required: number;
    available: number;
    shortfall: number;
  }>;
  pairShortfalls?: Array<{
    date1: string;
    date2: string;
    required: number;
    available: number;
    shortfall: number;
  }>;
  diagnosticDetails: {
    roomCount: number;
    facultyCount: number;
    examDatesCount: number;
    sessionsPerDay: number;
    defaultMaxDuties: number;
    effectiveMaxDutiesPerTeacher: number;
    theoreticalMaxCapacity: number;
    expectedRoomCount?: number;
    registeredRoomsTotal?: number;
    registeredRoomsActive?: number;
    roomsMismatch?: boolean;
    expectedFacultyCount?: number;
    registeredFacultyTotal?: number;
    registeredFacultyActive?: number;
    registeredFacultyExempt?: number;
    registeredFacultyUnavailable?: number;
    eligibleFacultyCount?: number;
    facultyMismatch?: boolean;
    timetableRecordsCount?: number;
    timetableSessionsCount?: number;
    timetableConfirmed?: boolean;
    requireDualRole?: boolean;
  };
}

export type ValidationRule =
  | 'RULE_A' // Complete room coverage
  | 'RULE_B' // No repeated teacher across daily sessions
  | 'RULE_C' // No consecutive examination-day duties
  | 'RULE_D' // Room rotation (no same room on consecutive exam days)
  | 'RULE_F' // Maximum duty limit
  | 'ELIGIBILITY' // Inactive, on approved leave, exempt, or own-department
  | 'DUPLICATE'; // Duplicate assignment in same room & session

export interface ValidationViolation {
  rule: ValidationRule;
  message: string;
  date?: string;
  session?: string;
  roomId?: string;
  facultyId?: string;
}

export interface ScheduleValidationResult {
  isValid: boolean;
  violations: ValidationViolation[];
  coveragePercentage: number;
  totalRequiredSlots: number;
  totalAssignedSlots: number;
}

export interface SchedulingInput {
  examinationId: string;
  dates: ExamDate[];
  sessions: ExamSession[];
  rooms: Room[];
  faculty: Faculty[];
  leaves: FacultyLeave[];
  defaultMaxDuties: number;
  restDays?: number;
  seed?: number | null;
  existingDuties?: Record<string, number>;
  pastRoomHistory?: Record<string, Record<string, string>>; // facultyId -> date -> roomId
  timetableSessions?: Array<{ date: string; session: string }>; // Optional confirmed timetable date-session pairs
  requireDualRole?: boolean;
}

export interface ScheduleRecord {
  id: string;
  examinationId: string;
  version: number;
  revisionNumber?: number;
  baseScheduleId?: string | null;
  state: 'DRAFT' | 'VALIDATED' | 'APPROVED' | 'PUBLISHED' | 'REVISED' | 'ARCHIVED' | 'CANCELLED';
  seed?: number | null;
  counter: number;
  validationResult?: any;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  publishedAt?: string;
  archivedAt?: string;
  notes?: string;
  assignments?: Assignment[];
}

export interface ScheduleGenerationResult {
  success: boolean;
  isInconclusive?: boolean;
  scheduleId?: string;
  state?: string;
  version?: number;
  revisionNumber?: number;
  baseScheduleId?: string | null;
  seed?: number | null;
  counter?: number;
  assignments: Assignment[];
  preflight: PreflightCheckResult;
  validation: ScheduleValidationResult;
  workloadStats?: WorkloadStats;
  sessionAccountings?: SessionAccounting[];
  failureDiagnostics?: {
    provenInfeasible: boolean;
    isInconclusive?: boolean;
    reason: string;
    details: string[];
    remedies?: string[];
    bottleneck?: {
      date: string;
      session: string;
      required: number;
      available: number;
    };
  };
}

import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { SettingsService } from '../../src/services/settings.service';
import { checkCapacityFeasibility } from '../../src/domain/scheduling/capacity';
import { ExamDate, ExamSession, Room, Faculty, FacultyLeave } from '../../src/domain/scheduling/types';

describe('Feature A: Editable Room and Teacher Counts & Capacity Diagnostics', () => {
  let db: any;

  beforeEach(() => {
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db, { roomCount: 20, facultyCount: 50, maxDuties: 6 });
  });

  it('allows updating expected room and faculty counts and persists changes after reload', () => {
    // 1. Initial values from seed
    expect(SettingsService.getExpectedRoomCount()).toBe(20);
    expect(SettingsService.getExpectedFacultyCount()).toBe(50);
    expect(SettingsService.getDefaultMaxDuties()).toBe(6);

    // 2. Update expected counts
    SettingsService.updateMany({
      default_room_count: '200',
      default_faculty_count: '500',
      default_max_duties: '8',
    });

    // 3. Verify updated in service
    expect(SettingsService.getExpectedRoomCount()).toBe(200);
    expect(SettingsService.getExpectedFacultyCount()).toBe(500);
    expect(SettingsService.getDefaultMaxDuties()).toBe(8);

    // 4. Verify persisted in SQLite settings table directly
    const roomRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('default_room_count') as any;
    expect(roomRow.value).toBe('200');

    const facultyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('default_faculty_count') as any;
    expect(facultyRow.value).toBe('500');

    // 5. Audit log recorded
    const auditLog = db.prepare("SELECT * FROM audit_logs WHERE entity = 'settings' ORDER BY id DESC LIMIT 1").get() as any;
    expect(auditLog).toBeDefined();
    expect(auditLog.action).toBe('UPDATE');
  });

  it('changing expected counts does NOT create, delete, or mutate actual room or faculty records', () => {
    // 1. Record baseline database record counts
    const initialRoomCount = (db.prepare('SELECT COUNT(*) as count FROM rooms').get() as any).count;
    const initialFacultyCount = (db.prepare('SELECT COUNT(*) as count FROM faculty').get() as any).count;
    expect(initialRoomCount).toBe(20);
    expect(initialFacultyCount).toBe(50);

    // 2. Change expected room count from 20 to 200, faculty from 50 to 520
    SettingsService.updateMany({
      default_room_count: '200',
      default_faculty_count: '520',
    });

    // 3. Verify actual records in database remain EXACTLY the same
    const postRoomCount = (db.prepare('SELECT COUNT(*) as count FROM rooms').get() as any).count;
    const postFacultyCount = (db.prepare('SELECT COUNT(*) as count FROM faculty').get() as any).count;

    expect(postRoomCount).toBe(initialRoomCount);
    expect(postFacultyCount).toBe(initialFacultyCount);

    // 4. Verify no new dummy IDs were invented
    const roomInvented = db.prepare("SELECT * FROM rooms WHERE id = 'RM-200'").get();
    expect(roomInvented).toBeUndefined();
    const facultyInvented = db.prepare("SELECT * FROM faculty WHERE id = 'FAC-520'").get();
    expect(facultyInvented).toBeUndefined();
  });

  it('strictly validates and rejects empty, malformed, negative, or excessive count values', () => {
    // Negative room count
    expect(() => {
      SettingsService.set('default_room_count', '-10');
    }).toThrow(/Invalid expected room count/i);

    // Zero room count
    expect(() => {
      SettingsService.set('default_room_count', '0');
    }).toThrow(/Invalid expected room count/i);

    // Float room count
    expect(() => {
      SettingsService.set('default_room_count', '25.5');
    }).toThrow(/Invalid expected room count/i);

    // Non-numeric string
    expect(() => {
      SettingsService.set('default_room_count', 'two-hundred');
    }).toThrow(/Invalid expected room count/i);

    // Empty string
    expect(() => {
      SettingsService.set('default_room_count', '');
    }).toThrow(/Invalid expected room count/i);

    // Excessive room count (> 2000)
    expect(() => {
      SettingsService.set('default_room_count', '5000');
    }).toThrow(/between 1 and 2000/i);

    // Negative faculty count
    expect(() => {
      SettingsService.set('default_faculty_count', '-50');
    }).toThrow(/Invalid expected faculty count/i);

    // Excessive faculty count (> 10000)
    expect(() => {
      SettingsService.set('default_faculty_count', '15000');
    }).toThrow(/between 1 and 10000/i);

    // Invalid max duties limit
    expect(() => {
      SettingsService.set('default_max_duties', '0');
    }).toThrow(/Invalid maximum duties limit/i);
    expect(() => {
      SettingsService.set('default_max_duties', '100');
    }).toThrow(/between 1 and 50/i);

    // Invalid sessions per day
    expect(() => {
      SettingsService.set('sessions_per_day', '10');
    }).toThrow(/between 1 and 6/i);
  });

  it('accurately detects and reports mismatch between expected counts and registered database records', () => {
    // Set expected room count to 200 and expected faculty to 500 (seeded has 20 rooms, 50 faculty)
    SettingsService.updateMany({
      default_room_count: '200',
      default_faculty_count: '500',
    });

    const summary = SettingsService.getSystemCountsSummary();
    expect(summary.expectedRooms).toBe(200);
    expect(summary.registeredRoomsTotal).toBe(20);
    expect(summary.registeredRoomsActive).toBe(20);
    expect(summary.roomsMismatch).toBe(true);

    expect(summary.expectedFaculty).toBe(500);
    expect(summary.registeredFacultyTotal).toBe(50);
    expect(summary.registeredFacultyActive).toBe(50);
    expect(summary.facultyMismatch).toBe(true);

    // Now update configuration to match registered counts
    SettingsService.updateMany({
      default_room_count: '20',
      default_faculty_count: '50',
    });

    const alignedSummary = SettingsService.getSystemCountsSummary();
    expect(alignedSummary.roomsMismatch).toBe(false);
    expect(alignedSummary.facultyMismatch).toBe(false);
  });

  it('integrates expected-vs-registered counts and mismatch warnings into preflight capacity analysis', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 2, isExamDay: true },
    ];
    const sessions: ExamSession[] = [
      { name: 'Morning', startTime: '09:30', endTime: '12:30' },
      { name: 'Afternoon', startTime: '14:00', endTime: '17:00' },
    ];

    const rawRooms = db.prepare('SELECT id, name, building, floor, capacity, active FROM rooms').all() as Room[];
    const rawFaculty = db.prepare('SELECT id, name, email, department, designation, active, exempt FROM faculty').all() as Faculty[];
    const leaves: FacultyLeave[] = [];

    // Preflight with expected 200 rooms and 500 teachers, but only 20 rooms and 50 teachers registered
    const preflight = checkCapacityFeasibility(
      dates,
      sessions,
      rawRooms,
      rawFaculty,
      leaves,
      6,
      1,
      { expectedRoomCount: 200, expectedFacultyCount: 500 }
    );

    // Diagnostic details check
    expect(preflight.diagnosticDetails.expectedRoomCount).toBe(200);
    expect(preflight.diagnosticDetails.registeredRoomsActive).toBe(20);
    expect(preflight.diagnosticDetails.roomsMismatch).toBe(true);

    expect(preflight.diagnosticDetails.expectedFacultyCount).toBe(500);
    expect(preflight.diagnosticDetails.registeredFacultyActive).toBe(50);
    expect(preflight.diagnosticDetails.facultyMismatch).toBe(true);

    // Mismatch warnings generated
    expect(preflight.warnings).toBeDefined();
    expect(preflight.warnings?.some((w) => w.includes('Room Count Mismatch'))).toBe(true);
    expect(preflight.warnings?.some((w) => w.includes('Faculty Count Mismatch'))).toBe(true);

    // Critical assertion: Schedule capacity is calculated from registered faculty (50), NOT expected (500)
    // 2 dates with rest_days = 1 => maxWorkingDays = 1
    // 50 eligible faculty * 1 max working day = 50 total possible capacity
    expect(preflight.diagnosticDetails.theoreticalMaxCapacity).toBe(50);
    expect(preflight.totalPossibleCapacity).toBe(50);
  });
});

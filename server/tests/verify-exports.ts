import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { getDatabase } from '../src/db/connection';
import { runMigrations } from '../src/db/schema';
import { seedDatabase } from '../src/db/seed';
import { ExamService } from '../src/services/exam.service';
import { ScheduleService } from '../src/services/schedule.service';
import { OperationsService } from '../src/services/operations.service';
import { ReportService } from '../src/services/report.service';
import { ExportService } from '../src/services/export.service';

async function verifyExports() {
  console.log('[Export Audit] Initializing database and generating test schedule...');
  const db = getDatabase(':memory:');
  runMigrations(db);
  seedDatabase(db, { roomCount: 8, facultyCount: 50, maxDuties: 4 });

  const exam = ExamService.create({
    id: 'EXAM-EXPORT-AUDIT',
    name: 'Export Verification Term Autumn 2026',
    academicYear: '2026-2027',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    dates: [
      { date: '2026-11-10', sequenceOrder: 1, isExamDay: true },
      { date: '2026-11-12', sequenceOrder: 2, isExamDay: true },
    ],
  });

  const schedResult = ScheduleService.generate(exam.id, 'Auditor');
  if (!schedResult.success) {
    throw new Error('Schedule generation failed in export audit');
  }

  // Mark attendance on one assignment
  const firstAsgn = schedResult.assignments[0];
  OperationsService.markAttendance({
    assignmentId: firstAsgn.id,
    status: 'COMPLETED',
    notes: 'Auditor checked present',
  });

  const scratchDir = path.resolve(__dirname, '..', 'scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  // 1. Daily Report Excel
  console.log('[Export Audit] Generating Daily Report Excel...');
  const dailyReport = ReportService.generateDailyReport(exam.id, '2026-11-10', false, 'Auditor');
  const dailyExcelBuf = await ExportService.generateDailyReportExcel(dailyReport);
  const dailyExcelPath = path.join(scratchDir, 'Daily_Report_Audit.xlsx');
  fs.writeFileSync(dailyExcelPath, dailyExcelBuf);
  console.log(` -> Wrote ${dailyExcelPath} (${dailyExcelBuf.length} bytes)`);

  const dailyWb = new ExcelJS.Workbook();
  await dailyWb.xlsx.readFile(dailyExcelPath);
  if (dailyWb.creator !== 'Faculty Allotment System') {
    throw new Error(`Expected workbook creator "Faculty Allotment System", got "${dailyWb.creator}"`);
  }
  const dailySheet = dailyWb.getWorksheet('Daily Allotment Report');
  if (!dailySheet) throw new Error('Missing worksheet "Daily Allotment Report"');
  console.log(` -> Verified Daily Excel: Creator "${dailyWb.creator}", Sheet "${dailySheet.name}", row count: ${dailySheet.rowCount}`);

  // 2. Daily Report PDF
  console.log('[Export Audit] Generating Daily Report PDF...');
  const dailyPdfBuf = await ExportService.generateDailyReportPDF(dailyReport);
  const dailyPdfPath = path.join(scratchDir, 'Daily_Report_Audit.pdf');
  fs.writeFileSync(dailyPdfPath, dailyPdfBuf);
  console.log(` -> Wrote ${dailyPdfPath} (${dailyPdfBuf.length} bytes)`);

  // Verify PDF header bytes
  const pdfHeader = dailyPdfBuf.subarray(0, 5).toString('ascii');
  if (pdfHeader !== '%PDF-') throw new Error(`Invalid PDF header: ${pdfHeader}`);
  console.log(` -> Verified Daily PDF: Valid magic header "%PDF-"`);

  // 3. Final Report Excel
  console.log('[Export Audit] Generating Final Report Excel...');
  const finalReport = ReportService.generateFinalReport(exam.id);
  const finalExcelBuf = await ExportService.generateFinalReportExcel(finalReport);
  const finalExcelPath = path.join(scratchDir, 'Final_Report_Audit.xlsx');
  fs.writeFileSync(finalExcelPath, finalExcelBuf);
  console.log(` -> Wrote ${finalExcelPath} (${finalExcelBuf.length} bytes)`);

  const finalWb = new ExcelJS.Workbook();
  await finalWb.xlsx.readFile(finalExcelPath);
  if (finalWb.creator !== 'Faculty Allotment System') {
    throw new Error(`Expected final workbook creator "Faculty Allotment System", got "${finalWb.creator}"`);
  }
  const summarySheet = finalWb.getWorksheet('Executive Summary');
  const ledgerSheet = finalWb.getWorksheet('Faculty Duty Ledger');
  if (!summarySheet || !ledgerSheet) throw new Error('Missing final report worksheets');
  console.log(` -> Verified Final Excel: Creator "${finalWb.creator}", Worksheets ["${summarySheet.name}", "${ledgerSheet.name}"], ledger rows: ${ledgerSheet.rowCount}`);

  // 4. Final Report PDF
  console.log('[Export Audit] Generating Final Report PDF...');
  const finalPdfBuf = await ExportService.generateFinalReportPDF(finalReport);
  const finalPdfPath = path.join(scratchDir, 'Final_Report_Audit.pdf');
  fs.writeFileSync(finalPdfPath, finalPdfBuf);
  console.log(` -> Wrote ${finalPdfPath} (${finalPdfBuf.length} bytes)`);
  const finalPdfHeader = finalPdfBuf.subarray(0, 5).toString('ascii');
  if (finalPdfHeader !== '%PDF-') throw new Error(`Invalid Final PDF header: ${finalPdfHeader}`);
  console.log(` -> Verified Final PDF: Valid magic header "%PDF-"`);

  console.log('[Export Audit PASSED] All 4 report files successfully generated, structured, and verified!');
}

verifyExports().catch((err) => {
  console.error('[Export Audit Failed]:', err);
  process.exit(1);
});

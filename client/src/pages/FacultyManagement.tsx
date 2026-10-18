import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import {
  Search,
  Plus,
  CalendarOff,
  History,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  Upload,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Eye,
} from 'lucide-react';

export const FacultyManagement: React.FC = () => {
  const [faculty, setFaculty] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingFaculty, setEditingFaculty] = useState<any>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedFacultyForView, setSelectedFacultyForView] = useState<any>(null);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [selectedFacultyForLeave, setSelectedFacultyForLeave] = useState<any>(null);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [newLeaveDate, setNewLeaveDate] = useState('');
  const [newLeaveScope, setNewLeaveScope] = useState('FULL_DAY');
  const [newLeaveReason, setNewLeaveReason] = useState('');

  // Duty history modal
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [dutyHistory, setDutyHistory] = useState<any>(null);
  const [selectedFacultyForHistory, setSelectedFacultyForHistory] = useState<any>(null);

  // CSV/Excel Import states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [allowUpdateExisting, setAllowUpdateExisting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // PDF Import states
  const [isPdfImportModalOpen, setIsPdfImportModalOpen] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreview, setPdfPreview] = useState<any>(null);
  const [pdfAllowUpdateExisting, setPdfAllowUpdateExisting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfSuccess, setPdfSuccess] = useState<string | null>(null);
  const [pdfSearchQuery, setPdfSearchQuery] = useState('');
  const [pdfFilterUncertainOnly, setPdfFilterUncertainOnly] = useState(false);
  const [pdfEditedRows, setPdfEditedRows] = useState<any[]>([]);

  const departments = [
    'Computer Science & Engineering',
    'Information Technology',
    'Electronics & Communication',
    'Mechanical Engineering',
    'Civil Engineering',
    'Mathematics',
    'Physics',
    'Humanities & Management',
  ];

  async function loadFaculty() {
    try {
      setLoading(true);
      const res = await api.getFaculty({ search, department: department || undefined, limit: 100 });
      setFaculty(res.data);
      setTotal(res.total);
    } catch (err) {
      console.error('Failed to load faculty:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFaculty();
  }, [search, department]);

  async function handleSaveFaculty(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingFaculty.id && editingFaculty.isNew !== true) {
        await api.updateFaculty(editingFaculty.id, editingFaculty);
      } else {
        const payload = { ...editingFaculty };
        delete payload.isNew;
        if (!payload.id || payload.id.trim() === '') delete payload.id;
        await api.createFaculty(payload);
      }
      setIsEditModalOpen(false);
      loadFaculty();
    } catch (err: any) {
      alert('Failed to save faculty: ' + (err.message || 'Validation error'));
    }
  }

  async function handleDeleteFaculty(id: string) {
    if (!confirm(`Are you sure you want to delete faculty member ${id}?`)) return;
    try {
      await api.deleteFaculty(id);
      loadFaculty();
    } catch (err: any) {
      if (err.status === 409 || err.conflict) {
        if (
          confirm(
            `${err.message || 'Cannot delete faculty with assignment history.'}\n\nWould you like to safely DEACTIVATE this faculty member instead? Deactivating preserves historical assignments and audit logs while excluding them from future schedules.`
          )
        ) {
          try {
            await api.deactivateFaculty(id);
            loadFaculty();
            alert(`Faculty member ${id} deactivated successfully.`);
          } catch (deactErr: any) {
            alert('Failed to deactivate faculty: ' + (deactErr.message || deactErr));
          }
        }
      } else {
        alert('Failed to delete faculty: ' + (err.message || err));
      }
    }
  }

  async function openLeaveModal(f: any) {
    setSelectedFacultyForLeave(f);
    setIsLeaveModalOpen(true);
    try {
      const res = await api.getLeaves(f.id);
      setLeaves(res.data);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAddLeave(e: React.FormEvent) {
    e.preventDefault();
    if (!newLeaveDate || !newLeaveReason) return;
    try {
      await api.addLeave({
        facultyId: selectedFacultyForLeave.id,
        date: newLeaveDate,
        sessionScope: newLeaveScope,
        reason: newLeaveReason,
        approvalStatus: 'APPROVED',
      });
      setNewLeaveDate('');
      setNewLeaveReason('');
      const res = await api.getLeaves(selectedFacultyForLeave.id);
      setLeaves(res.data);
    } catch (err) {
      alert('Failed to record leave: ' + (err as Error).message);
    }
  }

  async function handleDeleteLeave(id: number) {
    try {
      await api.deleteLeave(id);
      const res = await api.getLeaves(selectedFacultyForLeave.id);
      setLeaves(res.data);
    } catch (err) {
      alert('Failed to delete leave: ' + (err as Error).message);
    }
  }

  async function openHistoryModal(f: any) {
    setSelectedFacultyForHistory(f);
    setIsHistoryModalOpen(true);
    try {
      const res = await api.getFacultyHistory(f.id);
      setDutyHistory(res.data);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleFacultyFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportError(null);
    setImportSuccess(null);
    setImportLoading(true);

    const fileType = file.name.endsWith('.csv') ? 'csv' : 'xlsx';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        const res = await api.previewFacultyImport({
          fileBase64: base64,
          fileType,
          allowUpdateExisting,
        });
        setImportPreview(res.preview);
      } catch (err: any) {
        setImportError(err.message || 'Failed to parse import file.');
        setImportPreview(null);
      } finally {
        setImportLoading(false);
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read selected file.');
      setImportLoading(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleToggleUpdateExisting(checked: boolean) {
    setAllowUpdateExisting(checked);
    if (importFile) {
      setImportLoading(true);
      const fileType = importFile.name.endsWith('.csv') ? 'csv' : 'xlsx';
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const res = await api.previewFacultyImport({
            fileBase64: base64,
            fileType,
            allowUpdateExisting: checked,
          });
          setImportPreview(res.preview);
        } catch (err: any) {
          setImportError(err.message);
        } finally {
          setImportLoading(false);
        }
      };
      reader.readAsDataURL(importFile);
    }
  }

  async function handleConfirmFacultyImport() {
    if (!importPreview || !importPreview.canCommit) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const res = await api.commitFacultyImport({
        rows: importPreview.rows,
        allowUpdateExisting,
      });
      setImportSuccess(`Successfully committed batch import: ${res.imported} new faculty, ${res.updated} updated.`);
      loadFaculty();
      setTimeout(() => {
        setIsImportModalOpen(false);
        handleResetImport();
      }, 1600);
    } catch (err: any) {
      setImportError(err.message || 'Import commit failed.');
    } finally {
      setImportLoading(false);
    }
  }

  function handleResetImport() {
    setImportFile(null);
    setImportPreview(null);
    setImportError(null);
    setImportSuccess(null);
  }

  async function handlePdfFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setPdfError('Invalid file format: Please select a valid .pdf document.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setPdfError('File size exceeds the 10MB limit.');
      return;
    }

    setPdfFile(file);
    setPdfError(null);
    setPdfSuccess(null);
    setPdfLoading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        const res = await api.previewFacultyPdfImport({
          fileBase64: base64,
          filename: file.name,
          allowUpdateExisting: pdfAllowUpdateExisting,
        });
        setPdfPreview(res.preview);
        setPdfEditedRows(res.preview.records ? JSON.parse(JSON.stringify(res.preview.records)) : []);
      } catch (err: any) {
        setPdfError(err.message || 'Failed to parse faculty PDF document.');
        setPdfPreview(null);
        setPdfEditedRows([]);
      } finally {
        setPdfLoading(false);
      }
    };
    reader.onerror = () => {
      setPdfError('Failed to read selected PDF file.');
      setPdfLoading(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleTogglePdfUpdateExisting(checked: boolean) {
    setPdfAllowUpdateExisting(checked);
    if (pdfFile) {
      setPdfLoading(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const res = await api.previewFacultyPdfImport({
            fileBase64: base64,
            filename: pdfFile.name,
            allowUpdateExisting: checked,
          });
          setPdfPreview(res.preview);
          setPdfEditedRows(res.preview.records ? JSON.parse(JSON.stringify(res.preview.records)) : []);
        } catch (err: any) {
          setPdfError(err.message || 'Failed to update PDF preview.');
        } finally {
          setPdfLoading(false);
        }
      };
      reader.readAsDataURL(pdfFile);
    }
  }

  function handlePdfRowFieldChange(idx: number, field: string, value: string) {
    const updated = [...pdfEditedRows];
    updated[idx] = { ...updated[idx], [field]: value };

    const missing: string[] = [];
    if (!updated[idx].id?.trim()) missing.push('id');
    if (!updated[idx].name?.trim()) missing.push('name');
    if (!updated[idx].email?.trim()) missing.push('email');
    if (!updated[idx].department?.trim()) missing.push('department');
    if (!updated[idx].designation?.trim()) missing.push('designation');
    updated[idx].missingFields = missing;
    updated[idx].isUncertain = missing.length > 0 || (updated[idx].uncertainFields && updated[idx].uncertainFields.length > 0);
    updated[idx].confidence = missing.length === 0 ? 'HIGH' : missing.length <= 1 ? 'MEDIUM' : 'LOW';

    if (updated[idx].action === 'SKIP' && !updated[idx].isDuplicateInFile && missing.length === 0) {
      updated[idx].action = 'ADD';
      updated[idx].skipReason = undefined;
    }

    setPdfEditedRows(updated);
  }

  function handlePdfToggleRowAction(idx: number, action: 'ADD' | 'UPDATE' | 'SKIP') {
    const updated = [...pdfEditedRows];
    updated[idx] = { ...updated[idx], action };
    setPdfEditedRows(updated);
  }

  async function handleConfirmPdfImport() {
    if (!pdfPreview || pdfEditedRows.length === 0) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const res = await api.commitFacultyPdfImport({
        records: pdfEditedRows,
        allowUpdateExisting: pdfAllowUpdateExisting,
      });
      setPdfSuccess(`Successfully imported faculty records: ${res.imported} added, ${res.updated} updated, ${res.skipped} skipped.`);
      loadFaculty();
      setTimeout(() => {
        setIsPdfImportModalOpen(false);
        handleResetPdfImport();
      }, 1800);
    } catch (err: any) {
      setPdfError(err.message || 'Failed to commit PDF import.');
    } finally {
      setPdfLoading(false);
    }
  }

  function handleResetPdfImport() {
    setPdfFile(null);
    setPdfPreview(null);
    setPdfEditedRows([]);
    setPdfError(null);
    setPdfSuccess(null);
    setPdfSearchQuery('');
    setPdfFilterUncertainOnly(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1>Faculty Management</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Teaching staff directory, duty limits, eligibility & approved leave
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => {
              handleResetPdfImport();
              setIsPdfImportModalOpen(true);
            }}
            className="btn btn-secondary"
            title="Upload and extract faculty roster from PDF file"
          >
            <FileText size={16} /> Import Faculty PDF
          </button>
          <button
            onClick={() => {
              handleResetImport();
              setIsImportModalOpen(true);
            }}
            className="btn btn-secondary"
            title="Import faculty from CSV or Excel file"
          >
            <Upload size={16} /> Import CSV / Excel
          </button>
          <button
            id="btn-add-faculty"
            onClick={() => {
              setEditingFaculty({
                id: '',
                name: '',
                email: '',
                department: departments[0],
                designation: 'Assistant Professor',
                phone: '',
                active: true,
                exempt: false,
                maxDutyOverride: null,
                isNew: true,
              });
              setIsEditModalOpen(true);
            }}
            className="btn btn-primary"
          >
            <Plus size={16} /> Add Faculty Member
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '10px' }} />
            <input
              type="text"
              placeholder="Search faculty by ID, name, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '38px' }}
            />
          </div>

          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="form-select"
            style={{ width: '260px' }}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Faculty ID</th>
              <th>Full Name</th>
              <th>Department</th>
              <th>Designation</th>
              <th>Duty Override</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>
                  Loading faculty records...
                </td>
              </tr>
            ) : faculty.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-secondary)' }}>
                  {search || department ? (
                    <div>No faculty records found matching active filters.</div>
                  ) : (
                    <div style={{ maxWidth: '480px', margin: '0 auto' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--forest-green)', marginBottom: '8px' }}>
                        No Faculty Records Found
                      </div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
                        Start by uploading your institution's faculty roster via PDF or Excel/CSV spreadsheet, or manually register new faculty members.
                      </p>
                      <div style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button
                          type="button"
                          onClick={() => { setPdfError(null); setPdfSuccess(null); setIsPdfImportModalOpen(true); }}
                          className="btn btn-sage btn-sm"
                        >
                          <FileText size={14} /> Upload PDF Directory
                        </button>
                        <button
                          type="button"
                          onClick={() => { setImportError(null); setImportSuccess(null); setIsImportModalOpen(true); }}
                          className="btn btn-secondary btn-sm"
                        >
                          <FileSpreadsheet size={14} /> Import Excel / CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFaculty({
                              id: `FAC-${Date.now().toString().slice(-4)}`,
                              name: '',
                              email: '',
                              department: departments[0],
                              designation: 'Assistant Professor',
                              phone: '',
                              active: true,
                              exempt: false,
                              maxDutyOverride: null,
                              isNew: true,
                            });
                            setIsEditModalOpen(true);
                          }}
                          className="btn btn-primary btn-sm"
                        >
                          <Plus size={14} /> Register Faculty
                        </button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              faculty.map((f) => (
                <tr key={f.id}>
                  <td><span className="faculty-id">{f.id}</span></td>
                  <td><strong>{f.name}</strong><br /><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{f.email}</span></td>
                  <td>{f.department}</td>
                  <td>{f.designation}</td>
                  <td>
                    {f.maxDutyOverride ? (
                      <span className="mono-metric" style={{ fontWeight: 600 }}>{f.maxDutyOverride} duties</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Default (6)</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {f.active ? (
                        <Badge variant="success"><CheckCircle size={12} /> Active</Badge>
                      ) : (
                        <Badge variant="error"><XCircle size={12} /> Inactive</Badge>
                      )}
                      {f.exempt ? (
                        <Badge variant="sage">Exempt (H6)</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        onClick={() => {
                          setSelectedFacultyForView(f);
                          setIsViewModalOpen(true);
                        }}
                        className="btn btn-secondary btn-sm"
                        title="View Faculty Details"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => openHistoryModal(f)}
                        className="btn btn-secondary btn-sm"
                        title="Duty History"
                      >
                        <History size={14} />
                      </button>
                      <button
                        onClick={() => openLeaveModal(f)}
                        className="btn btn-sage btn-sm"
                        title="Manage Leave"
                      >
                        <CalendarOff size={14} />
                      </button>
                      <button
                        onClick={() => {
                          setEditingFaculty({ ...f });
                          setIsEditModalOpen(true);
                        }}
                        className="btn btn-secondary btn-sm"
                        title="Edit Details"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteFaculty(f.id)}
                        className="btn btn-danger btn-sm"
                        title="Delete Faculty"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        Showing {faculty.length} of {total} registered faculty members
      </div>

      {/* Add / Edit Faculty Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={editingFaculty?.isNew ? 'Register New Faculty Member' : `Edit Faculty: ${editingFaculty?.id}`}
      >
        {editingFaculty && (
          <form onSubmit={handleSaveFaculty}>
            <div className="form-group">
              <label className="form-label">Full Name & Title</label>
              <input
                type="text"
                required
                value={editingFaculty.name}
                onChange={(e) => setEditingFaculty({ ...editingFaculty, name: e.target.value })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Institutional Email</label>
              <input
                type="email"
                required
                value={editingFaculty.email}
                onChange={(e) => setEditingFaculty({ ...editingFaculty, email: e.target.value })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Department</label>
              <select
                value={editingFaculty.department}
                onChange={(e) => setEditingFaculty({ ...editingFaculty, department: e.target.value })}
                className="form-select"
              >
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Designation</label>
              <input
                type="text"
                value={editingFaculty.designation}
                onChange={(e) => setEditingFaculty({ ...editingFaculty, designation: e.target.value })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Maximum Duty Override (Optional Cap)</label>
              <input
                type="number"
                min="1"
                max="20"
                placeholder="Leave blank for system default (6)"
                value={editingFaculty.maxDutyOverride || ''}
                onChange={(e) =>
                  setEditingFaculty({
                    ...editingFaculty,
                    maxDutyOverride: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editingFaculty.active}
                  onChange={(e) => setEditingFaculty({ ...editingFaculty, active: e.target.checked })}
                />
                <span className="form-label" style={{ marginBottom: 0 }}>Active Faculty Member</span>
              </label>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(editingFaculty.exempt)}
                  onChange={(e) => setEditingFaculty({ ...editingFaculty, exempt: e.target.checked })}
                />
                <span className="form-label" style={{ marginBottom: 0 }}>Exempt from Duty Allocation (Rule H6)</span>
              </label>
            </div>

            <div className="modal-footer">
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Faculty
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* View Faculty Details Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        title={`Faculty Profile: ${selectedFacultyForView?.name || ''}`}
      >
        {selectedFacultyForView && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                padding: '16px',
                backgroundColor: 'var(--surface-muted)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Faculty ID</span>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--primary-forest)' }}>
                  {selectedFacultyForView.id}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status</span>
                <div style={{ marginTop: '2px' }}>
                  <Badge variant={selectedFacultyForView.active ? 'success' : 'error'}>
                    {selectedFacultyForView.active ? 'Active' : 'Inactive'}
                  </Badge>
                  {selectedFacultyForView.exempt ? (
                    <Badge variant="sage" style={{ marginLeft: '6px' }}>Exempt (H6)</Badge>
                  ) : null}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Full Name</span>
                <div style={{ fontWeight: 600 }}>{selectedFacultyForView.name}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Designation</span>
                <div>{selectedFacultyForView.designation}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Department</span>
                <div>{selectedFacultyForView.department}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Institutional Email</span>
                <div style={{ wordBreak: 'break-all' }}>{selectedFacultyForView.email}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Phone</span>
                <div>{selectedFacultyForView.phone || 'Not recorded'}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Max Duty Cap</span>
                <div className="mono-metric">
                  {selectedFacultyForView.maxDutyOverride ? `${selectedFacultyForView.maxDutyOverride} duties` : 'Default (6 duties)'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setIsViewModalOpen(false);
                  openHistoryModal(selectedFacultyForView);
                }}
                className="btn btn-secondary btn-sm"
              >
                <History size={14} /> Duty History
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsViewModalOpen(false);
                  openLeaveModal(selectedFacultyForView);
                }}
                className="btn btn-sage btn-sm"
              >
                <CalendarOff size={14} /> Manage Leaves
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsViewModalOpen(false);
                  setEditingFaculty({ ...selectedFacultyForView });
                  setIsEditModalOpen(true);
                }}
                className="btn btn-primary btn-sm"
              >
                <Edit2 size={14} /> Edit Record
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Leave Management Modal */}
      <Modal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        title={`Approved Leaves: ${selectedFacultyForLeave?.name} (${selectedFacultyForLeave?.id})`}
      >
        <div>
          <form onSubmit={handleAddLeave} style={{ padding: '14px', backgroundColor: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', marginBottom: '20px' }}>
            <div style={{ fontWeight: 600, marginBottom: '10px' }}>Record New Approved Leave</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group" style={{ marginBottom: '8px' }}>
                <label className="form-label">Leave Date</label>
                <input
                  type="date"
                  required
                  value={newLeaveDate}
                  onChange={(e) => setNewLeaveDate(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group" style={{ marginBottom: '8px' }}>
                <label className="form-label">Scope</label>
                <select
                  value={newLeaveScope}
                  onChange={(e) => setNewLeaveScope(e.target.value)}
                  className="form-select"
                >
                  <option value="FULL_DAY">Full Day</option>
                  <option value="MORNING">Morning Session</option>
                  <option value="AFTERNOON">Afternoon Session</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">Reason</label>
              <input
                type="text"
                required
                placeholder="Medical Leave, Official Conference, etc."
                value={newLeaveReason}
                onChange={(e) => setNewLeaveReason(e.target.value)}
                className="form-input"
              />
            </div>

            <button type="submit" className="btn btn-primary btn-sm">
              <Plus size={14} /> Record Approved Leave
            </button>
          </form>

          <h4>Existing Leave Records</h4>
          {leaves.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>No leave recorded for this faculty member.</p>
          ) : (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {leaves.map((l) => (
                <div
                  key={l.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-card)',
                  }}
                >
                  <div>
                    <strong>{l.date}</strong> — <span className="mono-metric">{l.sessionScope}</span>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.reason}</div>
                  </div>
                  <button
                    onClick={() => handleDeleteLeave(l.id)}
                    className="btn btn-danger btn-sm"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Duty History Modal */}
      <Modal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        title={`Duty History Ledger: ${selectedFacultyForHistory?.name} (${selectedFacultyForHistory?.id})`}
      >
        {dutyHistory ? (
          <div>
            <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '16px' }}>
              <div className="metric-card" style={{ padding: '12px' }}>
                <div className="metric-label">Total Consumed</div>
                <div className="metric-value" style={{ fontSize: '1.4rem' }}>{dutyHistory.totalDuties}</div>
              </div>
              <div className="metric-card" style={{ padding: '12px' }}>
                <div className="metric-label">Completed</div>
                <div className="metric-value" style={{ fontSize: '1.4rem', color: 'var(--success)' }}>{dutyHistory.completedCount}</div>
              </div>
              <div className="metric-card" style={{ padding: '12px' }}>
                <div className="metric-label">Scheduled</div>
                <div className="metric-value" style={{ fontSize: '1.4rem', color: 'var(--primary-forest)' }}>{dutyHistory.scheduledCount}</div>
              </div>
              <div className="metric-card" style={{ padding: '12px' }}>
                <div className="metric-label">Absences</div>
                <div className="metric-value" style={{ fontSize: '1.4rem', color: 'var(--error)' }}>{dutyHistory.absentCount}</div>
              </div>
            </div>

            <h4>Assigned Duty Log</h4>
            <div className="table-container" style={{ marginTop: '10px', maxHeight: '250px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Session</th>
                    <th>Room</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dutyHistory.assignments.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No assignments recorded yet.
                      </td>
                    </tr>
                  ) : (
                    dutyHistory.assignments.map((a: any) => (
                      <tr key={a.id}>
                        <td>{a.date}</td>
                        <td>{a.session}</td>
                        <td><span className="room-id">{a.room_id}</span> ({a.room_name})</td>
                        <td>
                          <Badge
                            variant={
                              a.status === 'COMPLETED'
                                ? 'success'
                                : a.status === 'ABSENT'
                                ? 'error'
                                : a.status === 'CANCELLED'
                                ? 'sage'
                                : 'forest'
                            }
                          >
                            {a.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p>Loading history...</p>
        )}
      </Modal>

      {/* CSV / Excel Import Modal */}
      {isImportModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => {
            setIsImportModalOpen(false);
            handleResetImport();
          }}
          title="Import Faculty Data (CSV / Excel)"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '75vh', overflowY: 'auto' }}>
            {/* File Selector */}
            {!importPreview && (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '12px' }}>
                  Upload a CSV or Excel (.xlsx) file containing faculty records. The file will be parsed in-memory and thoroughly validated before anything is committed to the database.
                </p>

                <div
                  style={{
                    border: '2px dashed var(--border-strong)',
                    borderRadius: 'var(--radius-md)',
                    padding: '32px 20px',
                    textAlign: 'center',
                    backgroundColor: 'var(--canvas-bg)',
                  }}
                >
                  <FileSpreadsheet size={36} color="var(--primary-forest)" style={{ marginBottom: '8px' }} />
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Select Faculty Data File (.csv, .xlsx)
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Supported columns: ID, Name, Email, Department, Designation, Phone, Active, Exempt, Max Duties
                  </div>

                  <input
                    type="file"
                    accept=".csv, .xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/csv"
                    onChange={handleFacultyFileSelect}
                    disabled={importLoading}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>
              </div>
            )}

            {importLoading && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Validating file rows in-memory...
              </div>
            )}

            {importError && (
              <div style={{ padding: '12px 16px', backgroundColor: 'var(--error-bg)', color: 'var(--error)', borderRadius: 'var(--radius-md)', border: '1px solid var(--error-border)', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>Validation Alert:</div>
                {importError}
              </div>
            )}

            {importSuccess && (
              <div style={{ padding: '12px 16px', backgroundColor: 'var(--success-bg)', color: 'var(--success)', borderRadius: 'var(--radius-md)', border: '1px solid var(--success-border)', fontSize: '0.85rem' }}>
                {importSuccess}
              </div>
            )}

            {/* Validation Preview Table */}
            {importPreview && (
              <div>
                {/* Summary badges */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Validation Summary:</span>
                  <Badge variant="forest">Total: {importPreview.totalRows}</Badge>
                  <Badge variant="success">Valid: {importPreview.validRows}</Badge>
                  {importPreview.errorRows > 0 && <Badge variant="error">Errors: {importPreview.errorRows}</Badge>}
                  {importPreview.warningRows > 0 && <Badge variant="warning">Warnings: {importPreview.warningRows}</Badge>}
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={allowUpdateExisting}
                      onChange={(e) => handleToggleUpdateExisting(e.target.checked)}
                    />
                    <span>Allow updating existing faculty records (match by Faculty ID)</span>
                  </label>
                </div>

                {importPreview.errorRows > 0 && (
                  <div style={{ padding: '8px 12px', backgroundColor: 'var(--error-bg)', color: 'var(--error)', borderRadius: '4px', fontSize: '0.8rem', marginBottom: '12px' }}>
                    File contains row-level errors. Please correct the source file and re-upload before committing.
                  </div>
                )}

                {/* Rows Table */}
                <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--canvas-bg)', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '6px 10px' }}>Row</th>
                        <th style={{ padding: '6px 10px' }}>Status</th>
                        <th style={{ padding: '6px 10px' }}>ID</th>
                        <th style={{ padding: '6px 10px' }}>Name</th>
                        <th style={{ padding: '6px 10px' }}>Department</th>
                        <th style={{ padding: '6px 10px' }}>Email</th>
                        <th style={{ padding: '6px 10px' }}>Diagnostics / Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((r: any) => (
                        <tr key={r.rowNumber} style={{ backgroundColor: r.isValid ? 'transparent' : 'var(--error-bg)' }}>
                          <td style={{ padding: '6px 10px' }}>{r.rowNumber}</td>
                          <td style={{ padding: '6px 10px' }}>
                            <Badge variant={r.isValid ? (r.warnings.length > 0 ? 'warning' : 'success') : 'error'}>
                              {r.isValid ? (r.warnings.length > 0 ? 'Warning' : 'Valid') : 'Error'}
                            </Badge>
                          </td>
                          <td style={{ padding: '6px 10px' }} className="mono-metric">{r.data.id || '-'}</td>
                          <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.data.name || '-'}</td>
                          <td style={{ padding: '6px 10px' }}>{r.data.department || '-'}</td>
                          <td style={{ padding: '6px 10px' }}>{r.data.email || '-'}</td>
                          <td style={{ padding: '6px 10px', color: r.errors.length > 0 ? 'var(--error)' : 'var(--warning)' }}>
                            {r.errors.length > 0 ? (
                              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                                {r.errors.map((e: any, idx: number) => (
                                  <li key={idx}>{e.message}</li>
                                ))}
                              </ul>
                            ) : r.warnings.length > 0 ? (
                              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                                {r.warnings.map((w: any, idx: number) => (
                                  <li key={idx}>{w.message}</li>
                                ))}
                              </ul>
                            ) : (
                              'Ready for import'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                  <button onClick={handleResetImport} className="btn btn-secondary btn-sm" disabled={importLoading}>
                    Select Another File
                  </button>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => {
                        setIsImportModalOpen(false);
                        handleResetImport();
                      }}
                      className="btn btn-secondary btn-sm"
                      disabled={importLoading}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmFacultyImport}
                      className="btn btn-primary btn-sm"
                      disabled={!importPreview.canCommit || importLoading}
                    >
                      {importLoading ? 'Committing...' : `Confirm & Commit (${importPreview.validRows} Records)`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Faculty PDF Upload & Extraction Modal */}
      {isPdfImportModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => {
            setIsPdfImportModalOpen(false);
            handleResetPdfImport();
          }}
          title="Import Faculty Directory (PDF Document)"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '78vh', overflowY: 'auto' }}>
            {/* Step 1: File Selector */}
            {!pdfPreview && (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '12px' }}>
                  Upload an institutional faculty list in digital PDF format. The document will be analyzed and parsed in-memory, extracting faculty names, employee IDs, departments, and emails for your review before any database changes occur.
                </p>

                <div
                  style={{
                    border: '2px dashed var(--border-strong)',
                    borderRadius: 'var(--radius-md)',
                    padding: '36px 20px',
                    textAlign: 'center',
                    backgroundColor: 'var(--canvas-bg)',
                  }}
                >
                  <FileText size={40} color="var(--primary-forest)" style={{ marginBottom: '10px' }} />
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Select Faculty PDF File (.pdf)
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Digital selectable text supported • Scanned PDFs require local OCR • Maximum file size: 10MB
                  </div>

                  <input
                    type="file"
                    accept=".pdf, application/pdf"
                    onChange={handlePdfFileSelect}
                    disabled={pdfLoading}
                    style={{ fontSize: '0.85rem' }}
                  />

                  <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={pdfAllowUpdateExisting}
                        onChange={(e) => handleTogglePdfUpdateExisting(e.target.checked)}
                      />
                      <span>Update existing faculty records on ID/email match (preserves approved schedules)</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {pdfLoading && (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>Extracting and validating PDF text streams...</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Parsing faculty entities, verifying in-file uniqueness, and checking database conflicts in-memory.
                </div>
              </div>
            )}

            {pdfError && (
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--error-bg)',
                  color: 'var(--error)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--error-border)',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>PDF Extraction Notice:</div>
                {pdfError}
              </div>
            )}

            {pdfSuccess && (
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--success-bg)',
                  color: 'var(--success)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--success-border)',
                  fontSize: '0.85rem',
                }}
              >
                {pdfSuccess}
              </div>
            )}

            {/* Step 2: Extraction & In-Memory Preview */}
            {pdfPreview && (
              <div>
                {/* Document metadata banner */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    backgroundColor: 'var(--surface-muted)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    marginBottom: '12px',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <strong>Document:</strong> <span className="mono-metric">{pdfPreview.filename}</span> ({pdfPreview.totalPages} {pdfPreview.totalPages === 1 ? 'page' : 'pages'}, {(pdfPreview.fileSizeBytes / 1024).toFixed(1)} KB)
                  </div>
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={pdfAllowUpdateExisting}
                        onChange={(e) => handleTogglePdfUpdateExisting(e.target.checked)}
                      />
                      <span>Allow updating existing records</span>
                    </label>
                  </div>
                </div>

                {/* Summary badges */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Parsed Statistics:</span>
                  <Badge variant="forest">Parsed: {pdfPreview.totalParsed}</Badge>
                  <Badge variant="success">Unique: {pdfPreview.uniqueCount}</Badge>
                  {pdfPreview.duplicateCount > 0 && <Badge variant="warning">Duplicates: {pdfPreview.duplicateCount}</Badge>}
                  {pdfPreview.missingRequiredCount > 0 && <Badge variant="error">Incomplete: {pdfPreview.missingRequiredCount}</Badge>}
                  {pdfPreview.uncertainCount > 0 && <Badge variant="warning">Uncertain: {pdfPreview.uncertainCount}</Badge>}
                  {pdfPreview.existingMatchCount > 0 && <Badge variant="sage">DB Matches: {pdfPreview.existingMatchCount}</Badge>}
                  <Badge variant="success">To Add: {pdfEditedRows.filter((r) => r.action === 'ADD').length}</Badge>
                  {pdfEditedRows.filter((r) => r.action === 'UPDATE').length > 0 && (
                    <Badge variant="forest">To Update: {pdfEditedRows.filter((r) => r.action === 'UPDATE').length}</Badge>
                  )}
                  {pdfEditedRows.filter((r) => r.action === 'SKIP').length > 0 && (
                    <Badge variant="sage">To Skip: {pdfEditedRows.filter((r) => r.action === 'SKIP').length}</Badge>
                  )}
                </div>

                {/* Warnings list */}
                {pdfPreview.warnings && pdfPreview.warnings.length > 0 && (
                  <div style={{ marginBottom: '12px', padding: '8px 12px', backgroundColor: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--warning)' }}>
                    {pdfPreview.warnings.map((w: string, idx: number) => (
                      <div key={idx}>• {w}</div>
                    ))}
                  </div>
                )}

                {/* Search & Filter Toolbar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <input
                      type="text"
                      placeholder="Search extracted faculty by name, ID, department..."
                      value={pdfSearchQuery}
                      onChange={(e) => setPdfSearchQuery(e.target.value)}
                      className="form-input"
                      style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pdfFilterUncertainOnly}
                      onChange={(e) => setPdfFilterUncertainOnly(e.target.checked)}
                    />
                    <span>Show uncertain or incomplete only</span>
                  </label>
                </div>

                {/* Reviewable, Editable Table */}
                <div className="table-container" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '40px', padding: '6px 8px' }}>#</th>
                        <th style={{ width: '110px', padding: '6px 8px' }}>Faculty ID *</th>
                        <th style={{ padding: '6px 8px' }}>Name *</th>
                        <th style={{ padding: '6px 8px' }}>Department</th>
                        <th style={{ padding: '6px 8px' }}>Designation</th>
                        <th style={{ padding: '6px 8px' }}>Email *</th>
                        <th style={{ width: '90px', padding: '6px 8px' }}>Status</th>
                        <th style={{ width: '85px', padding: '6px 8px' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pdfEditedRows
                        .map((row, originalIdx) => ({ row, originalIdx }))
                        .filter(({ row }) => {
                          if (pdfFilterUncertainOnly && !row.isUncertain && row.missingFields?.length === 0) {
                            return false;
                          }
                          if (!pdfSearchQuery) return true;
                          const q = pdfSearchQuery.toLowerCase();
                          return (
                            row.name?.toLowerCase().includes(q) ||
                            row.id?.toLowerCase().includes(q) ||
                            row.department?.toLowerCase().includes(q) ||
                            row.email?.toLowerCase().includes(q)
                          );
                        })
                        .map(({ row, originalIdx }) => (
                          <tr
                            key={originalIdx}
                            style={{
                              backgroundColor: row.action === 'SKIP' ? 'var(--surface-muted)' : row.isUncertain ? 'var(--warning-bg)' : undefined,
                              opacity: row.action === 'SKIP' ? 0.75 : 1,
                            }}
                          >
                            <td style={{ padding: '6px 8px' }}>{row.rowNumber}</td>
                            <td style={{ padding: '4px 6px' }}>
                              <input
                                type="text"
                                value={row.id || ''}
                                onChange={(e) => handlePdfRowFieldChange(originalIdx, 'id', e.target.value)}
                                className="form-input"
                                placeholder="ID Required"
                                style={{
                                  padding: '4px 6px',
                                  fontSize: '0.75rem',
                                  fontFamily: 'var(--font-data)',
                                  borderColor: !row.id ? 'var(--error)' : undefined,
                                }}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <input
                                type="text"
                                value={row.name || ''}
                                onChange={(e) => handlePdfRowFieldChange(originalIdx, 'name', e.target.value)}
                                className="form-input"
                                placeholder="Name Required"
                                style={{
                                  padding: '4px 6px',
                                  fontSize: '0.75rem',
                                  borderColor: !row.name ? 'var(--error)' : undefined,
                                }}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <input
                                type="text"
                                value={row.department || ''}
                                onChange={(e) => handlePdfRowFieldChange(originalIdx, 'department', e.target.value)}
                                className="form-input"
                                placeholder="Department"
                                style={{ padding: '4px 6px', fontSize: '0.75rem' }}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <input
                                type="text"
                                value={row.designation || ''}
                                onChange={(e) => handlePdfRowFieldChange(originalIdx, 'designation', e.target.value)}
                                className="form-input"
                                placeholder="Designation"
                                style={{ padding: '4px 6px', fontSize: '0.75rem' }}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <input
                                type="email"
                                value={row.email || ''}
                                onChange={(e) => handlePdfRowFieldChange(originalIdx, 'email', e.target.value)}
                                className="form-input"
                                placeholder="email@institution.edu"
                                style={{
                                  padding: '4px 6px',
                                  fontSize: '0.75rem',
                                  borderColor: !row.email ? 'var(--error)' : undefined,
                                }}
                              />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              {row.isDuplicateInFile ? (
                                <Badge variant="warning">Duplicate</Badge>
                              ) : row.isUncertain ? (
                                <Badge variant="warning" title={row.uncertainFields?.join(', ') || 'Incomplete fields'}>
                                  Uncertain
                                </Badge>
                              ) : row.existingMatch ? (
                                <Badge variant="forest">DB Match</Badge>
                              ) : (
                                <Badge variant="success">Valid</Badge>
                              )}
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <select
                                value={row.action}
                                onChange={(e) => handlePdfToggleRowAction(originalIdx, e.target.value as any)}
                                className="form-select"
                                style={{ padding: '3px 6px', fontSize: '0.75rem', width: '100%' }}
                              >
                                <option value="ADD">Add</option>
                                <option value="UPDATE">Update</option>
                                <option value="SKIP">Skip</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {/* Modal Footer Controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                  <button onClick={handleResetPdfImport} className="btn btn-secondary btn-sm" disabled={pdfLoading}>
                    Select Another PDF
                  </button>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => {
                        setIsPdfImportModalOpen(false);
                        handleResetPdfImport();
                      }}
                      className="btn btn-secondary btn-sm"
                      disabled={pdfLoading}
                    >
                      Cancel (Zero Writes)
                    </button>
                    <button
                      onClick={handleConfirmPdfImport}
                      className="btn btn-primary btn-sm"
                      disabled={pdfLoading || pdfEditedRows.filter((r) => r.action === 'ADD' || r.action === 'UPDATE').length === 0}
                    >
                      {pdfLoading
                        ? 'Committing Import...'
                        : `Confirm & Import (${pdfEditedRows.filter((r) => r.action === 'ADD' || r.action === 'UPDATE').length} Records)`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Search, Plus, Edit2, Trash2, CheckCircle, XCircle, Upload, FileSpreadsheet } from 'lucide-react';

export const RoomManagement: React.FC = () => {
  const [rooms, setRooms] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [building, setBuilding] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<any>(null);

  // Room Import states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [allowUpdateExisting, setAllowUpdateExisting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const buildings = [
    'Block A (Science)',
    'Block B (Computing)',
    'Block C (Engineering)',
    'Block D (Management)',
  ];

  async function loadRooms() {
    try {
      setLoading(true);
      const res = await api.getRooms({ search, building: building || undefined, limit: 100 });
      setRooms(res.data);
      setTotal(res.total);
    } catch (err) {
      console.error('Failed to load rooms:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRooms();
  }, [search, building]);

  async function handleSaveRoom(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingRoom.id && editingRoom.isNew !== true) {
        await api.updateRoom(editingRoom.id, editingRoom);
      } else {
        await api.createRoom(editingRoom);
      }
      setIsModalOpen(false);
      loadRooms();
    } catch (err) {
      alert('Failed to save room: ' + (err as Error).message);
    }
  }

  async function handleDeleteRoom(id: string) {
    if (!confirm(`Are you sure you want to remove examination room ${id}?`)) return;
    try {
      await api.deleteRoom(id);
      loadRooms();
    } catch (err) {
      alert('Failed to delete room: ' + (err as Error).message);
    }
  }

  async function handleRoomFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
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
        const res = await api.previewRoomImport({
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
          const res = await api.previewRoomImport({
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

  async function handleConfirmRoomImport() {
    if (!importPreview || !importPreview.canCommit) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const res = await api.commitRoomImport({
        rows: importPreview.rows,
        allowUpdateExisting,
      });
      setImportSuccess(`Successfully committed batch import: ${res.imported} new rooms, ${res.updated} updated.`);
      loadRooms();
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1>Room Management</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Examination halls, seating capacities, blocks & active status
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => {
              handleResetImport();
              setIsImportModalOpen(true);
            }}
            className="btn btn-secondary"
            title="Import rooms from CSV or Excel file"
          >
            <Upload size={16} /> Import Rooms
          </button>
          <button
            onClick={() => {
              setEditingRoom({ isNew: true, name: '', building: buildings[0], floor: 1, capacity: 40, active: true });
              setIsModalOpen(true);
            }}
            className="btn btn-primary"
          >
            <Plus size={16} /> Add Examination Room
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '10px' }} />
            <input
              type="text"
              placeholder="Search by Room ID, name, building..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '38px' }}
            />
          </div>

          <select
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            className="form-select"
            style={{ width: '260px' }}
          >
            <option value="">All Buildings / Blocks</option>
            {buildings.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Room ID</th>
              <th>Venue Name</th>
              <th>Building / Block</th>
              <th>Floor</th>
              <th>Exam Dept (H6)</th>
              <th>Student Capacity</th>
              <th>Active Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '32px' }}>
                  Loading rooms...
                </td>
              </tr>
            ) : rooms.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  No rooms found matching filters.
                </td>
              </tr>
            ) : (
              rooms.map((r) => (
                <tr key={r.id}>
                  <td><span className="room-id">{r.id}</span></td>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.building}</td>
                  <td>Floor {r.floor}</td>
                  <td>
                    {r.examDepartment ? (
                      <Badge variant="sage">{r.examDepartment}</Badge>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>None</span>
                    )}
                  </td>
                  <td><span className="mono-metric">{r.capacity} seats</span></td>
                  <td>
                    {r.active ? (
                      <Badge variant="success"><CheckCircle size={12} /> Active</Badge>
                    ) : (
                      <Badge variant="error"><XCircle size={12} /> Inactive</Badge>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        onClick={() => {
                          setEditingRoom({ ...r });
                          setIsModalOpen(true);
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteRoom(r.id)}
                        className="btn btn-danger btn-sm"
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
        Showing {rooms.length} of {total} registered examination rooms
      </div>

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRoom?.isNew ? 'Configure New Room' : `Edit Room: ${editingRoom?.id}`}
      >
        {editingRoom && (
          <form onSubmit={handleSaveRoom}>
            <div className="form-group">
              <label className="form-label">Room Identifier / Code</label>
              <input
                type="text"
                required
                disabled={!editingRoom.isNew}
                placeholder="e.g. RM-201"
                value={editingRoom.id || ''}
                onChange={(e) => setEditingRoom({ ...editingRoom, id: e.target.value })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Venue Display Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Hall RM-201 (Block B)"
                value={editingRoom.name || ''}
                onChange={(e) => setEditingRoom({ ...editingRoom, name: e.target.value })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Building / Block</label>
              <select
                value={editingRoom.building}
                onChange={(e) => setEditingRoom({ ...editingRoom, building: e.target.value })}
                className="form-select"
              >
                {buildings.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Floor</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={editingRoom.floor || 1}
                  onChange={(e) => setEditingRoom({ ...editingRoom, floor: Number(e.target.value) })}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Student Capacity</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={editingRoom.capacity || 30}
                  onChange={(e) => setEditingRoom({ ...editingRoom, capacity: Number(e.target.value) })}
                  className="form-input"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Examination Department (Rule H6 Exclusion — Leave blank if none)</label>
              <input
                type="text"
                placeholder="e.g. Computer Science & Engineering"
                value={editingRoom.examDepartment || ''}
                onChange={(e) => setEditingRoom({ ...editingRoom, examDepartment: e.target.value || null })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editingRoom.active}
                  onChange={(e) => setEditingRoom({ ...editingRoom, active: e.target.checked })}
                />
                <span className="form-label" style={{ marginBottom: 0 }}>Active for Examination Staffing</span>
              </label>
            </div>

            <div className="modal-footer">
              <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Room
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* CSV / Excel Room Import Modal */}
      {isImportModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => {
            setIsImportModalOpen(false);
            handleResetImport();
          }}
          title="Import Examination Rooms (CSV / Excel)"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '75vh', overflowY: 'auto' }}>
            {/* File Selector */}
            {!importPreview && (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '12px' }}>
                  Upload a CSV or Excel (.xlsx) file containing room records. The file will be parsed in-memory and thoroughly validated before anything is committed to the database.
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
                    Select Room Data File (.csv, .xlsx)
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Supported columns: Room ID, Name, Building, Floor, Capacity, Exam Department, Active
                  </div>

                  <input
                    type="file"
                    accept=".csv, .xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/csv"
                    onChange={handleRoomFileSelect}
                    disabled={importLoading}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>
              </div>
            )}

            {importLoading && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Validating room records in-memory...
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
                    <span>Allow updating existing room records (match by Room ID)</span>
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
                        <th style={{ padding: '6px 10px' }}>Room ID</th>
                        <th style={{ padding: '6px 10px' }}>Name</th>
                        <th style={{ padding: '6px 10px' }}>Building</th>
                        <th style={{ padding: '6px 10px' }}>Floor</th>
                        <th style={{ padding: '6px 10px' }}>Capacity</th>
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
                          <td style={{ padding: '6px 10px' }}>{r.data.building || '-'}</td>
                          <td style={{ padding: '6px 10px' }}>{r.data.floor}</td>
                          <td style={{ padding: '6px 10px' }}>{r.data.capacity}</td>
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
                      onClick={handleConfirmRoomImport}
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
    </div>
  );
};

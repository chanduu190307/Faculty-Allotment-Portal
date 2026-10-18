import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  Upload,
  FileSpreadsheet,
  Layers,
  Building,
  RefreshCw,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

export const RoomManagement: React.FC = () => {
  const [rooms, setRooms] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedBlock, setSelectedBlock] = useState<string>('');
  const [selectedFloor, setSelectedFloor] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Diagnostics
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(true);

  // Single Room Modal (Add / Edit)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<any>(null);

  // Bulk Generation Modal
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkBlock, setBulkBlock] = useState('Block A');
  const [bulkFloor, setBulkFloor] = useState(1);
  const [bulkCount, setBulkCount] = useState(25);
  const [bulkPrefix, setBulkPrefix] = useState('A');
  const [bulkStartNum, setBulkStartNum] = useState(1);
  const [bulkCapacity, setBulkCapacity] = useState(30);
  const [bulkPreview, setBulkPreview] = useState<any>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  // Room Import states (CSV / XLSX)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [allowUpdateExisting, setAllowUpdateExisting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const standardBlocks = ['Block A', 'Block B', 'Block C'];

  async function loadDiagnostics() {
    try {
      const res = await api.getRoomDiagnostics();
      if (res.success && res.data) {
        setDiagnostics(res.data);
      }
    } catch (err) {
      console.warn('Diagnostics unavailable:', err);
    }
  }

  async function loadRooms() {
    try {
      setLoading(true);
      const res = await api.getRooms({
        search: search || undefined,
        building: selectedBlock || undefined,
        floor: selectedFloor !== '' ? Number(selectedFloor) : undefined,
        active: activeFilter === 'active' ? true : activeFilter === 'inactive' ? false : undefined,
        limit: 200,
      });
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
    loadDiagnostics();
  }, [search, selectedBlock, selectedFloor, activeFilter]);

  // Sync prefix when bulk block changes
  useEffect(() => {
    if (bulkBlock.includes('Block A')) setBulkPrefix('A');
    else if (bulkBlock.includes('Block B')) setBulkPrefix('B');
    else if (bulkBlock.includes('Block C')) setBulkPrefix('C');
    else setBulkPrefix(bulkBlock.substring(0, 1).toUpperCase());
  }, [bulkBlock]);

  async function handleSaveRoom(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingRoom.id && editingRoom.isNew !== true) {
        await api.updateRoom(editingRoom.id, editingRoom);
      } else {
        const payload = { ...editingRoom };
        delete payload.isNew;
        await api.createRoom(payload);
      }
      setIsModalOpen(false);
      loadRooms();
      loadDiagnostics();
    } catch (err: any) {
      alert('Failed to save room: ' + (err.message || String(err)));
    }
  }

  async function handleDeleteRoom(id: string) {
    if (!confirm(`Are you sure you want to remove examination room ${id}?`)) return;
    try {
      await api.deleteRoom(id);
      loadRooms();
      loadDiagnostics();
    } catch (err: any) {
      if (err.status === 409 || err.conflict || err.message?.includes('assigned to active duties') || err.message?.includes('referenced by approved schedules')) {
        const shouldDeactivate = confirm(
          `Cannot delete room ${id}: ${err.message}\n\nWould you like to safely DEACTIVATE this room instead? This preserves historical examination records.`
        );
        if (shouldDeactivate) {
          try {
            await api.deactivateRoom(id);
            alert(`Room ${id} has been deactivated.`);
            loadRooms();
            loadDiagnostics();
          } catch (deactErr: any) {
            alert('Failed to deactivate room: ' + deactErr.message);
          }
        }
      } else {
        alert('Failed to delete room: ' + (err as Error).message);
      }
    }
  }

  async function handleToggleRoomActive(room: any) {
    try {
      if (room.active) {
        await api.deactivateRoom(room.id);
      } else {
        await api.updateRoom(room.id, { active: true });
      }
      loadRooms();
      loadDiagnostics();
    } catch (err: any) {
      alert(`Failed to update status for ${room.id}: ` + err.message);
    }
  }

  // Bulk Generation Handlers
  async function handlePreviewBulkGeneration() {
    setBulkLoading(true);
    setBulkError(null);
    setBulkSuccess(null);
    try {
      const res = await api.bulkGenerateRoomsPreview({
        block: bulkBlock,
        floor: Number(bulkFloor),
        count: Number(bulkCount),
        prefix: bulkPrefix.trim(),
      });
      setBulkPreview(res.data);
    } catch (err: any) {
      setBulkError(err.message || 'Failed to preview bulk room generation.');
      setBulkPreview(null);
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleCommitBulkGeneration() {
    if (!bulkPreview || !bulkPreview.proposedRooms) return;
    setBulkLoading(true);
    setBulkError(null);
    try {
      const res = await api.bulkGenerateRoomsCommit({
        block: bulkPreview.block,
        floor: bulkPreview.floor,
        rooms: bulkPreview.proposedRooms,
      });
      const data = res.data;
      setBulkSuccess(
        `Successfully generated ${data.createdCount} room(s) for ${bulkPreview.block} Floor ${bulkPreview.floor}. (Skipped ${data.skippedCount} existing rooms).`
      );
      loadRooms();
      loadDiagnostics();
      setTimeout(() => {
        setIsBulkModalOpen(false);
        setBulkPreview(null);
        setBulkSuccess(null);
      }, 2000);
    } catch (err: any) {
      setBulkError(err.message || 'Bulk room generation commit failed.');
    } finally {
      setBulkLoading(false);
    }
  }

  // Import Handlers
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
      loadDiagnostics();
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
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Building size={28} color="var(--primary-forest)" />
            College Room Management
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            Hierarchical management (Block → Floor → Room), 25 rooms/floor default, bulk generation and diagnostics
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="btn btn-secondary"
            title="Toggle room hierarchy diagnostics"
          >
            <Layers size={16} /> Diagnostics
          </button>
          <button
            onClick={() => {
              setBulkPreview(null);
              setBulkError(null);
              setBulkSuccess(null);
              setIsBulkModalOpen(true);
            }}
            className="btn btn-secondary"
            style={{ borderColor: 'var(--primary-forest)', color: 'var(--primary-forest)' }}
            title="Bulk generate 25 rooms for a block & floor"
          >
            <Sparkles size={16} /> Bulk Generate 25 Rooms
          </button>
          <button
            onClick={() => {
              handleResetImport();
              setIsImportModalOpen(true);
            }}
            className="btn btn-secondary"
            title="Import rooms from CSV or Excel file"
          >
            <Upload size={16} /> Import File
          </button>
          <button
            onClick={() => {
              setEditingRoom({
                isNew: true,
                id: '',
                name: '',
                building: selectedBlock || standardBlocks[0],
                floor: selectedFloor ? Number(selectedFloor) : 1,
                capacity: 30,
                active: true,
              });
              setIsModalOpen(true);
            }}
            className="btn btn-primary"
          >
            <Plus size={16} /> Add Single Room
          </button>
        </div>
      </div>

      {/* Diagnostics Banner */}
      {showDiagnostics && diagnostics && (
        <div
          className="card"
          style={{
            padding: '16px 20px',
            marginBottom: '20px',
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--primary-forest)' }}>
              <Layers size={18} />
              <span>Room Hierarchy Diagnostics (Block A, B, C — 25 rooms/floor standard)</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem' }}>
              <span>Expected Total: <strong>{diagnostics.totalExpectedRooms}</strong></span>
              <span>Registered Total: <strong>{diagnostics.totalRegisteredRooms}</strong></span>
              <span>Active Total: <strong style={{ color: 'var(--success)' }}>{diagnostics.totalActiveRooms}</strong></span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            {diagnostics.blocks?.map((blockName: string) => {
              const blockRooms = rooms.filter((r) => r.building?.toLowerCase().includes(blockName.toLowerCase()));
              const activeCount = blockRooms.filter((r) => r.active).length;
              return (
                <div
                  key={blockName}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: selectedBlock === blockName ? 'var(--primary-forest-subtle)' : 'var(--canvas-bg)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedBlock(selectedBlock === blockName ? '' : blockName)}
                  title={`Click to filter by ${blockName}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>{blockName}</strong>
                    <Badge variant={activeCount > 0 ? 'success' : 'sage'}>
                      {activeCount} Active
                    </Badge>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <span>Registered: <strong>{blockRooms.length}</strong></span>
                    <span style={{ marginLeft: '10px' }}>Target: <strong>100</strong> (4×25)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Block Tabs & Filter Controls */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
        {/* Block Selector Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setSelectedBlock('')}
            className={`btn btn-sm ${selectedBlock === '' ? 'btn-primary' : 'btn-secondary'}`}
          >
            All Blocks
          </button>
          {standardBlocks.map((b) => (
            <button
              key={b}
              onClick={() => setSelectedBlock(selectedBlock === b ? '' : b)}
              className={`btn btn-sm ${selectedBlock === b ? 'btn-primary' : 'btn-secondary'}`}
            >
              {b}
            </button>
          ))}
        </div>

        {/* Search, Floor & Status Filters */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '12px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '10px' }} />
            <input
              type="text"
              placeholder="Search by Room ID, name (e.g. A-101), block..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '38px' }}
            />
          </div>

          <select
            value={selectedFloor}
            onChange={(e) => setSelectedFloor(e.target.value)}
            className="form-select"
          >
            <option value="">All Floors</option>
            <option value="1">Floor 1 (101–125)</option>
            <option value="2">Floor 2 (201–225)</option>
            <option value="3">Floor 3 (301–325)</option>
            <option value="4">Floor 4 (401–425)</option>
          </select>

          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="form-select"
          >
            <option value="">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          <button
            onClick={() => {
              setSearch('');
              setSelectedBlock('');
              setSelectedFloor('');
              setActiveFilter('');
            }}
            className="btn btn-secondary btn-sm"
            title="Reset filters"
          >
            <RefreshCw size={14} /> Reset
          </button>
        </div>
      </div>

      {/* Rooms Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Room ID</th>
              <th>Room Number / Label</th>
              <th>Block / Building</th>
              <th>Floor</th>
              <th>Student Capacity</th>
              <th>Dept Exclusion (H6)</th>
              <th>Active Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '32px' }}>
                  Loading examination rooms...
                </td>
              </tr>
            ) : rooms.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                  <div style={{ marginBottom: '8px', fontSize: '1rem' }}>No examination rooms found.</div>
                  <div style={{ fontSize: '0.85rem' }}>
                    Tip: Use <strong>"Bulk Generate 25 Rooms"</strong> above to quickly instantiate rooms for a block and floor.
                  </div>
                </td>
              </tr>
            ) : (
              rooms.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="mono-metric" style={{ fontWeight: 600 }}>{r.id}</span>
                  </td>
                  <td>
                    <strong style={{ fontSize: '0.95rem' }}>{r.name}</strong>
                  </td>
                  <td>
                    <Badge variant="sage">{r.building}</Badge>
                  </td>
                  <td>Floor {r.floor}</td>
                  <td>
                    <span className="mono-metric">{r.capacity} seats</span>
                  </td>
                  <td>
                    {r.examDepartment ? (
                      <Badge variant="sage">{r.examDepartment}</Badge>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>None</span>
                    )}
                  </td>
                  <td>
                    {r.active ? (
                      <Badge variant="success">
                        <CheckCircle size={12} /> Active
                      </Badge>
                    ) : (
                      <Badge variant="error">
                        <XCircle size={12} /> Inactive
                      </Badge>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        onClick={() => handleToggleRoomActive(r)}
                        className={`btn btn-sm ${r.active ? 'btn-secondary' : 'btn-primary'}`}
                        title={r.active ? 'Deactivate room' : 'Activate room'}
                        style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                      >
                        {r.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingRoom({ ...r });
                          setIsModalOpen(true);
                        }}
                        className="btn btn-secondary btn-sm"
                        title="Edit Room"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteRoom(r.id)}
                        className="btn btn-danger btn-sm"
                        title="Delete Room"
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

      <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
        <span>Showing {rooms.length} of {total} registered examination rooms</span>
        <span>Standard: 25 rooms per floor across Blocks A, B, C</span>
      </div>

      {/* Bulk Room Generation Modal */}
      {isBulkModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => {
            setIsBulkModalOpen(false);
            setBulkPreview(null);
          }}
          title="Bulk Generate Examination Rooms by Block & Floor"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Standard institutional configuration defaults to <strong>25 rooms per floor</strong> (e.g. A-101 to A-125).
              Review the proposed room labels below before confirming. Existing rooms will be safely skipped to prevent duplicates.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Target Block</label>
                <select
                  value={bulkBlock}
                  onChange={(e) => setBulkBlock(e.target.value)}
                  className="form-select"
                >
                  <option value="Block A">Block A</option>
                  <option value="Block B">Block B</option>
                  <option value="Block C">Block C</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Target Floor</label>
                <select
                  value={bulkFloor}
                  onChange={(e) => setBulkFloor(Number(e.target.value))}
                  className="form-select"
                >
                  <option value={1}>Floor 1</option>
                  <option value={2}>Floor 2</option>
                  <option value={3}>Floor 3</option>
                  <option value={4}>Floor 4</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Rooms per Floor</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={bulkCount}
                  onChange={(e) => setBulkCount(Number(e.target.value))}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Room Prefix / Letter</label>
                <input
                  type="text"
                  value={bulkPrefix}
                  onChange={(e) => setBulkPrefix(e.target.value)}
                  className="form-input"
                  placeholder="e.g. A"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Default Capacity</label>
                <input
                  type="number"
                  min="10"
                  max="200"
                  value={bulkCapacity}
                  onChange={(e) => setBulkCapacity(Number(e.target.value))}
                  className="form-input"
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <button
                type="button"
                onClick={handlePreviewBulkGeneration}
                className="btn btn-secondary"
                disabled={bulkLoading}
              >
                <Sparkles size={16} /> Preview Proposed {bulkCount} Rooms
              </button>
            </div>

            {bulkError && (
              <div style={{ padding: '10px 14px', backgroundColor: 'var(--error-bg)', color: 'var(--error)', borderRadius: 'var(--radius-md)', border: '1px solid var(--error-border)', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 600 }}>Error:</div>
                {bulkError}
              </div>
            )}

            {bulkSuccess && (
              <div style={{ padding: '10px 14px', backgroundColor: 'var(--success-bg)', color: 'var(--success)', borderRadius: 'var(--radius-md)', border: '1px solid var(--success-border)', fontSize: '0.85rem' }}>
                {bulkSuccess}
              </div>
            )}

            {/* Proposed Rooms Grid Preview */}
            {bulkPreview && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Proposed Batch:</span>
                    <Badge variant="forest">Total: {bulkPreview.totalProposed}</Badge>
                    <Badge variant="success">New: {bulkPreview.newCount}</Badge>
                    {bulkPreview.alreadyExistsCount > 0 && (
                      <Badge variant="warning">Already Exists (Will Skip): {bulkPreview.alreadyExistsCount}</Badge>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px',
                    backgroundColor: 'var(--canvas-bg)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                    gap: '6px',
                  }}
                >
                  {bulkPreview.proposedRooms?.map((r: any) => (
                    <div
                      key={r.id}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: r.alreadyExists ? 'var(--warning-bg)' : 'var(--surface-card)',
                        border: `1px solid ${r.alreadyExists ? 'var(--warning-border)' : 'var(--border-subtle)'}`,
                        fontSize: '0.8rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <strong>{r.name}</strong>
                      {r.alreadyExists ? (
                        <span style={{ fontSize: '0.7rem', color: 'var(--warning)', fontWeight: 600 }}>Exists</span>
                      ) : (
                        <span style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 600 }}>+ New</span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="modal-footer" style={{ marginTop: '16px' }}>
                  <button
                    type="button"
                    onClick={() => setIsBulkModalOpen(false)}
                    className="btn btn-secondary"
                    disabled={bulkLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCommitBulkGeneration}
                    className="btn btn-primary"
                    disabled={bulkLoading || bulkPreview.newCount === 0}
                  >
                    {bulkLoading ? 'Generating...' : `Confirm & Create ${bulkPreview.newCount} Rooms`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Single Room Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRoom?.isNew ? 'Configure New Examination Room' : `Edit Room: ${editingRoom?.id}`}
      >
        {editingRoom && (
          <form onSubmit={handleSaveRoom}>
            <div className="form-group">
              <label className="form-label">Room Identifier / Code (Leave blank to auto-generate)</label>
              <input
                type="text"
                disabled={!editingRoom.isNew}
                placeholder="e.g. RM-BlockA-F1-101"
                value={editingRoom.id || ''}
                onChange={(e) => setEditingRoom({ ...editingRoom, id: e.target.value })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Room Number / Venue Label</label>
              <input
                type="text"
                required
                placeholder="e.g. A-101"
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
                {standardBlocks.map((b) => (
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

            {importPreview && (
              <div>
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

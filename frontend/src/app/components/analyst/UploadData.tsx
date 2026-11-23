import { useState, useRef, useEffect } from "react";
import { Upload, FileText, FileSpreadsheet, File, CheckCircle, AlertCircle, Clock, Trash2, RefreshCw } from "lucide-react";
import {
  uploadFile, listFiles, toggleFileActive, deleteFile, getFileStatus,
  type UploadedFile,
} from "../../api";

function FileIcon({ type }: { type: string }) {
  if (type === "xlsx") return <FileSpreadsheet size={18} color="#10B981" />;
  if (type === "pdf")  return <FileText size={18} color="#EF4444" />;
  return <File size={18} color="#6366F1" />;
}

function StatusBadge({ status }: { status: string }) {
  const configs = {
    verified:   { color: '#10B981', bg: '#D1FAE5', icon: <CheckCircle size={11} />, label: 'Verified & Indexed' },
    processing: { color: '#F59E0B', bg: '#FEF3C7', icon: <Clock size={11} />,       label: 'Processing...' },
    failed:     { color: '#EF4444', bg: '#FEE2E2', icon: <AlertCircle size={11} />, label: 'Failed' },
  };
  const c = configs[status as keyof typeof configs] || configs.processing;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '999px', background: c.bg, color: c.color, fontSize: '0.72rem', fontWeight: 600 }}>
      {c.icon} {c.label}
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function UploadData() {
  const [dragging, setDragging]   = useState(false);
  const [files, setFiles]         = useState<UploadedFile[]>([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load files on mount
  useEffect(() => {
    loadFiles();
  }, []);

  // Poll processing files every 5 seconds
  useEffect(() => {
    const processing = files.filter(f => f.status === "processing");
    if (processing.length === 0) return;

    const interval = setInterval(async () => {
      const updated = await Promise.all(
        processing.map(f => getFileStatus(f.id).catch(() => f))
      );
      updated.filter(u => u.status === "failed").forEach(u =>
        setError(`${u.original_name} could not be indexed: ${u.error_msg ?? "unknown error"}`));
      setFiles(prev => prev.map(f => {
        const update = updated.find(u => u.id === f.id);
        return update || f;
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, [files]);

  async function loadFiles() {
    try {
      setLoading(true);
      const data = await listFiles();
      setFiles(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || uploading) return;
    setUploading(true);
    setError(null);

    const failed: string[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const uploaded = await uploadFile(file);
        setFiles(prev => [uploaded, ...prev]);
      } catch (e: any) {
        failed.push(`${file.name}: ${e.message}`);
      }
    }
    if (failed.length) setError(`Upload failed — ${failed.join(" · ")}`);
    if (inputRef.current) inputRef.current.value = "";   // allow re-selecting the same file
    setUploading(false);
  }

  async function handleToggle(fileId: number) {
    try {
      const updated = await toggleFileActive(fileId);
      setFiles(prev => prev.map(f => f.id === fileId ? updated : f));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(fileId: number) {
    const f = files.find(x => x.id === fileId);
    if (!window.confirm(`Delete ${f?.original_name ?? "this file"}? This cannot be undone.`)) return;
    try {
      await deleteFile(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (e: any) {
      setError(e.message);
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const activeCount = files.filter(f => f.is_active && f.status === "verified").length;

  return (
    <div className="grid grid-cols-2 gap-6 h-full" style={{ minHeight: 0 }}>
      {/* Left: Upload Zone */}
      <div className="flex flex-col gap-5 overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>

        {/* Error Banner */}
        {error && (
          <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '10px 14px', color: '#DC2626', fontSize: '0.83rem' }}>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* Drag & Drop */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => { if (!uploading) inputRef.current?.click(); }}
          style={{
            border: `2px dashed ${dragging ? '#0D1B3E' : '#CBD5E1'}`,
            borderRadius: '12px',
            background: dragging ? '#EEF0F5' : '#fff',
            padding: '40px 24px',
            textAlign: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            flex: 1,
            minHeight: 260,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            opacity: uploading ? 0.7 : 1,
          }}>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.pdf"
            multiple
            className="hidden"
            onChange={e => handleFileUpload(e.target.files)}
            disabled={uploading}
          />
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: dragging ? '#0D1B3E' : '#F8F9FA', border: '1.5px solid #E8EAF0', transition: 'all 0.2s' }}>
            {uploading
              ? <RefreshCw size={24} color="#F59E0B" className="animate-spin" />
              : <Upload size={24} color={dragging ? '#F59E0B' : '#5A6480'} />
            }
          </div>
          <p style={{ color: '#0D1B3E', fontWeight: 600, fontSize: '0.95rem', marginBottom: '4px' }}>
            {uploading ? 'Uploading & indexing...' : 'Drop files here or click to browse'}
          </p>
          <p style={{ color: '#5A6480', fontSize: '0.8rem' }}>Supports CSV, Excel (.xlsx) and PDF · maximum file size depends on your plan</p>
          <div className="flex items-center justify-center gap-3 mt-4">
            {['CSV', 'XLSX', 'PDF'].map(ext => (
              <span key={ext} style={{ padding: '3px 10px', borderRadius: '6px', background: '#EEF0F5', color: '#0D1B3E', fontSize: '0.72rem', fontWeight: 600 }}>{ext}</span>
            ))}
          </div>
        </div>

      </div>

      {/* Right: File Table */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E8EAF0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #E8EAF0', flexShrink: 0 }}>
          <h3 style={{ color: '#0D1B3E', fontWeight: 600, fontSize: '0.9rem' }}>
            Uploaded Sources <span style={{ color: '#5A6480', fontWeight: 400 }}>({files.length})</span>
          </h3>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: '0.78rem', color: '#5A6480' }}>{activeCount} active for AI</span>
            <button onClick={loadFiles} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5A6480', display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Header row */}
        <div className="grid px-5 py-2" style={{ gridTemplateColumns: '32px 24px 1fr 80px 90px 110px 36px', gap: '8px', borderBottom: '1px solid #F0F2F7', flexShrink: 0 }}>
          {['', '', 'File Name', 'Size', 'Date', 'Status', ''].map((h, i) => (
            <span key={i} style={{ fontSize: '0.7rem', fontWeight: 600, color: '#5A6480', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
          ))}
        </div>

        <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'none' }}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={20} color="#5A6480" className="animate-spin" />
              <span style={{ marginLeft: '8px', color: '#5A6480', fontSize: '0.85rem' }}>Loading files...</span>
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Upload size={32} color="#CBD5E1" />
              <p style={{ color: '#5A6480', fontSize: '0.85rem', marginTop: '8px' }}>No files uploaded yet</p>
            </div>
          ) : (
            files.map(file => (
              <div
                key={file.id}
                className="grid px-5 py-3 items-center"
                style={{ gridTemplateColumns: '32px 24px 1fr 80px 90px 110px 36px', gap: '8px', borderBottom: '1px solid #F8F9FA', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F8F9FA')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <input
                  type="checkbox"
                  checked={file.is_active}
                  onChange={() => handleToggle(file.id)}
                  disabled={file.status !== "verified"}
                  style={{ width: '14px', height: '14px', accentColor: '#0D1B3E', cursor: 'pointer' }}
                />
                <FileIcon type={file.file_type} />
                <span style={{ fontSize: '0.83rem', color: '#0D1B3E', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.original_name}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#5A6480' }}>{formatSize(file.file_size)}</span>
                <span style={{ fontSize: '0.78rem', color: '#5A6480' }}>{formatDate(file.uploaded_at)}</span>
                <span title={file.error_msg ?? ""}><StatusBadge status={file.status} /></span>
                <button
                  onClick={() => handleDelete(file.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: '4px', display: 'flex', alignItems: 'center' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#CBD5E1')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

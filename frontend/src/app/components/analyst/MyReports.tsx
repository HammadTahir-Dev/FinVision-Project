import { useState, useEffect } from "react";
import {
  Clock, Search, Plus, FileText, FileSpreadsheet,
  Download, RefreshCw, AlertCircle, Trash2, X,
} from "lucide-react";
import {
  listReports, generateReport, downloadPDF, downloadExcel, deleteReport,
  listFiles, listForecasts,
  type ReportRecord, type UploadedFile,
} from "../../api";

// ── Type config ───────────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; badge: string; badgeBg: string; primary: string; secondary: string; light: string; lighter: string }> = {
  "Financial Summary": { label: "Financial", badge: "#1E3A5F", badgeBg: "#EEF3FA", primary: "#1E3A5F", secondary: "#4A6FA5", light: "#D6E4F5", lighter: "#EEF3FA" },
  "Revenue Analysis":  { label: "Revenue",   badge: "#166534", badgeBg: "#DCFCE7", primary: "#16A34A", secondary: "#4ADE80", light: "#BBF7D0", lighter: "#F0FDF4" },
  "Expense Report":    { label: "Expense",   badge: "#92400E", badgeBg: "#FEF3C7", primary: "#D97706", secondary: "#FBBF24", light: "#FDE68A", lighter: "#FFFBEB" },
  "Cash Flow":         { label: "Cash Flow", badge: "#1E40AF", badgeBg: "#DBEAFE", primary: "#2563EB", secondary: "#60A5FA", light: "#BFDBFE", lighter: "#EFF6FF" },
  "Investor Report":   { label: "Investor",  badge: "#5B21B6", badgeBg: "#EDE9FE", primary: "#7C3AED", secondary: "#A78BFA", light: "#DDD6FE", lighter: "#F5F3FF" },
};

const DEFAULT_TYPE = { label: "Report", badge: "#374151", badgeBg: "#F1F5F9", primary: "#374151", secondary: "#94A3B8", light: "#E2E8F0", lighter: "#F8FAFC" };

function getTypeConfig(reportType: string) {
  return TYPE_CONFIG[reportType] || DEFAULT_TYPE;
}

// ── Report Thumbnail ──────────────────────────────────────────────────────────
function ReportThumbnail({ reportType }: { reportType: string }) {
  const c = getTypeConfig(reportType);
  return (
    <svg viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "100%", display: "block" }}>
      <rect width="280" height="160" fill="#F8FAFC" />
      <rect x="0" y="0" width="280" height="38" fill={c.primary} />
      <rect x="12" y="10" width="18" height="18" rx="3" fill="rgba(255,255,255,0.18)" />
      <rect x="14" y="15" width="4" height="8" rx="1" fill="rgba(255,255,255,0.7)" />
      <rect x="20" y="12" width="4" height="11" rx="1" fill="rgba(255,255,255,0.9)" />
      <rect x="26" y="17" width="4" height="6" rx="1" fill="rgba(255,255,255,0.6)" />
      <rect x="38" y="12" width="80" height="5" rx="2" fill="rgba(255,255,255,0.9)" />
      <rect x="38" y="21" width="54" height="4" rx="2" fill="rgba(255,255,255,0.45)" />
      <rect x="12" y="46" width="180" height="3" rx="1.5" fill={c.primary} opacity="0.7" />
      <rect x="12" y="52" width="120" height="2.5" rx="1.25" fill={c.secondary} opacity="0.4" />
      <rect x="12" y="62" width="60" height="24" rx="4" fill={c.primary} />
      <rect x="14" y="71" width="44" height="7" rx="2" fill="rgba(255,255,255,0.9)" />
      <rect x="80" y="62" width="60" height="24" rx="4" fill={c.light} />
      <rect x="82" y="71" width="44" height="7" rx="2" fill={c.primary} opacity="0.75" />
      <rect x="148" y="62" width="60" height="24" rx="4" fill={c.lighter} />
      <rect x="150" y="71" width="44" height="7" rx="2" fill={c.secondary} opacity="0.8" />
      <rect x="12" y="94" width="256" height="12" rx="2" fill={c.primary} opacity="0.08" />
      {[0, 1, 2].map(i => (
        <g key={i}>
          <rect x="12" y={110 + i * 13} width="256" height="10" rx="2" fill={i % 2 === 0 ? "#fff" : "#F8FAFC"} />
          <rect x="16" y={113 + i * 13} width={36 + i * 4} height="2.5" rx="1.25" fill={c.primary} opacity="0.45" />
          <rect x="155" y={113 + i * 13} width={28 - i * 2} height="2.5" rx="1.25" fill={c.secondary} opacity="0.55" />
        </g>
      ))}
      <rect x="0" y="157" width="280" height="3" fill={c.primary} opacity="0.15" />
    </svg>
  );
}

// ── Generate Report Modal ─────────────────────────────────────────────────────
function GenerateModal({
  onClose, onGenerated,
}: {
  onClose: () => void;
  onGenerated: (r: ReportRecord) => void;
}) {
  const [files, setFiles]           = useState<UploadedFile[]>([]);
  const [forecasts, setForecasts]   = useState<any[]>([]);
  const [reportType, setReportType] = useState("Financial Summary");
  const [company, setCompany]       = useState("My Company");
  const [period, setPeriod]         = useState("2024-2025");
  const [selectedFiles, setSelectedFiles] = useState<number[]>([]);
  const [forecastId, setForecastId] = useState<number | undefined>(undefined);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  useEffect(() => {
    listFiles().then(f => {
      const verified = f.filter(x => x.status === "verified" && x.is_active);
      setFiles(verified);
      setSelectedFiles(verified.map(x => x.id));
    });
    listForecasts().then(setForecasts).catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!company.trim()) { setError("Please enter company name."); return; }
    setLoading(true); setError("");
    try {
      const result = await generateReport({
        report_type:  reportType,
        company_name: company,
        period,
        file_ids:     selectedFiles.length > 0 ? selectedFiles : undefined,
        forecast_id:  forecastId,
      });
      onGenerated(result);
      onClose();
    } catch (e: any) {
      setError(e.message || "Report generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px", border: "1.5px solid #E2E8F0",
    borderRadius: 8, fontSize: "0.85rem", color: "#0D1B3E", outline: "none",
    boxSizing: "border-box", fontFamily: "Inter, sans-serif",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: 480, maxHeight: "90vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ color: "#0D1B3E", fontWeight: 700, fontSize: "1.1rem" }}>Generate New Report</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", display: "flex" }}><X size={20} /></button>
        </div>

        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
            <AlertCircle size={14} color="#DC2626" />
            <p style={{ fontSize: "0.82rem", color: "#DC2626" }}>{error}</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Report Type */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#374151", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.07em" }}>Report Type</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.keys(TYPE_CONFIG).map(t => (
                <button key={t} onClick={() => setReportType(t)}
                  style={{
                    padding: "7px 12px", borderRadius: 8, border: "1.5px solid",
                    borderColor: reportType === t ? "#0D1B3E" : "#E2E8F0",
                    background: reportType === t ? "#0D1B3E" : "#fff",
                    color: reportType === t ? "#fff" : "#64748B",
                    fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
                  }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Company + Period */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#374151", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.07em" }}>Company Name</label>
              <input value={company} onChange={e => setCompany(e.target.value)} style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#0D1B3E"}
                onBlur={e => e.target.style.borderColor = "#E2E8F0"} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#374151", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.07em" }}>Period</label>
              <input value={period} onChange={e => setPeriod(e.target.value)} placeholder="e.g. 2024-2025" style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#0D1B3E"}
                onBlur={e => e.target.style.borderColor = "#E2E8F0"} />
            </div>
          </div>

          {/* File selection */}
          {files.length > 0 && (
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#374151", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.07em" }}>Data Sources</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {files.map(f => (
                  <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "#F8FAFC", border: "1px solid #E2E8F0", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedFiles.includes(f.id)}
                      onChange={e => setSelectedFiles(prev => e.target.checked ? [...prev, f.id] : prev.filter(id => id !== f.id))}
                      style={{ accentColor: "#0D1B3E" }} />
                    <span style={{ fontSize: "0.82rem", color: "#0D1B3E", fontWeight: 500 }}>{f.original_name}</span>
                    <span style={{ fontSize: "0.72rem", color: "#94A3B8", marginLeft: "auto" }}>{f.chunk_count} chunks</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Forecast selection */}
          {forecasts.length > 0 && (
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#374151", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.07em" }}>Include Forecast (optional)</label>
              <select value={forecastId || ""} onChange={e => setForecastId(e.target.value ? Number(e.target.value) : undefined)}
                style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="">None</option>
                {forecasts.map(f => (
                  <option key={f.id} value={f.id}>{f.metric} — {f.horizon} ({new Date(f.created_at).toLocaleDateString()})</option>
                ))}
              </select>
            </div>
          )}

          {/* Generate button */}
          <button onClick={handleGenerate} disabled={loading}
            style={{
              padding: "12px", background: loading ? "#1A2D5A" : "#0D1B3E",
              color: "#fff", border: "none", borderRadius: 9, fontWeight: 700,
              fontSize: "0.9rem", cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontFamily: "Inter, sans-serif", marginTop: 4,
            }}>
            {loading ? <><RefreshCw size={15} className="animate-spin" /> Generating report…</> : "Generate Report"}
          </button>

          {loading && (
            <p style={{ textAlign: "center", fontSize: "0.75rem", color: "#94A3B8" }}>
              This may take 15–30 seconds. Groq is writing your report…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Report Card ───────────────────────────────────────────────────────────────
function ReportCard({ report, onDelete }: { report: ReportRecord; onDelete: (id: number) => void }) {
  const [dlState, setDlState] = useState<"pdf" | "xlsx" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const c = getTypeConfig(report.report_type);

  const handleDownloadPDF = async () => {
    setDlState("pdf");
    try { await downloadPDF(report.id, report.title); }
    catch (e: any) { alert("PDF download failed: " + e.message); }
    finally { setDlState(null); }
  };

  const handleDownloadExcel = async () => {
    setDlState("xlsx");
    try { await downloadExcel(report.id, report.title); }
    catch (e: any) { alert("Excel download failed: " + e.message); }
    finally { setDlState(null); }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this report?")) return;
    setDeleting(true);
    try { await deleteReport(report.id); onDelete(report.id); }
    catch (e: any) { alert("Delete failed: " + e.message); setDeleting(false); }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E8EAF0", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", transition: "box-shadow 0.2s, transform 0.2s" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 8px 28px rgba(13,27,62,0.10)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; e.currentTarget.style.transform = "translateY(0)"; }}>

      <div style={{ height: 148, overflow: "hidden", borderBottom: "1px solid #F0F2F7" }}>
        <ReportThumbnail reportType={report.report_type} />
      </div>

      <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <h3 style={{ fontSize: "0.88rem", fontWeight: 700, color: "#0D1B3E", lineHeight: 1.35, flex: 1 }}>{report.title}</h3>
          <span style={{ padding: "3px 9px", borderRadius: 999, fontSize: "0.65rem", fontWeight: 800, flexShrink: 0, color: c.badge, background: c.badgeBg }}>{c.label}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 14 }}>
          <Clock size={12} color="#94A3B8" />
          <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>{new Date(report.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          <span style={{ fontSize: "0.65rem", color: "#CBD5E1", margin: "0 2px" }}>·</span>
          <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>{report.page_count}p · {report.file_size_kb}KB</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
          {report.has_pdf && (
            <button onClick={handleDownloadPDF} disabled={dlState === "pdf"}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 10px", borderRadius: 8, cursor: dlState === "pdf" ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "0.78rem", border: "none", background: dlState === "pdf" ? "#EEF0F5" : "#0D1B3E", color: dlState === "pdf" ? "#94A3B8" : "#fff", fontFamily: "Inter, sans-serif" }}>
              {dlState === "pdf" ? <RefreshCw size={13} className="animate-spin" /> : <FileText size={13} />}
              {dlState === "pdf" ? "Exporting…" : "Export PDF"}
            </button>
          )}
          {report.has_excel && (
            <button onClick={handleDownloadExcel} disabled={dlState === "xlsx"}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 10px", borderRadius: 8, cursor: dlState === "xlsx" ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "0.78rem", border: "1.5px solid #E2E8F0", background: "#fff", color: "#374151", fontFamily: "Inter, sans-serif" }}>
              {dlState === "xlsx" ? <RefreshCw size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
              {dlState === "xlsx" ? "Exporting…" : "Export Excel"}
            </button>
          )}
          <button onClick={handleDelete} disabled={deleting}
            style={{ width: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#fff", cursor: "pointer", color: "#CBD5E1", transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#EF4444"; e.currentTarget.style.color = "#EF4444"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.color = "#CBD5E1"; }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function MyReports() {
  const [reports, setReports]     = useState<ReportRecord[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [showModal, setShowModal] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => { loadReports(); }, []);

  async function loadReports() {
    try {
      setLoading(true);
      const data = await listReports();
      setReports(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = reports.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase()) ||
    r.report_type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16, minHeight: 0, fontFamily: "Inter, sans-serif" }}>

      {showModal && (
        <GenerateModal
          onClose={() => setShowModal(false)}
          onGenerated={r => setReports(prev => [r, ...prev])}
        />
      )}

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 300 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports…"
            style={{ width: "100%", padding: "9px 14px 9px 34px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: "0.84rem", color: "#0D1B3E", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: "Inter, sans-serif" }}
            onFocus={e => e.target.style.borderColor = "#0D1B3E"}
            onBlur={e => e.target.style.borderColor = "#E2E8F0"} />
        </div>

        <button onClick={loadReports} style={{ background: "none", border: "1.5px solid #E2E8F0", borderRadius: 9, cursor: "pointer", color: "#64748B", padding: "9px 12px", display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem" }}>
          <RefreshCw size={14} /> Refresh
        </button>

        <button onClick={() => setShowModal(true)}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "#0D1B3E", border: "none", borderRadius: 9, color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
          <Plus size={14} /> Generate Report
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 16px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <AlertCircle size={14} color="#DC2626" />
          <p style={{ fontSize: "0.82rem", color: "#DC2626", flex: 1 }}>{error}</p>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#DC2626" }}>×</button>
        </div>
      )}

      {/* Count */}
      <div style={{ flexShrink: 0 }}>
        <span style={{ fontSize: "0.78rem", color: "#64748B", fontWeight: 500 }}>
          {filtered.length} report{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 10 }}>
            <RefreshCw size={20} color="#94A3B8" className="animate-spin" />
            <span style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Loading reports...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#94A3B8" }}>
            <FileText size={36} color="#E2E8F0" style={{ margin: "0 auto 12px", display: "block" }} />
            <p style={{ fontWeight: 600, color: "#64748B", marginBottom: 4 }}>
              {reports.length === 0 ? "No reports yet" : "No reports match your search"}
            </p>
            <p style={{ fontSize: "0.82rem", marginBottom: 16 }}>
              {reports.length === 0 ? "Generate your first AI-powered financial report" : "Try a different search term"}
            </p>
            {reports.length === 0 && (
              <button onClick={() => setShowModal(true)}
                style={{ padding: "10px 20px", background: "#0D1B3E", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
                Generate First Report
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))", gap: 16, alignContent: "start", paddingBottom: 8 }}>
            {filtered.map(r => (
              <ReportCard key={r.id} report={r} onDelete={id => setReports(prev => prev.filter(x => x.id !== id))} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

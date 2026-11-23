import { useState, useRef, useEffect } from "react";
import {
  Send, FileText, FileSpreadsheet, Cpu, CheckCircle, AlertTriangle,
  Trash2, Filter, Calculator, ArrowRightLeft, Table, Search, Scissors,
  ChevronRight, Info, Sparkles, RotateCcw, Download, RefreshCw, Undo2,
} from "lucide-react";
import {
  listFiles, preprocessFile, getPreprocessPreview, undoPreprocess, downloadPreprocessed,
  type UploadedFile, type DataProfile, type TablePreview, type PreprocessResult,
} from "../../api";
import { renderLine } from "./safeHtml";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TransformStep {
  id: number;
  batch: number;      // all steps from one command share a batch (one undo reverts them all)
  command: string;
  action: string;
  affected: string;
  rows: number;
  status: "success" | "warning" | "info";
  time: string;
}

interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text: string;
  preview?: TablePreview;
  note?: string;
  tone?: "error";
}

// ── Quick actions (all handled instantly by the rule engine, no AI needed) ────
const QUICK_ACTIONS = [
  { label: "Show missing values",           icon: <Search size={12} /> },
  { label: "Remove duplicate rows",         icon: <Trash2 size={12} /> },
  { label: "Fill missing values with mean", icon: <Filter size={12} /> },
  { label: "Fill missing values with 0",    icon: <Filter size={12} /> },
  { label: "Drop rows with null values",    icon: <Trash2 size={12} /> },
  { label: "Add profit margin column",      icon: <Calculator size={12} /> },
  { label: "Normalize revenue column",      icon: <ArrowRightLeft size={12} /> },
  { label: "Trim extra spaces",             icon: <Scissors size={12} /> },
];

const READ_ONLY_OPS = new Set(["show_missing", "show_duplicates", "describe", "show_columns"]);

const HELP_TEXT =
  "Describe what you'd like to do in plain English. You can chain steps with \"and\":\n" +
  "• \"Remove duplicates and fill missing values with mean\"\n" +
  "• \"Rename Units to Quantity\" · \"Drop column Notes\"\n" +
  "• \"Add column Profit = Revenue - Expense\"\n" +
  "• \"Remove rows where Revenue < 0\" · \"Sort by Date descending\"\n" +
  "• \"Convert Date to date\" · \"Round Revenue to 2 decimals\"\n" +
  "Every change can be undone, and you can download the cleaned file.";

// ── Data preview table ─────────────────────────────────────────────────────────
function DataTable({ preview, note }: { preview: TablePreview; note?: string }) {
  if (!preview.columns.length) return null;
  return (
    <div style={{ marginTop: 12, borderRadius: 8, overflow: "hidden", border: "1px solid #E2E8F0" }}>
      <div style={{ overflowX: "auto", scrollbarWidth: "thin" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem", fontFamily: "monospace" }}>
          <thead>
            <tr style={{ background: "#0D1B3E" }}>
              {preview.columns.map((c, i) => (
                <th key={i} style={{ padding: "7px 10px", color: "#F59E0B", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#F8FAFC", borderBottom: "1px solid #F0F2F7" }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: "6px 10px", color: cell === null ? "#EF4444" : "#0D1B3E", whiteSpace: "nowrap", fontStyle: cell === null ? "italic" : "normal" }}>
                    {cell === null ? "missing" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && (
        <div style={{ padding: "6px 10px", background: "#F8FAFC", borderTop: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 6 }}>
          <Info size={11} color="#94A3B8" />
          <span style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{note}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ padding: "6px 8px", borderRadius: 7, background: warn && value > 0 ? "#FEF3C7" : "#F8FAFC", border: "1px solid #E8EAF0" }}>
      <p style={{ fontSize: "0.6rem", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>{label}</p>
      <p style={{ fontSize: "0.85rem", fontWeight: 800, color: warn && value > 0 ? "#B45309" : "#0D1B3E" }}>{value.toLocaleString()}</p>
    </div>
  );
}

const nowTime = () => new Date().toLocaleTimeString("en-US", { hour12: false });

// ── Main component ─────────────────────────────────────────────────────────────
export function PreprocessData() {
  const [files, setFiles]               = useState<UploadedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);
  const [sheets, setSheets]             = useState<string[]>([]);
  const [sheet, setSheet]               = useState<string | null>(null);
  const [profile, setProfile]           = useState<DataProfile | null>(null);
  const [canUndo, setCanUndo]           = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [messages, setMessages]         = useState<ChatMessage[]>([{
    id: 0, role: "ai",
    text: "Hello! I'm your **Data Preprocessing Assistant**.\n\nSelect a CSV or Excel file from the left panel to start.",
  }]);
  const [input, setInput]               = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transformLog, setTransformLog] = useState<TransformStep[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgId     = useRef(1);

  const addMessages = (...m: Omit<ChatMessage, "id">[]) =>
    setMessages(prev => [...prev, ...m.map(x => ({ ...x, id: msgId.current++ }))]);

  useEffect(() => { loadFiles(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isProcessing]);

  async function loadFiles(keepSelection = false) {
    try {
      setLoadingFiles(true);
      const all = await listFiles();
      const tabular = all.filter(f => (f.file_type === "csv" || f.file_type === "xlsx") && f.status !== "failed");
      setFiles(tabular);
      const keep = keepSelection && selectedFile ? tabular.find(f => f.id === selectedFile.id) : undefined;
      if (keep) { setSelectedFile(keep); return; }
      const first = tabular.find(f => f.status === "verified");
      if (first) await openFile(first, null, true);
    } catch (e: any) {
      addMessages({ role: "ai", text: `❌ Could not load files: ${e.message}. Make sure the backend is running.`, tone: "error" });
    } finally {
      setLoadingFiles(false);
    }
  }

  async function openFile(file: UploadedFile, sheetName: string | null, greet: boolean) {
    setSelectedFile(file);
    if (greet) setTransformLog([]);
    try {
      const snap = await getPreprocessPreview(file.id, sheetName);
      setSheets(snap.sheets);
      setSheet(snap.sheet);
      setProfile(snap.profile);
      setCanUndo(snap.can_undo);
      const p = snap.profile;
      const issues = [
        p.total_nulls ? `${p.total_nulls} missing values` : null,
        p.duplicate_rows ? `${p.duplicate_rows} duplicate rows` : null,
      ].filter(Boolean).join(" and ");
      const intro = `Active dataset: **${file.original_name}**${snap.sheet ? ` (sheet **${snap.sheet}**)` : ""} — ${p.rows.toLocaleString()} rows × ${p.columns} columns.\n` +
        (issues ? `⚠️ Found ${issues}.` : "✅ No missing values or duplicate rows.");
      const msg = { role: "ai" as const, text: greet ? `${intro}\n\n${HELP_TEXT}` : intro, preview: snap.preview, note: `First ${snap.preview.rows.length} rows` };
      if (greet) setMessages([{ ...msg, id: msgId.current++ }]);
      else addMessages(msg);
    } catch (e: any) {
      addMessages({ role: "ai", text: `❌ Could not open **${file.original_name}**: ${e.message}`, tone: "error" });
    }
  }

  const send = async (text: string) => {
    if (!text.trim() || isProcessing) return;
    setInput("");
    addMessages({ role: "user", text });
    if (!selectedFile) {
      addMessages({ role: "ai", text: "Please select a CSV or Excel file from the left panel first." });
      return;
    }
    setIsProcessing(true);
    try {
      const result: PreprocessResult = await preprocessFile(selectedFile.id, text, sheet);
      if (result.success) {
        const steps = result.steps || [];
        const changed = !!result.changed;
        const lines = steps.map(s => `${READ_ONLY_OPS.has(s.operation) ? "ℹ️" : "✅"} ${s.description}`);
        const shape = changed
          ? `\nRows: ${result.before_shape?.[0]} → ${result.after_shape?.[0]} · Columns: ${result.before_shape?.[1]} → ${result.after_shape?.[1]} · Missing values: ${result.before_nulls} → ${result.after_nulls}`
          : "";
        const via = result.parsed_by === "ai" ? "\n(interpreted by AI)" : "";
        addMessages({
          role: "ai",
          text: lines.join("\n") + shape + via,
          preview: changed ? result.preview : undefined,
          note: changed ? `Updated data · first ${result.preview?.rows.length ?? 0} rows · saved to file` : undefined,
        });
        if (result.profile) setProfile(result.profile);
        setCanUndo(!!result.can_undo);
        const t = nowTime();
        const batch = Date.now();
        setTransformLog(prev => [
          ...steps.map((s, i) => ({
            id: batch + i,
            batch,
            command: s.command,
            action: s.description,
            affected: selectedFile.original_name + (sheet ? ` · ${sheet}` : ""),
            rows: s.affected,
            status: (changed ? "success" : "info") as TransformStep["status"],
            time: t,
          })).reverse(),
          ...prev,
        ]);
        if (changed && result.file_size) {
          setFiles(prev => prev.map(f => f.id === selectedFile.id ? { ...f, file_size: result.file_size! } : f));
        }
      } else {
        addMessages({ role: "ai", text: `⚠️ ${result.error || "Could not apply that command."}`, tone: "error" });
      }
    } catch (e: any) {
      addMessages({ role: "ai", text: `❌ Error: ${e.message}. Make sure your backend is running.`, tone: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  const undo = async () => {
    if (!selectedFile || isProcessing) return;
    setIsProcessing(true);
    try {
      const snap = await undoPreprocess(selectedFile.id, sheet);
      setProfile(snap.profile);
      setCanUndo(snap.can_undo);
      // remove every step of the most recent change (a chained command is one undo)
      setTransformLog(prev => {
        const last = prev.find(s => s.status === "success");
        return last ? prev.filter(s => s.batch !== last.batch) : prev;
      });
      addMessages({ role: "ai", text: "↩️ **Last change undone.** The file has been restored.", preview: snap.preview, note: "Restored data" });
    } catch (e: any) {
      addMessages({ role: "ai", text: `⚠️ ${e.message}`, tone: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  const download = async () => {
    if (!selectedFile) return;
    try { await downloadPreprocessed(selectedFile.id, selectedFile.original_name); }
    catch (e: any) { addMessages({ role: "ai", text: `⚠️ Download failed: ${e.message}`, tone: "error" }); }
  };

  const selectFile = (file: UploadedFile) => {
    if (file.status !== "verified" || file.id === selectedFile?.id) return;
    openFile(file, null, true);
  };

  const statusColor = { success: "#10B981", warning: "#F59E0B", info: "#6366F1" };
  const statusBg    = { success: "#D1FAE5", warning: "#FEF3C7", info: "#EDE9FE" };
  const statusIcon  = { success: <CheckCircle size={12}/>, warning: <AlertTriangle size={12}/>, info: <Info size={12}/> };
  const headerBtn   = (enabled: boolean) => ({
    padding: "5px 10px", borderRadius: 7, border: "1px solid #E2E8F0", background: "#fff",
    cursor: enabled ? "pointer" : "not-allowed", opacity: enabled ? 1 : 0.45, fontSize: "0.72rem", color: "#64748B",
    display: "flex", alignItems: "center", gap: 4, fontFamily: "Inter, sans-serif",
  });
  const changeCount = transformLog.filter(s => s.status === "success").length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 260px", gap: 16, height: "100%", minHeight: 0 }}>

      {/* Column 1: File selector */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", padding: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em" }}>Active Dataset</h3>
          <button onClick={() => loadFiles(true)} title="Refresh" style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", display: "flex" }}><RefreshCw size={12}/></button>
        </div>
        <div style={{ flex: 1, overflow: "auto", scrollbarWidth: "none" }}>
          {loadingFiles ? (
            <p style={{ fontSize: "0.78rem", color: "#94A3B8", textAlign: "center", paddingTop: 20 }}>Loading...</p>
          ) : files.length === 0 ? (
            <p style={{ fontSize: "0.75rem", color: "#94A3B8", textAlign: "center", paddingTop: 20, lineHeight: 1.5 }}>No CSV or Excel files. Upload in the Upload tab first.</p>
          ) : (
            files.map(f => {
              const active = selectedFile?.id === f.id;
              const ready  = f.status === "verified";
              return (
                <button key={f.id} onClick={() => selectFile(f)} disabled={!ready}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: `2px solid ${active ? "#0D1B3E" : "#E8EAF0"}`, background: active ? "#EEF0F5" : "#F8FAFC", cursor: ready ? "pointer" : "wait", opacity: ready ? 1 : 0.6, textAlign: "left", marginBottom: 8, transition: "all 0.15s", fontFamily: "Inter, sans-serif" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    {f.file_type === "xlsx" ? <FileSpreadsheet size={14} color="#10B981"/> : <FileText size={14} color="#6366F1"/>}
                    <p style={{ fontSize: "0.72rem", fontWeight: 700, color: active ? "#0D1B3E" : "#374151", lineHeight: 1.2, wordBreak: "break-word" }}>{f.original_name}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.62rem", color: "#94A3B8", background: "#F0F2F7", padding: "1px 5px", borderRadius: 4 }}>{ready ? `${f.chunk_count} chunks` : "indexing…"}</span>
                    <span style={{ fontSize: "0.62rem", color: "#94A3B8", background: "#F0F2F7", padding: "1px 5px", borderRadius: 4 }}>{Math.max(1, Math.round(f.file_size / 1024))}KB</span>
                  </div>
                  {active && <div style={{ marginTop: 5, fontSize: "0.62rem", color: "#10B981", fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: "#10B981" }}/> Active</div>}
                </button>
              );
            })
          )}
        </div>
        {profile && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
            <Stat label="Rows" value={profile.rows}/>
            <Stat label="Columns" value={profile.columns}/>
            <Stat label="Missing" value={profile.total_nulls} warn/>
            <Stat label="Duplicates" value={profile.duplicate_rows} warn/>
          </div>
        )}
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "#EEF0F5", marginTop: 8, textAlign: "center" }}>
          <p style={{ fontSize: "0.68rem", color: "#5A6480" }}>{changeCount} transform{changeCount === 1 ? "" : "s"} applied</p>
        </div>
      </div>

      {/* Column 2: Chat */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #E8EAF0", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #0D1B3E, #1A2D5A)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Cpu size={18} color="#F59E0B"/>
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 700, color: "#0D1B3E", fontSize: "0.9rem", lineHeight: 1 }}>Data Preprocessing Assistant</p>
            <p style={{ fontSize: "0.7rem", color: selectedFile ? "#10B981" : "#94A3B8", marginTop: 2, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {selectedFile ? `● Ready · ${selectedFile.original_name}` : "● Select a file to start"}
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {sheets.length > 1 && selectedFile && (
              <select value={sheet ?? ""} disabled={isProcessing} title="Sheet"
                onChange={e => openFile(selectedFile, e.target.value, false)}
                style={{ padding: "4px 8px", borderRadius: 7, border: "1px solid #E2E8F0", fontSize: "0.72rem", color: "#0D1B3E", fontFamily: "Inter, sans-serif" }}>
                {sheets.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <button onClick={undo} disabled={!canUndo || isProcessing} title="Undo the last change" style={headerBtn(canUndo && !isProcessing)}>
              <Undo2 size={12}/> Undo
            </button>
            <button onClick={download} disabled={!selectedFile} title="Download the current (cleaned) file" style={headerBtn(!!selectedFile)}>
              <Download size={12}/> Download
            </button>
            <button onClick={() => { setMessages([{ id: msgId.current++, role: "ai", text: `Chat cleared. Your file changes are kept (use **Undo** to revert).\n\n${HELP_TEXT}` }]); setTransformLog([]); }}
              title="Clear the conversation" style={headerBtn(true)}>
              <RotateCcw size={12}/> Reset
            </button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: 18, scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: 16 }}>
          {messages.map(msg => (
            <div key={msg.id}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                <div style={{ width: 30, height: 30, borderRadius: msg.role === "ai" ? 8 : "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: msg.role === "ai" ? "linear-gradient(135deg, #0D1B3E, #1A2D5A)" : "#F59E0B" }}>
                  {msg.role === "ai" ? <Cpu size={14} color="#F59E0B"/> : <span style={{ color: "#0D1B3E", fontWeight: 700, fontSize: "0.65rem" }}>YOU</span>}
                </div>
                <div style={{ maxWidth: "80%", padding: "11px 14px", borderRadius: msg.role === "ai" ? "4px 12px 12px 12px" : "12px 4px 12px 12px", background: msg.role === "ai" ? (msg.tone === "error" ? "#FFFBEB" : "#F8FAFC") : "#0D1B3E", border: msg.role === "ai" ? `1px solid ${msg.tone === "error" ? "#FDE68A" : "#E8EAF0"}` : "none", color: msg.role === "ai" ? "#0D1B3E" : "#fff", fontSize: "0.83rem", lineHeight: 1.65, wordBreak: "break-word" }}>
                  {msg.text.split("\n").map((line, i) => (
                    <p key={i} style={{ margin: i > 0 ? "4px 0 0" : 0 }} dangerouslySetInnerHTML={{ __html: renderLine(line) || "&nbsp;" }}/>
                  ))}
                </div>
              </div>
              {msg.preview && msg.role === "ai" && <div style={{ marginLeft: 40 }}><DataTable preview={msg.preview} note={msg.note}/></div>}
            </div>
          ))}

          {isProcessing && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #0D1B3E, #1A2D5A)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Cpu size={14} color="#F59E0B"/>
              </div>
              <div style={{ padding: "11px 16px", borderRadius: "4px 12px 12px 12px", background: "#F8FAFC", border: "1px solid #E8EAF0", display: "flex", alignItems: "center", gap: 8 }}>
                <RefreshCw size={14} color="#0D1B3E" style={{ animation: "spin 1s linear infinite" }}/>
                <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Working on {selectedFile?.original_name}…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Quick actions */}
        <div style={{ padding: "8px 14px", borderTop: "1px solid #F0F2F7", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
            {QUICK_ACTIONS.map(a => (
              <button key={a.label} onClick={() => send(a.label)} disabled={isProcessing}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, border: "1px solid #E2E8F0", background: "#F8FAFC", cursor: isProcessing ? "not-allowed" : "pointer", fontSize: "0.7rem", color: "#374151", fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s", fontFamily: "Inter, sans-serif" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#0D1B3E"; e.currentTarget.style.background = "#EEF0F5"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.background = "#F8FAFC"; }}>
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #E8EAF0", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", background: "#F8FAFC", borderRadius: 12, border: "1.5px solid #E8EAF0", padding: "8px 12px" }}>
            <Sparkles size={15} color="#94A3B8" style={{ flexShrink: 0, marginBottom: 2 }}/>
            <textarea value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="Describe what to do… e.g. 'Remove duplicates and fill missing values'"
              rows={1}
              style={{ flex: 1, background: "none", border: "none", outline: "none", resize: "none", fontSize: "0.85rem", color: "#0D1B3E", fontFamily: "Inter, sans-serif", lineHeight: 1.5 }}/>
            <button onClick={() => send(input)} disabled={!input.trim() || isProcessing}
              style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: input.trim() && !isProcessing ? "#0D1B3E" : "#EEF0F5", cursor: input.trim() && !isProcessing ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.2s" }}>
              <Send size={14} color={input.trim() && !isProcessing ? "#fff" : "#94A3B8"}/>
            </button>
          </div>
        </div>
      </div>

      {/* Column 3: Transform log */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", padding: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em" }}>Transform Log</h3>
          {transformLog.length > 0 && (
            <button onClick={() => setTransformLog([])}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", fontSize: "0.65rem", display: "flex", alignItems: "center", gap: 3, fontFamily: "Inter, sans-serif" }}>
              <Trash2 size={10}/> Clear
            </button>
          )}
        </div>

        {transformLog.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#94A3B8", fontSize: "0.8rem" }}>
            <div>
              <Table size={28} color="#E2E8F0" style={{ margin: "0 auto 8px", display: "block" }}/>
              Transform steps will appear here as you preprocess data
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {transformLog.map((step, idx) => (
                <div key={step.id} style={{ padding: "10px 12px", borderRadius: 8, background: statusBg[step.status], border: `1px solid ${statusColor[step.status]}30` }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                    <div style={{ color: statusColor[step.status], flexShrink: 0, marginTop: 1 }}>{statusIcon[step.status]}</div>
                    <p style={{ fontSize: "0.78rem", fontWeight: 700, color: "#0D1B3E", lineHeight: 1.3 }}>{step.action}</p>
                    <span style={{ marginLeft: "auto", fontSize: "0.62rem", color: "#94A3B8", flexShrink: 0 }}>#{transformLog.length - idx}</span>
                  </div>
                  <p style={{ fontSize: "0.7rem", color: "#64748B", marginLeft: 18 }}>{step.affected}</p>
                  {step.rows > 0 && step.status === "success" && (
                    <div style={{ marginLeft: 18, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: "0.68rem", fontWeight: 700, color: statusColor[step.status], fontFamily: "monospace" }}>{step.rows.toLocaleString()}</span>
                      <span style={{ fontSize: "0.65rem", color: "#94A3B8" }}>rows/cells affected</span>
                    </div>
                  )}
                  <p style={{ fontSize: "0.62rem", color: "#94A3B8", marginLeft: 18, marginTop: 3, fontFamily: "monospace" }}>{step.time}</p>
                </div>
              ))}
            </div>

            {/* Pipeline summary */}
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "#0D1B3E", marginBottom: 6 }}>Pipeline Summary</p>
              {[...transformLog].reverse().filter(s => s.status === "success").map((s, i, arr) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: i < arr.length - 1 ? 4 : 0 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, background: statusColor[s.status], display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", color: "#fff", fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                  <span style={{ fontSize: "0.7rem", color: "#374151" }}>{s.action}</span>
                  {i < arr.length - 1 && <ChevronRight size={10} color="#CBD5E1" style={{ marginLeft: "auto", flexShrink: 0 }}/>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

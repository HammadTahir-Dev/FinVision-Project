import { useState, useRef, useEffect } from "react";
import {
  Send, FileText, FileSpreadsheet, Cpu, CheckCircle, AlertTriangle,
  Trash2, Filter, Merge, Calculator, ArrowRightLeft, Table,
  ChevronRight, Info, Sparkles, RotateCcw, Download, RefreshCw,
} from "lucide-react";
import { listFiles, preprocessFile, type UploadedFile } from "../../api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TransformStep {
  id: number;
  command: string;
  action: string;
  affected: string;
  rows: number;
  status: "success" | "warning" | "info";
  time: string;
}

interface DataPreview {
  columns: string[];
  rows: string[][];
  totalRows: number;
  note?: string;
}

interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text: string;
  preview?: DataPreview;
  steps?: TransformStep[];
}

// ── Quick actions ─────────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: "Remove duplicate rows",        icon: <Trash2 size={12} /> },
  { label: "Fill missing values with 0",   icon: <Filter size={12} /> },
  { label: "Fill missing values with mean",icon: <Filter size={12} /> },
  { label: "Add profit margin column",     icon: <Calculator size={12} /> },
  { label: "Normalize revenue column",     icon: <ArrowRightLeft size={12} /> },
  { label: "Drop rows with null values",   icon: <Trash2 size={12} /> },
];

// ── Data preview table ─────────────────────────────────────────────────────────
function DataTable({ preview }: { preview: DataPreview }) {
  return (
    <div style={{ marginTop: 12, borderRadius: 8, overflow: "hidden", border: "1px solid #E2E8F0" }}>
      <div style={{ overflowX: "auto", scrollbarWidth: "thin" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem", fontFamily: "monospace" }}>
          <thead>
            <tr style={{ background: "#0D1B3E" }}>
              {preview.columns.map(c => (
                <th key={c} style={{ padding: "7px 10px", color: "#F59E0B", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#F8FAFC", borderBottom: "1px solid #F0F2F7" }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: "6px 10px", color: cell === "—" ? "#94A3B8" : "#0D1B3E", whiteSpace: "nowrap" }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.note && (
        <div style={{ padding: "6px 10px", background: "#F8FAFC", borderTop: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 6 }}>
          <Info size={11} color="#94A3B8" />
          <span style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{preview.note}</span>
        </div>
      )}
    </div>
  );
}

// ── Build preview from API result ─────────────────────────────────────────────
function buildPreview(result: any): DataPreview | undefined {
  if (!result?.preview || result.preview.length === 0) return undefined;
  const rows      = result.preview;
  const columns   = Object.keys(rows[0]);
  const tableRows = rows.map((r: any) => columns.map(c => String(r[c] ?? "—")));
  return {
    columns,
    rows: tableRows,
    totalRows: result.after_shape?.[0] ?? rows.length,
    note: result.description
      ? `${result.description} · Before: ${result.before_shape?.[0]} rows → After: ${result.after_shape?.[0]} rows`
      : `Showing ${rows.length} rows`,
  };
}

// ── Main component ─────────────────────────────────────────────────────────────
export function PreprocessData() {
  const [files, setFiles]               = useState<UploadedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [messages, setMessages]         = useState<ChatMessage[]>([{
    id: 0,
    role: "ai",
    text: "Hello! I'm your **Data Preprocessing Assistant**.\n\nSelect a CSV or Excel file from the left panel, then describe what you'd like to do with it in plain English.\n\nExamples:\n• \"Remove duplicate rows\"\n• \"Fill missing values with 0\"\n• \"Normalize the revenue column\"",
  }]);
  const [input, setInput]               = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transformLog, setTransformLog] = useState<TransformStep[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgId     = useRef(1);

  useEffect(() => {
    loadFiles();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadFiles() {
    try {
      setLoadingFiles(true);
      const all = await listFiles();
      const csvXlsx = all.filter(f => f.status === "verified" && (f.file_type === "csv" || f.file_type === "xlsx"));
      setFiles(csvXlsx);
      if (csvXlsx.length > 0) {
        setSelectedFile(csvXlsx[0]);
        setMessages([{
          id: 0, role: "ai",
          text: `Hello! I'm your **Data Preprocessing Assistant**.\n\nActive dataset: **${csvXlsx[0].original_name}** (${csvXlsx[0].chunk_count} chunks indexed).\n\nDescribe what you'd like to do in plain English:\n• "Remove duplicate rows"\n• "Fill missing values with 0"\n• "Normalize the revenue column"`,
        }]);
      }
    } catch(e) {
      console.error(e);
    } finally {
      setLoadingFiles(false);
    }
  }

  const send = async (text: string) => {
    if (!text.trim() || isProcessing) return;
    if (!selectedFile) {
      setMessages(prev => [...prev,
        { id: msgId.current++, role: "user", text },
        { id: msgId.current++, role: "ai", text: "Please select a CSV or Excel file first from the left panel." },
      ]);
      setInput("");
      return;
    }

    const userMsg: ChatMessage = { id: msgId.current++, role: "user", text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsProcessing(true);
    const now = new Date().toLocaleTimeString("en-US", { hour12: false });

    try {
      const result = await preprocessFile(selectedFile.id, text);

      if (result.success) {
        const preview = buildPreview(result);
        const aiMsg: ChatMessage = {
          id:      msgId.current++,
          role:    "ai",
          text:    `✅ **${result.description || "Operation completed"}**\n\nOperation: \`${result.operation}\`\nRows before: ${result.before_shape?.[0]} → after: ${result.after_shape?.[0]}`,
          preview,
        };
        const step: TransformStep = {
          id:       Date.now(),
          command:  text,
          action:   result.description || result.operation || "Transform",
          affected: selectedFile.original_name,
          rows:     Math.abs((result.before_shape?.[0] || 0) - (result.after_shape?.[0] || 0)),
          status:   "success",
          time:     now,
        };
        setMessages(prev => [...prev, aiMsg]);
        setTransformLog(prev => [step, ...prev]);
      } else {
        setMessages(prev => [...prev, {
          id:   msgId.current++,
          role: "ai",
          text: `⚠️ Could not apply transformation: **${result.error || "Unknown error"}**\n\nTry rephrasing your command. Examples:\n• "Remove duplicate rows"\n• "Fill missing values with 0"\n• "Normalize the revenue column"`,
        }]);
      }
    } catch(e: any) {
      setMessages(prev => [...prev, {
        id:   msgId.current++,
        role: "ai",
        text: `❌ Error: ${e.message}. Make sure your backend is running.`,
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const selectFile = (file: UploadedFile) => {
    setSelectedFile(file);
    setMessages([{
      id: msgId.current++, role: "ai",
      text: `Switched to **${file.original_name}**. What would you like to do with this dataset?`,
    }]);
    setTransformLog([]);
  };

  const statusColor = { success: "#10B981", warning: "#F59E0B", info: "#6366F1" };
  const statusBg    = { success: "#D1FAE5", warning: "#FEF3C7", info: "#EDE9FE" };
  const statusIcon  = { success: <CheckCircle size={12}/>, warning: <AlertTriangle size={12}/>, info: <Info size={12}/> };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 260px", gap: 16, height: "100%", minHeight: 0 }}>

      {/* Column 1: File selector */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", padding: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em" }}>Active Dataset</h3>
          <button onClick={loadFiles} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", display: "flex" }}><RefreshCw size={12}/></button>
        </div>
        <div style={{ flex: 1, overflow: "auto", scrollbarWidth: "none" }}>
          {loadingFiles ? (
            <p style={{ fontSize: "0.78rem", color: "#94A3B8", textAlign: "center", paddingTop: 20 }}>Loading...</p>
          ) : files.length === 0 ? (
            <p style={{ fontSize: "0.75rem", color: "#94A3B8", textAlign: "center", paddingTop: 20, lineHeight: 1.5 }}>No CSV or Excel files. Upload in the Upload tab first.</p>
          ) : (
            files.map(f => {
              const active = selectedFile?.id === f.id;
              return (
                <button key={f.id} onClick={() => selectFile(f)}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: `2px solid ${active ? "#0D1B3E" : "#E8EAF0"}`, background: active ? "#EEF0F5" : "#F8FAFC", cursor: "pointer", textAlign: "left", marginBottom: 8, transition: "all 0.15s", fontFamily: "Inter, sans-serif" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    {f.file_type === "xlsx" ? <FileSpreadsheet size={14} color="#10B981"/> : <FileText size={14} color="#6366F1"/>}
                    <p style={{ fontSize: "0.72rem", fontWeight: 700, color: active ? "#0D1B3E" : "#374151", lineHeight: 1.2, wordBreak: "break-word" }}>{f.original_name}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.62rem", color: "#94A3B8", background: "#F0F2F7", padding: "1px 5px", borderRadius: 4 }}>{f.chunk_count} chunks</span>
                    <span style={{ fontSize: "0.62rem", color: "#94A3B8", background: "#F0F2F7", padding: "1px 5px", borderRadius: 4 }}>{(f.file_size/1024).toFixed(0)}KB</span>
                  </div>
                  {active && <div style={{ marginTop: 5, fontSize: "0.62rem", color: "#10B981", fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: "#10B981" }}/> Active</div>}
                </button>
              );
            })
          )}
        </div>
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "#EEF0F5", marginTop: 8, textAlign: "center" }}>
          <p style={{ fontSize: "0.68rem", color: "#5A6480" }}>{transformLog.length} transforms applied</p>
        </div>
      </div>

      {/* Column 2: Chat */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #E8EAF0", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #0D1B3E, #1A2D5A)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Cpu size={18} color="#F59E0B"/>
          </div>
          <div>
            <p style={{ fontWeight: 700, color: "#0D1B3E", fontSize: "0.9rem", lineHeight: 1 }}>Data Preprocessing Assistant</p>
            <p style={{ fontSize: "0.7rem", color: selectedFile ? "#10B981" : "#94A3B8", marginTop: 2, fontWeight: 600 }}>
              {selectedFile ? `● Ready · ${selectedFile.original_name}` : "● Select a file to start"}
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button onClick={() => { setMessages([{ id: msgId.current++, role: "ai", text: "Session reset. Select a file and start preprocessing." }]); setTransformLog([]); }}
              style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #E2E8F0", background: "#fff", cursor: "pointer", fontSize: "0.72rem", color: "#64748B", display: "flex", alignItems: "center", gap: 4, fontFamily: "Inter, sans-serif" }}>
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
                <div style={{ maxWidth: "80%", padding: "11px 14px", borderRadius: msg.role === "ai" ? "4px 12px 12px 12px" : "12px 4px 12px 12px", background: msg.role === "ai" ? "#F8FAFC" : "#0D1B3E", border: msg.role === "ai" ? "1px solid #E8EAF0" : "none", color: msg.role === "ai" ? "#0D1B3E" : "#fff", fontSize: "0.83rem", lineHeight: 1.65 }}>
                  {msg.text.split("\n").map((line, i) => (
                    <p key={i} style={{ margin: i > 0 ? "4px 0 0" : 0 }}
                      dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/`(.*?)`/g, "<code style='background:#EEF0F5;padding:1px 4px;border-radius:3px;font-size:0.85em'>$1</code>") }}/>
                  ))}
                </div>
              </div>
              {msg.preview && msg.role === "ai" && <div style={{ marginLeft: 40 }}><DataTable preview={msg.preview}/></div>}
            </div>
          ))}

          {isProcessing && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #0D1B3E, #1A2D5A)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Cpu size={14} color="#F59E0B"/>
              </div>
              <div style={{ padding: "11px 16px", borderRadius: "4px 12px 12px 12px", background: "#F8FAFC", border: "1px solid #E8EAF0", display: "flex", alignItems: "center", gap: 8 }}>
                <RefreshCw size={14} color="#0D1B3E" style={{ animation: "spin 1s linear infinite" }}/>
                <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Processing transform on {selectedFile?.original_name}…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Quick actions */}
        <div style={{ padding: "8px 14px", borderTop: "1px solid #F0F2F7", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
            {QUICK_ACTIONS.map(a => (
              <button key={a.label} onClick={() => send(a.label)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, border: "1px solid #E2E8F0", background: "#F8FAFC", cursor: "pointer", fontSize: "0.7rem", color: "#374151", fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s", fontFamily: "Inter, sans-serif" }}
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
                  {step.rows > 0 && (
                    <div style={{ marginLeft: 18, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: "0.68rem", fontWeight: 700, color: statusColor[step.status], fontFamily: "monospace" }}>{step.rows.toLocaleString()} rows</span>
                      <span style={{ fontSize: "0.65rem", color: "#94A3B8" }}>affected</span>
                    </div>
                  )}
                  <p style={{ fontSize: "0.62rem", color: "#94A3B8", marginLeft: 18, marginTop: 3, fontFamily: "monospace" }}>{step.time}</p>
                </div>
              ))}
            </div>

            {/* Pipeline summary */}
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "#0D1B3E", marginBottom: 6 }}>Pipeline Summary</p>
              {transformLog.map((s, i) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: i < transformLog.length - 1 ? 4 : 0 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, background: statusColor[s.status], display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", color: "#fff", fontWeight: 700, flexShrink: 0 }}>{transformLog.length - i}</div>
                  <span style={{ fontSize: "0.7rem", color: "#374151" }}>{s.action}</span>
                  {i < transformLog.length - 1 && <ChevronRight size={10} color="#CBD5E1" style={{ marginLeft: "auto", flexShrink: 0 }}/>}
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

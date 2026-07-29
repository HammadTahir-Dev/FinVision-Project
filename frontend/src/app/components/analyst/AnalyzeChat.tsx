import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send, Mic, MicOff, FileText, FileSpreadsheet, ChevronRight,
  User, AlertCircle, TrendingUp, Award, BookOpen, Star, RefreshCw,
} from "lucide-react";
import { PersonaAvatar } from "./PersonaAvatar";
import { sendQuery, listFiles, type Citation, type UploadedFile } from "../../api";

// ── Speech Recognition types ──────────────────────────────────────────────────
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionErrorEvent extends Event { error: string; }
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

// ── Persona ───────────────────────────────────────────────────────────────────
const PERSONA = {
  name: "Dr. Maya Chen",
  title: "Senior Financial Intelligence Expert",
  credentials: "CFA · PhD Finance · 18 yrs exp.",
  specialties: ["Revenue Analytics", "Forecasting", "Risk Assessment"],
};

function getSR(): (new () => SpeechRecognitionInstance) | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

// ── Message types ─────────────────────────────────────────────────────────────
interface Message {
  role: "user" | "ai";
  content: string;
  citations?: Citation[];
  timestamp: string;
  latency_ms?: number;
}

function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function FileIcon({ type }: { type: string }) {
  if (type === "xlsx") return <FileSpreadsheet size={14} color="#10B981" style={{ flexShrink: 0, marginTop: 1 }} />;
  if (type === "pdf")  return <FileText size={14} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />;
  return <FileText size={14} color="#6366F1" style={{ flexShrink: 0, marginTop: 1 }} />;
}

// ── Main component ────────────────────────────────────────────────────────────
export function AnalyzeChat() {
  const [messages, setMessages]         = useState<Message[]>([{
    role: "ai",
    content: `Good to meet you. I'm **${PERSONA.name}**, your dedicated Financial Intelligence Expert here on FinVision.\n\nI have access to your active data sources. Every answer I give you is grounded directly in your uploaded documents with cited references.\n\nWhat financial question can I help you think through today?`,
    timestamp: nowTime(),
  }]);
  const [input, setInput]               = useState("");
  const [interimText, setInterimText]   = useState("");
  const [activeCitations, setActiveCitations] = useState<Citation[]>([]);
  const [listening, setListening]       = useState(false);
  const [voiceError, setVoiceError]     = useState<string | null>(null);
  const [isTyping, setIsTyping]         = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [speechSupported]               = useState(() => !!getSR());
  const [activeFiles, setActiveFiles]   = useState<UploadedFile[]>([]);
  const [sessionId, setSessionId]       = useState<number | undefined>(undefined);
  const [loadingFiles, setLoadingFiles] = useState(true);

  const bottomRef       = useRef<HTMLDivElement>(null);
  const recognitionRef  = useRef<SpeechRecognitionInstance | null>(null);

  // Load active files on mount
  useEffect(() => {
    loadActiveFiles();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  async function loadActiveFiles() {
    try {
      setLoadingFiles(true);
      const files = await listFiles();
      const active = files.filter(f => f.is_active && f.status === "verified");
      setActiveFiles(active);
    } catch (e) {
      console.error("Could not load files:", e);
    } finally {
      setLoadingFiles(false);
    }
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterimText("");
  }, []);

  const startListening = useCallback(() => {
    setVoiceError(null);
    const SR = getSR();
    if (!SR) { setVoiceError("Speech recognition not supported. Try Chrome or Edge."); return; }
    const rec = new SR();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-US";
    rec.onstart  = () => { setListening(true); setInterimText(""); };
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      setInterimText(interim);
      if (final) { setInput(prev => (prev.trim() ? prev.trim() + " " : "") + final.trim()); setInterimText(""); }
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      const msgs: Record<string, string> = {
        "not-allowed": "Microphone access denied.",
        "no-speech":   "No speech detected. Try again.",
        "network":     "Network error during speech recognition.",
      };
      setVoiceError(msgs[e.error] ?? `Voice error: ${e.error}`);
      setListening(false); setInterimText(""); recognitionRef.current = null;
    };
    rec.onend = () => { setListening(false); setInterimText(""); recognitionRef.current = null; };
    recognitionRef.current = rec;
    try { rec.start(); } catch { setVoiceError("Could not start microphone."); setListening(false); }
  }, []);

  const toggleMic = () => listening ? stopListening() : startListening();

  // ── Send ──────────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isTyping) return;
    if (listening) stopListening();

    setMessages(prev => [...prev, { role: "user", content: text, timestamp: nowTime() }]);
    setInput(""); setInterimText(""); setVoiceError(null); setError(null);
    setIsTyping(true);

    try {
      const activeFileIds = activeFiles.map(f => f.id);
      const result = await sendQuery(text, sessionId, activeFileIds.length > 0 ? activeFileIds : undefined);

      // Save session ID for conversation continuity
      if (!sessionId) setSessionId(result.session_id);

      const aiMsg: Message = {
        role:       "ai",
        content:    result.answer,
        citations:  result.citations,
        timestamp:  nowTime(),
        latency_ms: result.latency_ms,
      };
      setMessages(prev => [...prev, aiMsg]);
      if (result.citations.length > 0) setActiveCitations(result.citations);

    } catch (e: any) {
      setError(e.message || "Failed to get response. Check your connection.");
      setMessages(prev => [...prev, {
        role:      "ai",
        content:   "I encountered an error processing your request. Please check that files are uploaded and try again.",
        timestamp: nowTime(),
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const displayValue = interimText ? input + (input ? " " : "") + interimText : input;
  const totalChunks  = activeFiles.reduce((sum, f) => sum + f.chunk_count, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 268px", gap: 16, height: "100%", minHeight: 0, fontFamily: "Inter, sans-serif" }}>

      {/* Column 1: Active Sources */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", padding: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em" }}>Active Sources</h3>
          <button onClick={loadActiveFiles} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: 0, display: "flex" }}>
            <RefreshCw size={12} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {loadingFiles ? (
            <div style={{ textAlign: "center", color: "#94A3B8", fontSize: "0.75rem", padding: "20px 0" }}>Loading...</div>
          ) : activeFiles.length === 0 ? (
            <div style={{ textAlign: "center", color: "#94A3B8", fontSize: "0.75rem", padding: "20px 0", lineHeight: 1.5 }}>
              No active files.<br />Upload files in the Upload tab.
            </div>
          ) : (
            activeFiles.map(f => (
              <div key={f.id} style={{ padding: 10, borderRadius: 8, background: "#F8FAFC", border: "1px solid #E8EAF0" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <FileIcon type={f.file_type} />
                  <div>
                    <p style={{ fontSize: "0.74rem", fontWeight: 600, color: "#0D1B3E", lineHeight: 1.3, wordBreak: "break-word" }}>{f.original_name}</p>
                    <p style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>{f.chunk_count} chunks</p>
                  </div>
                </div>
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981" }} />
                  <span style={{ fontSize: "0.63rem", color: "#10B981", fontWeight: 600 }}>Indexed & Ready</span>
                </div>
              </div>
            ))
          )}
        </div>
        <div style={{ marginTop: 12, padding: 8, borderRadius: 8, background: "#EEF0F5", textAlign: "center" }}>
          <p style={{ fontSize: "0.7rem", color: "#5A6480" }}>{activeFiles.length} sources · {totalChunks} chunks</p>
        </div>
      </div>

      {/* Column 2: Chat */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Persona header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #E8EAF0", background: "linear-gradient(135deg, #0D1B3E 0%, #1A2D5A 100%)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <PersonaAvatar size={52} showOnline={true} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <p style={{ color: "#fff", fontWeight: 800, fontSize: "0.95rem" }}>{PERSONA.name}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 999, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.3)" }}>
                  <Award size={10} color="#F59E0B" />
                  <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "#F59E0B" }}>CFA · PhD</span>
                </div>
              </div>
              <p style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.75rem", marginTop: 2 }}>{PERSONA.title}</p>
              <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                {PERSONA.specialties.map(s => (
                  <span key={s} style={{ fontSize: "0.6rem", padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.1)" }}>{s}</span>
                ))}
              </div>
            </div>
            <div style={{ flexShrink: 0, textAlign: "right" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981" }} />
                <span style={{ fontSize: "0.7rem", color: "#10B981", fontWeight: 600 }}>Online</span>
              </div>
              <p style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.3)", marginTop: 3 }}>{PERSONA.credentials}</p>
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ margin: "10px 14px 0", padding: "9px 12px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <AlertCircle size={14} color="#DC2626" />
            <p style={{ fontSize: "0.77rem", color: "#DC2626", flex: 1 }}>{error}</p>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#DC2626" }}>×</button>
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 16px", scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: 18 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
              {msg.role === "ai"
                ? <PersonaAvatar size={36} showOnline={false} />
                : <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={16} color="#0D1B3E" /></div>
              }
              <div style={{ maxWidth: "76%", display: "flex", flexDirection: "column", gap: 4, alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: msg.role === "ai" ? "#0D1B3E" : "#64748B" }}>
                    {msg.role === "ai" ? PERSONA.name : "You"}
                  </span>
                  <span style={{ fontSize: "0.65rem", color: "#94A3B8" }}>{msg.timestamp}</span>
                  {msg.latency_ms && <span style={{ fontSize: "0.62rem", color: "#10B981" }}>{(msg.latency_ms / 1000).toFixed(1)}s</span>}
                </div>
                <div style={{
                  padding: "12px 15px",
                  borderRadius: msg.role === "ai" ? "2px 14px 14px 14px" : "14px 2px 14px 14px",
                  background: msg.role === "ai" ? "#F8FAFC" : "#0D1B3E",
                  border: msg.role === "ai" ? "1px solid #E2E8F0" : "none",
                  color: msg.role === "ai" ? "#0D1B3E" : "#fff",
                  fontSize: "0.84rem", lineHeight: 1.7,
                  boxShadow: msg.role === "ai" ? "0 1px 4px rgba(0,0,0,0.04)" : "0 2px 8px rgba(13,27,62,0.2)",
                }}>
                  {msg.content.split("\n").map((line, j) => (
                    <p key={j} style={{ margin: j > 0 ? "5px 0 0" : 0 }}
                      dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }} />
                  ))}
                  {msg.citations && msg.citations.length > 0 && (
                    <button onClick={() => setActiveCitations(msg.citations!)}
                      style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", cursor: "pointer", color: "#B45309", fontSize: "0.72rem", fontWeight: 700 }}>
                      <BookOpen size={12} />
                      View {msg.citations.length} source citation{msg.citations.length > 1 ? "s" : ""}
                      <ChevronRight size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <PersonaAvatar size={36} showOnline={false} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#0D1B3E" }}>{PERSONA.name}</span>
                <div style={{ padding: "12px 16px", borderRadius: "2px 14px 14px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[0, 1, 2].map(n => (
                        <div key={n} style={{ width: 7, height: 7, borderRadius: "50%", background: "#0D1B3E", opacity: 0.7, animation: `typingBounce 1.4s ease-in-out ${n * 0.16}s infinite` }} />
                      ))}
                    </div>
                    <span style={{ fontSize: "0.73rem", color: "#94A3B8", fontStyle: "italic" }}>Analysing your data…</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Voice error */}
        {voiceError && (
          <div style={{ margin: "0 14px", padding: "9px 12px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", display: "flex", alignItems: "flex-start", gap: 8, flexShrink: 0 }}>
            <AlertCircle size={14} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: "0.77rem", color: "#DC2626", flex: 1 }}>{voiceError}</p>
            <button onClick={() => setVoiceError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#DC2626" }}>×</button>
          </div>
        )}

        {/* Listening indicator */}
        {listening && (
          <div style={{ margin: "0 14px", padding: "8px 14px", borderRadius: 8, background: "#FEF3C7", border: "1px solid #F59E0B", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 16 }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} style={{ width: 3, borderRadius: 2, background: "#F59E0B", height: `${8 + n * 2}px` }} />
              ))}
            </div>
            <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "#92400E" }}>
              Listening…{interimText && <span style={{ fontWeight: 400, fontStyle: "italic" }}> "{interimText}"</span>}
            </p>
            <button onClick={stopListening} style={{ marginLeft: "auto", fontSize: "0.7rem", fontWeight: 700, color: "#92400E", background: "none", border: "1px solid #F59E0B", borderRadius: 5, padding: "2px 8px", cursor: "pointer" }}>Stop</button>
          </div>
        )}

        {/* Input bar */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid #E8EAF0", flexShrink: 0, background: "#FAFAFA" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", background: "#fff", borderRadius: 12, border: `1.5px solid ${listening ? "#F59E0B" : "#E2E8F0"}`, padding: "9px 12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", transition: "border-color 0.2s" }}>
            <textarea value={displayValue}
              onChange={e => { if (!interimText) setInput(e.target.value); }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={listening ? "Speak now…" : `Ask ${PERSONA.name} anything about your financial data…`}
              rows={1}
              style={{ flex: 1, background: "none", border: "none", outline: "none", resize: "none", fontSize: "0.86rem", color: interimText ? "#94A3B8" : "#0D1B3E", fontFamily: "Inter, sans-serif", lineHeight: 1.5, fontStyle: interimText ? "italic" : "normal" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {speechSupported ? (
                <button onClick={toggleMic}
                  style={{ width: 34, height: 34, borderRadius: 8, border: "none", background: listening ? "#F59E0B" : "#F1F5F9", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                  {listening ? <MicOff size={16} color="#fff" /> : <Mic size={16} color="#64748B" />}
                </button>
              ) : null}
              <button onClick={sendMessage} disabled={!input.trim() && !interimText || isTyping}
                style={{ width: 34, height: 34, borderRadius: 8, border: "none", background: (input.trim() || interimText) && !isTyping ? "#0D1B3E" : "#F1F5F9", cursor: (input.trim() || interimText) && !isTyping ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" }}>
                {isTyping ? <RefreshCw size={15} color="#94A3B8" /> : <Send size={15} color={(input.trim() || interimText) && !isTyping ? "#fff" : "#94A3B8"} />}
              </button>
            </div>
          </div>
          <p style={{ fontSize: "0.67rem", color: "#94A3B8", marginTop: 6, textAlign: "center" }}>
            Every answer is grounded in your uploaded documents · {speechSupported ? "🎤 Voice enabled" : "Voice: Chrome/Edge only"}
          </p>
        </div>
      </div>

      {/* Column 3: Citations panel */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E8EAF0", flexShrink: 0 }}>
          <h3 style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em" }}>Source Citations</h3>
          <p style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 3 }}>Every claim is traceable to your data</p>
        </div>

        {activeCitations.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", textAlign: "center", padding: 20, color: "#94A3B8", fontSize: "0.82rem", gap: 10 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#F8FAFC", border: "1px solid #E8EAF0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BookOpen size={20} color="#CBD5E1" />
            </div>
            <div>
              <p style={{ fontWeight: 600, color: "#64748B", marginBottom: 4 }}>No citations yet</p>
              <p style={{ fontSize: "0.75rem" }}>Source references appear after each AI response</p>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10, scrollbarWidth: "none" }}>
            {activeCitations.map((c, i) => (
              <div key={i} style={{ padding: 12, borderRadius: 10, background: "#F8FAFC", border: "1px solid #E2E8F0", transition: "all 0.18s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#0D1B3E"; e.currentTarget.style.background = "#F0F4FF"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.background = "#F8FAFC"; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, background: "#FEF3C7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Star size={11} color="#F59E0B" fill="#F59E0B" />
                  </div>
                  <span style={{ fontSize: "0.73rem", fontWeight: 700, color: "#0D1B3E" }}>{c.source}</span>
                </div>
                <p style={{ fontSize: "0.74rem", color: "#374151", lineHeight: 1.55, fontStyle: "italic" }}>"{c.snippet}"</p>
                <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ padding: "2px 8px", background: "#EEF0F5", borderRadius: 5, fontSize: "0.67rem", color: "#5A6480", fontFamily: "monospace" }}>
                    {c.page !== "N/A" ? `Page ${c.page}` : "Section 1"}
                  </span>
                  <TrendingUp size={11} color="#10B981" />
                  <span style={{ fontSize: "0.67rem", color: "#10B981", fontWeight: 600 }}>{c.relevance?.toFixed(0)}% match</span>
                </div>
              </div>
            ))}
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "linear-gradient(135deg, #0D1B3E, #1A2D5A)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <PersonaAvatar size={28} showOnline={false} />
                <div>
                  <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "#F59E0B", marginBottom: 3 }}>{PERSONA.name}</p>
                  <p style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>All citations are extracted directly from your indexed documents.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes typingBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

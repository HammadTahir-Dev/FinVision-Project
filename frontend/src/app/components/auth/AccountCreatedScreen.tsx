import { useEffect, useState } from "react";
import {
  ArrowRight, Upload, MessageSquare, TrendingUp, FileText,
  Mail, User, Shield, Calendar, Copy, Check, Sparkles,
  BarChart2, Database, LogIn,
} from "lucide-react";
import type { AuthUser } from "@/app/auth";
import finvisionLogo from "@/imports/Gemini_Generated_Image_zcm87kzcm87kzcm8__1_-Photoroom.png";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";

interface Props {
  user: AuthUser;
  onGoToLogin: () => void;
}

// ── Confetti ──────────────────────────────────────────────────────────────────
const CONFETTI = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  delay: Math.random() * 0.9,
  x: 8 + Math.random() * 84,
  color: ["#F59E0B", "#0D1B3E", "#10B981", "#6366F1", "#EF4444", "#FCD34D"][i % 6],
  size: 6 + Math.random() * 6,
  round: Math.random() > 0.5,
}));

// ── Role-specific next steps ───────────────────────────────────────────────────
const STEPS = {
  analyst: [
    { icon: Upload,        title: "Upload your data",         desc: "Import CSV, Excel, or PDF financial files to build your AI context." },
    { icon: MessageSquare, title: "Chat with Dr. Maya Chen",  desc: "Ask questions and get expert-level insights grounded in your data." },
    { icon: TrendingUp,    title: "Generate a forecast",      desc: "Select a metric and horizon to produce AI-powered projections." },
    { icon: FileText,      title: "Export your reports",      desc: "Create polished PDF or Excel reports from your analysis in one click." },
  ],
  supervisor: [
    { icon: Shield,        title: "Configure the LLM model",  desc: "Select and tune the active local AI model and embedding pipeline." },
    { icon: BarChart2,     title: "Set RAG parameters",       desc: "Adjust temperature, chunk size, and retrieval depth for best results." },
    { icon: MessageSquare, title: "Run the prompt sandbox",   desc: "Test queries against your live configuration before analysts use it." },
    { icon: Database,      title: "Monitor system health",    desc: "Track database health, backup schedules, and system event logs." },
  ],
};

// ── Copyable account ID ───────────────────────────────────────────────────────
function AccountIdBadge({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(id).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px 4px 12px", borderRadius: 6,
      background: "#EEF0F5", border: "1px solid #E2E8F0",
      cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
      fontSize: "0.74rem", fontWeight: 600, color: "#374151",
      transition: "background 0.15s",
    }}
    onMouseEnter={e => e.currentTarget.style.background = "#E2E8F0"}
    onMouseLeave={e => e.currentTarget.style.background = "#EEF0F5"}>
      {id}
      {copied
        ? <Check size={12} color="#10B981" />
        : <Copy size={12} color="#94A3B8" />}
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function AccountCreatedScreen({ user, onGoToLogin }: Props) {
  const [visible, setVisible]         = useState(false);
  const [showContent, setShowContent] = useState(false);

  const accountId  = `FV-${user.id.slice(0, 8).toUpperCase()}`;
  const createdAt  = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const steps      = STEPS[user.role];
  const isAnalyst  = user.role === "analyst";
  const roleLabel  = isAnalyst ? "Financial Analyst" : "System Supervisor";
  const roleBadge  = isAnalyst
    ? { color: "#166534", bg: "#DCFCE7" }
    : { color: "#1E40AF", bg: "#DBEAFE" };

  // Staggered entrance
  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 60);
    const t2 = setTimeout(() => setShowContent(true), 550);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

const fade = (delay = 0): React.CSSProperties => ({
    opacity:   showContent ? 1 : 0,
    transform: showContent ? "translateY(0)" : "translateY(10px)",
    transition: `opacity 0.4s ease ${delay}s, transform 0.4s ease ${delay}s`,
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #F8FAFF 0%, #EEF2FF 55%, #F0FDF4 100%)",
      fontFamily: "Inter, sans-serif",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "36px 24px 48px",
      position: "relative", overflow: "hidden",
    }}>

      {/* Soft background blobs */}
      <div style={{ position: "fixed", top: -100, right: -100, width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -80, left: -80, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Confetti burst */}
      <div style={{ position: "fixed", top: "22%", left: "50%", transform: "translateX(-50%)", width: 640, height: 1, pointerEvents: "none", zIndex: 50 }}>
        {CONFETTI.map(c => (
          <div key={c.id} style={{
            position: "absolute", top: 0, left: `${c.x}%`,
            width: c.size, height: c.size,
            borderRadius: c.round ? "50%" : "2px",
            background: c.color,
            opacity: 0,
            animation: `confettiFall 2.6s ease-out ${c.delay}s both`,
          }} />
        ))}
      </div>

      {/* Logo */}
      <div style={{
        marginBottom: 32,
        opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(-14px)",
        transition: "opacity 0.5s ease, transform 0.5s ease",
      }}>
        <ImageWithFallback src={finvisionLogo} alt="FinVision"
          style={{ height: 50, width: "auto", objectFit: "contain" }} />
      </div>

      {/* Main card */}
      <div style={{
        width: "100%", maxWidth: 680,
        background: "#fff", borderRadius: 24,
        border: "1px solid #E8EAF0",
        boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 20px 60px rgba(13,27,62,0.09)",
        overflow: "hidden",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(22px) scale(0.97)",
        transition: "opacity 0.55s ease, transform 0.55s ease",
      }}>

        {/* ── Navy header ── */}
        <div style={{
          background: "linear-gradient(135deg, #0D1B3E 0%, #1E3A6E 100%)",
          padding: "38px 40px 34px",
          textAlign: "center",
          position: "relative", overflow: "hidden",
        }}>
          {/* Grid overlay */}
          <div style={{ position: "absolute", inset: 0, opacity: 0.06, backgroundImage: "linear-gradient(rgba(245,158,11,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.6) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

          {/* Animated checkmark */}
          <div style={{
            width: 90, height: 90, borderRadius: "50%", margin: "0 auto 22px",
            background: "rgba(16,185,129,0.12)", border: "1.5px solid rgba(16,185,129,0.28)",
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative",
            animation: visible ? "popIn 0.6s cubic-bezier(0.175,0.885,0.32,1.275) 0.15s both" : "none",
          }}>
            {/* Pulse ring */}
            <div style={{ position: "absolute", inset: -10, borderRadius: "50%", border: "1.5px solid rgba(16,185,129,0.22)", animation: "ringPulse 2.2s ease-out 0.9s infinite" }} />
            <svg width="50" height="50" viewBox="0 0 50 50" fill="none">
              <circle cx="25" cy="25" r="23" stroke="#10B981" strokeWidth="1.8" fill="rgba(16,185,129,0.08)" />
              <path d="M15 25 L22 32 L35 18"
                stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  strokeDasharray: 30,
                  strokeDashoffset: visible ? 0 : 30,
                  transition: "stroke-dashoffset 0.5s ease 0.65s",
                }} />
            </svg>
          </div>

          <h1 style={{ color: "#fff", fontWeight: 800, fontSize: "1.7rem", lineHeight: 1.2, marginBottom: 10, position: "relative" }}>
            Account Created Successfully!
          </h1>
          <p style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.93rem", lineHeight: 1.65, position: "relative" }}>
            Welcome to FinVision,{" "}
            <strong style={{ color: "#F59E0B" }}>{user.name.split(" ")[0]}</strong>.
            {" "}Your AI-powered workspace is ready.
          </p>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "30px 40px 36px" }}>

          {/* Account summary */}
          <div style={{ background: "#F8FAFC", borderRadius: 14, border: "1px solid #E8EAF0", padding: "20px 24px", marginBottom: 26, ...fade(0.05) }}>
            <p style={{ fontSize: "0.65rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>
              Account Details
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 28px" }}>
              {[
                { icon: <User size={14} />,     label: "Full Name",  content: <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#0D1B3E" }}>{user.name}</span> },
                { icon: <Mail size={14} />,     label: "Email",      content: <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#0D1B3E" }}>{user.email}</span> },
                { icon: <Shield size={14} />,   label: "Role",       content: <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.73rem", fontWeight: 700, color: roleBadge.color, background: roleBadge.bg }}>{roleLabel}</span> },
                { icon: <Calendar size={14} />, label: "Created On", content: <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#0D1B3E" }}>{createdAt}</span> },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: "#EEF0F5", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B", flexShrink: 0 }}>
                    {item.icon}
                  </div>
                  <div>
                    <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{item.label}</p>
                    {item.content}
                  </div>
                </div>
              ))}
            </div>

            {/* Account ID */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #E8EAF0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Sparkles size={13} color="#F59E0B" />
                <span style={{ fontSize: "0.74rem", color: "#64748B", fontWeight: 600 }}>Account ID</span>
              </div>
              <AccountIdBadge id={accountId} />
            </div>
          </div>

          {/* Next steps */}
          <div style={{ marginBottom: 24, ...fade(0.12) }}>
            <p style={{ fontSize: "0.65rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
              Getting started — your first four steps
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {steps.map((step, i) => (
                <div key={i}
                  style={{
                    padding: "14px 16px", borderRadius: 12,
                    background: "#fff", border: `1.5px solid ${i === 0 ? "#0D1B3E" : "#E8EAF0"}`,
                    display: "flex", gap: 12, alignItems: "flex-start",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#0D1B3E"; e.currentTarget.style.boxShadow = "0 2px 10px rgba(13,27,62,0.07)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = i === 0 ? "#0D1B3E" : "#E8EAF0"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                    background: i === 0 ? "#0D1B3E" : "#F8FAFC",
                    border: i === 0 ? "none" : "1.5px solid #E8EAF0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <step.icon size={15} color={i === 0 ? "#F59E0B" : "#64748B"} />
                  </div>
                  <div>
                    <p style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0D1B3E", marginBottom: 3, lineHeight: 1.2 }}>{step.title}</p>
                    <p style={{ fontSize: "0.71rem", color: "#94A3B8", lineHeight: 1.5 }}>{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Email verification notice */}
          <div style={{
            padding: "12px 16px", borderRadius: 10,
            background: "#FFFBEB", border: "1px solid #FDE68A",
            display: "flex", alignItems: "flex-start", gap: 10,
            marginBottom: 24, ...fade(0.18),
          }}>
            <Mail size={15} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#92400E" }}>Verify your email address</p>
              <p style={{ fontSize: "0.73rem", color: "#A16207", marginTop: 2, lineHeight: 1.5 }}>
                A verification link was sent to{" "}
                <strong>{user.email}</strong>. Please verify to unlock all features.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div style={{ ...fade(0.24) }}>
            <p style={{ fontSize: "0.78rem", color: "#64748B", textAlign: "center", marginBottom: 12, lineHeight: 1.5 }}>
              Your account is ready. Sign in with your credentials to access your workspace.
            </p>

            <button onClick={onGoToLogin}
              style={{
                width: "100%", padding: "15px 24px",
                background: "#0D1B3E", color: "#fff",
                border: "none", borderRadius: 12,
                fontWeight: 800, fontSize: "1rem",
                cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", gap: 10,
                letterSpacing: "0.02em", fontFamily: "Inter, sans-serif",
                boxShadow: "0 4px 18px rgba(13,27,62,0.28)",
                transition: "background 0.2s, transform 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#1A2D5A"; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 24px rgba(13,27,62,0.35)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#0D1B3E"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 18px rgba(13,27,62,0.28)"; }}>
              <LogIn size={18} />
              Continue to Login
              <ArrowRight size={18} />
            </button>

            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 9, background: "#F8FAFC", border: "1px solid #E8EAF0", display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={13} color="#F59E0B" style={{ flexShrink: 0 }} />
              <p style={{ fontSize: "0.72rem", color: "#64748B", lineHeight: 1.45 }}>
                Sign in using <strong style={{ color: "#0D1B3E" }}>{user.email}</strong> and the password you just created.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <p style={{
        marginTop: 28, fontSize: "0.73rem", color: "#CBD5E1", textAlign: "center",
        opacity: visible ? 1 : 0, transition: "opacity 0.5s ease 1s",
      }}>
        © 2025 FinVision · Finance Made Bright with AI Insight
      </p>

      <style>{`
        @keyframes popIn {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes ringPulse {
          0%   { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes confettiFall {
          0%   { transform: translateY(0) rotate(0deg);    opacity: 1; }
          100% { transform: translateY(260px) rotate(560deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

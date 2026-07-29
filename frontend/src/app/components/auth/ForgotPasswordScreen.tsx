import { useState } from "react";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";
import { AuthBrandPanel } from "./AuthBrandPanel";
import finvisionLogo from "@/imports/Gemini_Generated_Image_zcm87kzcm87kzcm8__1_-Photoroom.png";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";

interface Props { onBack: () => void; }

export function ForgotPasswordScreen({ onBack }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => { setLoading(false); setSent(true); }, 900);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2" style={{ fontFamily: 'Inter, sans-serif', background: '#F4F6FB' }}>
      <AuthBrandPanel />
      <div className="flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-[420px]">

          <div className="lg:hidden mb-8">
            <ImageWithFallback src={finvisionLogo} alt="FinVision"
              style={{ height: '56px', width: 'auto', objectFit: 'contain' }} />
          </div>

          {sent ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center"
                style={{ background: '#D1FAE5' }}>
                <CheckCircle size={34} color="#10B981" />
              </div>
              <h2 style={{ color: '#0D1B3E', fontWeight: 700, fontSize: '1.6rem', marginBottom: '10px' }}>
                Check your inbox
              </h2>
              <p style={{ color: '#64748B', fontSize: '0.9rem', marginBottom: '28px', lineHeight: 1.65 }}>
                A password reset link has been sent to{' '}
                <strong style={{ color: '#0D1B3E' }}>{email}</strong>.
                Follow the instructions to regain access.
              </p>
              <button onClick={onBack} style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                background: '#0D1B3E', color: '#fff', border: 'none', borderRadius: '9px',
                padding: '12px 28px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}>
                <ArrowLeft size={16} /> Back to Login
              </button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 style={{ color: '#0D1B3E', fontWeight: 700, fontSize: '1.8rem', lineHeight: 1.2, marginBottom: '6px' }}>
                  Reset password
                </h2>
                <p style={{ color: '#64748B', fontSize: '0.88rem', lineHeight: 1.65 }}>
                  Enter your corporate email and we'll send a secure recovery link.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#374151', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Corporate Email
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com" required
                      style={{
                        width: '100%', padding: '11px 14px 11px 40px', border: '1.5px solid #E2E8F0',
                        borderRadius: '8px', fontSize: '0.9rem', outline: 'none',
                        color: '#0D1B3E', background: '#fff', boxSizing: 'border-box',
                        fontFamily: 'Inter, sans-serif',
                      }}
                      onFocus={e => e.target.style.borderColor = '#0D1B3E'}
                      onBlur={e => e.target.style.borderColor = '#E2E8F0'}
                    />
                  </div>
                </div>

                <button type="submit" disabled={loading} style={{
                  width: '100%', padding: '13px', background: '#0D1B3E', color: '#fff',
                  border: 'none', borderRadius: '9px', fontWeight: 700, fontSize: '0.95rem',
                  cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif',
                }}>
                  {loading ? 'Sending…' : 'Send Recovery Link'}
                </button>

                <div className="text-center">
                  <button type="button" onClick={onBack} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#64748B', fontSize: '0.85rem', display: 'inline-flex',
                    alignItems: 'center', gap: '6px',
                  }}>
                    <ArrowLeft size={14} /> Back to Login
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

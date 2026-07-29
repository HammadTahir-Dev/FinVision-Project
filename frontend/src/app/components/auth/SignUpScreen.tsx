import { useState } from "react";
import { Eye, EyeOff, CheckCircle, Circle, AlertCircle } from "lucide-react";
import { AuthBrandPanel } from "./AuthBrandPanel";
import { register } from "@/app/auth";
import finvisionLogo from "@/imports/Gemini_Generated_Image_zcm87kzcm87kzcm8__1_-Photoroom.png";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";

interface Props {
  onBack: () => void;
  onSuccess: (role: "analyst" | "supervisor") => void;
}

function Criterion({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2" style={{ fontSize: '0.77rem', color: met ? '#10B981' : '#94A3B8' }}>
      {met ? <CheckCircle size={12} /> : <Circle size={12} />}
      {label}
    </div>
  );
}

export function SignUpScreen({ onBack, onSuccess }: Props) {
  const [name, setName]                     = useState("");
  const [email, setEmail]                   = useState("");
  const [password, setPassword]             = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass]             = useState(false);
  const [showConfirm, setShowConfirm]       = useState(false);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState("");

  const criteria = {
    length:  password.length >= 8,
    upper:   /[A-Z]/.test(password),
    number:  /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim())                    { setError("Please enter your full name."); return; }
    if (password.length < 8)            { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword)    { setError("Passwords do not match."); return; }

    setLoading(true);
    try {
      const result = await register(name, email, password);
      if ("error" in result) {
        setError(result.error);
      } else {
        onSuccess(result.user.role);
      }
    } catch (e: any) {
      setError(e.message || "Registration failed. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const inputBase: React.CSSProperties = {
    width: '100%', padding: '11px 14px', border: '1.5px solid #E2E8F0',
    borderRadius: '8px', fontSize: '0.9rem', outline: 'none',
    color: '#0D1B3E', background: '#fff', boxSizing: 'border-box',
    transition: 'border-color 0.18s', fontFamily: 'Inter, sans-serif',
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2" style={{ fontFamily: 'Inter, sans-serif', background: '#F4F6FB' }}>
      <AuthBrandPanel />
      <div className="flex items-center justify-center p-8 overflow-y-auto">
        <div className="w-full max-w-[420px] py-6">
          <div className="lg:hidden mb-7">
            <ImageWithFallback src={finvisionLogo} alt="FinVision" style={{ height: '56px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div className="mb-7">
            <h2 style={{ color: '#0D1B3E', fontWeight: 700, fontSize: '1.8rem', lineHeight: 1.2, marginBottom: '6px' }}>Create account</h2>
            <p style={{ color: '#64748B', fontSize: '0.88rem' }}>Join FinVision to start your AI-powered financial analysis</p>
          </div>
          {error && (
            <div className="flex items-start gap-3 mb-5 p-3 rounded-lg" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
              <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: '1px' }} />
              <p style={{ fontSize: '0.83rem', color: '#DC2626' }}>{error}</p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#374151', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Full Name</label>
              <input value={name} onChange={e => { setName(e.target.value); setError(""); }}
                placeholder="Jane Thornton" required style={inputBase}
                onFocus={e => e.target.style.borderColor = '#0D1B3E'}
                onBlur={e => e.target.style.borderColor = '#E2E8F0'} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#374151', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Corporate Email</label>
              <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="you@company.com" required style={inputBase}
                onFocus={e => e.target.style.borderColor = '#0D1B3E'}
                onBlur={e => e.target.style.borderColor = '#E2E8F0'} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#374151', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPass ? "text" : "password"} value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="Min. 8 characters" required style={{ ...inputBase, paddingRight: '42px' }}
                  onFocus={e => e.target.style.borderColor = '#0D1B3E'}
                  onBlur={e => e.target.style.borderColor = '#E2E8F0'} />
                <button type="button" onClick={() => setShowPass(!showPass)} style={{
                  position: 'absolute', right: '13px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0,
                }}>
                  {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {password.length > 0 && (
                <div className="mt-2 p-3 rounded-lg grid grid-cols-2 gap-1.5" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <Criterion met={criteria.length}  label="Min. 8 characters" />
                  <Criterion met={criteria.upper}   label="Uppercase letter" />
                  <Criterion met={criteria.number}  label="Number" />
                  <Criterion met={criteria.special} label="Special character" />
                </div>
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#374151', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showConfirm ? "text" : "password"} value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
                  placeholder="Re-enter your password" required
                  style={{ ...inputBase, paddingRight: '42px', borderColor: confirmPassword && confirmPassword !== password ? '#EF4444' : '#E2E8F0' }}
                  onFocus={e => e.target.style.borderColor = confirmPassword !== password ? '#EF4444' : '#0D1B3E'}
                  onBlur={e => e.target.style.borderColor = confirmPassword && confirmPassword !== password ? '#EF4444' : '#E2E8F0'} />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={{
                  position: 'absolute', right: '13px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0,
                }}>
                  {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '4px' }}>Passwords do not match</p>
              )}
            </div>
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '13px', background: '#0D1B3E', color: '#fff',
              border: 'none', borderRadius: '9px', fontWeight: 700, fontSize: '0.95rem',
              cursor: loading ? 'not-allowed' : 'pointer', marginTop: '4px', fontFamily: 'Inter, sans-serif',
            }}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
            <p className="text-center" style={{ fontSize: '0.85rem', color: '#64748B' }}>
              Already have an account?{' '}
              <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0D1B3E', fontWeight: 700 }}>
                Sign in
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

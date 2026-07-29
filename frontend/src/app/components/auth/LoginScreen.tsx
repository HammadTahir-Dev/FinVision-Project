import { useState } from "react";
import { Eye, EyeOff, AlertCircle } from "lucide-react";
import { AuthBrandPanel } from "./AuthBrandPanel";
import { login } from "@/app/auth";
import finvisionLogo from "@/imports/Gemini_Generated_Image_zcm87kzcm87kzcm8__1_-Photoroom.png";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";

interface Props {
  onLogin: (role: "analyst" | "supervisor") => void;
  onSignUp: () => void;
  onForgot: () => void;
}

export function LoginScreen({ onLogin, onSignUp, onForgot }: Props) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Please enter your email address."); return; }
    if (!password)     { setError("Please enter your password."); return; }
    setLoading(true);
    try {
      const result = await login(email, password);
      if ("error" in result) {
        setError(result.error);
      } else {
        onLogin(result.user.role);
      }
    } catch (e: any) {
      setError(e.message || "Login failed. Check your connection.");
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
      <div className="flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden mb-8">
            <ImageWithFallback src={finvisionLogo} alt="FinVision"
              style={{ height: '56px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div className="mb-8">
            <h2 style={{ color: '#0D1B3E', fontWeight: 700, fontSize: '1.8rem', lineHeight: 1.2, marginBottom: '6px' }}>Welcome back</h2>
            <p style={{ color: '#64748B', fontSize: '0.88rem' }}>Sign in to your FinVision workspace</p>
          </div>
          {error && (
            <div className="flex items-start gap-3 mb-5 p-3 rounded-lg" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
              <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: '1px' }} />
              <p style={{ fontSize: '0.83rem', color: '#DC2626' }}>{error}</p>
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#374151', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Email</label>
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
                  placeholder="••••••••" required style={{ ...inputBase, paddingRight: '42px' }}
                  onFocus={e => e.target.style.borderColor = '#0D1B3E'}
                  onBlur={e => e.target.style.borderColor = '#E2E8F0'} />
                <button type="button" onClick={() => setShowPass(!showPass)} style={{
                  position: 'absolute', right: '13px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0, display: 'flex', alignItems: 'center',
                }}>
                  {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none" style={{ fontSize: '0.84rem', color: '#64748B' }}>
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
                  style={{ width: '15px', height: '15px', accentColor: '#0D1B3E', cursor: 'pointer' }} />
                Remember me
              </label>
              <button type="button" onClick={onForgot} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F59E0B', fontWeight: 700, fontSize: '0.84rem' }}>
                Forgot password?
              </button>
            </div>
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '13px', background: loading ? '#1A2D5A' : '#0D1B3E',
              color: '#fff', border: 'none', borderRadius: '9px', fontWeight: 700,
              fontSize: '0.95rem', cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s', marginTop: '4px', fontFamily: 'Inter, sans-serif',
            }}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <p className="text-center" style={{ fontSize: '0.85rem', color: '#64748B' }}>
              Don't have an account?{' '}
              <button type="button" onClick={onSignUp} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0D1B3E', fontWeight: 700 }}>
                Create one
              </button>
            </p>
          </form>
          <div className="mt-8 p-4 rounded-xl" style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
            <p style={{ fontSize: '0.75rem', color: '#4338CA', fontWeight: 600, marginBottom: '4px' }}>First time?</p>
            <p style={{ fontSize: '0.72rem', color: '#4338CA' }}>Register a new account — use any email and a password with at least 8 characters.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

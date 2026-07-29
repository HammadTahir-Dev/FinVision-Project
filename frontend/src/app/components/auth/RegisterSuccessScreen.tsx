import { CheckCircle, ArrowRight } from "lucide-react";
import { AuthBrandPanel } from "./AuthBrandPanel";
import { type AuthUser } from "@/app/auth";

interface Props {
  user: AuthUser;
  onContinue: () => void;
}

export function RegisterSuccessScreen({ user, onContinue }: Props) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2" style={{ fontFamily: 'Inter, sans-serif', background: '#F4F6FB' }}>
      <AuthBrandPanel />

      <div className="flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-[420px] text-center">

          {/* Success Icon */}
          <div style={{
            width: '80px', height: '80px', borderRadius: '50%',
            background: '#D1FAE5', border: '3px solid #10B981',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <CheckCircle size={40} color="#10B981" />
          </div>

          {/* Heading */}
          <h2 style={{ color: '#0D1B3E', fontWeight: 700, fontSize: '1.8rem', marginBottom: '8px' }}>
            Account Created!
          </h2>
          <p style={{ color: '#64748B', fontSize: '0.9rem', marginBottom: '32px', lineHeight: 1.6 }}>
            Welcome to FinVision, <strong style={{ color: '#0D1B3E' }}>{user.name}</strong>.
            Your account has been successfully created and you're ready to start.
          </p>

          {/* Account Details Card */}
          <div style={{
            background: '#fff', border: '1px solid #E8EAF0', borderRadius: '12px',
            padding: '20px', marginBottom: '32px', textAlign: 'left',
          }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#5A6480', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '14px' }}>
              Account Details
            </p>
            <div className="space-y-3">
              {[
                { label: 'Name',  value: user.name },
                { label: 'Email', value: user.email },
                { label: 'Role',  value: user.role === 'supervisor' ? 'System Supervisor' : 'Financial Analyst' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span style={{ fontSize: '0.82rem', color: '#5A6480', fontWeight: 500 }}>{label}</span>
                  <span style={{ fontSize: '0.82rem', color: '#0D1B3E', fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Role badge */}
          <div style={{
            background: user.role === 'supervisor' ? '#EEF2FF' : '#ECFDF5',
            border: `1px solid ${user.role === 'supervisor' ? '#C7D2FE' : '#A7F3D0'}`,
            borderRadius: '8px', padding: '12px 16px', marginBottom: '32px',
            fontSize: '0.82rem',
            color: user.role === 'supervisor' ? '#4338CA' : '#065F46',
          }}>
            {user.role === 'supervisor'
              ? '🔧 As a Supervisor, you can manage system settings, monitor performance, and oversee all users.'
              : '📊 As a Financial Analyst, you can upload data, run AI analysis, generate forecasts and reports.'
            }
          </div>

          {/* Continue Button */}
          <button
            onClick={onContinue}
            style={{
              width: '100%', padding: '13px', background: '#0D1B3E',
              color: '#fff', border: 'none', borderRadius: '9px',
              fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              fontFamily: 'Inter, sans-serif',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#1A2D5A')}
            onMouseLeave={e => (e.currentTarget.style.background = '#0D1B3E')}
          >
            Go to Dashboard <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

import finvisionLogo from "@/imports/Gemini_Generated_Image_zcm87kzcm87kzcm8__1_-Photoroom.png";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";

export function AuthBrandPanel() {
  return (
    <div
      className="hidden lg:flex flex-col justify-between h-full p-12 relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #0B1835 0%, #112249 50%, #0B1835 100%)' }}
    >
      {/* Subtle grid */}
      <div className="absolute inset-0" style={{
        backgroundImage: `linear-gradient(rgba(245,158,11,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.08) 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
      }} />

      {/* Decorative chart lines near bottom */}
      <div className="absolute bottom-28 left-0 right-0 h-44 opacity-15">
        <svg viewBox="0 0 500 180" className="w-full h-full" preserveAspectRatio="none">
          <polyline points="0,160 80,120 160,140 240,80 320,100 420,40 500,60"
            fill="none" stroke="#F59E0B" strokeWidth="2.5" />
          <polyline points="0,170 80,155 160,162 240,118 320,132 420,78 500,95"
            fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="6,4" />
        </svg>
      </div>

      {/* Top spacer — no duplicate logo */}
      <div className="relative z-10" />

      {/* Central branding — logo native on dark, matching reference */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo — transparent bg PNG sits directly on dark panel */}
        <div style={{ marginBottom: '28px' }}>
          <ImageWithFallback
            src={finvisionLogo}
            alt="FinVision — Finance Made Bright with AI Insight"
            style={{
              width: '300px',
              height: 'auto',
              objectFit: 'contain',
              display: 'block',
              filter: 'drop-shadow(0 4px 24px rgba(245,158,11,0.25))',
            }}
          />
        </div>

        <p style={{
          color: 'rgba(255,255,255,0.58)',
          fontFamily: 'Inter, sans-serif',
          fontSize: '0.9rem',
          lineHeight: 1.8,
          maxWidth: '290px',
          textAlign: 'center',
        }}>
          Empowering financial analysts and supervisors with intelligent
          forecasting, contextual AI chat, and real-time insights.
        </p>
      </div>

      {/* Stats row */}
      <div className="relative z-10 grid grid-cols-3 gap-3">
        {[
          { label: 'Data Sources', value: '200+' },
          { label: 'Forecast Accuracy', value: '94.2%' },
          { label: 'Avg. Time Saved', value: '8h/wk' },
        ].map((s) => (
          <div key={s.label} className="text-center p-3 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: 700, color: '#F59E0B' }}>
              {s.value}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.7rem', fontFamily: 'Inter, sans-serif', marginTop: '3px' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

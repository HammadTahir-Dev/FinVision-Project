/**
 * Dr. Maya Chen — Senior Financial Intelligence Expert
 * Professional illustrated SVG avatar with financial chart motif.
 * Flat-design portrait: navy blazer, gold accent, upward-trend backdrop.
 */

interface Props {
  size?: number;
  showOnline?: boolean;
}

export function PersonaAvatar({ size = 40, showOnline = true }: Props) {
  const r = size / 2;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", borderRadius: "50%", overflow: "hidden" }}
      >
        <defs>
          {/* Background gradient */}
          <radialGradient id="bgG" cx="50%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#1E3A6E" />
            <stop offset="100%" stopColor="#0B1835" />
          </radialGradient>

          {/* Skin gradient */}
          <radialGradient id="skinG" cx="45%" cy="38%" r="60%">
            <stop offset="0%" stopColor="#D4956A" />
            <stop offset="100%" stopColor="#B8734A" />
          </radialGradient>

          {/* Blazer gradient */}
          <linearGradient id="blazerG" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#112449" />
            <stop offset="100%" stopColor="#0A1628" />
          </linearGradient>

          {/* Amber glow for chart */}
          <linearGradient id="chartG" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0" />
            <stop offset="40%" stopColor="#F59E0B" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#FCD34D" stopOpacity="0.6" />
          </linearGradient>

          {/* Chart area fill */}
          <linearGradient id="chartFill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
          </linearGradient>

          <clipPath id="circle">
            <circle cx="60" cy="60" r="60" />
          </clipPath>
        </defs>

        {/* ── Background ── */}
        <circle cx="60" cy="60" r="60" fill="url(#bgG)" />

        {/* ── Financial chart backdrop ── */}
        <g clipPath="url(#circle)" opacity="1">
          {/* Subtle grid */}
          {[30, 45, 60].map(y => (
            <line key={y} x1="0" y1={y} x2="120" y2={y}
              stroke="#F59E0B" strokeWidth="0.4" opacity="0.12" />
          ))}
          {/* Chart area fill */}
          <path
            d="M0 65 L15 58 L30 62 L45 50 L60 44 L75 36 L90 28 L120 18 L120 80 L0 80Z"
            fill="url(#chartFill)"
          />
          {/* Upward trend line */}
          <polyline
            points="0,65 15,58 30,62 45,50 60,44 75,36 90,28 120,18"
            stroke="url(#chartG)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Data point dots on trend line */}
          {[[45, 50], [60, 44], [90, 28]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="#F59E0B" opacity="0.7" />
          ))}
        </g>

        {/* ── Body / Blazer ── */}
        <g clipPath="url(#circle)">
          {/* Shoulder base */}
          <ellipse cx="60" cy="128" rx="52" ry="32" fill="url(#blazerG)" />

          {/* Blazer lapels */}
          <path
            d="M38 104 L60 118 L82 104 Q76 122 60 128 Q44 122 38 104Z"
            fill="#0D1B3E"
          />
          {/* Left lapel detail */}
          <path d="M38 104 L52 112 L50 118 Q43 115 38 104Z" fill="#162E5A" />
          {/* Right lapel detail */}
          <path d="M82 104 L68 112 L70 118 Q77 115 82 104Z" fill="#162E5A" />

          {/* White shirt / collar triangle */}
          <path
            d="M52 100 L60 110 L68 100 Q65 94 60 93 Q55 94 52 100Z"
            fill="#EDF2F8"
          />
          {/* Collar shadow */}
          <path
            d="M56 100 L60 107 L64 100 Q62 97 60 97 Q58 97 56 100Z"
            fill="#D4DFF0"
          />

          {/* Small gold lapel pin / CFA badge */}
          <circle cx="45" cy="108" r="3.5" fill="#F59E0B" />
          <text x="45" y="109.5" textAnchor="middle" fontSize="4" fill="#0D1B3E" fontWeight="800" fontFamily="Inter, sans-serif">$</text>
        </g>

        {/* ── Head & Hair ── */}
        <g clipPath="url(#circle)">
          {/* Hair base — neat professional bun / styled */}
          <ellipse cx="60" cy="58" rx="23" ry="27" fill="#1C0F08" />
          {/* Hair shine */}
          <ellipse cx="54" cy="44" rx="8" ry="5" fill="#2E1810" opacity="0.7" />
          {/* Professional bun at back */}
          <circle cx="60" cy="38" r="9" fill="#1C0F08" />
          <circle cx="60" cy="36" r="6" fill="#251208" />

          {/* Face */}
          <ellipse cx="60" cy="68" rx="18" ry="21" fill="url(#skinG)" />

          {/* Ear left */}
          <ellipse cx="41.5" cy="68" rx="3" ry="4.5" fill="#C4855C" />
          <ellipse cx="41.5" cy="68" rx="1.8" ry="3" fill="#B8744A" />
          {/* Ear right */}
          <ellipse cx="78.5" cy="68" rx="3" ry="4.5" fill="#C4855C" />
          <ellipse cx="78.5" cy="68" rx="1.8" ry="3" fill="#B8744A" />

          {/* Small gold earring left */}
          <circle cx="40" cy="70" r="1.5" fill="#F59E0B" />
          <circle cx="79.8" cy="70" r="1.5" fill="#F59E0B" />

          {/* Hair framing the face — side strands */}
          <path d="M42 55 Q38 62 40 72 Q39 60 44 52Z" fill="#1C0F08" />
          <path d="M78 55 Q82 62 80 72 Q81 60 76 52Z" fill="#1C0F08" />

          {/* ── Facial features ── */}

          {/* Eyebrows — confident, professional arch */}
          <path d="M49 59 Q53 56.5 57 58.5" stroke="#1C0F08" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M63 58.5 Q67 56.5 71 59" stroke="#1C0F08" strokeWidth="1.6" fill="none" strokeLinecap="round" />

          {/* Eyes — almond shaped, confident */}
          {/* Left eye */}
          <path d="M49 63.5 Q53 60.5 57 63.5 Q53 66.5 49 63.5Z" fill="#fff" />
          <ellipse cx="53" cy="63.5" rx="2.6" ry="2.4" fill="#3D2B1A" />
          <ellipse cx="53" cy="63.5" rx="1.5" ry="1.4" fill="#1A0D08" />
          <circle cx="54.2" cy="62.5" r="0.9" fill="#fff" opacity="0.75" />
          {/* Upper lash line left */}
          <path d="M49.5 63 Q53 60.5 56.5 63" stroke="#1A0D08" strokeWidth="0.8" fill="none" strokeLinecap="round" />

          {/* Right eye */}
          <path d="M63 63.5 Q67 60.5 71 63.5 Q67 66.5 63 63.5Z" fill="#fff" />
          <ellipse cx="67" cy="63.5" rx="2.6" ry="2.4" fill="#3D2B1A" />
          <ellipse cx="67" cy="63.5" rx="1.5" ry="1.4" fill="#1A0D08" />
          <circle cx="68.2" cy="62.5" r="0.9" fill="#fff" opacity="0.75" />
          {/* Upper lash line right */}
          <path d="M63.5 63 Q67 60.5 70.5 63" stroke="#1A0D08" strokeWidth="0.8" fill="none" strokeLinecap="round" />

          {/* Nose — subtle, refined */}
          <path d="M59 70 Q57.5 75 59 76.5 Q61 77 62.5 76.5 Q64 75 62 70" stroke="#A06040" strokeWidth="0.9" fill="none" strokeLinecap="round" />
          <path d="M58 76.5 Q60 78.5 62.5 76.5" stroke="#A06040" strokeWidth="1" fill="none" strokeLinecap="round" />

          {/* Confident professional smile */}
          <path d="M52 81 Q56 85.5 60 86 Q64 85.5 68 81"
            stroke="#A0502A" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          {/* Teeth hint */}
          <path d="M54 82.5 Q60 85 66 82.5 Q60 85.5 54 82.5Z"
            fill="#F0EBE6" opacity="0.6" />

          {/* Cheek warmth */}
          <ellipse cx="47" cy="75" rx="5" ry="3" fill="#E8855A" opacity="0.18" />
          <ellipse cx="73" cy="75" rx="5" ry="3" fill="#E8855A" opacity="0.18" />
        </g>

        {/* ── Outer ring / professional frame ── */}
        <circle cx="60" cy="60" r="58.5" stroke="#F59E0B" strokeWidth="1.5" strokeOpacity="0.35" fill="none" />
        <circle cx="60" cy="60" r="56" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
      </svg>

      {/* Online indicator dot */}
      {showOnline && (
        <div style={{
          position: "absolute",
          bottom: size * 0.04,
          right: size * 0.04,
          width: size * 0.22,
          height: size * 0.22,
          borderRadius: "50%",
          background: "#10B981",
          border: `${Math.max(2, size * 0.04)}px solid #fff`,
          boxShadow: "0 0 0 1px #10B981",
        }} />
      )}
    </div>
  );
}

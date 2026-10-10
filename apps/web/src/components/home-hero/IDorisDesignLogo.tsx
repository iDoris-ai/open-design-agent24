interface Props {
  className?: string;
  /** Accessible label for the wordmark (the artwork itself is decorative). */
  label?: string;
}

const WORD = 'iDoris Design';

// Agent24 fork: the home hero brand moment. Replaces the upstream WebGL
// PixelScanLogo with a cartoon painter mascot + "iDoris Design" wordmark.
// Pure SVG + CSS keyframes (see styles/home/home-hero.css, `.idoris-logo*`):
// no WebGL, no extra bundle weight, and `prefers-reduced-motion` freezes it.
export function IDorisDesignLogo({ className, label = WORD }: Props) {
  return (
    <div className={['idoris-logo', className].filter(Boolean).join(' ')} role="img" aria-label={label}>
      <svg className="idoris-logo__mascot" viewBox="0 0 120 120" aria-hidden focusable="false">
        <g className="idoris-logo__splats">
          <circle className="idoris-logo__splat idoris-logo__splat--1" cx="104" cy="22" r="5" />
          <circle className="idoris-logo__splat idoris-logo__splat--2" cx="112" cy="46" r="3.5" />
          <circle className="idoris-logo__splat idoris-logo__splat--3" cx="92" cy="10" r="3" />
        </g>
        <g className="idoris-logo__body">
          <line x1="52" y1="22" x2="52" y2="10" className="idoris-logo__stroke" />
          <circle className="idoris-logo__bulb" cx="52" cy="8" r="5" />
          <rect x="18" y="20" width="68" height="62" rx="30" className="idoris-logo__head" />
          <ellipse cx="34" cy="62" rx="6" ry="3.5" className="idoris-logo__cheek" />
          <ellipse cx="72" cy="62" rx="6" ry="3.5" className="idoris-logo__cheek" />
          <g className="idoris-logo__eyes">
            <ellipse cx="40" cy="50" rx="5" ry="7" className="idoris-logo__eye" />
            <ellipse cx="66" cy="50" rx="5" ry="7" className="idoris-logo__eye" />
            <circle cx="42" cy="47" r="1.8" className="idoris-logo__glint" />
            <circle cx="68" cy="47" r="1.8" className="idoris-logo__glint" />
          </g>
          <path d="M44 68 Q53 76 62 68" className="idoris-logo__smile" />
          <rect x="34" y="84" width="36" height="24" rx="11" className="idoris-logo__torso" />
          <g className="idoris-logo__arm">
            <path d="M70 92 Q84 88 90 72" className="idoris-logo__stroke" />
            <g transform="rotate(28 92 66)">
              <rect x="89" y="46" width="6" height="22" rx="3" className="idoris-logo__brush-handle" />
              <path d="M88 47 Q92 34 96 47 Z" className="idoris-logo__brush-tip" />
            </g>
          </g>
        </g>
      </svg>
      <span className="idoris-logo__word" aria-hidden>
        {Array.from(WORD).map((ch, i) => (
          <span
            key={i}
            className={ch === ' ' ? 'idoris-logo__gap' : 'idoris-logo__char'}
            style={{ animationDelay: `${0.15 + i * 0.05}s` }}
          >
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </span>
    </div>
  );
}

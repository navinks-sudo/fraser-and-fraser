import React from 'react';

/**
 * SBL Knowledge Services logo — three stacked italic block letters in
 * green / red / blue, with the "Success through Partnership" tagline
 * underneath. Pure SVG so it scales crisply at every size.
 *
 * Props:
 *   - size: target render height in pixels (default 42)
 *   - showTagline: whether to render the tagline strip (default true)
 *   - className: forwarded to the wrapper
 */
const SblLogo = ({ size = 42, showTagline = true, className = '' }) => {
  // Native SVG height; we scale via the rendered `height` prop.
  const VB_W = 160;
  const VB_H = showTagline ? 160 : 120;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={size * (VB_W / VB_H)}
      height={size}
      className={className}
      role="img"
      aria-label="SBL Knowledge Services"
      style={{ display: 'block' }}
    >
      <defs>
        <style>{`
          .sbl-letter {
            font-family: 'Inter Tight', 'Arial Black', system-ui, sans-serif;
            font-weight: 900;
            font-style: italic;
            paint-order: stroke fill;
            stroke: #ffffff;
            stroke-width: 4;
            stroke-linejoin: round;
            letter-spacing: -0.04em;
          }
          .sbl-tag {
            font-family: 'Inter', system-ui, sans-serif;
            font-weight: 600;
            letter-spacing: 0.04em;
            fill: #2A3550;
          }
        `}</style>
      </defs>

      {/* Letters arranged in a tight diagonal stack — S top-left (green),
          B middle (red), L bottom-right (blue, biggest). */}
      <text className="sbl-letter" x="6"  y="58"  fontSize="76"  fill="#5BB12F">S</text>
      <text className="sbl-letter" x="42" y="78"  fontSize="84"  fill="#E83A2E">B</text>
      <text className="sbl-letter" x="78" y="106" fontSize="120" fill="#1F8AE6">L</text>

      {showTagline && (
        <text
          className="sbl-tag"
          x={VB_W / 2}
          y={VB_H - 6}
          fontSize="11"
          textAnchor="middle"
        >
          Success through Partnership
        </text>
      )}
    </svg>
  );
};

export default SblLogo;

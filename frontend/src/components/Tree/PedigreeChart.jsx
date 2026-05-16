import React, { useMemo, forwardRef, useRef, useImperativeHandle } from 'react';
import { User, UserRound, HelpCircle } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { layoutPedigree, PERSON_W, PERSON_H } from '../../utils/pedigreeLayout';

// Restrained — borders + small symbol only, no fills, no shouting accents.
// Harmonised with the navy + orange brand palette.
const PALETTE = {
  M: { border: '#142849', symbol: '#0B1F3A', muted: '#3D4F70' },  // navy
  F: { border: '#E25E10', symbol: '#7C2F06', muted: '#C84F0D' },  // orange
  U: { border: '#B9B19E', symbol: '#5B6478', muted: '#8A8470' },  // warm grey
};

const PHOTO_H = 110;            // photo area inside the card
const ANCHOR_R = 5;             // top anchor dot radius
const MARRIAGE_DROP = 30;       // how far below cards the marriage anchor sits
const CARD_CORNER = 8;

const Silhouette = ({ g, fill }) => {
  // Soft photographer-silhouette in SVG. Same shape for M/F so it reads as
  // "photo placeholder" rather than gender confirmation.
  const stroke = fill;
  return (
    <g style={{ color: stroke, opacity: 0.42 }}>
      {/* Head */}
      <circle cx="0" cy="-22" r="20" fill={stroke} opacity={0.55} />
      {/* Shoulders / torso */}
      <path
        d="M -40 30 Q -40 -8 0 -8 Q 40 -8 40 30 L 40 50 L -40 50 Z"
        fill={stroke}
        opacity={0.55}
      />
    </g>
  );
};

const wrapName = (name, lineLen = 17) => {
  if (!name) return [''];
  if (name.length <= lineLen) return [name];
  const words = name.split(' ');
  const lines = [''];
  for (const w of words) {
    const cand = (lines[lines.length - 1] ? lines[lines.length - 1] + ' ' : '') + w;
    if (cand.length <= lineLen) lines[lines.length - 1] = cand;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = lines[1] + '…'; break; }
  }
  return lines;
};

const PersonCard = ({ p, selectedId, onClick }) => {
  const pal = PALETTE[p.gender] || PALETTE.U;
  const isSelected = selectedId === p.id;
  const sym = p.gender === 'F' ? '♀' : p.gender === 'M' ? '♂' : '◦';
  const nameLines = wrapName(p.name, 17);
  const dateLine = p.birthYear
    ? `b. ${p.birthYear}${p.deathYear ? ` – d. ${p.deathYear}` : ''}`
    : p.deathYear ? `d. ${p.deathYear}` : '';

  return (
    <g
      transform={`translate(${p.x}, ${p.y})`}
      style={{ cursor: 'pointer' }}
      onClick={(e) => { e.stopPropagation(); onClick(p); }}
    >
      {/* Selection halo */}
      {isSelected && (
        <rect
          x={-3}
          y={-3}
          width={PERSON_W + 6}
          height={PERSON_H + 6}
          rx={CARD_CORNER + 2}
          fill="none"
          stroke={pal.symbol}
          strokeWidth={2}
          strokeDasharray="4 3"
          opacity={0.75}
        />
      )}

      {/* Top anchor — where parent connections meet the card */}
      <circle
        cx={PERSON_W / 2}
        cy={-2}
        r={ANCHOR_R}
        fill="white"
        stroke={pal.border}
        strokeWidth={1.5}
      />

      {/* Card body */}
      <rect
        width={PERSON_W}
        height={PERSON_H}
        rx={CARD_CORNER}
        fill="white"
        stroke={pal.border}
        strokeWidth={1.75}
        style={{ filter: 'drop-shadow(0 1px 2px rgba(15,23,42,0.05))' }}
      />

      {/* Photo well — subtle inset background */}
      <rect
        x={6}
        y={6}
        width={PERSON_W - 12}
        height={PHOTO_H}
        rx={CARD_CORNER - 4}
        fill="#F8F6F1"
        stroke="#E8E2D4"
        strokeWidth={0.5}
      />

      {/* Silhouette photo */}
      <g transform={`translate(${PERSON_W / 2}, ${6 + PHOTO_H - 22})`}>
        <Silhouette g={p.gender} fill={pal.muted} />
      </g>

      {/* Divider under photo */}
      <line
        x1={10}
        y1={6 + PHOTO_H + 8}
        x2={PERSON_W - 10}
        y2={6 + PHOTO_H + 8}
        stroke="#E8E2D4"
        strokeWidth={1}
      />

      {/* Name + gender symbol */}
      <text
        x={10}
        y={6 + PHOTO_H + 26}
        fill={pal.symbol}
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.06em',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {sym}
      </text>
      {nameLines.map((line, i) => (
        <text
          key={i}
          x={22}
          y={6 + PHOTO_H + 26 + i * 13}
          fill="#0B1F3A"
          style={{
            fontSize: 11.5,
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontFamily: "'Inter Tight', 'Inter', system-ui, sans-serif",
          }}
        >
          {line}
        </text>
      ))}

      {/* Birth/death years */}
      {dateLine && (
        <text
          x={22}
          y={6 + PHOTO_H + 26 + nameLines.length * 13 + 2}
          fill="#8A8470"
          style={{
            fontSize: 9.5,
            fontStyle: 'italic',
            fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {dateLine}
        </text>
      )}

      {/* Subject marker — tiny orange corner pip */}
      {p.principal && (
        <circle cx={PERSON_W - 10} cy={10} r={3.5} fill="#E25E10" />
      )}
    </g>
  );
};

const Legend = () => (
  <div className="absolute top-4 right-4 z-30 bg-surface/95 backdrop-blur border border-line shadow-warm-sm rounded-md p-2.5 text-[10px] font-medium text-ink-secondary">
    <div className="text-[9px] uppercase tracking-[0.22em] text-ink-tertiary font-bold mb-1.5 pb-1.5 border-b border-line-subtle">
      Legend
    </div>
    <div className="flex items-center gap-2 mb-1">
      <span className="w-3.5 h-3.5 rounded-sm bg-surface" style={{ border: '2px solid #142849' }} />
      <span><strong className="text-navy-800">♂</strong> Male</span>
    </div>
    <div className="flex items-center gap-2 mb-1">
      <span className="w-3.5 h-3.5 rounded-sm bg-surface" style={{ border: '2px solid #E25E10' }} />
      <span><strong className="text-orange-600">♀</strong> Female</span>
    </div>
    <div className="flex items-center gap-2 mb-1">
      <span className="w-3.5 h-3.5 rounded-sm bg-surface" style={{ border: '2px solid #B9B19E' }} />
      <span>Unknown</span>
    </div>
    <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-line-subtle">
      <span className="w-2 h-2 rounded-full bg-orange-500" />
      <span>Subject of record</span>
    </div>
  </div>
);

const PedigreeChart = forwardRef(({ gedcomx, onNodeClick, selectedId, direction = 'vertical' }, ref) => {
  // Held by us, populated by TransformWrapper. Exposes:
  //   zoomIn(step?, time?), zoomOut(step?, time?), resetTransform(time?, animationType?)
  //   centerView(scale?, time?), setTransform(x, y, scale, time?), instance.transformState
  const transformRef = useRef(null);

  // Surface a clean zoom API to the parent (TreeViewer's toolbar dock).
  useImperativeHandle(ref, () => ({
    zoomIn: (step = 0.2) => transformRef.current?.zoomIn(step, 200),
    zoomOut: (step = 0.2) => transformRef.current?.zoomOut(step, 200),
    reset: () => transformRef.current?.resetTransform(300),
    center: (scale) => transformRef.current?.centerView(scale ?? 0.7, 300),
    getScale: () => transformRef.current?.instance?.transformState?.scale ?? 1,
  }), []);
  const layout = useMemo(() => layoutPedigree(gedcomx, { direction }), [gedcomx, direction]);

  if (!layout.persons.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ink-tertiary">
        <p>No persons in the tree.</p>
      </div>
    );
  }

  // Build a small paper-grid by drawing dots — feels like printed pedigree paper
  return (
    <div
      className="w-full h-full relative"
      style={{
        background: '#F8F6F1',
        backgroundImage:
          'radial-gradient(circle, #D9D2C1 0.7px, transparent 0.7px)',
        backgroundSize: '24px 24px',
      }}
    >
      <Legend />

      <TransformWrapper
        ref={transformRef}
        initialScale={0.7}
        minScale={0.15}
        maxScale={2.5}
        centerOnInit
        wheel={{ step: 0.08 }}
        doubleClick={{ disabled: true }}
        panning={{ velocityDisabled: true }}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: layout.width, height: layout.height }}
        >
          <svg
            className="pedigree-svg"
            data-pedigree="root"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block' }}
          >

            {/* Couples — U-shaped connector dropping from each spouse to a shared marriage anchor */}
            {layout.couples.map((c, i) => {
              const isVertical = direction === 'vertical';
              if (isVertical) {
                // Two cards side by side, U drops below
                const leftX = Math.min(c.line.x1, c.line.x2);
                const rightX = Math.max(c.line.x1, c.line.x2);
                const cardBottom = c.line.y1 + PERSON_H / 2;  // c.line.y1 is mid-height; cardBottom adjusts
                // Actually our layout puts marriage line at mid-height between cards.
                // Let's compute card bottom from line y minus half PERSON_H... easier: derive from layout
                // We need bottom-of-card y, which we don't have directly. Reconstruct from line y:
                // line.y is at PERSON_H/2 below card top. Card top = line.y - PERSON_H/2. Card bottom = line.y + PERSON_H/2.
                const cardTopY = c.line.y1 - PERSON_H / 2;
                const bottomY = cardTopY + PERSON_H;
                const anchorY = bottomY + MARRIAGE_DROP;
                const midX = (leftX + rightX) / 2;
                // Connector path: from left spouse bottom-center -> down -> right to anchor -> up -> right spouse bottom-center
                const path = `
                  M ${(c.line.x1)} ${bottomY}
                  L ${(c.line.x1)} ${anchorY - 8}
                  Q ${(c.line.x1)} ${anchorY} ${(c.line.x1) + 8} ${anchorY}
                  L ${(c.line.x2) - 8} ${anchorY}
                  Q ${(c.line.x2)} ${anchorY} ${(c.line.x2)} ${anchorY - 8}
                  L ${(c.line.x2)} ${bottomY}
                `;
                return (
                  <g key={`c-${i}`}>
                    {/* Build coordinates: line.x1 and line.x2 are EDGES of card (one is +PERSON_W, one is the other card's x).
                       Use the centers of card bottoms instead. */}
                    {(() => {
                      const aLeft = c.leftId ? null : null;  // just to silence
                      // Marriage line endpoints are card edges; compute center of each card.
                      // leftCardCenterX = c.line.x1 - PERSON_W/2  (since x1 was leftCardX + PERSON_W)
                      const leftCenterX = c.line.x1 - PERSON_W / 2;
                      const rightCenterX = c.line.x2 + PERSON_W / 2;
                      const path2 = `
                        M ${leftCenterX} ${bottomY}
                        L ${leftCenterX} ${anchorY - 10}
                        Q ${leftCenterX} ${anchorY} ${leftCenterX + 10} ${anchorY}
                        L ${rightCenterX - 10} ${anchorY}
                        Q ${rightCenterX} ${anchorY} ${rightCenterX} ${anchorY - 10}
                        L ${rightCenterX} ${bottomY}
                      `;
                      return <path d={path2} fill="none" stroke="#B9B19E" strokeWidth={1.5} strokeLinecap="round" />;
                    })()}
                    {/* Marriage anchor */}
                    <circle cx={midX} cy={anchorY} r={4} fill="white" stroke="#8A8470" strokeWidth={1.5} />
                  </g>
                );
              }
              // Horizontal layout — U shape extends to the right of the couple
              const topY = Math.min(c.line.y1, c.line.y2);
              const bottomYh = Math.max(c.line.y1, c.line.y2);
              const cardLeftX = c.line.x1 - PERSON_W / 2;
              const cardRight = cardLeftX + PERSON_W;
              const anchorX = cardRight + MARRIAGE_DROP;
              const midY = (topY + bottomYh) / 2;
              const topCenterY = topY - PERSON_H / 2 + PERSON_H / 2;  // simplify: just use topY for top card center
              // We need each card's right-edge center. line.y1, line.y2 ARE the centers.
              return (
                <g key={`c-${i}`}>
                  <path
                    d={`
                      M ${cardRight} ${c.line.y1}
                      L ${anchorX - 10} ${c.line.y1}
                      Q ${anchorX} ${c.line.y1} ${anchorX} ${c.line.y1 + (c.line.y1 < c.line.y2 ? 10 : -10)}
                      L ${anchorX} ${c.line.y2 + (c.line.y1 < c.line.y2 ? -10 : 10)}
                      Q ${anchorX} ${c.line.y2} ${anchorX - 10} ${c.line.y2}
                      L ${cardRight} ${c.line.y2}
                    `}
                    fill="none"
                    stroke="#B9B19E"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                  <circle cx={anchorX} cy={midY} r={4} fill="white" stroke="#8A8470" strokeWidth={1.5} />
                </g>
              );
            })}

            {/* Descent (parent marriage anchor → sibling bracket → each child's top anchor) */}
            {layout.descents.map((d) => {
              const isVertical = direction === 'vertical';
              if (isVertical) {
                // Compute marriage anchor (already drawn). We need the descent stem to start there.
                // The layout's stem.y1 is parent card bottom. We want descent to start at marriage anchor instead.
                // Marriage anchor y = parent bottom + MARRIAGE_DROP. Adjust stem to start there.
                const stemStartY = d.stem.y1 + MARRIAGE_DROP;
                return (
                  <g key={`d-${d.id}`}>
                    {/* Stem from marriage anchor down to bracket */}
                    <line
                      x1={d.stem.x1}
                      y1={stemStartY}
                      x2={d.stem.x2}
                      y2={d.stem.y2}
                      stroke="#B9B19E"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    {/* Bracket */}
                    {d.bracket && (
                      <line {...d.bracket} stroke="#B9B19E" strokeWidth={1.5} strokeLinecap="round" />
                    )}
                    {/* Drops to each child's top anchor (instead of card top) */}
                    {d.drops.map((drop, i) => (
                      <line
                        key={`drop-${d.id}-${i}`}
                        x1={drop.x1}
                        y1={drop.y1}
                        x2={drop.x2}
                        y2={drop.y2 - 2}
                        stroke="#B9B19E"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                      />
                    ))}
                  </g>
                );
              }
              // Horizontal: similar but rightward
              const stemStartX = d.stem.x1 + MARRIAGE_DROP;
              return (
                <g key={`d-${d.id}`}>
                  <line
                    x1={stemStartX}
                    y1={d.stem.y1}
                    x2={d.stem.x2}
                    y2={d.stem.y2}
                    stroke="#B9B19E"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                  {d.bracket && (
                    <line {...d.bracket} stroke="#B9B19E" strokeWidth={1.5} strokeLinecap="round" />
                  )}
                  {d.drops.map((drop, i) => (
                    <line key={`drop-${d.id}-${i}`} {...drop}
                          stroke="#B9B19E" strokeWidth={1.5} strokeLinecap="round" />
                  ))}
                </g>
              );
            })}

            {/* Person cards */}
            {layout.persons.map((p) => (
              <PersonCard key={p.id} p={p} selectedId={selectedId} onClick={onNodeClick} />
            ))}
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
});
PedigreeChart.displayName = 'PedigreeChart';

export default PedigreeChart;

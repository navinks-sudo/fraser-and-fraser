import React, { useMemo } from 'react';
import {
  User, UserRound, HelpCircle, Heart, Briefcase, MapPin, Star,
} from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { layoutPedigree, PERSON_W, PERSON_H } from '../../utils/pedigreeLayout';

// Restrained, document-style palette. Tints are muted so the cards read like
// printed cells in a published pedigree, not bright UI chips.
const PALETTE = {
  M: { accent: '#1F3A6D', soft: '#EEF2FB', deep: '#0F1F40', muted: '#5872A6' },
  F: { accent: '#7E2F4F', soft: '#FBF1F5', deep: '#4A1530', muted: '#A6577A' },
  U: { accent: '#475569', soft: '#F1F5F9', deep: '#334155', muted: '#94A3B8' },
};

const GenderIcon = ({ g, size = 18, color }) => {
  if (g === 'F') return <UserRound size={size} color={color} strokeWidth={1.6} />;
  if (g === 'M') return <User size={size} color={color} strokeWidth={1.6} />;
  return <HelpCircle size={size} color={color} strokeWidth={1.6} />;
};

const wrapName = (name, lineLen = 18) => {
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

const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

const PersonCard = ({ p, selectedId, onClick }) => {
  const pal = PALETTE[p.gender] || PALETTE.U;
  const isSelected = selectedId === p.id;
  const age = p.birthYear && p.deathYear ? p.deathYear - p.birthYear : null;
  const lifespan = p.birthYear || p.deathYear
    ? `${p.birthYear ?? '—'} — ${p.deathYear ?? '—'}`
    : null;
  const nameLines = wrapName(p.name, 18);

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
          rx={9}
          fill="none"
          stroke="#0F172A"
          strokeWidth={1.25}
          opacity={0.55}
        />
      )}

      {/* Card body — quiet, paper-like */}
      <rect
        width={PERSON_W}
        height={PERSON_H}
        rx={6}
        fill="white"
        stroke="#E2E8F0"
        strokeWidth={1}
        style={{ filter: 'drop-shadow(0 1px 2px rgba(15,23,42,0.04)) drop-shadow(0 4px 12px rgba(15,23,42,0.04))' }}
      />

      {/* Slim top accent in the gender colour */}
      <rect x={0} y={0} width={PERSON_W} height={4} rx={6} fill={pal.accent} />
      <rect x={0} y={2} width={PERSON_W} height={2} fill={pal.accent} />

      {/* Generation marker — tiny, top-left, very subtle */}
      <text
        x={14}
        y={20}
        fill="#94A3B8"
        style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.2em', fontFamily: "'Inter', sans-serif" }}
      >
        GEN {p.generation + 1}
      </text>

      {/* Subject star — gold, top-right */}
      {p.principal && (
        <g transform={`translate(${PERSON_W - 18}, 12)`}>
          <Star size={11} fill="#D69E2E" color="#D69E2E" strokeWidth={1.2} />
        </g>
      )}

      {/* Avatar — refined circle with single ring */}
      <g transform="translate(18, 32)">
        <circle cx={16} cy={16} r={17} fill={pal.soft} stroke={pal.accent} strokeWidth={1.2} />
        <g transform="translate(7, 7)" style={{ color: pal.deep }}>
          <GenderIcon g={p.gender} size={18} color={pal.deep} />
        </g>
      </g>

      {/* Name */}
      {nameLines.map((line, i) => (
        <text
          key={i}
          x={62}
          y={48 + i * 16}
          fill="#0F172A"
          style={{
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
            letterSpacing: '-0.01em',
          }}
        >
          {line}
        </text>
      ))}

      {/* Lifespan — tabular nums, slate-500 */}
      <text
        x={62}
        y={48 + nameLines.length * 16 + 2}
        fill="#64748B"
        style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {lifespan ? `${lifespan}${age != null ? `   ·   ${age} yr` : ''}` : 'dates unknown'}
      </text>

      {/* Footer divider */}
      <line x1={14} y1={PERSON_H - 30} x2={PERSON_W - 14} y2={PERSON_H - 30}
            stroke="#F1F5F9" strokeWidth={1} />

      {/* Place row */}
      {p.birthPlace && (
        <g transform={`translate(14, ${PERSON_H - 20})`}>
          <g style={{ color: '#94A3B8' }}>
            <MapPin size={10} color="#94A3B8" strokeWidth={1.6} />
          </g>
          <text x={14} y={9} fill="#475569" style={{ fontSize: 10.5 }}>
            {truncate(p.birthPlace, 28)}
          </text>
        </g>
      )}

      {/* Occupation row (or shifts up if no place) */}
      {p.occupation && (
        <g transform={`translate(14, ${PERSON_H - (p.birthPlace ? 6 : 20)})`}>
          <g style={{ color: '#94A3B8' }}>
            <Briefcase size={10} color="#94A3B8" strokeWidth={1.6} />
          </g>
          <text x={14} y={9} fill="#92400E"
                style={{ fontSize: 10.5, fontStyle: 'italic', fontWeight: 500 }}>
            {truncate(p.occupation, 28)}
          </text>
        </g>
      )}
    </g>
  );
};

// Top-right floating legend so the chart reads as a "document"
const Legend = () => (
  <div className="absolute top-4 right-4 z-30 bg-white/95 backdrop-blur border border-line shadow-warm-sm rounded-md p-2.5 text-[10px] font-medium text-ink-secondary">
    <div className="flex items-center gap-3 mb-1.5 pb-1.5 border-b border-line-subtle">
      <span className="text-[9px] uppercase tracking-widest text-ink-tertiary font-bold">Legend</span>
    </div>
    <div className="flex items-center gap-2 mb-1">
      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#EEF2FB', border: '1.5px solid #1F3A6D' }} />
      <span>Male</span>
    </div>
    <div className="flex items-center gap-2 mb-1">
      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FBF1F5', border: '1.5px solid #7E2F4F' }} />
      <span>Female</span>
    </div>
    <div className="flex items-center gap-2 mb-1">
      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#F1F5F9', border: '1.5px solid #475569' }} />
      <span>Unknown</span>
    </div>
    <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-line-subtle">
      <Star size={10} fill="#D69E2E" color="#D69E2E" strokeWidth={1} />
      <span>Subject of record</span>
    </div>
    <div className="flex items-center gap-2 mt-1">
      <Heart size={10} fill="#9F4267" color="#9F4267" strokeWidth={1} />
      <span>Married</span>
    </div>
  </div>
);

const PedigreeChart = ({ gedcomx, onNodeClick, selectedId, direction = 'vertical' }) => {
  const layout = useMemo(() => layoutPedigree(gedcomx, { direction }), [gedcomx, direction]);

  if (!layout.persons.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ink-tertiary">
        <p>No persons in the tree.</p>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full relative"
      style={{
        background: 'linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 50%, #F8FAFC 100%)',
      }}
    >
      <Legend />

      <TransformWrapper
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
          <svg width={layout.width} height={layout.height} style={{ display: 'block' }}>
            <defs>
              <linearGradient id="marriageLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#1F3A6D" />
                <stop offset="50%" stopColor="#7E2F4F" />
                <stop offset="100%" stopColor="#1F3A6D" />
              </linearGradient>
              {/* Subtle paper grid for document feel */}
              <pattern id="paperGrid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="0" cy="0" r="0.6" fill="#E2E8F0" />
              </pattern>
            </defs>

            {/* Paper grid overlay — extremely faint */}
            <rect width={layout.width} height={layout.height} fill="url(#paperGrid)" opacity={0.5} />

            {/* Generation lanes — alternating quiet tints */}
            {layout.genRanges.map((g, i) => {
              const isHorizontal = layout.direction === 'horizontal';
              const laneFill = i % 2 === 0 ? 'rgba(241,245,249,0.7)' : 'transparent';
              if (isHorizontal) {
                return (
                  <g key={`gen-${g.generation}`}>
                    <rect x={g.main - 36} y={0} width={PERSON_W + 72} height={layout.height} fill={laneFill} />
                    <g transform={`translate(${g.main + PERSON_W / 2}, 30)`}>
                      <text textAnchor="middle" fill="#475569"
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              letterSpacing: '0.25em',
                              textTransform: 'uppercase',
                              fontFamily: "'Inter', system-ui, sans-serif",
                            }}>
                        Generation {g.generation + 1}
                      </text>
                      <text y={13} textAnchor="middle" fill="#94A3B8"
                            style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.05em' }}>
                        {g.minYear ? `c. ${g.minYear}${g.maxYear && g.maxYear !== g.minYear ? `–${g.maxYear}` : ''}` : ''}
                        {g.minYear && g.count ? ' · ' : ''}
                        {g.count} {g.count === 1 ? 'person' : 'persons'}
                      </text>
                      <line x1={-PERSON_W / 2 - 30} y1={30} x2={PERSON_W / 2 + 30} y2={30} stroke="#CBD5E1" strokeWidth={0.6} />
                    </g>
                  </g>
                );
              }
              return (
                <g key={`gen-${g.generation}`}>
                  <rect x={0} y={g.main - 36} width={layout.width} height={PERSON_H + 72} fill={laneFill} />
                  <g transform={`translate(36, ${g.main - 14})`}>
                    <text fill="#475569"
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            letterSpacing: '0.25em',
                            textTransform: 'uppercase',
                            fontFamily: "'Inter', system-ui, sans-serif",
                          }}>
                      Generation {g.generation + 1}
                    </text>
                    <text x={150} fill="#94A3B8"
                          style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.05em' }}>
                      {g.minYear ? `c. ${g.minYear}${g.maxYear && g.maxYear !== g.minYear ? `–${g.maxYear}` : ''}` : ''}
                      {g.minYear && g.count ? ' · ' : ''}
                      {g.count} {g.count === 1 ? 'person' : 'persons'}
                    </text>
                  </g>
                  <line x1={36} y1={g.main - 22} x2={layout.width - 36} y2={g.main - 22}
                        stroke="#CBD5E1" strokeWidth={0.6} />
                </g>
              );
            })}

            {/* Descent — slim, professional slate lines */}
            {layout.descents.map((d) => (
              <g key={`desc-${d.id}`}>
                <line {...d.stem} stroke="#94A3B8" strokeWidth={1.25} strokeLinecap="round" />
                {d.bracket && (
                  <line {...d.bracket} stroke="#94A3B8" strokeWidth={1.25} strokeLinecap="round" />
                )}
                {d.drops.map((drop, i) => (
                  <line key={`drop-${d.id}-${i}`} {...drop}
                        stroke="#94A3B8" strokeWidth={1.25} strokeLinecap="round" />
                ))}
              </g>
            ))}

            {/* Marriage bars */}
            {layout.couples.map((c, i) => (
              <g key={`couple-${i}`}>
                <line {...c.line}
                      stroke="url(#marriageLine)" strokeWidth={1.5} strokeLinecap="round" />
                <g transform={`translate(${c.mid.x - 5}, ${c.mid.y - 5})`}>
                  <circle cx={5} cy={5} r={6} fill="white" stroke="#7E2F4F" strokeWidth={1} />
                  <g transform="translate(-1, -1)">
                    <Heart size={9} fill="#7E2F4F" color="#7E2F4F" strokeWidth={1} />
                  </g>
                </g>
              </g>
            ))}

            {/* Person cards on top */}
            {layout.persons.map((p) => (
              <PersonCard key={p.id} p={p} selectedId={selectedId} onClick={onNodeClick} />
            ))}
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
};

export default PedigreeChart;

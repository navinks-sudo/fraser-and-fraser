// Pedigree layout — turns a GedcomX graph into positioned cards on a 2-D canvas.
//
// Supports two directions:
//   - 'vertical'   (default): generations stack top→bottom, siblings spread L→R,
//                  couples are side-by-side (husband left, wife right).
//   - 'horizontal':           generations spread L→R, siblings stack top→bottom,
//                  couples are stacked vertically (husband top, wife bottom).
//
// Algorithm is depth-first subtree-shifting: lay out a family's children first
// then centre the parents over them; if centring would push left/up of the
// canvas origin, shift the entire subtree to make room.

export const PERSON_W = 150;
export const PERSON_H = 180;
const COUPLE_GAP = 32;     // small gap between spouses (cards stay close)
const FAMILY_GAP = 64;     // bigger gap between unrelated families
const SIBLING_GAP = 32;
const GEN_GAP = 140;       // vertical between generations (room for descent stems)
const PAD = 72;

const nameOf = (p) => (p.names || [])[0]?.nameForms?.[0]?.fullText || p.id;
const genderOf = (p) => {
  const t = (p.gender || {}).type || '';
  if (t.endsWith('Male')) return 'M';
  if (t.endsWith('Female')) return 'F';
  return 'U';
};
const factOf = (p, suffix) => (p.facts || []).find((f) => (f.type || '').endsWith(suffix));
const yearOf = (raw) => {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
};

export function layoutPedigree(gedcomx, opts = {}) {
  const direction = opts.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const persons = gedcomx?.persons || [];
  const rels = gedcomx?.relationships || [];

  if (!persons.length) {
    return { persons: [], couples: [], descents: [], genRanges: [], width: 0, height: 0, direction };
  }

  // ── Indexes
  const childrenOf = new Map();
  const parentsOf = new Map();
  const coupleSet = new Set();
  const couplePairs = [];

  for (const r of rels) {
    const t = (r.type || '').split('/').slice(-1)[0];
    const a = (r.person1 || {}).resource?.replace('#', '');
    const b = (r.person2 || {}).resource?.replace('#', '');
    if (!a || !b) continue;
    if (t === 'ParentChild') {
      if (!childrenOf.has(a)) childrenOf.set(a, []);
      childrenOf.get(a).push(b);
      if (!parentsOf.has(b)) parentsOf.set(b, []);
      parentsOf.get(b).push(a);
    } else if (t === 'Couple') {
      const key = [a, b].sort().join('|');
      if (!coupleSet.has(key)) {
        coupleSet.add(key);
        couplePairs.push([a, b]);
      }
    }
  }

  // ── Family units (couple, shared children) + single-parent units
  const families = [];
  const familyOfChild = new Map();
  for (const [a, b] of couplePairs) {
    const aKids = new Set(childrenOf.get(a) || []);
    const bKids = new Set(childrenOf.get(b) || []);
    const shared = [...aKids].filter((c) => bKids.has(c));
    // Order parents so father (M) comes first, mother (F) second
    const pa = (gedcomx.persons || []).find((p) => p.id === a);
    const pb = (gedcomx.persons || []).find((p) => p.id === b);
    const ga = pa ? genderOf(pa) : 'U';
    const ordered = ga === 'F' && genderOf(pb) === 'M' ? [b, a] : [a, b];
    const fam = { id: `fam-${ordered[0]}-${ordered[1]}`, parents: ordered, children: shared };
    families.push(fam);
    for (const c of shared) familyOfChild.set(c, fam);
  }
  const assignedAsParent = new Set();
  for (const f of families) for (const p of f.parents) assignedAsParent.add(p);
  for (const [pid, kids] of childrenOf) {
    if (assignedAsParent.has(pid)) continue;
    const newKids = kids.filter((c) => !familyOfChild.has(c));
    if (!newKids.length) continue;
    const fam = { id: `fam-${pid}`, parents: [pid], children: newKids };
    families.push(fam);
    for (const c of newKids) familyOfChild.set(c, fam);
    assignedAsParent.add(pid);
  }
  const familyByParent = new Map();
  for (const f of families) for (const p of f.parents) familyByParent.set(p, f);

  // ── Generation depths (longest path from a root)
  const gen = new Map();
  persons.forEach((p) => gen.set(p.id, 0));
  let changed = true;
  let safety = 0;
  while (changed && safety++ < 1000) {
    changed = false;
    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      if (!parents.length) continue;
      const m = Math.max(...parents.map((pp) => gen.get(pp) ?? 0));
      if ((gen.get(p.id) ?? 0) < m + 1) {
        gen.set(p.id, m + 1);
        changed = true;
      }
    }
  }
  for (const [a, b] of couplePairs) {
    const m = Math.max(gen.get(a) ?? 0, gen.get(b) ?? 0);
    gen.set(a, m);
    gen.set(b, m);
  }

  // ── Direction-specific geometry
  // crossSize  = size of a card along the cross-axis (perpendicular to generation flow)
  // crossGap   = gap between siblings on the cross-axis
  // famGap     = gap between unrelated family groups on the cross-axis
  // mainSize   = size of a card along the main (generation) axis
  // mainGap    = gap between generations on the main axis
  // coupleGap  = gap between the two spouses (laid out along the cross-axis perpendicular to generation flow)
  //
  // In VERTICAL: cross axis = X, main axis = Y. A couple is laid out across the cross axis (side by side).
  // In HORIZONTAL: cross axis = Y, main axis = X. A couple is still laid out across its own perpendicular
  //   axis — which is now the main axis. So spouses sit one above the other (same X), stacked on the Y axis.
  //   Wait — that's not quite right. Let me re-check.
  //
  // In horizontal pedigree convention: father on top, mother below, both in the SAME GENERATION COLUMN.
  // So the couple is stacked along the cross-axis (Y). Marriage line is short vertical.
  // That means the couple TAKES UP the cross-axis space, just like in vertical mode.

  const crossSize = direction === 'vertical' ? PERSON_W : PERSON_H;
  const crossGap = SIBLING_GAP;
  const famGap = FAMILY_GAP;
  const coupleGap = COUPLE_GAP;
  const mainSize = direction === 'vertical' ? PERSON_H : PERSON_W;
  const mainGap = GEN_GAP;

  // ── Cross-axis positions
  const cx = new Map(); // personId → cross-axis coord (top-left of card on cross axis)
  const placed = new Set();

  const shiftSubtree = (subtree, delta) => {
    for (const id of subtree) cx.set(id, (cx.get(id) ?? 0) + delta);
  };

  const layoutFamily = (fam, leftEdge) => {
    const subtree = new Set();
    let cursor = leftEdge;
    const childCenters = [];

    for (const childId of fam.children) {
      if (placed.has(childId)) {
        childCenters.push((cx.get(childId) ?? 0) + crossSize / 2);
        continue;
      }
      const subFam = familyByParent.get(childId);
      if (subFam) {
        const { rightEdge, subtree: subSub } = layoutFamily(subFam, cursor);
        cursor = rightEdge;
        for (const id of subSub) subtree.add(id);
        if (cx.has(childId)) childCenters.push(cx.get(childId) + crossSize / 2);
      } else {
        cx.set(childId, cursor);
        placed.add(childId);
        subtree.add(childId);
        childCenters.push(cursor + crossSize / 2);
        cursor += crossSize + crossGap;
      }
    }

    const N = fam.parents.length;
    const blockW = N * crossSize + (N - 1) * coupleGap;

    let childCentroid;
    if (childCenters.length) {
      childCentroid = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
    } else {
      childCentroid = leftEdge + blockW / 2;
    }

    let parentStartX = childCentroid - blockW / 2;
    if (parentStartX < leftEdge) {
      const delta = leftEdge - parentStartX;
      shiftSubtree(subtree, delta);
      parentStartX = leftEdge;
      cursor += delta;
    }

    fam.parents.forEach((pid, i) => {
      if (!placed.has(pid)) {
        cx.set(pid, parentStartX + i * (crossSize + coupleGap));
        placed.add(pid);
        subtree.add(pid);
      }
    });

    const subtreeRight = Math.max(cursor, parentStartX + blockW + famGap);
    return { rightEdge: subtreeRight, subtree };
  };

  const rootFamilies = families.filter((f) => f.parents.every((p) => !parentsOf.has(p)));
  let nextLeft = PAD;
  for (const root of rootFamilies) {
    const { rightEdge } = layoutFamily(root, nextLeft);
    nextLeft = rightEdge;
  }
  for (const f of families) {
    if (!f.parents.every((p) => placed.has(p))) {
      const { rightEdge } = layoutFamily(f, nextLeft);
      nextLeft = rightEdge;
    }
  }
  for (const p of persons) {
    if (!placed.has(p.id)) {
      cx.set(p.id, nextLeft);
      placed.add(p.id);
      nextLeft += crossSize + famGap;
    }
  }

  // Normalise so min cross is PAD
  const minCx = Math.min(...persons.map((p) => cx.get(p.id) ?? 0));
  const offset = PAD - minCx;
  for (const p of persons) cx.set(p.id, (cx.get(p.id) ?? 0) + offset);

  // ── Project to (x, y) based on direction
  const project = (id) => {
    const g = gen.get(id) ?? 0;
    const c = cx.get(id) ?? 0;
    const mainCoord = PAD + g * (mainSize + mainGap);
    if (direction === 'vertical') return { x: c, y: mainCoord };
    return { x: mainCoord, y: c };
  };

  const positionedPersons = persons.map((p) => {
    const g = gen.get(p.id) ?? 0;
    const { x, y } = project(p.id);
    return {
      id: p.id,
      name: nameOf(p),
      gender: genderOf(p),
      principal: !!p.principal,
      birthYear: yearOf(factOf(p, 'Birth')?.date?.original),
      deathYear: yearOf(factOf(p, 'Death')?.date?.original),
      birthPlace: factOf(p, 'Birth')?.place?.original || null,
      deathPlace: factOf(p, 'Death')?.place?.original || null,
      occupation: (p.facts || []).find((f) => (f.type || '').toLowerCase().includes('occupation'))?.value || null,
      x,
      y,
      generation: g,
    };
  });

  const byId = Object.fromEntries(positionedPersons.map((p) => [p.id, p]));

  // ── Marriage bars and descent geometry
  let couples, descents;
  if (direction === 'vertical') {
    couples = couplePairs
      .filter(([a, b]) => byId[a] && byId[b])
      .map(([a, b]) => {
        const pa = byId[a];
        const pb = byId[b];
        const left = Math.min(pa.x, pb.x);
        const right = Math.max(pa.x, pb.x);
        const y = pa.y + PERSON_H / 2;
        return {
          line: { x1: left + PERSON_W, y1: y, x2: right, y2: y },
          mid: { x: (left + PERSON_W + right) / 2, y },
        };
      });
    descents = families
      .filter((f) => f.children.length && f.parents.every((p) => byId[p]) && f.children.every((c) => byId[c]))
      .map((f) => {
        const parentCenters = f.parents.map((p) => byId[p].x + PERSON_W / 2);
        const parentMidX = (Math.min(...parentCenters) + Math.max(...parentCenters)) / 2;
        const parentBottom = byId[f.parents[0]].y + PERSON_H;
        const childTopY = byId[f.children[0]].y;
        const bracketY = parentBottom + (childTopY - parentBottom) * 0.55;
        const childCs = f.children.map((c) => byId[c].x + PERSON_W / 2);
        // The bracket must connect the parent's stem to EVERY child drop —
        // for single offset children too, otherwise the line dangles. Span
        // from parentMidX through the full children range.
        const bracketLeft  = Math.min(parentMidX, ...childCs);
        const bracketRight = Math.max(parentMidX, ...childCs);
        return {
          id: f.id,
          stem: { x1: parentMidX, y1: parentBottom, x2: parentMidX, y2: bracketY },
          bracket:
            bracketRight - bracketLeft > 0.5
              ? { x1: bracketLeft, y1: bracketY, x2: bracketRight, y2: bracketY }
              : null,
          drops: childCs.map((cxx) => ({ x1: cxx, y1: bracketY, x2: cxx, y2: childTopY })),
        };
      });
  } else {
    // horizontal
    couples = couplePairs
      .filter(([a, b]) => byId[a] && byId[b])
      .map(([a, b]) => {
        const pa = byId[a];
        const pb = byId[b];
        const top = Math.min(pa.y, pb.y);
        const bottom = Math.max(pa.y, pb.y);
        const x = pa.x + PERSON_W / 2;
        return {
          line: { x1: x, y1: top + PERSON_H, x2: x, y2: bottom },
          mid: { x, y: (top + PERSON_H + bottom) / 2 },
        };
      });
    descents = families
      .filter((f) => f.children.length && f.parents.every((p) => byId[p]) && f.children.every((c) => byId[c]))
      .map((f) => {
        const parentCenters = f.parents.map((p) => byId[p].y + PERSON_H / 2);
        const parentMidY = (Math.min(...parentCenters) + Math.max(...parentCenters)) / 2;
        const parentRight = byId[f.parents[0]].x + PERSON_W;
        const childLeftX = byId[f.children[0]].x;
        const bracketX = parentRight + (childLeftX - parentRight) * 0.55;
        const childCs = f.children.map((c) => byId[c].y + PERSON_H / 2);
        // Same fix in horizontal direction: bracket must span parentMidY
        // through all children's y positions to keep the line continuous.
        const bracketTop    = Math.min(parentMidY, ...childCs);
        const bracketBottom = Math.max(parentMidY, ...childCs);
        return {
          id: f.id,
          stem: { x1: parentRight, y1: parentMidY, x2: bracketX, y2: parentMidY },
          bracket:
            bracketBottom - bracketTop > 0.5
              ? { x1: bracketX, y1: bracketTop, x2: bracketX, y2: bracketBottom }
              : null,
          drops: childCs.map((cyy) => ({ x1: bracketX, y1: cyy, x2: childLeftX, y2: cyy })),
        };
      });
  }

  const maxX = positionedPersons.length ? Math.max(...positionedPersons.map((p) => p.x + PERSON_W)) : 0;
  const maxY = positionedPersons.length ? Math.max(...positionedPersons.map((p) => p.y + PERSON_H)) : 0;

  // Generation lane labels
  const genGroups = new Map();
  for (const p of positionedPersons) {
    if (!genGroups.has(p.generation)) genGroups.set(p.generation, []);
    genGroups.get(p.generation).push(p);
  }
  const genRanges = [...genGroups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([g, ppl]) => {
      const ys = ppl.map((p) => p.birthYear).filter(Boolean);
      const ds = ppl.map((p) => p.deathYear).filter(Boolean);
      const mainCoord = PAD + g * (mainSize + mainGap);
      return {
        generation: g,
        main: mainCoord,
        x: direction === 'horizontal' ? mainCoord : 0,
        y: direction === 'vertical' ? mainCoord : 0,
        count: ppl.length,
        minYear: ys.length ? Math.min(...ys) : null,
        maxYear: ds.length ? Math.max(...ds) : ys.length ? Math.max(...ys) : null,
      };
    });

  return {
    direction,
    persons: positionedPersons,
    couples,
    descents,
    genRanges,
    width: maxX + PAD,
    height: maxY + PAD,
  };
}

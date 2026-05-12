// JS port of backend/services/treeviewer_service.py:gedcomx_to_d3
// Used in TreeViewer to live-render edits without round-tripping the server.

export function gedcomxToD3(gedcomx) {
  const persons = (gedcomx && gedcomx.persons) || [];
  const relationships = (gedcomx && gedcomx.relationships) || [];

  if (!persons.length) {
    return { name: 'No data', attributes: { id: 'none' }, children: [] };
  }

  const byId = Object.fromEntries(persons.filter((p) => p.id).map((p) => [p.id, p]));
  const childrenOf = {};
  const parentsOf = {};
  const couples = []; // [a, b]
  const seenCouples = new Set();

  for (const rel of relationships) {
    const t = (rel.type || '').split('/').slice(-1)[0];
    const a = (rel.person1 || {}).resource?.replace('#', '') || '';
    const b = (rel.person2 || {}).resource?.replace('#', '') || '';
    if (!a || !b) continue;
    if (t === 'ParentChild') {
      (childrenOf[a] = childrenOf[a] || []).push(b);
      (parentsOf[b] = parentsOf[b] || []).push(a);
    } else if (t === 'Couple') {
      const key = [a, b].sort().join('|');
      if (!seenCouples.has(key)) {
        seenCouples.add(key);
        couples.push([a, b]);
      }
    }
  }

  const principalId = persons.find((p) => p.principal)?.id;

  const nameOf = (p) => {
    for (const n of p.names || []) {
      for (const nf of n.nameForms || []) {
        if (nf.fullText) return nf.fullText;
      }
    }
    return p.id || 'Unknown';
  };

  const genderOf = (p) => {
    const t = (p.gender || {}).type || '';
    if (t.endsWith('Male')) return 'M';
    if (t.endsWith('Female')) return 'F';
    return 'U';
  };

  const makeNode = (p, relationLabel = null, typeOverride = null) => {
    const attrs = { id: p.id, gender: genderOf(p) };
    if (relationLabel) attrs.relation = relationLabel;
    if (typeOverride) attrs.type = typeOverride;
    else if (p.id === principalId) attrs.type = 'Primary';
    return { name: nameOf(p), attributes: attrs, children: [] };
  };

  const usedAsParent = new Set();
  const usedAsChild = new Set();
  const families = [];

  // Pass 1: couples with shared children
  for (const [a, b] of couples) {
    const sharedKids = (childrenOf[a] || [])
      .filter((c) => (childrenOf[b] || []).includes(c))
      .sort();
    if (!sharedKids.length) continue;
    const father = byId[a];
    const mother = byId[b];
    if (!father || !mother) continue;
    const familyName = `${nameOf(father)} & ${nameOf(mother)}`;
    const node = {
      name: familyName,
      attributes: {
        id: `family-${a}-${b}`,
        type: 'Family',
        fatherName: nameOf(father),
        motherName: nameOf(mother),
        fatherGender: genderOf(father),
        motherGender: genderOf(mother),
      },
      children: sharedKids.filter((c) => byId[c]).map((c) => makeNode(byId[c], 'Child')),
    };
    if (principalId && (a === principalId || b === principalId)) {
      node.attributes.type = 'Primary';
    }
    families.push(node);
    usedAsParent.add(a);
    usedAsParent.add(b);
    sharedKids.forEach((c) => usedAsChild.add(c));
  }

  // Pass 2: single-parent groups
  for (const [pid, kids] of Object.entries(childrenOf)) {
    if (usedAsParent.has(pid)) continue;
    const newKids = kids.filter((c) => !usedAsChild.has(c));
    if (!newKids.length) continue;
    const parent = byId[pid];
    if (!parent) continue;
    const node = {
      name: nameOf(parent),
      attributes: {
        id: `family-${pid}`,
        type: pid === principalId ? 'Primary' : 'Family',
        parents: [pid],
      },
      children: newKids.filter((c) => byId[c]).map((c) => makeNode(byId[c], 'Child')),
    };
    families.push(node);
    usedAsParent.add(pid);
    newKids.forEach((c) => usedAsChild.add(c));
  }

  // Orphans
  const orphans = persons.filter((p) => !usedAsParent.has(p.id) && !usedAsChild.has(p.id));

  if (families.length === 1 && !orphans.length) return families[0];
  if (!families.length) {
    return {
      name: 'Persons',
      attributes: { id: 'root', type: 'Root' },
      children: persons.map((p) => makeNode(p, 'Person')),
    };
  }

  const root = {
    name: `${families.length} Famil${families.length === 1 ? 'y' : 'ies'} on this page`,
    attributes: { id: 'root', type: 'Root' },
    children: [...families],
  };
  if (orphans.length) {
    root.children.push({
      name: 'Unrelated individuals',
      attributes: { id: 'orphans', type: 'Other' },
      children: orphans.map((p) => makeNode(p, 'Person')),
    });
  }
  return root;
}

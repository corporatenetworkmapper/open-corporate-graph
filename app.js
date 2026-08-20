(() => {
  'use strict';

  const GLEIF = 'https://api.gleif.org/api/v1';
  const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
  const WDQS = 'https://query.wikidata.org/sparql';
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const svg = $('graph');

  const S = {
    nodes: new Map(),
    edges: new Map(),
    selected: null,
    root: null,
    scale: 1,
    panX: 0,
    panY: 0,
    path: [],
    events: [],
    busy: new Set(),
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const addrText = (a) => a ? [
    ...(a.addressLines || []), a.city, a.region, a.postalCode, a.country
  ].filter(Boolean).join(', ') : '';
  const streetKey = (a) => norm((a?.addressLines || []).join(' '));

  function status(text, kind = '') {
    $('status').textContent = text;
    $('status').className = kind;
  }

  function log(text) {
    S.events.unshift({
      t: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      m: text,
    });
    $('history').className = 'history';
    $('history').innerHTML = S.events.slice(0, 30).map((x) =>
      `<div class="event"><time>${x.t}</time>${esc(x.m)}</div>`
    ).join('');
  }

  async function getJSON(url, optional = false) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (optional && (r.status === 404 || r.status === 204)) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function sparql(query) {
    return getJSON(`${WDQS}?format=json&origin=*&query=${encodeURIComponent(query)}`);
  }

  function color(kind) {
    if (kind === 'person') return '#c8a7ff';
    if (kind === 'place') return '#6ee7b7';
    if (kind === 'address') return '#7dd3fc';
    return '#62b6ff';
  }

  function wrapName(name, kind) {
    const text = String(name || '');
    const maxChars = kind === 'address' ? 31 : 24;
    if (text.length <= maxChars) return [text];

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [text.slice(0, maxChars - 1) + '…'];

    const lines = ['', ''];
    let line = 0;
    for (const word of words) {
      const next = lines[line] ? `${lines[line]} ${word}` : word;
      if (next.length <= maxChars || !lines[line]) {
        lines[line] = next;
      } else if (line === 0) {
        line = 1;
        lines[line] = word;
      } else {
        lines[line] += ' ' + word;
      }
    }
    if (lines[1].length > maxChars) lines[1] = lines[1].slice(0, maxChars - 1).trimEnd() + '…';
    return lines.filter(Boolean).slice(0, 2);
  }

  function nodeDimensions(node) {
    const lines = wrapName(node.name, node.kind);
    const longest = Math.max(...lines.map((x) => x.length), 8);
    const minW = node.kind === 'address' ? 138 : 104;
    const maxW = node.kind === 'address' ? 232 : 190;
    const width = Math.max(minW, Math.min(maxW, 36 + longest * 6.25));
    const height = lines.length > 1 ? 66 : 52;
    return { width, height, lines };
  }

  function gleifNode(record) {
    const a = record?.attributes || {};
    const e = a.entity || {};
    const rg = a.registration || {};
    const lei = a.lei || record.id;
    return {
      id: `lei:${lei}`,
      kind: 'company',
      name: e.legalName?.name || lei,
      sub: [e.jurisdiction, e.status].filter(Boolean).join(' · '),
      x: 560,
      y: 325,
      expanded: false,
      sources: new Set(['GLEIF']),
      meta: {
        lei,
        jur: e.jurisdiction || '',
        status: e.status || rg.status || '',
        reg: e.registeredAs || '',
        legal: e.legalAddress || null,
        hq: e.headquartersAddress || null,
      }
    };
  }

  function wikidataKind(entity) {
    const ids = (entity?.claims?.P31 || []).map((c) => c.mainsnak?.datavalue?.value?.id);
    if (ids.includes('Q5')) return 'person';
    if (ids.some((x) => ['Q515', 'Q6256', 'Q82794', 'Q200250', 'Q17334923'].includes(x))) return 'place';
    return 'company';
  }

  function mergeNode(target, incoming) {
    for (const s of incoming.sources || []) target.sources.add(s);
    target.meta = { ...(target.meta || {}), ...(incoming.meta || {}) };
    if ((!target.sub || target.sub.length < 3) && incoming.sub) target.sub = incoming.sub;
    return target;
  }

  function addNode(node) {
    for (const x of S.nodes.values()) {
      if (node.meta?.lei && x.meta?.lei === node.meta.lei) return mergeNode(x, node);
      if (node.meta?.qid && x.meta?.qid === node.meta.qid) return mergeNode(x, node);
      if (node.kind === x.kind && norm(node.name) === norm(x.name)) return mergeNode(x, node);
    }
    node.sources = node.sources || new Set();
    if (!S.root) {
      S.root = node.id;
      node.x = 560;
      node.y = 325;
    }
    S.nodes.set(node.id, node);
    addSurnameLeads(node);
    return node;
  }

  function addEdge(a, b, label, src = 'Wikidata', inferred = false) {
    if (!a || !b || a.id === b.id) return;
    const key = `${[a.id, b.id].sort().join('|')}|${label}`;
    if (!S.edges.has(key)) S.edges.set(key, { a: a.id, b: b.id, label, src, inferred });
  }

  function surname(name) {
    const p = String(name || '').trim().split(/\s+/);
    return p.length > 1 ? p[p.length - 1].toLowerCase() : '';
  }

  function addSurnameLeads(node) {
    if (node.kind !== 'person') return;
    const s = surname(node.name);
    if (s.length < 4) return;
    for (const x of S.nodes.values()) {
      if (x.id !== node.id && x.kind === 'person' && surname(x.name) === s) {
        addEdge(node, x, 'SHARED SURNAME', 'Inference', true);
      }
    }
  }

  function addAddress(owner, address, label) {
    if (!address) return null;
    const text = addrText(address);
    if (!text) return null;
    let h = 0;
    for (const ch of text) h = (((h << 5) - h) + ch.charCodeAt(0)) | 0;
    const node = addNode({
      id: `addr:${Math.abs(h)}:${norm(text).slice(0, 18)}`,
      kind: 'address',
      name: text,
      sub: label,
      x: owner.x,
      y: owner.y,
      expanded: false,
      sources: new Set(['GLEIF']),
      meta: { address, street: streetKey(address) },
    });
    addEdge(owner, node, label, 'GLEIF');
    return node;
  }

  function collides(candidate, x, y, moving = new Set()) {
    const cd = nodeDimensions(candidate);
    for (const n of S.nodes.values()) {
      if (n.id === candidate.id || moving.has(n.id)) continue;
      const nd = nodeDimensions(n);
      const gapX = (cd.width + nd.width) / 2 + 24;
      const gapY = (cd.height + nd.height) / 2 + 22;
      if (Math.abs(x - n.x) < gapX && Math.abs(y - n.y) < gapY) return true;
    }
    return false;
  }

  function placeBatch(parent, ids) {
    const moving = new Set(ids);
    const base = (hash(parent.id) % 360) * Math.PI / 180;
    ids.forEach((id, idx) => {
      const n = S.nodes.get(id);
      if (!n) return;
      let placed = false;
      for (let ring = 1; ring <= 14 && !placed; ring++) {
        const radius = 185 + (ring - 1) * 96;
        const steps = Math.max(12, Math.ceil(2 * Math.PI * radius / 175));
        for (let j = 0; j < steps; j++) {
          const a = base + ((j + idx * 0.67) / steps) * Math.PI * 2 + ring * 0.08;
          const x = parent.x + Math.cos(a) * radius;
          const y = parent.y + Math.sin(a) * radius;
          if (!collides(n, x, y, moving)) {
            n.x = x;
            n.y = y;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        const d = nodeDimensions(n);
        n.x = parent.x + 210 + idx * (d.width + 50);
        n.y = parent.y + 180;
      }
      moving.delete(id);
    });
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function graphBounds(ids = null) {
    const arr = ids ? ids.map((id) => S.nodes.get(id)).filter(Boolean) : [...S.nodes.values()];
    if (!arr.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of arr) {
      const d = nodeDimensions(n);
      minX = Math.min(minX, n.x - d.width / 2);
      maxX = Math.max(maxX, n.x + d.width / 2);
      minY = Math.min(minY, n.y - d.height / 2);
      maxY = Math.max(maxY, n.y + d.height / 2);
    }
    return { minX, maxX, minY, maxY };
  }

  function focus(ids) {
    const b = graphBounds(ids);
    if (!b) return;
    const w = Math.max(240, b.maxX - b.minX);
    const h = Math.max(180, b.maxY - b.minY);
    const s = Math.min(1.2, 1000 / (w + 80), 555 / (h + 80));
    S.scale = s;
    S.panX = 560 - s * (b.minX + b.maxX) / 2;
    S.panY = 325 - s * (b.minY + b.maxY) / 2;
    render();
  }

  function fitAll() {
    focus([...S.nodes.keys()]);
  }

  function arrange() {
    if (!S.root) return;
    const root = S.nodes.get(S.root);
    const adj = new Map([...S.nodes.keys()].map((id) => [id, []]));
    for (const e of S.edges.values()) {
      adj.get(e.a)?.push(e.b);
      adj.get(e.b)?.push(e.a);
    }
    const depth = new Map([[root.id, 0]]);
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift();
      const d = depth.get(id);
      for (const nb of adj.get(id) || []) {
        if (!depth.has(nb)) {
          depth.set(nb, d + 1);
          queue.push(nb);
        }
      }
    }
    root.x = 560;
    root.y = 325;
    const maxDepth = Math.max(0, ...depth.values());
    for (let d = 1; d <= maxDepth; d++) {
      const layer = [...S.nodes.values()].filter((n) => depth.get(n.id) === d);
      const radius = 230 + d * 155 + Math.max(0, layer.length - 8) * 8;
      layer.forEach((n, i) => {
        const a = -Math.PI / 2 + (i / Math.max(1, layer.length)) * Math.PI * 2;
        n.x = 560 + Math.cos(a) * radius;
        n.y = 325 + Math.sin(a) * radius;
      });
    }
    fitAll();
  }

  async function wikidataEntity(id) {
    const j = await getJSON(`${WIKIDATA_API}?action=wbgetentities&ids=${id}&props=labels|descriptions|claims&languages=en&format=json&origin=*`);
    return j.entities?.[id];
  }

  async function wikidataResolve(ids) {
    ids = [...new Set(ids.filter(Boolean))];
    const out = {};
    for (let i = 0; i < ids.length; i += 45) {
      const chunk = ids.slice(i, i + 45);
      const j = await getJSON(`${WIKIDATA_API}?action=wbgetentities&ids=${chunk.join('|')}&props=labels|descriptions|claims&languages=en&format=json&origin=*`);
      Object.assign(out, j.entities || {});
    }
    return out;
  }

  function claims(entity, property) {
    return (entity?.claims?.[property] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
  }

  function wikidataNode(id, entity, near) {
    const node = {
      id: `wd:${id}`,
      kind: wikidataKind(entity),
      name: entity?.labels?.en?.value || id,
      sub: entity?.descriptions?.en?.value || '',
      x: near?.x || 560,
      y: near?.y || 325,
      expanded: false,
      sources: new Set(['Wikidata']),
      meta: { qid: id },
    };
    const lei = (entity?.claims?.P1278 || [])[0]?.mainsnak?.datavalue?.value;
    if (lei) node.meta.lei = lei;
    return addNode(node);
  }

  async function findWikidata(node) {
    if (node.meta?.qid) return node.meta.qid;
    if (node.meta?.lei) {
      try {
        const j = await sparql(`SELECT ?item WHERE {?item wdt:P1278 "${node.meta.lei}".} LIMIT 2`);
        const id = j.results?.bindings?.[0]?.item?.value?.split('/').pop();
        if (id) return id;
      } catch {}
    }
    try {
      const j = await getJSON(`${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(node.name)}&language=en&type=item&limit=10&format=json&origin=*`);
      const exact = (j.search || []).find((r) => norm(r.label) === norm(node.name));
      return (exact || (j.search || [])[0])?.id || null;
    } catch {
      return null;
    }
  }

  async function search() {
    const q = $('q').value.trim();
    if (!q) return;
    status('Searching GLEIF + Wikidata…');
    $('results').className = 'results';

    const tasks = [
      (async () => {
        const u = /^[A-Z0-9]{20}$/i.test(q)
          ? `${GLEIF}/lei-records?filter[lei]=${encodeURIComponent(q.toUpperCase())}&page[size]=15`
          : `${GLEIF}/lei-records?filter[entity.legalName]=${encodeURIComponent(q)}&page[size]=15`;
        const j = await getJSON(u);
        return (j.data || []).map((r) => ({ src: 'GLEIF', n: gleifNode(r) }));
      })(),
      (async () => {
        const j = await getJSON(`${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&type=item&limit=15&format=json&origin=*`);
        const ids = (j.search || []).map((x) => x.id);
        const entities = await wikidataResolve(ids);
        return ids.map((id) => ({
          src: 'Wikidata',
          n: {
            id: `wd:${id}`,
            kind: wikidataKind(entities[id]),
            name: entities[id]?.labels?.en?.value || id,
            sub: entities[id]?.descriptions?.en?.value || '',
            x: 560,
            y: 325,
            expanded: false,
            sources: new Set(['Wikidata']),
            meta: {
              qid: id,
              lei: (entities[id]?.claims?.P1278 || [])[0]?.mainsnak?.datavalue?.value,
            }
          }
        }));
      })(),
    ];

    const settled = await Promise.allSettled(tasks);
    const all = [];
    settled.forEach((r) => { if (r.status === 'fulfilled') all.push(...r.value); });

    const box = $('results');
    box.innerHTML = '';
    const seen = new Set();
    for (const r of all) {
      const key = `${norm(r.n.name)}|${r.n.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = document.createElement('div');
      d.className = 'result';
      d.innerHTML = `<b>${esc(r.n.name)}</b><small>${esc(r.src)} · ${esc(r.n.sub || r.n.meta?.lei || '')}</small>`;
      d.onclick = () => {
        box.className = 'results';
        const n = addNode(r.n);
        S.root = n.id;
        S.selected = n.id;
        S.path = [n.id];
        n.x = 560;
        n.y = 325;
        render();
        details(n);
        log(`Seeded ${n.name} from ${r.src}`);
        expand(n.id);
      };
      box.appendChild(d);
    }
    box.className = `results${seen.size ? ' show' : ''}`;
    status(seen.size ? `${seen.size} live results found.` : 'No match found.', seen.size ? 'ok' : 'err');
  }

  async function expandGLEIF(node) {
    if (!node.meta?.lei) return 0;
    let count = 0;
    const lei = node.meta.lei;
    const calls = [
      ['DIRECT PARENT', `${GLEIF}/lei-records/${lei}/direct-parent`, 'parent'],
      ['ULTIMATE PARENT', `${GLEIF}/lei-records/${lei}/ultimate-parent`, 'parent'],
      ['DIRECT CHILD', `${GLEIF}/lei-records/${lei}/direct-children?page[size]=60`, 'child'],
    ];

    const settled = await Promise.allSettled(calls.map((x) => getJSON(x[1], true)));
    settled.forEach((s, i) => {
      if (s.status !== 'fulfilled' || !s.value) return;
      const call = calls[i];
      const data = Array.isArray(s.value.data) ? s.value.data : [s.value.data].filter(Boolean);
      for (const r of data) {
        const other = addNode(gleifNode(r));
        if (call[2] === 'parent') addEdge(other, node, call[0], 'GLEIF');
        else addEdge(node, other, call[0], 'GLEIF');
        count++;
      }
    });

    const legal = addAddress(node, node.meta.legal, 'LEGAL ADDRESS');
    if (legal) count++;
    if (norm(addrText(node.meta.hq)) !== norm(addrText(node.meta.legal))) {
      const hq = addAddress(node, node.meta.hq, 'HEADQUARTERS');
      if (hq) count++;
    }
    return count;
  }

  async function expandAddress(node) {
    const a = node.meta?.address || {};
    if (!a.country || !a.postalCode) return 0;
    const j = await getJSON(`${GLEIF}/lei-records?filter[entity.legalAddress.country]=${encodeURIComponent(a.country)}&filter[entity.legalAddress.postalCode]=${encodeURIComponent(a.postalCode)}&page[size]=100`);
    let count = 0;
    for (const r of j.data || []) {
      const ra = r.attributes?.entity?.legalAddress;
      if (node.meta.street && streetKey(ra) !== node.meta.street) continue;
      const other = addNode(gleifNode(r));
      addEdge(node, other, 'SAME LEGAL ADDRESS', 'GLEIF');
      count++;
    }
    return count;
  }

  const COMPANY_PROPS = {
    P112: 'FOUNDER', P169: 'CEO', P488: 'CHAIRPERSON', P1037: 'DIRECTOR / MANAGER',
    P3320: 'BOARD MEMBER', P2828: 'CORPORATE OFFICER', P127: 'OWNER',
    P749: 'PARENT ORGANIZATION', P355: 'SUBSIDIARY', P159: 'HEADQUARTERS'
  };
  const PERSON_PROPS = { P108: 'EMPLOYER', P1416: 'AFFILIATION', P463: 'MEMBER OF' };

  async function expandWikidata(node) {
    const qid = await findWikidata(node);
    if (!qid) return 0;
    node.meta.qid = qid;
    node.sources.add('Wikidata');

    const entity = await wikidataEntity(qid);
    if (!entity) return 0;
    const props = node.kind === 'person' ? PERSON_PROPS : node.kind === 'place' ? {} : COMPANY_PROPS;
    const ids = [];
    for (const p in props) ids.push(...claims(entity, p));
    const entities = await wikidataResolve(ids);

    let count = 0;
    for (const p in props) {
      for (const id of claims(entity, p)) {
        const other = wikidataNode(id, entities[id], node);
        addEdge(node, other, props[p], 'Wikidata');
        count++;
      }
    }

    const incoming = node.kind === 'person'
      ? `{?item wdt:P112 wd:${qid}. BIND("FOUNDED" AS ?rel)} UNION {?item wdt:P169 wd:${qid}. BIND("CEO OF" AS ?rel)} UNION {?item wdt:P488 wd:${qid}. BIND("CHAIR OF" AS ?rel)} UNION {?item wdt:P1037 wd:${qid}. BIND("DIRECTOR / MANAGER" AS ?rel)} UNION {?item wdt:P3320 wd:${qid}. BIND("BOARD MEMBER OF" AS ?rel)} UNION {?item wdt:P2828 wd:${qid}. BIND("OFFICER OF" AS ?rel)}`
      : node.kind === 'place'
        ? `{?item wdt:P159 wd:${qid}. BIND("HEADQUARTERS HERE" AS ?rel)}`
        : `{?item wdt:P108 wd:${qid}. BIND("EMPLOYER OF" AS ?rel)} UNION {?item wdt:P1416 wd:${qid}. BIND("AFFILIATED PERSON" AS ?rel)} UNION {?item wdt:P749 wd:${qid}. BIND("HAS SUBSIDIARY" AS ?rel)} UNION {?item wdt:P127 wd:${qid}. BIND("OWNS" AS ?rel)}`;

    try {
      const j = await sparql(`SELECT DISTINCT ?item ?rel WHERE {${incoming}} LIMIT 40`);
      const rows = j.results?.bindings || [];
      const ids2 = rows.map((x) => x.item.value.split('/').pop());
      const entities2 = await wikidataResolve(ids2);
      for (const row of rows) {
        const id = row.item.value.split('/').pop();
        const other = wikidataNode(id, entities2[id], node);
        addEdge(node, other, row.rel.value, 'Wikidata');
        count++;
      }
    } catch {}

    return count;
  }

  async function expand(id) {
    const node = S.nodes.get(id);
    if (!node || S.busy.has(id)) return;

    S.busy.add(id);
    S.selected = id;
    if (!S.path.includes(id)) S.path.push(id);
    render();
    details(node);
    status(`Expanding ${node.name}…`);

    const beforeNodes = new Set(S.nodes.keys());
    const beforeEdges = S.edges.size;
    const failures = [];

    try {
      if (node.kind === 'address') {
        try { await expandAddress(node); } catch { failures.push('address registry'); }
      } else {
        if (node.kind === 'company' && node.meta?.lei) {
          try { await expandGLEIF(node); } catch { failures.push('GLEIF'); }
        }
        try { await expandWikidata(node); } catch { failures.push('Wikidata'); }
      }

      node.expanded = true;
      const newIds = [...S.nodes.keys()].filter((x) => !beforeNodes.has(x));
      if (newIds.length) {
        placeBatch(node, newIds);
        focus([node.id, ...newIds]);
      }

      const links = S.edges.size - beforeEdges;
      if (links) {
        log(`Expanded ${node.name} · ${links} new links`);
        status(`Expanded ${node.name} · ${links} new link${links === 1 ? '' : 's'}.`, 'ok');
      } else {
        log(`Checked ${node.name} · no additional public links`);
        status(`No additional public links found for ${node.name}.`, 'ok');
      }
      if (failures.length) log(`Some sources unavailable: ${failures.join(', ')}`);
    } finally {
      S.busy.delete(id);
      render();
      details(node);
    }
  }

  function details(node) {
    if (!node) return;
    const rel = [...S.edges.values()].filter((e) => e.a === node.id || e.b === node.id);
    const m = node.meta || {};
    let data = '';
    for (const [k, v] of [
      ['Type', node.kind], ['LEI', m.lei], ['QID', m.qid], ['Jurisdiction', m.jur],
      ['Status', m.status], ['Registry ID', m.reg]
    ]) {
      if (v) data += `<div class="k">${esc(k)}</div><div>${esc(v)}</div>`;
    }

    const links = [];
    if (m.lei) links.push(`<a target="_blank" rel="noopener" href="${GLEIF}/lei-records/${encodeURIComponent(m.lei)}">GLEIF ↗</a>`);
    if (m.qid) links.push(`<a target="_blank" rel="noopener" href="https://www.wikidata.org/wiki/${encodeURIComponent(m.qid)}">Wikidata ↗</a>`);

    $('details').className = '';
    $('details').innerHTML = `
      <div class="name">${esc(node.name)}</div>
      <div class="sub">${esc(node.sub || '')}</div>
      <div class="badges">${[...node.sources].map((x) => `<span class="badge">${esc(x)}</span>`).join('')}${node.expanded ? '<span class="badge">checked</span>' : ''}</div>
      <div class="data">${data}</div>
      ${links.length ? `<div class="links">${links.join('')}</div>` : ''}
      <div class="relations">${rel.slice(0, 24).map((e) => {
        const other = S.nodes.get(e.a === node.id ? e.b : e.a);
        return `<div class="relation"><span class="source">${esc(e.src)}</span><b>${esc(e.label)}</b><div class="other">${esc(other?.name || '')}</div></div>`;
      }).join('') || '<div class="empty">No visible relationships yet.</div>'}</div>`;
  }

  function renderNode(root, node) {
    const d = nodeDimensions(node);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `node ${S.selected === node.id ? 'selected' : ''}`);

    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', node.x - d.width / 2);
    r.setAttribute('y', node.y - d.height / 2);
    r.setAttribute('width', d.width);
    r.setAttribute('height', d.height);
    r.setAttribute('rx', 11);
    r.setAttribute('stroke', color(node.kind));
    g.appendChild(r);

    const titleY = d.lines.length === 1 ? node.y - 2 : node.y - 10;
    d.lines.forEach((line, i) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', node.x);
      t.setAttribute('y', titleY + i * 13);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'nodeName');
      t.textContent = line;
      g.appendChild(t);
    });

    const type = document.createElementNS(NS, 'text');
    type.setAttribute('x', node.x);
    type.setAttribute('y', node.y + d.height / 2 - 8);
    type.setAttribute('text-anchor', 'middle');
    type.setAttribute('class', 'nodeType');
    type.textContent = `${node.kind}${node.expanded ? ' · checked' : ''}`.toUpperCase();
    g.appendChild(type);

    const title = document.createElementNS(NS, 'title');
    title.textContent = node.name;
    g.appendChild(title);

    g.onclick = (e) => {
      e.stopPropagation();
      expand(node.id);
    };
    root.appendChild(g);
  }

  function render() {
    svg.innerHTML = '';
    $('nodeCount').textContent = S.nodes.size;
    $('edgeCount').textContent = S.edges.size;
    $('crumb').textContent = S.path.map((x) => S.nodes.get(x)?.name).filter(Boolean).join(' › ') || 'No active path';

    const root = document.createElementNS(NS, 'g');
    root.setAttribute('transform', `translate(${S.panX} ${S.panY}) scale(${S.scale})`);
    svg.appendChild(root);

    for (const e of S.edges.values()) {
      const a = S.nodes.get(e.a);
      const b = S.nodes.get(e.b);
      if (!a || !b) continue;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      line.setAttribute('class', `edge ${e.inferred ? 'inf' : e.src === 'Wikidata' ? 'wd' : ''}`);
      root.appendChild(line);

      if (S.selected === e.a || S.selected === e.b) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', (a.x + b.x) / 2);
        t.setAttribute('y', (a.y + b.y) / 2 - 5);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'edgeLabel');
        t.textContent = e.label;
        root.appendChild(t);
      }
    }

    for (const node of S.nodes.values()) renderNode(root, node);
  }

  function exportPNG() {
    const b = graphBounds();
    if (!b) return status('Nothing to export.', 'err');

    const pad = 110;
    const minX = b.minX - pad;
    const minY = b.minY - pad;
    const width = Math.ceil(b.maxX - b.minX + pad * 2);
    const height = Math.ceil(b.maxY - b.minY + pad * 2);
    const scale = Math.max(1, Math.min(4, 8192 / width, 8192 / height));
    const outW = Math.round(width * scale);
    const outH = Math.round(height * scale);

    const ex = document.createElementNS(NS, 'svg');
    ex.setAttribute('xmlns', NS);
    ex.setAttribute('width', width);
    ex.setAttribute('height', height);
    ex.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', minX); bg.setAttribute('y', minY);
    bg.setAttribute('width', width); bg.setAttribute('height', height);
    bg.setAttribute('fill', '#071019');
    ex.appendChild(bg);

    for (const e of S.edges.values()) {
      const a = S.nodes.get(e.a), b2 = S.nodes.get(e.b);
      if (!a || !b2) continue;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b2.x); line.setAttribute('y2', b2.y);
      line.setAttribute('stroke', e.inferred ? '#e6bb68' : e.src === 'Wikidata' ? '#725f91' : '#36516c');
      line.setAttribute('stroke-width', 2);
      if (e.inferred) line.setAttribute('stroke-dasharray', '6 5');
      ex.appendChild(line);

      const et = document.createElementNS(NS, 'text');
      et.setAttribute('x', (a.x + b2.x) / 2); et.setAttribute('y', (a.y + b2.y) / 2 - 5);
      et.setAttribute('text-anchor', 'middle'); et.setAttribute('fill', '#8fa5ba');
      et.setAttribute('font-size', 8); et.setAttribute('font-family', 'system-ui');
      et.textContent = e.label;
      ex.appendChild(et);
    }

    for (const node of S.nodes.values()) {
      const d = nodeDimensions(node);
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', node.x - d.width / 2); r.setAttribute('y', node.y - d.height / 2);
      r.setAttribute('width', d.width); r.setAttribute('height', d.height);
      r.setAttribute('rx', 11); r.setAttribute('fill', '#12202d'); r.setAttribute('stroke', color(node.kind));
      r.setAttribute('stroke-width', 2); ex.appendChild(r);

      const titleY = d.lines.length === 1 ? node.y - 2 : node.y - 10;
      d.lines.forEach((lineText, i) => {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', node.x); t.setAttribute('y', titleY + i * 13);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('fill', '#edf5fd');
        t.setAttribute('font-size', 10); t.setAttribute('font-weight', 700); t.setAttribute('font-family', 'system-ui');
        t.textContent = lineText; ex.appendChild(t);
      });

      const st = document.createElementNS(NS, 'text');
      st.setAttribute('x', node.x); st.setAttribute('y', node.y + d.height / 2 - 8);
      st.setAttribute('text-anchor', 'middle'); st.setAttribute('fill', '#8fa5ba');
      st.setAttribute('font-size', 8); st.setAttribute('font-family', 'system-ui');
      st.textContent = node.kind.toUpperCase(); ex.appendChild(st);
    }

    const blob = new Blob([new XMLSerializer().serializeToString(ex)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    status(`Rendering full PNG ${outW}×${outH}px…`);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        const u = URL.createObjectURL(png);
        const a = document.createElement('a');
        a.href = u;
        a.download = `open-corporate-graph-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
        status(`Full PNG saved ${outW}×${outH}px`, 'ok');
      }, 'image/png');
    };
    img.onerror = () => status('PNG export failed.', 'err');
    img.src = url;
  }

  let panning = false, startX = 0, startY = 0, startPanX = 0, startPanY = 0;
  svg.onpointerdown = (e) => {
    if (e.target === svg) {
      panning = true;
      startX = e.clientX; startY = e.clientY;
      startPanX = S.panX; startPanY = S.panY;
      svg.setPointerCapture(e.pointerId);
    }
  };
  svg.onpointermove = (e) => {
    if (!panning) return;
    const r = svg.getBoundingClientRect();
    S.panX = startPanX + (e.clientX - startX) * (1120 / r.width);
    S.panY = startPanY + (e.clientY - startY) * (650 / r.height);
    render();
  };
  svg.onpointerup = (e) => {
    panning = false;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
  };

  $('searchBtn').onclick = search;
  $('q').onkeydown = (e) => { if (e.key === 'Enter') search(); };
  $('clearBtn').onclick = () => {
    S.nodes.clear(); S.edges.clear(); S.selected = null; S.root = null;
    S.scale = 1; S.panX = 0; S.panY = 0; S.path = []; S.events = [];
    $('results').className = 'results';
    $('details').className = 'empty'; $('details').textContent = 'Select a result or graph node.';
    $('history').className = 'history empty'; $('history').textContent = 'Nothing expanded yet.';
    status('New graph ready.');
    render();
  };
  $('arrangeBtn').onclick = arrange;
  $('fitBtn').onclick = fitAll;
  $('shotBtn').onclick = exportPNG;
  $('zinBtn').onclick = () => { S.scale = Math.min(2.5, S.scale * 1.15); render(); };
  $('zoutBtn').onclick = () => { S.scale = Math.max(0.25, S.scale / 1.15); render(); };

  render();
})();

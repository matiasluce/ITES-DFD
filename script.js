// ═══════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════
const FONT_SIZE  = 13;
const FONT_FACE  = 'bold 13px "Segoe UI", Arial, sans-serif';
const PAD_H      = 30;
const PAD_V      = 18;
const MIN_W      = 150;
const MIN_H_NORM = 52;
const MIN_H_DEC  = 72;
const V_GAP      = 40;   // vertical gap between nodes
const BRANCH_H_PAD = 50; // horizontal clearance between branch column and decision center
const COL_X      = 440;  // center x of main chain

const ZOOM_MIN  = 0.3;
const ZOOM_MAX  = 2;
const ZOOM_STEP = 0.1;

// Per-decision layout info, filled by autoLayout, used by mountArrow
// decId → { noCenterX, siCenterX, branchTopY, mergeY, mergeNodeId }
const decisionLayout = {};

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let nodes    = [];
let arrows   = [];
let nodeSeq  = 0;
let arrowSeq = 0;
let zoomLevel = 1;

let selectedTool    = null;
let selectedNodeId  = null;
let selectedArrowId = null;

let dragActive = false;
let dragNodeId = null;
let dragOX = 0, dragOY = 0;

const _mCanvas = document.createElement('canvas');
const _mCtx    = _mCanvas.getContext('2d');

// Cached DOM references
const _canvasEl   = document.getElementById('canvas');
const _arrowsSvg  = document.getElementById('arrows');
const _ghostEl    = document.getElementById('ghost');
const _statusBar  = document.getElementById('status-bar');
const _modalOvr   = document.getElementById('modal-overlay');
const _canvasWrap = document.getElementById('canvas-wrap');

// ═══════════════════════════════════════════════════════
//  TEXT MEASUREMENT
// ═══════════════════════════════════════════════════════
function measureText(text) {
  _mCtx.font = FONT_FACE;
  const lines = text.split('\n');
  const w = Math.max(...lines.map(l => _mCtx.measureText(l).width));
  const h = lines.length * (FONT_SIZE + 4);
  return { w, h };
}

function calcNodeSize(type, label) {
  const { w: tw, h: th } = measureText(label);
  const minH = type === 'decision' ? MIN_H_DEC : MIN_H_NORM;
  const diamondPad = type === 'decision' ? 1.6 : 1;
  let w = Math.max(MIN_W, tw * diamondPad + PAD_H * 2);
  let h = Math.max(minH, th + PAD_V * 2);
  w = Math.ceil(w / 2) * 2;
  h = Math.ceil(h / 2) * 2;
  return { w, h };
}

// ═══════════════════════════════════════════════════════
//  SHAPE SVG BUILDER
// ═══════════════════════════════════════════════════════
function xmlEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildSVG(type, label, w, h) {
  const cx = w / 2, cy = h / 2;
  const lines = label.split('\n');
  const lineH = FONT_SIZE + 4;
  const totalTextH = lines.length * lineH;
  let textY = cy - totalTextH / 2 + lineH / 2;

  const textLines = lines.map(line => {
    const t = `<text x="${cx}" y="${textY}" text-anchor="middle" dominant-baseline="central"
      font-family="Segoe UI,Arial,sans-serif" font-size="${FONT_SIZE}" font-weight="700" fill="#1a1f2e"
      style="pointer-events:none">${xmlEsc(line)}</text>`;
    textY += lineH;
    return t;
  }).join('');

  let body = '';
  switch (type) {
    case 'terminal':
      body = `<rect x="1" y="1" width="${w-2}" height="${h-2}" rx="${(h-2)/2}" ry="${(h-2)/2}"
        fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`;
      break;
    case 'input':
      body = `<polygon points="${h*0.28+1},1 ${w-1},1 ${w-h*0.28-1},${h-1} 1,${h-1}"
        fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`;
      break;
    case 'process':
      body = `<rect x="1" y="1" width="${w-2}" height="${h-2}"
        fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`;
      break;
    case 'decision':
      body = `<polygon points="${cx},1 ${w-1},${cy} ${cx},${h-1} 1,${cy}"
        fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`;
      break;
    case 'print': {
      // Rectangle with a single wave running along the bottom edge
      // (matches reference image: flat top/sides, wavy bottom — like paper from a printer)
      const waveY = h * 0.82;
      const amp   = h * 0.16;
      body = `<path d="M1,1 H${w-1} V${waveY} C${w*0.75},${waveY+amp} ${w*0.25},${waveY-amp} 1,${waveY} Z"
        fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"
    viewBox="0 0 ${w} ${h}" style="display:block;overflow:visible">
    ${body}${textLines}
  </svg>`;
}

// ═══════════════════════════════════════════════════════
//  NODE DOM
// ═══════════════════════════════════════════════════════
function mountNode(node) {
  const { w, h } = calcNodeSize(node.type, node.label);
  node.w = w; node.h = h;

  let el = document.getElementById(node.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'node';
    el.id = node.id;
    _canvasEl.appendChild(el);
    el.addEventListener('mousedown', onNodeMouseDown);
    el.addEventListener('click',    onNodeClick);
    el.addEventListener('dblclick', onNodeDblClick);
  }
  el.style.left   = node.x + 'px';
  el.style.top    = node.y + 'px';
  el.style.width  = node.w + 'px';
  el.style.height = node.h + 'px';
  el.innerHTML = buildSVG(node.type, node.label, node.w, node.h);
}

function updateNodePos(node) {
  const el = document.getElementById(node.id);
  if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
}

// ═══════════════════════════════════════════════════════
//  ARROW DOM  —  clean top/bottom-only router
// ═══════════════════════════════════════════════════════

// Only top and bottom ports used
function getPortTB(node, dir) {
  const cx = node.x + node.w / 2;
  if (dir === 'top')    return { x: cx, y: node.y };
  return { x: cx, y: node.y + node.h }; // bottom (default)
}

function ptsToPath(pts) {
  return 'M' + pts.map(p => p[0] + ',' + p[1]).join(' L');
}
function dedup(pts) {
  return pts.filter((p, i, a) => i === 0 || p[0] !== a[i-1][0] || p[1] !== a[i-1][1]);
}

// Walk backward from an arrow to find the decision that started this branch
// Returns { decId, side:'no'|'si' } or null
function getBranchInfo(arrow) {
  const seen = new Set();
  let cur = arrow;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.srcPort === 'left' || cur.srcPort === 'right') {
      const s = nodes.find(n => n.id === cur.srcId);
      if (s && s.type === 'decision') {
        return { decId: s.id, side: cur.srcPort === 'left' ? 'no' : 'si' };
      }
    }
    const srcNode = nodes.find(n => n.id === cur.srcId);
    if (!srcNode || srcNode.incoming.length !== 1) return null;
    cur = arrows.find(a => a.id === srcNode.incoming[0]);
  }
  return null;
}

function mountArrow(arrow) {
  let g = document.getElementById(arrow.id);
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = arrow.id;
    g.style.pointerEvents = 'auto';
    _arrowsSvg.appendChild(g);
  }
  g.replaceChildren();

  const src = nodes.find(n => n.id === arrow.srcId);
  const dst = nodes.find(n => n.id === arrow.dstId);
  if (!src || !dst) return;

  const sel = selectedArrowId === arrow.id;
  const col = sel ? '#f0a500' : '#5b9cf6';
  const mk  = sel ? 'url(#ahs)' : 'url(#ah)';

  // ── Geometry ─────────────────────────────────────────────
  const srcCx  = src.x + src.w / 2;
  const srcBot = src.y + src.h;
  const srcCy  = src.y + src.h / 2;
  const dstCx  = dst.x + dst.w / 2;
  const dstTop = dst.y;
  const decLeftX  = src.x;
  const decRightX = src.x + src.w;

  // ── Classify ─────────────────────────────────────────────
  const isDecBranch = (arrow.srcPort === 'left' || arrow.srcPort === 'right')
                      && src.type === 'decision';
  const dl = isDecBranch ? decisionLayout[src.id] : null;

  // ── Find the IMMEDIATE decision that owns this arrow's branch chain ──────
  // Walks backward and returns the FIRST (closest) decision found via left/right port.
  // This means each nested decision handles its own merge bar independently.
  function getImmediateDecId(a) {
    const seen = new Set();
    let cur = a;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.srcPort === 'left' || cur.srcPort === 'right') {
        const s = nodes.find(n => n.id === cur.srcId);
        if (s && s.type === 'decision') return s.id; // stop at FIRST decision found
      }
      const srcNode = nodes.find(n => n.id === cur.srcId);
      if (!srcNode || srcNode.incoming.length !== 1) break;
      cur = arrows.find(a => a.id === srcNode.incoming[0]);
    }
    return null;
  }

  const myRootDecId = getImmediateDecId(arrow);

  // All arrows arriving at dst that belong to the same immediate decision
  // (used only to pick THIS arrow's exit column from its own decision — unrelated to convergence detection below).
  const allSameRoot = myRootDecId
    ? arrows.filter(a => a.dstId === dst.id && getImmediateDecId(a) === myRootDecId)
    : [];

  // Direct branch exits (left/right port of that decision)
  const directBranches = allSameRoot.filter(a => {
    const s = nodes.find(n => n.id === a.srcId);
    return (a.srcPort === 'left' || a.srcPort === 'right') && s && s.id === myRootDecId;
  });

  // ── Convergence detection ─────────────────────────────────
  // ANY destination with 2+ incoming arrows is a convergence point — this
  // also covers nested decisions, where one branch reaches dst directly while
  // the other reaches it only after passing through a second, inner decision
  // (whose own SI/NO already merged earlier). All such arrows must share the
  // SAME merge bar height so they visibly join into a single line instead of
  // bending at different heights.
  const allIncoming = arrows.filter(a => a.dstId === dst.id);
  const isConverging = allIncoming.length >= 2;

  // ── Compute mergeBarY ────────────────────────────────────
  // Take the deepest (max) mergeBarY among every incoming arrow's OWN root
  // decision — autoLayout already guarantees a parent decision's bar sits at
  // or below any nested child decision's bar, so the max across all roots
  // converging here is the one shared height all of them should bend at.
  let mergeBarY = dstTop - V_GAP; // safe fallback for non-converging arrows

  if (isConverging) {
    let best = -Infinity;
    allIncoming.forEach(a => {
      const rootId = getImmediateDecId(a);
      const rdl = rootId ? decisionLayout[rootId] : null;
      if (rdl && rdl.mergeBarY != null) best = Math.max(best, rdl.mergeBarY);
    });
    mergeBarY = best > -Infinity ? best : dstTop - Math.round(V_GAP * 1.5);
  }

  // ── iAmThrough: only one arrow draws the final arrowhead into dst ─────────
  // Prefer the SI-side (right) branch among ALL converging incoming arrows;
  // among ties pick rightmost source x. This is decided across every arrow
  // reaching dst, not just the ones sharing this arrow's immediate decision.
  let iAmThrough = !isConverging; // single arrows always draw head
  if (isConverging) {
    let throughId = allIncoming[0].id;
    let best = -Infinity;
    allIncoming.forEach(a => {
      const info = getBranchInfo(a);
      const s = nodes.find(n => n.id === a.srcId);
      const score = (info && info.side === 'si' ? 10000 : 0) + (s ? s.x + s.w / 2 : 0);
      if (score > best) { best = score; throughId = a.id; }
    });
    iAmThrough = (arrow.id === throughId);
  }

  // ── Build path ──────────────────────────────────────────
  let pathD, labelX, labelY, drawHead = true;

  if (isDecBranch) {
    // Exits from side vertex of diamond → horizontal to column → down → (converging: bar; else: into dst)
    const vertexX = arrow.srcPort === 'left' ? decLeftX : decRightX;
    const colX = dl
      ? (arrow.srcPort === 'left' ? dl.noCenterX : dl.siCenterX)
      : (arrow.srcPort === 'left' ? src.x - 100 : src.x + src.w + 100);

    // Label just outside the vertex
    labelX = arrow.srcPort === 'left' ? vertexX - 28 : vertexX + 28;
    labelY = srcCy - 13;

    if (isConverging) {
      const pts = dedup([
        [vertexX, srcCy],
        [colX,    srcCy],
        [colX,    mergeBarY],
        [dstCx,   mergeBarY],
      ]);
      // The arrowhead and the final drop into dst are drawn separately as the
      // "trunk" below — it's shared by every converging branch and sits
      // outside any single decision's path, so it must never be colored or
      // highlighted as if it belonged to this one branch.
      drawHead = false;
      pathD = ptsToPath(pts);
    } else {
      // No convergence: goes straight to dst via a stair-step
      const turnY = dstTop - Math.round(V_GAP / 2);
      const pts = dedup([
        [vertexX, srcCy],
        [colX,    srcCy],
        [colX,    turnY],
        [dstCx,   turnY],
        [dstCx,   dstTop],
      ]);
      pathD = ptsToPath(pts);
      drawHead = true;
    }

  } else if (isConverging) {
    // Node inside a branch converges to dst (e.g. "Proceso → Fin")
    // Goes straight down from its bottom to mergeBarY, then across to dstCx.
    // Arrowhead/final drop is handled by the shared "trunk" below.
    const pts = dedup([
      [srcCx, srcBot],
      [srcCx, mergeBarY],
      [dstCx, mergeBarY],
    ]);
    drawHead = false;
    pathD = ptsToPath(pts);
    labelX = srcCx;
    labelY = (srcBot + mergeBarY) / 2 - 8;

  } else if (Math.abs(srcCx - dstCx) < 3) {
    // Straight vertical
    pathD = `M${srcCx},${srcBot} L${dstCx},${dstTop}`;
    labelX = srcCx;
    labelY = (srcBot + dstTop) / 2 - 8;
    drawHead = true;

  } else {
    // Stair-step
    const midY = Math.round((srcBot + dstTop) / 2);
    pathD = ptsToPath(dedup([[srcCx, srcBot], [srcCx, midY], [dstCx, midY], [dstCx, dstTop]]));
    labelX = (srcCx + dstCx) / 2;
    labelY = midY - 10;
    drawHead = true;
  }

  const mk2 = drawHead ? mk : 'none';

  // ── Label ────────────────────────────────────────────────
  const labelSVG = arrow.label
    ? (() => {
        const lw = arrow.label.length * 7 + 6;
        return `<rect x="${labelX - lw/2}" y="${labelY - 10}" width="${lw}" height="16" rx="3" fill="#1e2d50" opacity="0.92"/>
       <text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="central"
         font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#7ec8ff">${xmlEsc(arrow.label)}</text>`;
      })()
    : '';

  // ── Render path ──────────────────────────────────────────
  const visPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  visPath.setAttribute('d', pathD);
  visPath.setAttribute('stroke', col);
  visPath.setAttribute('stroke-width', '2.5');
  visPath.setAttribute('fill', 'none');
  visPath.setAttribute('marker-end', mk2);
  g.appendChild(visPath);

  if (labelSVG) {
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tmp.innerHTML = labelSVG;
    while (tmp.firstChild) g.appendChild(tmp.firstChild);
  }

  // ── Hit area ─────────────────────────────────────────────
  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('d', pathD);
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute('stroke-width', '14');
  hit.setAttribute('fill', 'none');
  hit.style.cursor = 'pointer';
  hit.addEventListener('click', e => {
    e.stopPropagation();
    if (selectedTool) { insertOnArrow(arrow.id); return; }
    selectArrow(arrow.id);
  });
  g.appendChild(hit);

  // ── Merge bar hit area (only on the through arrow) ───────
  if (isConverging && iAmThrough) {
    // Compute the X span of the merge bar from ALL converging incoming arrows
    const xs = allIncoming.map(a => {
      const s = nodes.find(n => n.id === a.srcId);
      const info = getBranchInfo(a);
      if (info && s && s.type === 'decision') {
        const adl = decisionLayout[s.id];
        if (adl) return info.side === 'no' ? adl.noCenterX : adl.siCenterX;
      }
      return s ? s.x + s.w / 2 : dstCx;
    });
    const barX1 = Math.min(...xs), barX2 = Math.max(...xs);
    const barHit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    barHit.setAttribute('d', `M${barX1},${mergeBarY} L${barX2},${mergeBarY}`);
    barHit.setAttribute('stroke', 'transparent');
    barHit.setAttribute('stroke-width', '18');
    barHit.setAttribute('fill', 'none');
    barHit.style.cursor = 'pointer';
    const allIncomingIds = allIncoming.map(a => a.id);
    barHit.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedTool) { insertAfterMerge(allIncomingIds, dst.id); return; }
      clearArrowSel();
    });
    g.appendChild(barHit);

    // ── Shared trunk: the final drop from the merge bar into dst ─────────
    // This single segment is fed by EVERY converging branch (not just the
    // "through" one carrying this arrow's id), so it must read as its own
    // thing — always default blue with the default arrowhead, never tinted
    // or selected as part of whichever branch happens to render it.
    const trunkD = `M${dstCx},${mergeBarY} L${dstCx},${dstTop}`;
    const trunkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trunkPath.setAttribute('d', trunkD);
    trunkPath.setAttribute('stroke', '#5b9cf6');
    trunkPath.setAttribute('stroke-width', '2.5');
    trunkPath.setAttribute('fill', 'none');
    trunkPath.setAttribute('marker-end', 'url(#ah)');
    g.appendChild(trunkPath);

    const trunkHit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trunkHit.setAttribute('d', trunkD);
    trunkHit.setAttribute('stroke', 'transparent');
    trunkHit.setAttribute('stroke-width', '14');
    trunkHit.setAttribute('fill', 'none');
    trunkHit.style.cursor = 'pointer';
    trunkHit.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedTool) { insertAfterMerge(allIncomingIds, dst.id); return; }
      clearArrowSel();
    });
    g.appendChild(trunkHit);
  }
}

function removeArrowEl(id) { const e = document.getElementById(id); if (e) e.remove(); }
function redrawAllArrows() { arrows.forEach(mountArrow); }

// ═══════════════════════════════════════════════════════
//  DATA CREATION
// ═══════════════════════════════════════════════════════
function mkNode(type, x, y, label) {
  const id   = 'n' + (nodeSeq++);
  const node = { id, type, label, x, y, w: MIN_W, h: MIN_H_NORM, incoming: [], outgoing: [] };
  nodes.push(node);
  mountNode(node);
  return node;
}

function mkArrow(srcId, dstId, label, srcPort, dstPort) {
  const id    = 'a' + (arrowSeq++);
  const arrow = { id, srcId, dstId, label: label || '', srcPort: srcPort||null, dstPort: dstPort||null };
  arrows.push(arrow);
  const srcNode = nodes.find(n => n.id === srcId);
  const dstNode = nodes.find(n => n.id === dstId);
  if (srcNode) srcNode.outgoing.push(id);
  if (dstNode) dstNode.incoming.push(id);
  mountArrow(arrow);
  return arrow;
}

function removeArrow(arrowId) {
  const arrow = arrows.find(a => a.id === arrowId);
  if (!arrow) return;
  removeArrowEl(arrowId);
  arrows = arrows.filter(a => a.id !== arrowId);
  const srcNode = nodes.find(n => n.id === arrow.srcId);
  const dstNode = nodes.find(n => n.id === arrow.dstId);
  if (srcNode) srcNode.outgoing = srcNode.outgoing.filter(id => id !== arrowId);
  if (dstNode) dstNode.incoming = dstNode.incoming.filter(id => id !== arrowId);
}

// ═══════════════════════════════════════════════════════
//  AUTO-LAYOUT
//  Handles main chain + decision side-branches
// ═══════════════════════════════════════════════════════
function getMainChain() {
  // Buscamos el nodo de inicio por tipo 'terminal' con label 'Inicio', o el primer terminal, o nodes[0]
  // Evitamos depender del label hardcoded 'Inicio' que el usuario podría haber cambiado.
  const start = nodes.find(n => n.label === 'Inicio') ||
                nodes.find(n => n.type === 'terminal') ||
                nodes[0];
  if (!start) return [];
  const visited = new Set(), chain = [];
  let cur = start;
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id); chain.push(cur);
    if (cur.type === 'decision') {
      const noArrow = arrows.find(a => a.srcId === cur.id && a.srcPort === 'left');
      const siArrow = arrows.find(a => a.srcId === cur.id && a.srcPort === 'right');
      const siBranch = siArrow ? walkBranch(siArrow) : { nodes: [], mergeId: null };
      const noBranch = noArrow ? walkBranch(noArrow) : { nodes: [], mergeId: null };
      siBranch.nodes.forEach(n => { if (!visited.has(n.id)) { visited.add(n.id); chain.push(n); } });
      noBranch.nodes.forEach(n => { if (!visited.has(n.id)) { visited.add(n.id); chain.push(n); } });
      const mergeId = siBranch.mergeId || noBranch.mergeId;
      cur = mergeId ? nodes.find(n => n.id === mergeId) : null;
    } else {
      const outArrows = arrows.filter(a => a.srcId === cur.id);
      const nextArrow = outArrows.find(a => !a.srcPort || a.srcPort === 'bottom') || outArrows[0];
      cur = nextArrow ? nodes.find(n => n.id === nextArrow.dstId) : null;
    }
  }
  return chain;
}

// Walks a single branch (SI or NO) starting from its first arrow, following
// the linear chain until it reaches the convergence node (2+ incoming arrows).
// Returns { nodes, mergeId } where nodes are only those INSIDE this branch
// (not the convergence node itself).
function walkBranch(startArrow) {
  const chainNodes = [];
  let arrow = startArrow;
  const seen = new Set();
  while (arrow && arrow.dstId) {
    if (seen.has(arrow.id)) break; // guard against cycles
    seen.add(arrow.id);
    const nextNode = nodes.find(n => n.id === arrow.dstId);
    if (!nextNode) break;
    if (nextNode.incoming.length > 1) {
      return { nodes: chainNodes, mergeId: nextNode.id };
    }
    chainNodes.push(nextNode);
    // If this node is itself a decision, skip over its entire sub-tree:
    // walkBranch is only responsible for collecting the "flat" list of nodes
    // that belong to THIS branch. The sub-tree will be laid out recursively
    // by layoutChain when it processes this node.
    if (nextNode.type === 'decision') {
      const subSiArrow = arrows.find(a => a.srcId === nextNode.id && a.srcPort === 'left');
      const subNoArrow = arrows.find(a => a.srcId === nextNode.id && a.srcPort === 'right');
      const subSi = subSiArrow ? walkBranch(subSiArrow) : { nodes: [], mergeId: null };
      const subNo = subNoArrow ? walkBranch(subNoArrow) : { nodes: [], mergeId: null };
      // Collect all nodes in the nested sub-tree so the parent walkBranch
      // includes them in the returned list (needed by getMainChain to mark them visited)
      subSi.nodes.forEach(n => chainNodes.push(n));
      subNo.nodes.forEach(n => chainNodes.push(n));
      const subMergeId = subSi.mergeId || subNo.mergeId;
      if (subMergeId) {
        // If the merge node has more incoming arrows than the nested decision's
        // sub-branches, it's ALSO the outer convergence point — stop here.
        const mergeNode = nodes.find(n => n.id === subMergeId);
        const subCount = (subSiArrow ? 1 : 0) + (subNoArrow ? 1 : 0);
        if (mergeNode && mergeNode.incoming.length > subCount) {
          return { nodes: chainNodes, mergeId: subMergeId };
        }
        arrow = arrows.find(a => a.srcId === subMergeId && (!a.srcPort || a.srcPort === 'bottom')) || null;
        if (arrow) continue;
      }
      break;
    }
    const outArrows = arrows.filter(a => a.srcId === nextNode.id);
    arrow = outArrows.length === 1 ? outArrows[0] : null;
  }
  return { nodes: chainNodes, mergeId: null };
}

// ═══════════════════════════════════════════════════════
//  layoutChain — recursive layout engine
//  Places nodes top-to-bottom in the given center column.
//  For decisions: places NO branch left, SI branch right,
//  records column centers in decisionLayout[dec.id].
//  Returns { endY, minX, maxX }.
// ═══════════════════════════════════════════════════════
function layoutChain(cur, centerX, startY, positioned) {
  let y = startY;
  let minX = Infinity, maxX = -Infinity;
  const seen = new Set();

  while (cur && !positioned.has(cur.id)) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    positioned.add(cur.id);

    cur.x = Math.round(centerX - cur.w / 2);
    cur.y = Math.round(y);
    updateNodePos(cur);
    minX = Math.min(minX, cur.x);
    maxX = Math.max(maxX, cur.x + cur.w);

    if (cur.type === 'decision') {
      const noArrow = arrows.find(a => a.srcId === cur.id && a.srcPort === 'left');
      const siArrow = arrows.find(a => a.srcId === cur.id && a.srcPort === 'right');
      const noBranch = noArrow ? walkBranch(noArrow) : { nodes: [], mergeId: null };
      const siBranch = siArrow ? walkBranch(siArrow) : { nodes: [], mergeId: null };

      const branchTopY = y + cur.h + V_GAP;

      // ── Dry-run to measure each branch width ───────────────
      const siDry = layoutBranchNodes(siArrow, centerX, branchTopY, new Set(positioned), true);
      const noDry = layoutBranchNodes(noArrow, centerX, branchTopY, new Set(positioned), true);

      const siHalfW = Math.max((siDry.maxX - siDry.minX) / 2, MIN_W / 2);
      const noHalfW = Math.max((noDry.maxX - noDry.minX) / 2, MIN_W / 2);

      // Branch centers: placed so the inner edge of each branch clears the
      // decision diamond by BRANCH_H_PAD, and branches don't overlap each other.
      const decHalfW = cur.w / 2;
      const siCenterX = centerX + decHalfW + BRANCH_H_PAD + siHalfW;
      const noCenterX = centerX - decHalfW - BRANCH_H_PAD - noHalfW;

      // ── Real layout ────────────────────────────────────────
      const siReal = layoutBranchNodes(siArrow, siCenterX, branchTopY, positioned, false);
      const noReal = layoutBranchNodes(noArrow, noCenterX, branchTopY, positioned, false);

      const bottomY = Math.max(siReal.endY, noReal.endY, branchTopY);

      // Find the deepest mergeBarY among any nested decisions in either branch.
      // The parent's merge bar must be at or below all child merge bars so lines
      // can route horizontally outward without crossing children.
      function deepestChildMergeBarY(branchArrow, guard) {
        if (!branchArrow || guard.size > 60) return 0;
        let maxBar = 0;
        let wCur = nodes.find(n => n.id === branchArrow.dstId);
        const wSeen = new Set(guard);
        while (wCur && !wSeen.has(wCur.id)) {
          wSeen.add(wCur.id);
          if (wCur.type === 'decision') {
            const cdl = decisionLayout[wCur.id];
            if (cdl && cdl.mergeBarY != null) maxBar = Math.max(maxBar, cdl.mergeBarY);
            // Also recurse into this child's sub-branches
            const cSi = arrows.find(a => a.srcId === wCur.id && a.srcPort === 'right');
            const cNo = arrows.find(a => a.srcId === wCur.id && a.srcPort === 'left');
            if (cSi) maxBar = Math.max(maxBar, deepestChildMergeBarY(cSi, new Set(wSeen)));
            if (cNo) maxBar = Math.max(maxBar, deepestChildMergeBarY(cNo, new Set(wSeen)));
            break;
          }
          const outA = arrows.find(a => a.srcId === wCur.id && (!a.srcPort || a.srcPort === 'bottom'));
          if (!outA || outA.dstPort === 'top') break;
          wCur = nodes.find(n => n.id === outA.dstId);
        }
        return maxBar;
      }

      const childBarSI = siArrow ? deepestChildMergeBarY(siArrow, new Set()) : 0;
      const childBarNO = noArrow ? deepestChildMergeBarY(noArrow, new Set()) : 0;
      const deepestChildBar = Math.max(childBarSI, childBarNO);

      // Parent merge bar: at least V_GAP*0.6 below branch content,
      // but also at or below the deepest child merge bar so outer lines clear inner ones.
      const naturalBar = bottomY + Math.round(V_GAP * 0.3);
      const mergeBarYForDec = Math.max(naturalBar, deepestChildBar);

      // Store for arrow router
      decisionLayout[cur.id] = {
        noCenterX,
        siCenterX,
        branchTopY,
        mergeY:    bottomY,
        mergeBarY: mergeBarYForDec,
        decCenterX: centerX,
      };

      minX = Math.min(minX, noReal.minX);
      maxX = Math.max(maxX, siReal.maxX);
      // Position merge node well below the bar so there's room to insert nodes
      y = mergeBarYForDec + Math.round(V_GAP * 1.0);

      const mergeId = noBranch.mergeId || siBranch.mergeId;
      const mergeNode = mergeId ? nodes.find(n => n.id === mergeId) : null;
      if (mergeNode && positioned.has(mergeNode.id)) {
        // The merge node was already positioned while laying out a NESTED
        // decision's own (shallower) branch — that inner decision doesn't
        // know about THIS outer decision's wider/deeper bar. Push it down so
        // it always lands below every decision that converges on it, instead
        // of leaving it too high (which made the merge bar/line geometry
        // overlap and zigzag). Always correct x to the current centerX even
        // if y is already deep enough — the branch centerX differs from the
        // main chain centerX.
        mergeNode.x = Math.round(centerX - mergeNode.w / 2);
        if (mergeNode.y < y) mergeNode.y = Math.round(y);
        updateNodePos(mergeNode);
      }
      if (mergeNode && !positioned.has(mergeNode.id)) {
        cur = mergeNode;
      } else { break; }

    } else {
      y += cur.h + V_GAP;
      const outArrows = arrows.filter(a => a.srcId === cur.id);
      const nextArrow = outArrows.find(a => !a.srcPort || a.srcPort === 'bottom') || outArrows[0];
      const nextCandidate = nextArrow ? nodes.find(n => n.id === nextArrow.dstId) : null;
      if (nextCandidate && nextCandidate.incoming.length > 1) return { endY: y, minX, maxX };
      cur = nextCandidate;
    }
  }
  if (minX === Infinity) minX = centerX - MIN_W / 2;
  if (maxX === -Infinity) maxX = centerX + MIN_W / 2;
  return { endY: y, minX, maxX };
}

// Layout nodes of one branch column recursively.
// dryRun=true: uses a copy of positioned, doesn't commit.
function layoutBranchNodes(branchStartArrow, centerX, startY, positioned, dryRun) {
  if (!branchStartArrow) return { endY: startY, minX: centerX - MIN_W/2, maxX: centerX + MIN_W/2 };
  let y = startY;
  let minX = Infinity, maxX = -Infinity;
  let arrow = branchStartArrow;
  const seen = new Set();
  const posSet = dryRun ? new Set(positioned) : positioned;

  while (arrow && arrow.dstId) {
    if (seen.has(arrow.id)) break;
    seen.add(arrow.id);

    const nextNode = nodes.find(n => n.id === arrow.dstId);
    if (!nextNode) break;
    if (nextNode.incoming.length > 1) break;
    if (posSet.has(nextNode.id)) break;

    const r = layoutChain(nextNode, centerX, y, posSet);
    y = r.endY;
    minX = Math.min(minX, r.minX);
    maxX = Math.max(maxX, r.maxX);

    const outArrows = arrows.filter(a => a.srcId === nextNode.id && (!a.srcPort || a.srcPort === 'bottom'));
    arrow = outArrows.length ? outArrows[0] : null;

    if (nextNode.type === 'decision') {
      const subSi = arrows.find(a => a.srcId === nextNode.id && a.srcPort === 'right');
      const subNo = arrows.find(a => a.srcId === nextNode.id && a.srcPort === 'left');
      const subSiB = subSi ? walkBranch(subSi) : { mergeId: null };
      const subNoB = subNo ? walkBranch(subNo) : { mergeId: null };
      const subMid = subSiB.mergeId || subNoB.mergeId;
      if (subMid) {
        const mergeNode = nodes.find(n => n.id === subMid);
        const subCnt = (subSi ? 1 : 0) + (subNo ? 1 : 0);
        if (mergeNode && mergeNode.incoming.length > subCnt) break;
        arrow = arrows.find(a => a.srcId === subMid && (!a.srcPort || a.srcPort === 'bottom')) || null;
      } else { break; }
    }
  }
  if (minX === Infinity) minX = centerX - MIN_W/2;
  if (maxX === -Infinity) maxX = centerX + MIN_W/2;
  return { endY: y, minX, maxX };
}

function autoLayout() {
  // Reset layout registries
  Object.keys(decisionLayout).forEach(k => delete decisionLayout[k]);

  const start = nodes.find(n => n.label === 'Inicio') ||
                nodes.find(n => n.type === 'terminal') ||
                nodes[0];
  if (!start) { redrawAllArrows(); return; }

  const positioned = new Set();
  layoutChain(start, COL_X, 80, positioned);

  nodes.filter(n => !positioned.has(n.id)).forEach((node, i) => {
    node.x = COL_X + 600;
    node.y = 80 + i * (node.h + V_GAP);
    updateNodePos(node);
  });

  redrawAllArrows();
}
// ═══════════════════════════════════════════════════════
//  INSERT AFTER NODE
//  For 'decision': inserts decision + SI branch (left) + NO branch (right)
//  Both branches converge back to the node that was after the clicked node
// ═══════════════════════════════════════════════════════
const DEFAULT_LABELS = {
  terminal: 'Terminal', input: 'Entrada', process: 'Proceso',
  decision: 'Condición', print: 'Imprimir'
};

function insertAfterNode(afterNodeId) {
  if (!selectedTool) return;
  const afterNode = nodes.find(n => n.id === afterNodeId);
  if (!afterNode) return;

  if (selectedTool === 'decision') {
    insertDecision(afterNodeId);
    return;
  }

  // Clicking on a decision with a non-decision tool: insert on the trunk
  // after the merge (convergence) point instead of creating a bottom arrow
  // that would bypass the SI/NO branches.
  if (afterNode.type === 'decision') {
    const noA = arrows.find(a => a.srcId === afterNode.id && a.srcPort === 'left');
    const siA = arrows.find(a => a.srcId === afterNode.id && a.srcPort === 'right');
    const branchArrows = [noA, siA].filter(Boolean);
    if (branchArrows.length >= 1) {
      let mergeId = null;
      for (const ba of branchArrows) {
        const w = walkBranch(ba);
        if (w.mergeId) { mergeId = w.mergeId; break; }
      }
      if (mergeId) {
        const allIncoming = arrows.filter(a => a.dstId === mergeId);
        insertAfterMerge(allIncoming.map(a => a.id), mergeId);
        return;
      }
    }
    setStatus('Haz clic sobre una línea SI/NO o en la barra de unión para insertar.');
    deselectTool();
    return;
  }

  // Normal insert
  const existingArrow = arrows.find(a => a.srcId === afterNodeId && (!a.srcPort || a.srcPort === 'bottom'));
  const newNode = mkNode(selectedTool, afterNode.x, afterNode.y + afterNode.h + V_GAP, DEFAULT_LABELS[selectedTool]);

  if (existingArrow) {
    const oldDstId = existingArrow.dstId;
    removeArrow(existingArrow.id);
    mkArrow(afterNodeId, newNode.id, '', null, null);
    mkArrow(newNode.id, oldDstId, '', null, null);
  } else {
    mkArrow(afterNodeId, newNode.id, '', null, null);
  }

  autoLayout();
  deselectTool();
  selectNode(newNode.id);
  setStatus(`"${newNode.label}" agregado después de "${afterNode.label}". Doble clic para renombrar.`);
}

function insertDecision(afterNodeId) {
  const afterNode = nodes.find(n => n.id === afterNodeId);

  // Find what comes after afterNode in main chain
  const existingArrow = arrows.find(a => a.srcId === afterNodeId && (!a.srcPort || a.srcPort === 'bottom'));
  const oldDstId = existingArrow ? existingArrow.dstId : null;

  // Create decision node
  const dec = mkNode('decision', 0, 0, 'Condición');

  // Remove old arrow from afterNode
  if (existingArrow) {
    removeArrow(existingArrow.id);
  }

  // afterNode → decision (main flow down)
  mkArrow(afterNodeId, dec.id, '', null, null);

  // decision → oldDst directly via NO (left) and SI (right) lines — no process boxes yet.
  // Layout engine: left = NO (izquierda), right = SI (derecha).
  if (oldDstId) {
    mkArrow(dec.id, oldDstId, 'NO', 'left',  'top');
    mkArrow(dec.id, oldDstId, 'SI', 'right', 'top');
  } else {
    // No successor yet — create a stub Fin node so both branches have somewhere to go.
    const stub = mkNode('terminal', 0, 0, 'Fin');
    mkArrow(dec.id, stub.id, 'NO', 'left',  'top');
    mkArrow(dec.id, stub.id, 'SI', 'right', 'top');
  }

  autoLayout();
  deselectTool();
  selectNode(dec.id);
  setStatus('Decisión agregada con líneas NO (izquierda) y SI (derecha), sin procesos. Selecciona una forma y haz clic sobre una de esas líneas para insertarla.');
}

// ═══════════════════════════════════════════════════════
//  INSERT ON ARROW
//  With a tool selected, clicking a line inserts the shape
//  in the middle of that line, splitting it into two arrows.
// ═══════════════════════════════════════════════════════
function insertOnArrow(arrowId) {
  if (!selectedTool) return;
  const arrow = arrows.find(a => a.id === arrowId);
  if (!arrow) return;
  const { srcId, dstId, srcPort, label } = arrow;
  if (!dstId) return; // dangling line with nothing to split toward

  if (selectedTool === 'decision') {
    // Insert a decision in the middle of the line, branching SI/NO back into the same target
    const dec = mkNode('decision', 0, 0, 'Condición');
    removeArrow(arrow.id);
    mkArrow(srcId, dec.id, label, srcPort, 'top');
    mkArrow(dec.id, dstId, 'NO', 'left',  'top');  // left = NO
    mkArrow(dec.id, dstId, 'SI', 'right', 'top');  // right = SI
    autoLayout();
    deselectTool();
    selectNode(dec.id);
    setStatus('Decisión insertada en la línea, con ramas SI y NO sin procesos.');
    return;
  }

  const newNode = mkNode(selectedTool, 0, 0, DEFAULT_LABELS[selectedTool]);

  removeArrow(arrow.id);

  // Primer tramo: hereda el puerto/label original (ej. "SI"/"NO" de la decisión padre).
  // Segundo tramo: srcPort null para que findBranchSideForArrow pueda remontar
  // la cadena hacia la decisión original y calcular mergeRole correctamente.
  mkArrow(srcId, newNode.id, label, srcPort, 'top');
  mkArrow(newNode.id, dstId, '', null, 'top');

  autoLayout();
  deselectTool();
  selectNode(newNode.id);
  setStatus(`"${newNode.label}" insertado en la línea. Doble clic para renombrar.`);
}

// ═══════════════════════════════════════════════════════
//  INSERT AFTER MERGE BAR
//  Clicking the horizontal "join" bar where a decision's SI and NO
//  branches come back together inserts the new shape AFTER the merge,
//  on the single trunk line — outside of both decision paths. Both
//  branch arrows are re-pointed to the new node, and a fresh arrow
//  continues from the new node down to the original convergence target.
// ═══════════════════════════════════════════════════════
function insertAfterMerge(arrowIds, oldDstId) {
  if (!selectedTool) return;
  const incoming = arrowIds.map(id => arrows.find(a => a.id === id)).filter(Boolean);
  if (incoming.length < 2) return;

  if (selectedTool === 'decision') {
    setStatus('No se puede insertar una decisión justo en la barra de unión.');
    return;
  }

  const newNode = mkNode(selectedTool, 0, 0, DEFAULT_LABELS[selectedTool]);

  // Remove old converging arrows and create new ones pointing to the new node
  const replays = incoming.map(a => ({ srcId: a.srcId, label: a.label, srcPort: a.srcPort, dstPort: a.dstPort }));
  incoming.forEach(a => removeArrow(a.id));
  replays.forEach(r => mkArrow(r.srcId, newNode.id, r.label, r.srcPort, r.dstPort));

  // Continue the trunk from the new node down to whatever followed the merge before.
  mkArrow(newNode.id, oldDstId, '', null, null);

  autoLayout();
  deselectTool();
  selectNode(newNode.id);
  setStatus(`"${newNode.label}" agregado después de la unión SI/NO, fuera de los caminos de decisión. Doble clic para renombrar.`);
}

// ═══════════════════════════════════════════════════════
//  TOOL
// ═══════════════════════════════════════════════════════
function selectTool(type) {
  if (selectedTool === type) { deselectTool(); return; }
  deselectTool();
  selectedTool = type;
  document.getElementById('tool-' + type).classList.add('active');
  const lbl = DEFAULT_LABELS[type];
  const { w, h } = calcNodeSize(type, lbl);
  _ghostEl.style.width  = w + 'px';
  _ghostEl.style.height = h + 'px';
  _ghostEl.innerHTML = buildSVG(type, lbl, w, h);
  nodes.forEach(n => { const el = document.getElementById(n.id); if (el) el.classList.add('ins-target'); });
  clearNodeSel(); clearArrowSel();
  const names = {terminal:'Terminal',input:'Entrada',process:'Proceso',decision:'Decisión',print:'Imprimir'};
  setStatus(`"${names[type]}" seleccionado — haz clic sobre el nodo DESPUÉS DEL CUAL quieres insertarlo.`);
}

function deselectTool() {
  if (selectedTool) {
    const btn = document.getElementById('tool-' + selectedTool);
    if (btn) btn.classList.remove('active');
  }
  selectedTool = null;
  _ghostEl.style.display = 'none';
  nodes.forEach(n => { const el = document.getElementById(n.id); if (el) el.classList.remove('ins-target'); });
}

// ═══════════════════════════════════════════════════════
//  NODE EVENTS
// ═══════════════════════════════════════════════════════
function onNodeClick(e) {
  e.stopPropagation();
  if (selectedTool) { insertAfterNode(e.currentTarget.id); return; }
  if (!dragActive) selectNode(e.currentTarget.id);
}

function onNodeDblClick(e) {
  e.stopPropagation();
  if (selectedTool) return;
  const node = nodes.find(n => n.id === e.currentTarget.id);
  if (node) startEditLabel(node);
}

function onNodeMouseDown(e) {
  if (e.button !== 0 || selectedTool) return;
  dragActive = false;
  dragNodeId = e.currentTarget.id;
  const node = nodes.find(n => n.id === dragNodeId);
  const rect = _canvasEl.getBoundingClientRect();
  dragOX = (e.clientX - rect.left) / zoomLevel - node.x;
  dragOY = (e.clientY - rect.top)  / zoomLevel - node.y;
  e.preventDefault();
}

document.addEventListener('mousemove', e => {
  if (!dragNodeId) return;
  dragActive = true;
  const node = nodes.find(n => n.id === dragNodeId);
  if (!node) return;
  const rect = _canvasEl.getBoundingClientRect();
  node.x = Math.max(0, (e.clientX - rect.left) / zoomLevel - dragOX);
  node.y = Math.max(0, (e.clientY - rect.top)  / zoomLevel - dragOY);
  const el = document.getElementById(dragNodeId);
  if (el) { el.classList.add('dragging-node'); el.style.left = node.x+'px'; el.style.top = node.y+'px'; }
  redrawAllArrows();
});

document.addEventListener('mouseup', () => {
  if (dragNodeId) {
    const el = document.getElementById(dragNodeId);
    if (el) el.classList.remove('dragging-node');
    setTimeout(() => { dragActive = false; dragNodeId = null; }, 10);
  }
});

_canvasWrap.addEventListener('mousemove', e => {
  if (!selectedTool) { _ghostEl.style.display = 'none'; return; }
  const rect = _canvasEl.getBoundingClientRect();
  _ghostEl.style.display = 'block';
  _ghostEl.style.left = ((e.clientX - rect.left) / zoomLevel - parseInt(_ghostEl.style.width||'70')/2) + 'px';
  _ghostEl.style.top  = ((e.clientY - rect.top)  / zoomLevel - parseInt(_ghostEl.style.height||'50')/2) + 'px';
});

_canvasEl.addEventListener('click', e => {
  if (e.target === _canvasEl || e.target.closest('svg#arrows')) {
    if (selectedTool) { deselectTool(); setStatus('Inserción cancelada.'); return; }
    clearNodeSel(); clearArrowSel();
  }
});

// ═══════════════════════════════════════════════════════
//  ZOOM
// ═══════════════════════════════════════════════════════
function applyZoom() {
  _canvasEl.style.transform = `scale(${zoomLevel})`;
  document.getElementById('zoom-level').textContent = Math.round(zoomLevel * 100) + '%';
}

function zoomIn() {
  zoomLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 100) / 100);
  applyZoom();
}

function zoomOut() {
  zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 100) / 100);
  applyZoom();
}

function zoomReset() {
  zoomLevel = 1;
  applyZoom();
}

// Ctrl/Cmd + scroll wheel zooms in and out, anchored at the mouse position.
_canvasWrap.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const rect = _canvasWrap.getBoundingClientRect();
  const mx = e.clientX - rect.left + _canvasWrap.scrollLeft;
  const my = e.clientY - rect.top  + _canvasWrap.scrollTop;
  const oldZoom = zoomLevel;
  if (e.deltaY < 0) zoomLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 100) / 100);
  else              zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 100) / 100);
  applyZoom();
  const scale = zoomLevel / oldZoom;
  _canvasWrap.scrollLeft = mx * scale - (e.clientX - rect.left);
  _canvasWrap.scrollTop  = my * scale - (e.clientY - rect.top);
}, { passive: false });

// ═══════════════════════════════════════════════════════
//  SELECTION
// ═══════════════════════════════════════════════════════
function selectNode(id) {
  clearNodeSel(); clearArrowSel();
  selectedNodeId = id;
  const el = document.getElementById(id);
  if (el) el.classList.add('selected');
  const node = nodes.find(n => n.id === id);
  if (node) setStatus(`"${node.label}" seleccionado. Doble clic para editar. Supr para eliminar.`);
}
function clearNodeSel() {
  if (selectedNodeId) { const el = document.getElementById(selectedNodeId); if (el) el.classList.remove('selected','ins-target'); }
  selectedNodeId = null;
}
function selectArrow(id) {
  clearNodeSel(); clearArrowSel();
  selectedArrowId = id;
  redrawAllArrows();
  setStatus('Flecha seleccionada. Supr para eliminar.');
}
function clearArrowSel() {
  if (selectedArrowId) { selectedArrowId = null; redrawAllArrows(); }
}

// ═══════════════════════════════════════════════════════
//  EDIT LABEL
// ═══════════════════════════════════════════════════════
function startEditLabel(node) {
  const inp = document.createElement('input');
  inp.className = 'node-input';
  inp.value = node.label;
  inp.style.left   = (node.x + 4) + 'px';
  inp.style.top    = (node.y + 4) + 'px';
  inp.style.width  = Math.max(node.w - 8, 80) + 'px';
  inp.style.height = (node.h - 8) + 'px';
  _canvasEl.appendChild(inp);
  inp.focus(); inp.select();

  const done = () => {
    const v = inp.value.trim();
    if (v) node.label = v;
    if (inp.parentNode) inp.parentNode.removeChild(inp);
    mountNode(node);
    autoLayout();
    redrawAllArrows();
  };
  inp.addEventListener('blur', done);
  inp.addEventListener('keydown', e => { if (e.key==='Enter'||e.key==='Escape') inp.blur(); });
}

// ═══════════════════════════════════════════════════════
//  DELETE
// ═══════════════════════════════════════════════════════
function deleteSelected() {
  if (selectedNodeId) {
    const nodeId = selectedNodeId;
    const node   = nodes.find(n => n.id === nodeId);
    if (node && (node.label === 'Inicio' || node.label === 'Fin')) {
      setStatus('No se puede eliminar el nodo Inicio o Fin.'); return;
    }

    if (node && node.type === 'decision') {
      // Capture incoming arrow before deletion
      const inArr = node.incoming.length ? arrows.find(a => a.id === node.incoming[0]) : null;
      const noArrow = arrows.find(a => a.srcId === nodeId && a.srcPort === 'left');
      const siArrow = arrows.find(a => a.srcId === nodeId && a.srcPort === 'right');
      const siBranch = siArrow ? walkBranch(siArrow) : { nodes: [], mergeId: null };
      const noBranch = noArrow ? walkBranch(noArrow) : { nodes: [], mergeId: null };
      const mergeId  = siBranch.mergeId || noBranch.mergeId;
      const branchIds = new Set([...siBranch.nodes, ...noBranch.nodes].map(n => n.id));

      // Remove all arrows connected to decision or any branch node via pointers
      const affected = new Set();
      [node, ...siBranch.nodes, ...noBranch.nodes].forEach(n => {
        n.incoming.forEach(id => affected.add(id));
        n.outgoing.forEach(id => affected.add(id));
      });
      affected.forEach(id => removeArrow(id));

      branchIds.forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
      const el = document.getElementById(nodeId);
      if (el) el.remove();
      nodes = nodes.filter(n => n.id !== nodeId && !branchIds.has(n.id));

      if (inArr && mergeId) mkArrow(inArr.srcId, mergeId, inArr.label || '', inArr.srcPort || null, null);

      selectedNodeId = null;
      autoLayout();
      setStatus('Decisión y sus ramas eliminadas.');
      return;
    }

    // A merge-point node (2+ incoming arrows) must reconnect ALL of them to
    // whatever followed it — otherwise the other branch dangles.
    if (node.incoming.length > 1) {
      // Capture arrow data before removal
      const inData = node.incoming.map(id => {
        const a = arrows.find(arr => arr.id === id);
        return a ? { srcId: a.srcId, label: a.label, srcPort: a.srcPort, dstPort: a.dstPort } : null;
      }).filter(Boolean);
      const outArr = arrows.find(a => a.srcId === nodeId && (!a.srcPort || a.srcPort === 'bottom'));
      const outDstId = outArr ? outArr.dstId : null;

      // Remove all arrows connected to this node
      [...node.incoming, ...node.outgoing].forEach(id => removeArrow(id));

      if (outDstId) {
        inData.forEach(d => mkArrow(d.srcId, outDstId, d.label, d.srcPort, d.dstPort));
      }
      const el = document.getElementById(nodeId);
      if (el) el.remove();
      nodes = nodes.filter(n => n.id !== nodeId);
      selectedNodeId = null;
      autoLayout();
      setStatus('Nodo eliminado y ramas reconectadas.');
      return;
    }

    // Regular node (exactly 1 incoming arrow)
    const inArr   = arrows.find(a => a.dstId === nodeId && (!a.dstPort || a.dstPort !== 'top'));
    // Branch node sits directly after a decision's SI/NO port
    const brArr   = arrows.find(a => a.dstId === nodeId && a.dstPort === 'top' && (a.srcPort === 'left' || a.srcPort === 'right'));
    const outArr  = arrows.find(a => a.srcId === nodeId && (!a.srcPort || a.srcPort === 'bottom'));

    // Capture data before removal
    const inData  = inArr  ? { srcId: inArr.srcId } : null;
    const brData  = brArr  ? { srcId: brArr.srcId, label: brArr.label, srcPort: brArr.srcPort } : null;
    const outDst  = outArr ? outArr.dstId : null;

    [...node.incoming, ...node.outgoing].forEach(id => removeArrow(id));

    if (inData && outDst) {
      mkArrow(inData.srcId, outDst);
    } else if (brData && outDst) {
      mkArrow(brData.srcId, outDst, brData.label, brData.srcPort, 'top');
    }
    const el = document.getElementById(nodeId);
    if (el) el.remove();
    nodes = nodes.filter(n => n.id !== nodeId);
    selectedNodeId = null;
    autoLayout();
    setStatus('Nodo eliminado.');
  } else if (selectedArrowId) {
    removeArrow(selectedArrowId);
    selectedArrowId = null;
    setStatus('Flecha eliminada.');
  }
}

document.addEventListener('keydown', e => {
  if (document.activeElement.tagName === 'INPUT') return;
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  if (e.key === 'Escape') {
    deselectTool(); clearNodeSel(); clearArrowSel();
    setStatus('Modo normal.');
  }
});

// ═══════════════════════════════════════════════════════
//  RESET — modal-based, no confirm()
// ═══════════════════════════════════════════════════════
function askReset() {
  _modalOvr.classList.add('show');
}

function closeModal() {
  _modalOvr.classList.remove('show');
}

function doReset() {
  closeModal();

  // Si hay un campo de edición de texto activo, quitarle el foco primero
  // para evitar que quede un input huérfano flotando tras el reset
  if (document.activeElement && document.activeElement.classList.contains('node-input')) {
    document.activeElement.blur();
  }
  document.querySelectorAll('.node-input').forEach(el => el.remove());

  // Remove all .node divs from canvas
  _canvasEl.querySelectorAll('.node').forEach(el => el.remove());

  // Remove all arrow <g> elements from SVG (keep <defs>)
  Array.from(_arrowsSvg.childNodes).forEach(child => {
    if (child.nodeType === 1 && child.tagName.toLowerCase() !== 'defs') {
      child.remove();
    }
  });

  // Reset all state variables
  nodes           = [];
  arrows          = [];
  nodeSeq         = 0;
  arrowSeq        = 0;
  selectedNodeId  = null;
  selectedArrowId = null;
  dragNodeId      = null;
  dragActive      = false;
  zoomLevel       = 1;
  applyZoom();

  // Deselect any active tool
  if (selectedTool) {
    const btn = document.getElementById('tool-' + selectedTool);
    if (btn) btn.classList.remove('active');
    selectedTool = null;
    _ghostEl.style.display = 'none';
  }

  // Re-init
  initDiagram();
  setStatus('Diagrama reiniciado correctamente.');
}

// Close modal if clicking outside box
_modalOvr.addEventListener('click', e => {
  if (e.target === _modalOvr) closeModal();
});

// ═══════════════════════════════════════════════════════
//  SAVE AS SVG
// ═══════════════════════════════════════════════════════
function saveDiagram() {
  if (!nodes.length) { setStatus('No hay nada que guardar.'); return; }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(n => {
    minX=Math.min(minX,n.x); minY=Math.min(minY,n.y);
    maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+n.h);
  });
  // Include branch column positions and merge bars from decision layout
  Object.values(decisionLayout).forEach(dl => {
    if (dl.siCenterX != null) { minX = Math.min(minX, dl.siCenterX - MIN_W); maxX = Math.max(maxX, dl.siCenterX + MIN_W); }
    if (dl.noCenterX != null) { minX = Math.min(minX, dl.noCenterX - MIN_W); maxX = Math.max(maxX, dl.noCenterX + MIN_W); }
    if (dl.mergeBarY != null) { minY = Math.min(minY, dl.mergeBarY); maxY = Math.max(maxY, dl.mergeBarY + V_GAP); }
    if (dl.mergeY    != null) { maxY = Math.max(maxY, dl.mergeY); }
  });
  const pad=80, W=maxX-minX+pad*2, H=maxY-minY+pad*2, ox=minX-pad, oy=minY-pad;
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${ox} ${oy} ${W} ${H}">
<defs><marker id="ah" markerWidth="8" markerHeight="5.6" refX="7.2" refY="2.8" orient="auto">
  <polygon points="0 0,8 2.8,0 5.6" fill="#3a7bd5"/></marker></defs>
<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="#f5f8ff"/>
`;
  arrows.forEach(arrow => {
    const src=nodes.find(n=>n.id===arrow.srcId), dst=nodes.find(n=>n.id===arrow.dstId);
    if (!src||!dst) return;

    const sxCx = src.x + src.w / 2, sxBy = src.y + src.h, sxCy = src.y + src.h / 2;
    const dxCx = dst.x + dst.w / 2, dxTy = dst.y;
    const decLeftX = src.x, decRightX = src.x + src.w;

    const isDecBranch2 = (arrow.srcPort === 'left' || arrow.srcPort === 'right') && src.type === 'decision';
    const dl2 = isDecBranch2 ? decisionLayout[src.id] : null;

    function getImmediateDecId2(a) {
      const seen = new Set();
      let cur = a;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.srcPort === 'left' || cur.srcPort === 'right') {
          const s = nodes.find(n => n.id === cur.srcId);
          if (s && s.type === 'decision') return s.id;
        }
        const incs = arrows.filter(x => x.dstId === cur.srcId);
        if (incs.length !== 1) break;
        cur = incs[0];
      }
      return null;
    }

    // Detect convergence — any destination with 2+ incoming arrows, mirroring
    // the live-canvas logic so nested decisions (where one branch reaches dst
    // directly and another through a second decision) still share one bar.
    const allIncoming2 = arrows.filter(a => a.dstId === dst.id);
    const isConv2 = allIncoming2.length >= 2;

    let mergeBarY2 = dst.y - 22;
    if (isConv2) {
      let best = -Infinity;
      allIncoming2.forEach(a => {
        const rootId = getImmediateDecId2(a);
        const rdl = rootId ? decisionLayout[rootId] : null;
        if (rdl && rdl.mergeBarY != null) best = Math.max(best, rdl.mergeBarY);
      });
      mergeBarY2 = best > -Infinity ? best : dst.y - Math.round(V_GAP * 1.5);
    }

    let throughId2 = allIncoming2[0]?.id;
    if (isConv2) {
      let best2 = -Infinity;
      allIncoming2.forEach(a => {
        const info2=getBranchInfo(a), s2=nodes.find(n=>n.id===a.srcId);
        const sc2=(info2&&info2.side==='si'?10000:0)+(s2?s2.x+s2.w/2:0);
        if(sc2>best2){best2=sc2;throughId2=a.id;}
      });
    }
    const iAmThrough2 = !isConv2 || arrow.id === throughId2;

    let pathD2, lx2, ly2, drawHead2=true;

    if (isDecBranch2) {
      const vertexX = arrow.srcPort === 'left' ? decLeftX : decRightX;
      const colX = dl2
        ? (arrow.srcPort === 'left' ? dl2.noCenterX : dl2.siCenterX)
        : (arrow.srcPort === 'left' ? src.x - 100 : src.x + src.w + 100);
      lx2 = arrow.srcPort === 'left' ? vertexX - 28 : vertexX + 28;
      ly2 = sxCy - 13;
      if (isConv2) {
        const pts = [[vertexX, sxCy], [colX, sxCy], [colX, mergeBarY2], [dxCx, mergeBarY2]];
        if (iAmThrough2) pts.push([dxCx, dxTy]);
        drawHead2 = iAmThrough2;
        const npts = pts.filter((p,i,a)=>i===0||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
        pathD2 = 'M'+npts.map(p=>p[0]+','+p[1]).join(' L');
      } else {
        const turnY = dxTy - Math.round(V_GAP / 2);
        const pts = [[vertexX, sxCy], [colX, sxCy], [colX, turnY], [dxCx, turnY], [dxCx, dxTy]];
        const npts = pts.filter((p,i,a)=>i===0||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
        pathD2 = 'M'+npts.map(p=>p[0]+','+p[1]).join(' L');
        drawHead2 = true;
      }
    } else if (isConv2) {
      const pts=[[sxCx,sxBy],[sxCx,mergeBarY2],[dxCx,mergeBarY2]];
      if(iAmThrough2) pts.push([dxCx,dxTy]);
      drawHead2=iAmThrough2;
      const npts=pts.filter((p,i,a)=>i===0||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
      pathD2='M'+npts.map(p=>p[0]+','+p[1]).join(' L');
      lx2=sxCx; ly2=(sxBy+mergeBarY2)/2-8;
    } else if (Math.abs(sxCx-dxCx)<3) {
      pathD2=`M${sxCx},${sxBy} L${dxCx},${dxTy}`;
      lx2=sxCx; ly2=(sxBy+dxTy)/2-8;
    } else {
      const midY2=Math.round((sxBy+dxTy)/2);
      const pts=[[sxCx,sxBy],[sxCx,midY2],[dxCx,midY2],[dxCx,dxTy]];
      const npts=pts.filter((p,i,a)=>i===0||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
      pathD2='M'+npts.map(p=>p[0]+','+p[1]).join(' L');
      lx2=(sxCx+dxCx)/2; ly2=midY2-10;
    }

    svg+=`<path d="${pathD2}" stroke="#3a7bd5" stroke-width="2.5" fill="none" ${drawHead2?'marker-end="url(#ah)"':''}/>
`;
    if (arrow.label) {
      svg+=`<text x="${lx2}" y="${ly2}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#3a7bd5">${xmlEsc(arrow.label)}</text>
`;
    }
  });
  nodes.forEach(node => {
    const {w,h,x,y,type,label}=node, cx=x+w/2, cy=y+h/2;
    const lines=label.split('\n'), lineH=17;
    let ty=cy-(lines.length*lineH)/2+lineH/2;
    let body='';
    switch(type){
      case 'terminal': body=`<rect x="${x+1}" y="${y+1}" width="${w-2}" height="${h-2}" rx="${(h-2)/2}" fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`; break;
      case 'input':    body=`<polygon points="${x+h*0.28+1},${y+1} ${x+w-1},${y+1} ${x+w-h*0.28-1},${y+h-1} ${x+1},${y+h-1}" fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`; break;
      case 'process':  body=`<rect x="${x+1}" y="${y+1}" width="${w-2}" height="${h-2}" fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`; break;
      case 'decision': body=`<polygon points="${cx},${y+1} ${x+w-1},${cy} ${cx},${y+h-1} ${x+1},${cy}" fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`; break;
      case 'print': {
        const waveY = y + h*0.82, amp = h*0.16;
        body=`<path d="M${x+1},${y+1} H${x+w-1} V${waveY} C${x+w*0.75},${waveY+amp} ${x+w*0.25},${waveY-amp} ${x+1},${waveY} Z" fill="white" stroke="#3a7bd5" stroke-width="2.5"/>`; break;
      }
    }
    svg+=body;
    lines.forEach(line => {
      svg+=`<text x="${cx}" y="${ty}" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-size="13" font-weight="700" fill="#1a1f2e">${xmlEsc(line)}</text>\n`;
      ty+=lineH;
    });
  });
  // ── Watermark ITES-DFD ───────────────────────────────
  // Positioned at top-left of the exported image, subtle but legible.
  const wmX = ox + 14;
  const wmY = oy + 22;
  svg += `<text x="${wmX}" y="${wmY}"
    font-family="'Segoe UI',Arial,sans-serif" font-size="13" font-weight="800"
    fill="#3a7bd5" opacity="0.38" letter-spacing="2"
    style="user-select:none">ITES-DFD</text>\n`;

  svg+='</svg>';
  const blob=new Blob([svg],{type:'image/svg+xml'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='diagrama-de-flujo.svg'; a.click();
  URL.revokeObjectURL(url);
  setStatus('Guardado como diagrama-de-flujo.svg');
}

// ═══════════════════════════════════════════════════════
//  STATUS
// ═══════════════════════════════════════════════════════
function setStatus(msg) { _statusBar.textContent = msg; }

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
function initDiagram() {
  const inicio = mkNode('terminal', COL_X - 75, 80,  'Inicio');
  const fin    = mkNode('terminal', COL_X - 75, 200, 'Fin');
  mkArrow(inicio.id, fin.id, '', null, null);
  autoLayout();
  applyZoom();
  setStatus('Selecciona una forma del toolbar y haz clic sobre un nodo para insertarla después de él.');
}

window.addEventListener('load', initDiagram);
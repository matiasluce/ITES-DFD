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
    document.getElementById('canvas').appendChild(el);
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

// Keep getPort for legacy calls in saveDiagram
function getPort(node, dir) {
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
  if (dir === 'top')    return { x: cx, y: node.y };
  if (dir === 'bottom') return { x: cx, y: node.y + node.h };
  if (dir === 'left')   return { x: node.x, y: cy };
  if (dir === 'right')  return { x: node.x + node.w, y: cy };
}

function bestDirs(src, dst) {
  return ['bottom','top'];
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
    const inc = arrows.filter(a => a.dstId === cur.srcId);
    if (inc.length !== 1) return null;
    cur = inc[0];
  }
  return null;
}

// Legacy compatibility shim used by saveDiagram
function findBranchSideForArrow(arrow) {
  const info = getBranchInfo(arrow);
  if (!info) return null;
  return info.side === 'no' ? 'left' : 'right';
}

function resetConvergeCache() {} // no longer needed, kept for compat

function mountArrow(arrow) {
  const svgEl = document.getElementById('arrows');
  let g = document.getElementById(arrow.id);
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = arrow.id;
    g.style.pointerEvents = 'auto';
    svgEl.appendChild(g);
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
      const incs = arrows.filter(x => x.dstId === cur.srcId);
      if (incs.length !== 1) break;
      cur = incs[0];
    }
    return null;
  }

  const myRootDecId = getImmediateDecId(arrow);

  // All arrows arriving at dst that belong to the same immediate decision
  const allSameRoot = myRootDecId
    ? arrows.filter(a => a.dstId === dst.id && getImmediateDecId(a) === myRootDecId)
    : [];

  // Direct branch exits (left/right port of that decision)
  const directBranches = allSameRoot.filter(a => {
    const s = nodes.find(n => n.id === a.srcId);
    return (a.srcPort === 'left' || a.srcPort === 'right') && s && s.id === myRootDecId;
  });

  const isConverging = directBranches.length >= 2 && allSameRoot.some(a => a.id === arrow.id);

  // ── Compute mergeBarY ────────────────────────────────────
  // Read from decisionLayout (computed by autoLayout, always correct).
  // NOT clamped to dst position — dst can be dragged freely below the bar.
  let mergeBarY = dstTop - V_GAP; // safe fallback for non-converging arrows

  if (isConverging && myRootDecId) {
    const rdl = decisionLayout[myRootDecId];
    if (rdl && rdl.mergeBarY != null) {
      mergeBarY = rdl.mergeBarY;
    } else {
      // decisionLayout not yet populated (first render before autoLayout)
      // Fall back to a position above dst
      mergeBarY = dstTop - Math.round(V_GAP * 1.5);
    }
  }

  // ── iAmThrough: only one arrow draws the final arrowhead into dst ─────────
  // Pick the SI-side (right) direct branch arrow as the "through" arrow.
  let iAmThrough = !isConverging; // single arrows always draw head
  if (isConverging) {
    // Prefer the SI direct branch; among ties pick rightmost source x
    let throughId = directBranches[0]?.id ?? arrow.id;
    let best = -Infinity;
    allSameRoot.forEach(a => {
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
      if (iAmThrough) pts.push([dstCx, dstTop]);
      drawHead = iAmThrough;
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
    // Goes straight down from its bottom to mergeBarY, then across to dstCx
    const pts = dedup([
      [srcCx, srcBot],
      [srcCx, mergeBarY],
      [dstCx, mergeBarY],
    ]);
    if (iAmThrough) pts.push([dstCx, dstTop]);
    drawHead = iAmThrough;
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
    // Compute the X span of the merge bar from all converging sources
    const xs = allSameRoot.map(a => {
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
    const otherArrowId = allSameRoot.find(a => a.id !== arrow.id)?.id || arrow.id;
    barHit.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedTool) { insertAfterMerge(otherArrowId, arrow.id, dst.id); return; }
      selectArrow(arrow.id);
    });
    g.appendChild(barHit);
  }
}

function removeArrowEl(id) { const e = document.getElementById(id); if (e) e.remove(); }
function redrawAllArrows() { arrows.forEach(mountArrow); }

// ═══════════════════════════════════════════════════════
//  DATA CREATION
// ═══════════════════════════════════════════════════════
function mkNode(type, x, y, label) {
  const id   = 'n' + (nodeSeq++);
  const node = { id, type, label, x, y, w: MIN_W, h: MIN_H_NORM };
  nodes.push(node);
  mountNode(node);
  return node;
}

function mkArrow(srcId, dstId, label, srcPort, dstPort) {
  const id    = 'a' + (arrowSeq++);
  const arrow = { id, srcId, dstId, label: label || '', srcPort: srcPort||null, dstPort: dstPort||null };
  arrows.push(arrow);
  resetConvergeCache();
  mountArrow(arrow);
  return arrow;
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
      const siArrow = arrows.find(a => a.srcId === cur.id && a.srcPort === 'left');
      const noArrow = arrows.find(a => a.srcId === cur.id && a.srcPort === 'right');
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
    const incoming = arrows.filter(a => a.dstId === nextNode.id);
    if (incoming.length > 1) {
      // Convergence point — belongs to the trunk, not this branch
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
        // Continue walking from the sub-merge node
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
      const naturalBar = bottomY + Math.round(V_GAP * 0.6);
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
      y = mergeBarYForDec + Math.round(V_GAP * 1.5);

      const mergeId = noBranch.mergeId || siBranch.mergeId;
      if (mergeId && !positioned.has(mergeId)) {
        cur = nodes.find(n => n.id === mergeId);
      } else { break; }

    } else {
      y += cur.h + V_GAP;
      const outArrows = arrows.filter(a => a.srcId === cur.id);
      const nextArrow = outArrows.find(a => !a.srcPort || a.srcPort === 'bottom') || outArrows[0];
      cur = nextArrow ? nodes.find(n => n.id === nextArrow.dstId) : null;
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
    const incoming = arrows.filter(a => a.dstId === nextNode.id);
    if (incoming.length > 1) break; // convergence node — stop
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

  // Normal insert
  const existingArrow = arrows.find(a => a.srcId === afterNodeId && (!a.srcPort || a.srcPort === 'bottom'));
  const newNode = mkNode(selectedTool, afterNode.x, afterNode.y + afterNode.h + V_GAP, DEFAULT_LABELS[selectedTool]);

  if (existingArrow) {
    const oldDstId = existingArrow.dstId;
    removeArrowEl(existingArrow.id);
    arrows = arrows.filter(a => a.id !== existingArrow.id);
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
    removeArrowEl(existingArrow.id);
    arrows = arrows.filter(a => a.id !== existingArrow.id);
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
    removeArrowEl(arrow.id);
    arrows = arrows.filter(a => a.id !== arrow.id);
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

  removeArrowEl(arrow.id);
  arrows = arrows.filter(a => a.id !== arrow.id);

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
function insertAfterMerge(noArrowId, siArrowId, oldDstId) {
  if (!selectedTool) return;
  const noArrow = arrows.find(a => a.id === noArrowId);
  const siArrow = arrows.find(a => a.id === siArrowId);
  if (!noArrow || !siArrow) return;

  if (selectedTool === 'decision') {
    setStatus('No se puede insertar una decisión justo en la barra de unión.');
    return;
  }

  const newNode = mkNode(selectedTool, 0, 0, DEFAULT_LABELS[selectedTool]);

  // Re-point both converging branches to land on the new node instead of the old target.
  noArrow.dstId = newNode.id;
  siArrow.dstId = newNode.id;

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
  const ghost = document.getElementById('ghost');
  const lbl = DEFAULT_LABELS[type];
  const { w, h } = calcNodeSize(type, lbl);
  ghost.style.width  = w + 'px';
  ghost.style.height = h + 'px';
  ghost.innerHTML = buildSVG(type, lbl, w, h);
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
  const ghost = document.getElementById('ghost');
  ghost.style.display = 'none';
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
  const rect = document.getElementById('canvas').getBoundingClientRect();
  dragOX = (e.clientX - rect.left) / zoomLevel - node.x;
  dragOY = (e.clientY - rect.top)  / zoomLevel - node.y;
  e.preventDefault();
}

document.addEventListener('mousemove', e => {
  if (!dragNodeId) return;
  dragActive = true;
  const node = nodes.find(n => n.id === dragNodeId);
  if (!node) return;
  const rect = document.getElementById('canvas').getBoundingClientRect();
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

document.getElementById('canvas-wrap').addEventListener('mousemove', e => {
  const ghost = document.getElementById('ghost');
  if (!selectedTool) { ghost.style.display = 'none'; return; }
  const rect = document.getElementById('canvas').getBoundingClientRect();
  ghost.style.display = 'block';
  ghost.style.left = ((e.clientX - rect.left) / zoomLevel - parseInt(ghost.style.width||'70')/2) + 'px';
  ghost.style.top  = ((e.clientY - rect.top)  / zoomLevel - parseInt(ghost.style.height||'50')/2) + 'px';
});

document.getElementById('canvas').addEventListener('click', e => {
  if (e.target === document.getElementById('canvas') || e.target.closest('svg#arrows')) {
    if (selectedTool) { deselectTool(); setStatus('Inserción cancelada.'); return; }
    clearNodeSel(); clearArrowSel();
  }
});

// ═══════════════════════════════════════════════════════
//  ZOOM
// ═══════════════════════════════════════════════════════
function applyZoom() {
  const canvasEl = document.getElementById('canvas');
  canvasEl.style.transform = `scale(${zoomLevel})`;
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
document.getElementById('canvas-wrap').addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  const mx = e.clientX - rect.left + wrap.scrollLeft;
  const my = e.clientY - rect.top  + wrap.scrollTop;
  const oldZoom = zoomLevel;
  if (e.deltaY < 0) zoomLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 100) / 100);
  else              zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 100) / 100);
  applyZoom();
  const scale = zoomLevel / oldZoom;
  wrap.scrollLeft = mx * scale - (e.clientX - rect.left);
  wrap.scrollTop  = my * scale - (e.clientY - rect.top);
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
  const canvasEl = document.getElementById('canvas');
  const inp = document.createElement('input');
  inp.className = 'node-input';
  inp.value = node.label;
  inp.style.left  = (node.x + 4) + 'px';
  inp.style.top   = (node.y + node.h/2 - 14) + 'px';
  inp.style.width = Math.max(node.w - 8, 80) + 'px';
  canvasEl.appendChild(inp);
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
      const inArrow = arrows.find(a => a.dstId === nodeId);
      const siArrow = arrows.find(a => a.srcId === nodeId && a.srcPort === 'left');
      const noArrow = arrows.find(a => a.srcId === nodeId && a.srcPort === 'right');
      const siBranch = siArrow ? walkBranch(siArrow) : { nodes: [], mergeId: null };
      const noBranch = noArrow ? walkBranch(noArrow) : { nodes: [], mergeId: null };
      const mergeId  = siBranch.mergeId || noBranch.mergeId;
      const branchIds = new Set([...siBranch.nodes, ...noBranch.nodes].map(n => n.id));

      arrows.filter(a => a.srcId === nodeId || a.dstId === nodeId || branchIds.has(a.srcId) || branchIds.has(a.dstId))
        .forEach(a => removeArrowEl(a.id));
      arrows = arrows.filter(a => !(a.srcId === nodeId || a.dstId === nodeId || branchIds.has(a.srcId) || branchIds.has(a.dstId)));

      branchIds.forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
      const el = document.getElementById(nodeId);
      if (el) el.remove();
      nodes = nodes.filter(n => n.id !== nodeId && !branchIds.has(n.id));

      if (inArrow && mergeId) mkArrow(inArrow.srcId, mergeId, '', null, null);

      selectedNodeId = null;
      autoLayout();
      setStatus('Decisión y sus ramas eliminadas.');
      return;
    }

    // A merge-point node (created via insertAfterMerge, or any node two SI/NO
    // branches converge into) has MORE THAN ONE incoming arrow. Deleting it
    // must reconnect ALL of them to whatever followed it, not just one —
    // otherwise the other branch is left dangling with no destination.
    const allIncoming = arrows.filter(a => a.dstId === nodeId);
    const outArrow = arrows.find(a => a.srcId === nodeId && (!a.srcPort || a.srcPort === 'bottom'));

    if (allIncoming.length > 1) {
      arrows.filter(a => a.srcId === nodeId || a.dstId === nodeId).forEach(a => removeArrowEl(a.id));
      arrows = arrows.filter(a => a.srcId !== nodeId && a.dstId !== nodeId);
      if (outArrow) {
        allIncoming.forEach(a => mkArrow(a.srcId, outArrow.dstId, a.label, a.srcPort, a.dstPort));
      }
      const el = document.getElementById(nodeId);
      if (el) el.remove();
      nodes = nodes.filter(n => n.id !== nodeId);
      selectedNodeId = null;
      autoLayout();
      setStatus('Nodo eliminado y ramas reconectadas.');
      return;
    }

    const inArrow  = arrows.find(a => a.dstId === nodeId && (!a.dstPort || a.dstPort !== 'top'));
    // A branch node sits directly after a decision's SI/NO port (dstPort === 'top',
    // srcPort left/right) — its outgoing arrow may itself have any port, but we only
    // need the destination it pointed to so the branch can be wired straight through.
    const branchInArrow = arrows.find(a => a.dstId === nodeId && a.dstPort === 'top' && (a.srcPort === 'left' || a.srcPort === 'right'));
    arrows.filter(a => a.srcId === nodeId || a.dstId === nodeId).forEach(a => removeArrowEl(a.id));
    arrows = arrows.filter(a => a.srcId !== nodeId && a.dstId !== nodeId);
    if (inArrow && outArrow) {
      mkArrow(inArrow.srcId, outArrow.dstId);
    } else if (branchInArrow && outArrow) {
      // Reconnect the decision straight to whatever the deleted branch node led to,
      // restoring the original SI/NO label/port so it renders as a direct branch again.
      mkArrow(branchInArrow.srcId, outArrow.dstId, branchInArrow.label, branchInArrow.srcPort, 'top');
    }
    const el = document.getElementById(nodeId);
    if (el) el.remove();
    nodes = nodes.filter(n => n.id !== nodeId);
    selectedNodeId = null;
    autoLayout();
    setStatus('Nodo eliminado.');
  } else if (selectedArrowId) {
    removeArrowEl(selectedArrowId);
    arrows = arrows.filter(a => a.id !== selectedArrowId);
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
  document.getElementById('modal-overlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
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
  const canvasEl = document.getElementById('canvas');
  canvasEl.querySelectorAll('.node').forEach(el => el.remove());

  // Remove all arrow <g> elements from SVG (keep <defs>)
  const svgEl = document.getElementById('arrows');
  Array.from(svgEl.childNodes).forEach(child => {
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
    document.getElementById('ghost').style.display = 'none';
  }

  // Re-init
  initDiagram();
  setStatus('Diagrama reiniciado correctamente.');
}

// Close modal if clicking outside box
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ═══════════════════════════════════════════════════════
//  SAVE AS SVG
// ═══════════════════════════════════════════════════════
function saveDiagram() {
  if (!nodes.length) { setStatus('No hay nada que guardar.'); return; }
  resetConvergeCache();
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(n => {
    minX=Math.min(minX,n.x); minY=Math.min(minY,n.y);
    maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+n.h);
  });
  const pad=60, W=maxX-minX+pad*2, H=maxY-minY+pad*2, ox=minX-pad, oy=minY-pad;
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${ox} ${oy} ${W} ${H}">
<defs><marker id="ah" markerWidth="8" markerHeight="5.6" refX="7.2" refY="2.8" orient="auto">
  <polygon points="0 0,8 2.8,0 5.6" fill="#3a7bd5"/></marker></defs>
<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="#f5f8ff"/>
`;
  arrows.forEach(arrow => {
    const src=nodes.find(n=>n.id===arrow.srcId), dst=nodes.find(n=>n.id===arrow.dstId);
    if (!src||!dst) return;

    const sxCx = src.x + src.w / 2, sxBy = src.y + src.h;
    const dxCx = dst.x + dst.w / 2, dxTy = dst.y;

    // Detect convergence
    const allToTop2 = arrows.filter(a => a.dstId === dst.id && a.dstPort === 'top');
    const branches2 = allToTop2.filter(a => !!getBranchInfo(a));
    const isConv2   = branches2.length >= 2 && branches2.some(a => a.id === arrow.id);

    let mergeBarY2 = dst.y - 22;
    if (isConv2) {
      let maxSB = 0;
      branches2.forEach(a => { const s=nodes.find(n=>n.id===a.srcId); if(s) maxSB=Math.max(maxSB,s.y+s.h); });
      mergeBarY2 = Math.min(maxSB + Math.round(V_GAP*0.4), dst.y - 22);
    }

    let throughId2 = branches2[0]?.id;
    if (isConv2) {
      let best2 = -Infinity;
      branches2.forEach(a => {
        const info2=getBranchInfo(a), s2=nodes.find(n=>n.id===a.srcId);
        const sc2=(info2&&info2.side==='si'?10000:0)+(s2?s2.x+s2.w/2:0);
        if(sc2>best2){best2=sc2;throughId2=a.id;}
      });
    }
    const iAmThrough2 = !isConv2 || arrow.id === throughId2;

    let pathD2, lx2, ly2, drawHead2=true;

    if (isConv2) {
      const pts=[[sxCx,sxBy],[sxCx,mergeBarY2],[dxCx,mergeBarY2]];
      if(iAmThrough2) pts.push([dxCx,dxTy]);
      drawHead2=iAmThrough2;
      const npts=pts.filter((p,i,a)=>i===0||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
      pathD2='M'+npts.map(p=>p[0]+','+p[1]).join(' L');
      lx2=(sxCx+dxCx)/2; ly2=mergeBarY2-13;
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
function setStatus(msg) { document.getElementById('status-bar').textContent = msg; }

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
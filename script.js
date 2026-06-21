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
const V_GAP      = 40;
const H_GAP      = 80;   // horizontal gap for decision branches
const COL_X      = 380;  // center x of main chain
const SIDE_STUB  = 34;   // how far SI/NO lines stick out to the side before turning down

const ZOOM_MIN  = 0.3;
const ZOOM_MAX  = 2;
const ZOOM_STEP = 0.1;

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
//  ARROW DOM
// ═══════════════════════════════════════════════════════
function getPort(node, dir) {
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
  if (dir === 'top')    return { x: cx, y: node.y };
  if (dir === 'bottom') return { x: cx, y: node.y + node.h };
  if (dir === 'left')   return { x: node.x, y: cy };
  if (dir === 'right')  return { x: node.x + node.w, y: cy };
}

function bestDirs(src, dst) {
  const dy = (dst.y + dst.h/2) - (src.y + src.h/2);
  const dx = (dst.x + dst.w/2) - (src.x + src.w/2);
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ['bottom','top'] : ['top','bottom'];
  return dx >= 0 ? ['right','left'] : ['left','right'];
}

// For an arrow ending at `dst` via its top port, figure out whether it is the
// final segment of a decision's SI or NO branch (whether or not that branch
// passes through inserted shapes first). Returns 'left' | 'right' | null —
// matching the originating srcPort of the branch — so converging SI/NO lines
// that both land on the same node's top port can be offset apart instead of
// drawing two arrowheads on the exact same pixel.
function findBranchSideForArrow(arrow) {
  if (arrow.dstPort !== 'top') return null;
  // Direct branch: the arrow itself leaves a decision via left/right.
  if ((arrow.srcPort === 'left' || arrow.srcPort === 'right')) {
    const src = nodes.find(n => n.id === arrow.srcId);
    if (src && src.type === 'decision') return arrow.srcPort;
  }
  // Otherwise, walk backwards through the chain to see if it originates
  // from a decision's left/right port without passing through another merge.
  let cur = arrow;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const src = nodes.find(n => n.id === cur.srcId);
    if (src && src.type === 'decision' && (cur.srcPort === 'left' || cur.srcPort === 'right')) {
      return cur.srcPort;
    }
    // Step back: find the arrow that feeds into cur's source node, but only
    // if that source node has exactly one incoming arrow (i.e. is purely
    // part of this branch's linear chain, not itself a convergence point).
    const incomingToSrc = arrows.filter(a => a.dstId === cur.srcId);
    if (incomingToSrc.length !== 1) return null;
    cur = incomingToSrc[0];
  }
  return null;
}

// Given a destination node + port, return a small x-offset to apply so that
// converging SI and NO branch arrows land on visually distinct points instead
// of overlapping. Returns 0 unless both a left-branch and right-branch arrow
// are found converging on the same node via the same port.
const CONVERGE_OFFSET = 16;
function getConvergeOffset(arrow, dst, dd) {
  if (dd !== 'top') return 0;
  const side = findBranchSideForArrow(arrow);
  if (!side) return 0;
  const others = arrows.filter(a => a.id !== arrow.id && a.dstId === arrow.dstId && a.dstPort === 'top');
  const hasOpposite = others.some(a => findBranchSideForArrow(a) === (side === 'left' ? 'right' : 'left'));
  if (!hasOpposite) return 0;
  // NO branches approach from the left, so they enter left-of-center; SI from the right.
  return side === 'left' ? -CONVERGE_OFFSET : CONVERGE_OFFSET;
}

function mountArrow(arrow) {
  const svgEl = document.getElementById('arrows');
  let g = document.getElementById(arrow.id);
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = arrow.id;
    g.style.cursor = 'pointer';
    g.style.pointerEvents = 'auto';
    svgEl.appendChild(g);
  }
  // Rebuilt on every render: the merge-bar hit area (if any) needs to know
  // the CURRENT sibling arrow id, so the whole listener set is reattached
  // fresh each time rather than reused from a stale closure.
  g.replaceChildren();

  const src = nodes.find(n => n.id === arrow.srcId);
  const dst = nodes.find(n => n.id === arrow.dstId);
  if (!src || !dst) return;

  // If arrow has explicit ports, use them; otherwise auto-detect
  const sd = arrow.srcPort || bestDirs(src, dst)[0];
  const dd = arrow.dstPort || bestDirs(src, dst)[1];
  const sp = getPort(src, sd), dp = getPort(dst, dd);

  const sel = selectedArrowId === arrow.id;
  const col = sel ? '#f0a500' : '#5b9cf6';
  const mk  = sel ? 'url(#ahs)' : 'url(#ah)';

  // Any SI/NO branch leaving a decision via its left/right port always exits
  // with a short side "stub" before turning down — this matches the reference
  // design and keeps the SI and NO lines visually distinct from each other,
  // whether or not the sibling branch shares the same destination.
  let isDecisionBranch = false, isMergedBranch = false, siblingPort = null, mergeSiblingArrowId = null;
  if ((sd === 'left' || sd === 'right') && src.type === 'decision') {
    isDecisionBranch = true;
    siblingPort = sd === 'left' ? 'right' : 'left';
    const sibling = arrows.find(a => a.srcId === src.id && a.dstId === dst.id && a.srcPort === siblingPort);
    if (sibling) { isMergedBranch = true; mergeSiblingArrowId = sibling.id; }
  }

  // Converging SI/NO branches that are NOT a pure direct merge (i.e. at least
  // one side passes through its own inserted shape before reaching the
  // shared destination) must still visually JOIN into a single line above the
  // destination, just like a pure merge does — not draw two separate
  // arrowheads side by side, and not bend at two different heights (which
  // makes the "join" look like it happens at a random point). We find the
  // "stop" side (NO/left — its line simply ends flush at the shared bend
  // point, no arrowhead) and the "through" side (SI/right — its line
  // continues straight down from that same bend point into the
  // destination's top port, carrying the only arrowhead). Both sides bend
  // at exactly the same height so the join reads as one clean line.
  let mergeRole = null, mergePartner = null;
  if (!isMergedBranch && dd === 'top') {
    const side = findBranchSideForArrow(arrow);
    if (side) {
      mergePartner = arrows.find(a => a.id !== arrow.id && a.dstId === arrow.dstId && a.dstPort === 'top' &&
        findBranchSideForArrow(a) === (side === 'left' ? 'right' : 'left'));
      if (mergePartner) { mergeRole = side === 'left' ? 'stop' : 'through'; mergeSiblingArrowId = mergePartner.id; }
    }
  }
  const mergeX = dp.x;
  // mergeBendY: altura donde las dos ramas se unen horizontalmente antes de bajar al destino.
  // Calculamos primero el candidato ideal y luego lo acotamos para que nunca quede
  // encima ni dentro del nodo destino (dp.y - 12 garantiza al menos 12 px de espacio).
  let mergeBendY = dst.y - 18;
  if (mergeRole && mergePartner) {
    const partnerSrc = nodes.find(n => n.id === mergePartner.srcId);
    if (partnerSrc) {
      mergeBendY = Math.max(src.y + src.h, partnerSrc.y + partnerSrc.h) + V_GAP / 2;
    }
  }
  // Safety clamp: nunca sobrepasar el top del nodo destino
  mergeBendY = Math.min(mergeBendY, dp.y - 12);

  let pathD, labelX, labelY, drawArrowhead = true;
  let mergeBarSeg = null; // [x1, x2, y] of this arrow's half of the SI/NO join bar, if any

  if (isMergedBranch) {
    const cy    = src.y + src.h / 2;
    const cx    = src.x + src.w / 2;
    // mY: punto de doblez horizontal donde ambas ramas convergen.
    // Nunca puede sobrepasar el nodo destino (dp.y - 12) para evitar
    // que la línea se doble dentro o encima del nodo cuando las ramas están vacías.
    const mY    = Math.min(src.y + src.h + V_GAP / 2, dp.y - 12);
    const sideX = sd === 'left' ? src.x - SIDE_STUB : src.x + src.w + SIDE_STUB;

    if (sd === 'left') {
      // Rama NO: sale izquierda, baja hasta mY, llega al centro horizontal — sin flecha
      pathD = `M${sp.x},${sp.y} L${sideX},${cy} L${sideX},${mY} L${cx},${mY}`;
      drawArrowhead = false;
    } else {
      // Rama SI: sale derecha, baja hasta mY, cruza al centro, baja al destino.
      // Filtramos duplicados consecutivos para que el arrowhead apunte siempre hacia abajo.
      const pts = [
        [sp.x, sp.y],
        [sideX, cy],
        [sideX, mY],
        [cx, mY],
        [cx, dp.y],
        [dp.x, dp.y]
      ].filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]);
      pathD = 'M' + pts.map(p => p.join(',')).join(' L');
      drawArrowhead = true;
    }
    labelX = (sp.x + sideX) / 2;
    labelY = cy - 10;
    // La barra de unión va desde el stub lateral hasta el centro de la decisión
    mergeBarSeg = [sideX, cx, mY];
  } else if (isDecisionBranch) {
    // Branch leaving a decision via a side stub. Always finish with a
    // straight vertical drop into the destination's port (never a sideways
    // entry) so the arrowhead points cleanly downward: turn from the side
    // stub onto the destination's x BEFORE descending, so the final segment
    // is always vertical. If this branch converges with its sibling further
    // down (mergeRole set), bend at the shared mergeBendY instead.
    const cy      = src.y + src.h / 2;
    const sideX   = sd === 'left' ? src.x - SIDE_STUB : src.x + src.w + SIDE_STUB;
    let pts;
    if (mergeRole) {
      pts = [[sp.x, sp.y], [sideX, cy], [sideX, mergeBendY], [mergeX, mergeBendY]];
      if (mergeRole === 'through') pts.push([dp.x, dp.y]);
      drawArrowhead = mergeRole === 'through';
      mergeBarSeg = [sideX, mergeX, mergeBendY];
    } else {
      // No convergence: ir de sp al punto de quiebre y luego a dp.x.
      // Solo usamos el stub (sideX) si el destino está más allá de él en la misma
      // dirección — si está más cerca, saltamos el stub para evitar que la línea
      // se extienda innecesariamente lejos del nodo antes de doblar.
      const useStub = sd === 'left' ? dp.x <= sideX : dp.x >= sideX;
      const turnX = useStub ? sideX : sp.x;
      pts = [[sp.x, sp.y], [turnX, cy], [dp.x, cy], [dp.x, dp.y]];
    }
    pathD = 'M' + pts.filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]).map(p => p.join(',')).join(' L');
    labelX = sideX + (sd === 'left' ? -14 : 14);
    labelY = cy - 10;
  } else if (sd === 'left' || sd === 'right') {
    // Elbow: go horizontal then vertical, always ending with a vertical drop
    let pts;
    if (mergeRole) {
      pts = [[sp.x, sp.y], [mergeX, sp.y], [mergeX, mergeBendY]];
      if (mergeRole === 'through') pts.push([dp.x, dp.y]);
      drawArrowhead = mergeRole === 'through';
      mergeBarSeg = [sp.x, mergeX, mergeBendY];
    } else {
      pts = [[sp.x, sp.y], [dp.x, sp.y], [dp.x, dp.y]];
    }
    pathD = 'M' + pts.filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]).map(p => p.join(',')).join(' L');
    labelX = (sp.x + dp.x) / 2;
    labelY = sp.y - 10;
  } else if (sp.x === dp.x && !mergeRole) {
    // Perfectly aligned vertically — single straight line
    pathD = `M${sp.x},${sp.y} L${dp.x},${dp.y}`;
    labelX = (sp.x + dp.x) / 2;
    labelY = (sp.y + dp.y) / 2 - 8;
  } else {
    // Vertical-ish but offset horizontally — straight elbow (no curve), always ending vertically.
    // If converging with a sibling branch, bend at the shared mergeBendY instead of the midpoint.
    let pts;
    if (mergeRole) {
      pts = [[sp.x, sp.y], [sp.x, mergeBendY], [mergeX, mergeBendY]];
      if (mergeRole === 'through') pts.push([dp.x, dp.y]);
      drawArrowhead = mergeRole === 'through';
      mergeBarSeg = [sp.x, mergeX, mergeBendY];
    } else {
      const my = (sp.y + dp.y) / 2;
      pts = [[sp.x, sp.y], [sp.x, my], [dp.x, my], [dp.x, dp.y]];
    }
    pathD = 'M' + pts.filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]).map(p => p.join(',')).join(' L');
    labelX = (sp.x + dp.x) / 2;
    labelY = (sp.y + dp.y) / 2 - 8;
  }

  const mk2 = drawArrowhead ? mk : 'none';

  const labelSVG = arrow.label
    ? `<rect x="${labelX - arrow.label.length*3.5 - 3}" y="${labelY - 10}" width="${arrow.label.length*7 + 6}" height="16" rx="3" fill="#1e2d50" opacity="0.85"/>
       <text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="central"
         font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#7ec8ff">${xmlEsc(arrow.label)}</text>`
    : '';

  g.innerHTML = `
    <path d="${pathD}" stroke="${col}" stroke-width="2.5" fill="none" marker-end="${mk2}"/>
    ${labelSVG}`;

  // Hit area for the rest of the line (inserts INSIDE the branch / on the trunk).
  // Added first so the merge-bar hit area below sits on top of it where they overlap.
  const lineHit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  lineHit.setAttribute('d', pathD);
  lineHit.setAttribute('stroke', 'transparent');
  lineHit.setAttribute('stroke-width', '14');
  lineHit.setAttribute('fill', 'none');
  lineHit.style.pointerEvents = 'auto';
  lineHit.addEventListener('click', e => {
    e.stopPropagation();
    if (selectedTool) { insertOnArrow(arrow.id); return; }
    selectArrow(arrow.id);
  });
  g.appendChild(lineHit);

  // Hit area for the SI/NO join bar (if this arrow has one): a separate
  // clickable strip covering just the horizontal merge segment, layered on
  // top of the general line-hit area so it wins where they overlap. Clicking
  // here inserts the new shape AFTER the merge, outside both decision
  // branches — distinct from clicking the rest of the line, which inserts
  // INSIDE the branch as before.
  if (mergeBarSeg && mergeSiblingArrowId) {
    const [bx1, bx2, by] = mergeBarSeg;
    const barHit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    barHit.setAttribute('d', `M${bx1},${by} L${bx2},${by}`);
    barHit.setAttribute('stroke', 'transparent');
    barHit.setAttribute('stroke-width', '16');
    barHit.setAttribute('fill', 'none');
    barHit.style.pointerEvents = 'auto';
    barHit.style.cursor = selectedTool ? 'crosshair' : 'pointer';
    const noId = sd === 'left' || mergeRole === 'stop' ? arrow.id : mergeSiblingArrowId;
    const siId = sd === 'left' || mergeRole === 'stop' ? mergeSiblingArrowId : arrow.id;
    barHit.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedTool) { insertAfterMerge(noId, siId, dst.id); return; }
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
//  Positions a linear chain starting at `cur`, using centerX as the
//  horizontal center column and startY as the top. Returns the Y
//  coordinate immediately after the last node it placed, so the
//  caller knows where to continue.
// ═══════════════════════════════════════════════════════
function layoutChain(cur, centerX, startY, positioned) {
  let y = startY;
  const seen = new Set();

  while (cur && !positioned.has(cur.id)) {
    if (seen.has(cur.id)) break; // cycle guard
    seen.add(cur.id);
    positioned.add(cur.id);

    cur.x = centerX - cur.w / 2;
    cur.y = y;
    updateNodePos(cur);

    if (cur.type === 'decision') {
      const siArrow = arrows.find(a => a.srcId === cur.id && a.srcPort === 'left');
      const noArrow = arrows.find(a => a.srcId === cur.id && a.srcPort === 'right');
      const siBranch = siArrow ? walkBranch(siArrow) : { nodes: [], mergeId: null };
      const noBranch = noArrow ? walkBranch(noArrow) : { nodes: [], mergeId: null };

      const branchTopY = y + cur.h + V_GAP;

      // Left branch (NO): centered to the LEFT of the decision
      const leftCenterX = centerX - H_GAP - 75; // 75 ≈ half of typical branch node width
      const ly = layoutBranchNodes(siArrow, siBranch.nodes, leftCenterX, branchTopY, positioned);

      // Right branch (SI): centered to the RIGHT of the decision
      const rightCenterX = centerX + H_GAP + 75;
      const ry = layoutBranchNodes(noArrow, noBranch.nodes, rightCenterX, branchTopY, positioned);

      const mergeId = siBranch.mergeId || noBranch.mergeId;
      y = Math.max(ly, ry, branchTopY);

      if (mergeId && !positioned.has(mergeId)) {
        cur = nodes.find(n => n.id === mergeId);
      } else {
        break;
      }
    } else {
      y += cur.h + V_GAP;
      const outArrows = arrows.filter(a => a.srcId === cur.id);
      const nextArrow = outArrows.find(a => !a.srcPort || a.srcPort === 'bottom') || outArrows[0];
      cur = nextArrow ? nodes.find(n => n.id === nextArrow.dstId) : null;
    }
  }
  return y;
}

// Lays out the nodes of a single branch (SI or NO), recursing into any
// nested decisions. Returns the Y coordinate after the last node placed.
function layoutBranchNodes(branchStartArrow, branchNodes, centerX, startY, positioned) {
  if (!branchStartArrow) return startY;
  // Walk the branch arrow by arrow so nested decisions get recursive treatment
  let y = startY;
  let arrow = branchStartArrow;
  const seen = new Set();

  while (arrow && arrow.dstId) {
    if (seen.has(arrow.id)) break;
    seen.add(arrow.id);

    const nextNode = nodes.find(n => n.id === arrow.dstId);
    if (!nextNode) break;
    // Stop at the convergence point
    const incoming = arrows.filter(a => a.dstId === nextNode.id);
    if (incoming.length > 1) break;
    if (positioned.has(nextNode.id)) break;

    // Use layoutChain for recursive handling of nested decisions
    y = layoutChain(nextNode, centerX, y, positioned);

    // After layoutChain places nextNode (and its subtree), find the
    // continuation arrow from the LAST positioned node in this branch.
    // layoutChain already advanced y; we just need the next arrow.
    const outArrows = arrows.filter(a => a.srcId === nextNode.id && (!a.srcPort || a.srcPort === 'bottom'));
    arrow = outArrows.length ? outArrows[0] : null;
    // If node was a decision, layoutChain consumed its sub-tree and returned
    // past the merge node — the merge node is now `positioned`, so the
    // next iteration's positioned.has check will stop us cleanly.
    if (nextNode.type === 'decision') {
      const subSi = arrows.find(a => a.srcId === nextNode.id && a.srcPort === 'left');
      const subNo = arrows.find(a => a.srcId === nextNode.id && a.srcPort === 'right');
      const subSiBranch = subSi ? walkBranch(subSi) : { mergeId: null };
      const subNoBranch = subNo ? walkBranch(subNo) : { mergeId: null };
      const subMergeId = subSiBranch.mergeId || subNoBranch.mergeId;
      if (subMergeId) {
        arrow = arrows.find(a => a.srcId === subMergeId && (!a.srcPort || a.srcPort === 'bottom')) || null;
      } else {
        break;
      }
    }
  }
  return y;
}

function autoLayout() {
  const start = nodes.find(n => n.label === 'Inicio') ||
                nodes.find(n => n.type === 'terminal') ||
                nodes[0];
  if (!start) { redrawAllArrows(); return; }

  const positioned = new Set();
  layoutChain(start, COL_X, 80, positioned);

  // Truly orphaned nodes (not reachable from Inicio)
  nodes.filter(n => !positioned.has(n.id)).forEach((node, i) => {
    node.x = COL_X + 380;
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

  // decision → oldDst directly via SI (left) and NO (right) lines — no process boxes yet.
  // Later: select a shape and click on one of these lines to insert it there.
  if (oldDstId) {
    mkArrow(dec.id, oldDstId, 'NO', 'left',  'top');
    mkArrow(dec.id, oldDstId, 'SI', 'right', 'top');
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
    mkArrow(dec.id, dstId, 'NO', 'left',  'top');
    mkArrow(dec.id, dstId, 'SI', 'right', 'top');
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
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(n => {
    minX=Math.min(minX,n.x); minY=Math.min(minY,n.y);
    maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+n.h);
  });
  const pad=60, W=maxX-minX+pad*2, H=maxY-minY+pad*2, ox=minX-pad, oy=minY-pad;
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${ox} ${oy} ${W} ${H}">
<defs><marker id="ah" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
  <polygon points="0 0,10 3.5,0 7" fill="#3a7bd5"/></marker></defs>
<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="#f5f8ff"/>
`;
  arrows.forEach(arrow => {
    const src=nodes.find(n=>n.id===arrow.srcId), dst=nodes.find(n=>n.id===arrow.dstId);
    if (!src||!dst) return;
    const sd = arrow.srcPort || bestDirs(src,dst)[0];
    const dd = arrow.dstPort || bestDirs(src,dst)[1];
    const sp=getPort(src,sd), dp=getPort(dst,dd);

    let isDecisionBranch = false, isMergedBranch = false;
    if ((sd==='left'||sd==='right') && src.type==='decision') {
      isDecisionBranch = true;
      const siblingPort = sd==='left' ? 'right' : 'left';
      if (arrows.find(a => a.srcId===src.id && a.dstId===dst.id && a.srcPort===siblingPort)) isMergedBranch = true;
    }

    let mergeRole = null, mergePartner = null;
    if (!isMergedBranch && dd === 'top') {
      const side = findBranchSideForArrow(arrow);
      if (side) {
        mergePartner = arrows.find(a => a.id !== arrow.id && a.dstId === arrow.dstId && a.dstPort === 'top' &&
          findBranchSideForArrow(a) === (side === 'left' ? 'right' : 'left'));
        if (mergePartner) mergeRole = side === 'left' ? 'stop' : 'through';
      }
    }
    const mergeX = dp.x;
    let mergeBendY = dst.y - 18;
    if (mergeRole && mergePartner) {
      const partnerSrc = nodes.find(n => n.id === mergePartner.srcId);
      if (partnerSrc) mergeBendY = Math.max(src.y + src.h, partnerSrc.y + partnerSrc.h) + V_GAP / 2;
    }
    mergeBendY = Math.min(mergeBendY, dp.y - 12);

    let pathD, lx, ly, drawHead = true;
    if (isMergedBranch) {
      const cy = src.y + src.h/2, cx = src.x + src.w/2;
      const mY = Math.min(src.y + src.h + V_GAP/2, dp.y - 12);
      const sideX = sd==='left' ? src.x - SIDE_STUB : src.x + src.w + SIDE_STUB;
      if (sd==='left') {
        pathD = `M${sp.x},${sp.y} L${sideX},${cy} L${sideX},${mY} L${cx},${mY}`;
        drawHead = false;
      } else {
        const pts = [
          [sp.x, sp.y], [sideX, cy], [sideX, mY],
          [cx, mY], [cx, dp.y], [dp.x, dp.y]
        ].filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]);
        pathD = 'M' + pts.map(p => p.join(',')).join(' L');
        drawHead = true;
      }
      lx = (sp.x+sideX)/2; ly = cy-10;
    } else if (isDecisionBranch) {
      const cy = src.y + src.h/2;
      const sideX = sd==='left' ? src.x - SIDE_STUB : src.x + src.w + SIDE_STUB;
      let pts;
      if (mergeRole) {
        pts = [[sp.x, sp.y], [sideX, cy], [sideX, mergeBendY], [mergeX, mergeBendY]];
        if (mergeRole === 'through') pts.push([dp.x, dp.y]);
        drawHead = mergeRole === 'through';
      } else {
        const useStub = sd==='left' ? dp.x <= sideX : dp.x >= sideX;
        const turnX = useStub ? sideX : sp.x;
        pts = [[sp.x, sp.y], [turnX, cy], [dp.x, cy], [dp.x, dp.y]];
      }
      pathD = 'M' + pts.filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]).map(p => p.join(',')).join(' L');
      lx = sideX + (sd==='left' ? -14 : 14); ly = cy-10;
    } else if (sd==='left'||sd==='right') {
      let pts;
      if (mergeRole) {
        pts = [[sp.x, sp.y], [mergeX, sp.y], [mergeX, mergeBendY]];
        if (mergeRole === 'through') pts.push([dp.x, dp.y]);
        drawHead = mergeRole === 'through';
      } else {
        pts = [[sp.x, sp.y], [dp.x, sp.y], [dp.x, dp.y]];
      }
      pathD = 'M' + pts.filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]).map(p => p.join(',')).join(' L');
      lx=(sp.x+dp.x)/2; ly=sp.y-10;
    } else if (sp.x === dp.x && !mergeRole) {
      pathD = `M${sp.x},${sp.y} L${dp.x},${dp.y}`;
      lx=(sp.x+dp.x)/2; ly=(sp.y+dp.y)/2-8;
    } else {
      let pts;
      if (mergeRole) {
        pts = [[sp.x, sp.y], [sp.x, mergeBendY], [mergeX, mergeBendY]];
        if (mergeRole === 'through') pts.push([dp.x, dp.y]);
        drawHead = mergeRole === 'through';
      } else {
        const my=(sp.y+dp.y)/2;
        pts = [[sp.x, sp.y], [sp.x, my], [dp.x, my], [dp.x, dp.y]];
      }
      pathD = 'M' + pts.filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]).map(p => p.join(',')).join(' L');
      lx=(sp.x+dp.x)/2; ly=(sp.y+dp.y)/2-8;
    }
    svg+=`<path d="${pathD}" stroke="#3a7bd5" stroke-width="2.5" fill="none" ${drawHead ? 'marker-end="url(#ah)"' : ''}/>\n`;
    if (arrow.label) {
      svg+=`<text x="${lx}" y="${ly}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#3a7bd5">${xmlEsc(arrow.label)}</text>\n`;
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
/* Quarto-klient.
   Arkitektur: servern är auktoritativ, men egna drag appliceras optimistiskt
   direkt vid tryck (servern bekräftar tyst med samma resultat). DOM:en byggs
   en gång och uppdateras på plats — inga omrenderingar, inga layoutskift.
   Pjäser flyger med FLIP-animation mellan förråd → hand → bräde. */

const socket = io();

const PLAYERS = ['Emreos', 'Raquel'];
const AVATARS = { Emreos: 'emreos.jpg', Raquel: 'raquel.jpg' };

const BOT_NAME = 'Don Quartolomé';
const BOT_AVATAR = 'quartolome.jpg';
const BOT_LEVELS = { easy: 'lätt', medium: 'medel', hard: 'svår' };

let me = null;
let mode = null;     // 'online' | 'bot' — väljs i lobbyn
let conn = socket;   // aktiv spelkanal: socket eller lokal botsession
let botLevel = null;

// Matchformat: först till så här många vunna partier tar hela matchen.
const MATCH_TARGET = 5;

// Ljud (och vibration) kan stängas av; valet sparas mellan besök.
let soundEnabled = true;
try { soundEnabled = localStorage.getItem('quarto.muted') !== '1'; } catch (e) { /* lagring ej kritisk */ }

// I botläget sitter boten på motståndarens plats; visa den med eget
// namn och porträtt i stället för platsens riktiga namn.
function displayName(p) {
  return mode === 'bot' && p !== me ? BOT_NAME : p;
}
function avatarFor(p) {
  return mode === 'bot' && p !== me ? BOT_AVATAR : AVATARS[p];
}

let auth = null;      // senaste tillstånd från servern
let predicted = null; // optimistiskt tillstånd efter eget drag, tills servern bekräftat
let view = null;      // det tillstånd som just nu visas i DOM
let lastSeq = -1;

const $ = (id) => document.getElementById(id);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function opponent() { return me === PLAYERS[0] ? PLAYERS[1] : PLAYERS[0]; }
function effective() { return predicted || auth; }

// ---------- Pjäsgrafik ----------
// Pjäs-id är 4 bitar: bit0 mörk, bit1 hög, bit2 fyrkantig, bit3 ihålig.
// Polerade objekt i sidovy: champagne-metall mot espresso-grafit. Kroppen
// skuggas som en cylinder (mörk kant → ljus dager → mörk skuggsida), toppen
// fångar mest ljus, en mjuk reflex löper längs sidan, en nedre ambient­ocklusion
// tyngder foten och en inbäddad kontaktskugga jordar pjäsen. Allt ritas i
// vektor utan oskärpefilter, så skuggorna förblir skarpa även på mobil/retina.

let svgGradSeq = 0;

function pieceSVG(id) {
  const dark = id & 1;
  const tall = id & 2;
  const square = id & 4;
  const hollow = id & 8;

  // Unikt id-prefix per SVG-instans. Samma pjäs kan finnas i förråd, hand,
  // bräde och flygande klon samtidigt — delade id:n vore ogiltig HTML.
  const u = `q${id}_${svgGradSeq++}`;

  const c = dark
    ? {
        edge: '#211c16', hi: '#776d61', mid: '#39332c', edge2: '#100d0a',
        topCtr: '#8c8174', topRim: '#221d17', stroke: '#0b0907',
        hole: '#070504', holeDeep: '#000000', holeRim: 'rgba(232, 224, 206, 0.5)',
        spec: '#fffaf0', specA: 0.5, aoCol: '#000000', aoA: 0.5,
        shCol: '#080604', shA: 0.5,
      }
    : {
        edge: '#a37c3d', hi: '#fdf1c8', mid: '#cca25b', edge2: '#6d5020',
        topCtr: '#fff7e0', topRim: '#bd934c', stroke: '#5a4317',
        hole: '#3a2a0b', holeDeep: '#221806', holeRim: 'rgba(255, 247, 224, 0.85)',
        spec: '#fffdf6', specA: 0.85, aoCol: '#4a3411', aoA: 0.42,
        shCol: '#3c2a0d', shA: 0.5,
      };

  const topY = tall ? 7 : 41; // överdriven höjdskillnad gör hög/låg omisskännlig
  const h = 66 - topY;
  const bodyTop = topY + 5; // där tubväggen börjar (under toppellipsen)
  const wallH = h - 12;     // rak väggdel

  let defs = '<defs>';
  // Cylinderskuggning över kroppens bredd.
  defs += `<linearGradient id="b${u}" x1="0" y1="0" x2="1" y2="0">`
    + `<stop offset="0" stop-color="${c.edge}"/>`
    + `<stop offset="0.24" stop-color="${c.hi}"/>`
    + `<stop offset="0.52" stop-color="${c.mid}"/>`
    + `<stop offset="1" stop-color="${c.edge2}"/></linearGradient>`;
  // Ambientocklusion: mörknar mot foten.
  defs += `<linearGradient id="a${u}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0.4" stop-color="${c.aoCol}" stop-opacity="0"/>`
    + `<stop offset="1" stop-color="${c.aoCol}" stop-opacity="${c.aoA}"/></linearGradient>`;
  // Mjukkantad reflex.
  defs += `<linearGradient id="s${u}" x1="0" y1="0" x2="1" y2="0">`
    + `<stop offset="0" stop-color="${c.spec}" stop-opacity="0"/>`
    + `<stop offset="0.5" stop-color="${c.spec}" stop-opacity="${c.specA}"/>`
    + `<stop offset="1" stop-color="${c.spec}" stop-opacity="0"/></linearGradient>`;
  // Kontaktskugga (radiell, tonar ut till genomskinligt).
  defs += `<radialGradient id="h${u}" cx="0.5" cy="0.5" r="0.5">`
    + `<stop offset="0" stop-color="${c.shCol}" stop-opacity="${c.shA}"/>`
    + `<stop offset="0.6" stop-color="${c.shCol}" stop-opacity="${c.shA * 0.4}"/>`
    + `<stop offset="1" stop-color="${c.shCol}" stop-opacity="0"/></radialGradient>`;
  // Topp: rund pjäs får svarvad lyster, fyrkantig en sned fasning.
  if (square) {
    defs += `<linearGradient id="t${u}" x1="0.1" y1="0" x2="0.9" y2="1">`
      + `<stop offset="0" stop-color="${c.topCtr}"/>`
      + `<stop offset="1" stop-color="${c.topRim}"/></linearGradient>`;
  } else {
    defs += `<radialGradient id="t${u}" cx="0.4" cy="0.32" r="0.9">`
      + `<stop offset="0" stop-color="${c.topCtr}"/>`
      + `<stop offset="1" stop-color="${c.topRim}"/></radialGradient>`;
  }
  if (hollow) {
    defs += `<radialGradient id="o${u}" cx="0.5" cy="0.62" r="0.72">`
      + `<stop offset="0" stop-color="${c.holeDeep}"/>`
      + `<stop offset="1" stop-color="${c.hole}"/></radialGradient>`;
  }
  defs += '</defs>';

  // Kontaktskugga bakom pjäsen — vektor, ingen oskärpa → skarp på mobil.
  let s = `<ellipse cx="24" cy="67" rx="${square ? 20 : 18.5}" ry="5" fill="url(#h${u})"/>`;

  if (square) {
    s += `<rect x="6.5" y="${topY}" width="35" height="${h}" rx="3.6" fill="url(#b${u})" stroke="${c.stroke}" stroke-width="1.3"/>`;
    s += `<rect x="6.5" y="${topY}" width="35" height="${h}" rx="3.6" fill="url(#a${u})"/>`;
    s += `<rect x="6.5" y="${topY}" width="35" height="9" rx="3.6" fill="url(#t${u})" stroke="${c.stroke}" stroke-width="1"/>`;
    s += `<rect x="10" y="${topY + 12}" width="4.5" height="${h - 17}" rx="2.25" fill="url(#s${u})"/>`;
    if (hollow) {
      s += `<rect x="15" y="${topY + 2}" width="18" height="5" rx="2.5" fill="url(#o${u})" stroke="${c.holeRim}" stroke-width="1"/>`;
    }
  } else {
    s += `<path d="M6 ${bodyTop} v${wallH} a18 7 0 0 0 36 0 v-${wallH} z" fill="url(#b${u})" stroke="${c.stroke}" stroke-width="1.3"/>`;
    s += `<path d="M6 ${bodyTop} v${wallH} a18 7 0 0 0 36 0 v-${wallH} z" fill="url(#a${u})"/>`;
    s += `<ellipse cx="24" cy="${bodyTop}" rx="18" ry="6.5" fill="url(#t${u})" stroke="${c.stroke}" stroke-width="1"/>`;
    s += `<rect x="11.5" y="${bodyTop + 4}" width="4.5" height="${wallH - 1}" rx="2.25" fill="url(#s${u})"/>`;
    if (hollow) {
      s += `<ellipse cx="24" cy="${bodyTop}" rx="9.5" ry="3.4" fill="url(#o${u})"/>`;
      s += `<path d="M15 ${bodyTop} a9.5 3.4 0 0 1 18 0" fill="none" stroke="${c.holeRim}" stroke-width="0.9" stroke-linecap="round"/>`;
    }
  }

  return `<svg viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${pieceName(id)}">${defs}${s}</svg>`;
}

function pieceName(id) {
  return [
    id & 1 ? 'mörk' : 'ljus',
    id & 2 ? 'hög' : 'låg',
    id & 4 ? 'fyrkantig' : 'rund',
    id & 8 ? 'ihålig' : 'massiv',
  ].join(' · ');
}

// ---------- Ljud (syntetiserat + inspelade utrop) ----------

let audioCtx = null;

function tone(freq, start, dur, vol, type = 'sine') {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = audioCtx.currentTime + start;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// Lätt haptik på mobil; följer samma av/på som ljudet (tyst läge = ingen vibb).
function haptic(pattern) {
  if (!soundEnabled) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* vibration ej kritisk */ }
}

function playSound(kind) {
  if (!soundEnabled) return;
  if (kind === 'place') haptic(12);
  else if (kind === 'gong') haptic([0, 35, 45, 80]);
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (kind === 'place') {
      tone(190, 0, 0.1, 0.12, 'triangle'); // träklocka
      tone(950, 0, 0.04, 0.05, 'square');
    } else if (kind === 'select') {
      tone(660, 0, 0.07, 0.05, 'triangle');
    } else if (kind === 'kudos') {
      tone(523, 0, 0.16, 0.07);
      tone(784, 0.09, 0.22, 0.07);
    } else if (kind === 'message') {
      tone(880, 0, 0.08, 0.045, 'triangle'); // diskret tvåtonsping
      tone(1318.5, 0.08, 0.14, 0.04, 'triangle');
    } else if (kind === 'gong') {
      tone(98, 0, 2.2, 0.16);
      tone(196.5, 0, 1.7, 0.08);
      tone(294.7, 0, 1.2, 0.04);
    }
  } catch (e) {
    /* ljud är aldrig kritiskt */
  }
}

document.addEventListener('pointerdown', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});

const customAudios = {
  woah: new Audio('/sounds/woah.wav'),
  namen: new Audio('/sounds/namen.wav'),
  omojligt: new Audio('/sounds/omojligt.wav'),
};

function playCustomSound(key, fallbackKind) {
  if (!soundEnabled) return;
  const audio = customAudios[key];
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {
      if (fallbackKind) playSound(fallbackKind);
    });
  } else if (fallbackKind) {
    playSound(fallbackKind);
  }
}

function playKudosSound(text) {
  const cleaned = text.trim().toLowerCase();
  if (cleaned.includes('woah')) playCustomSound('woah', 'kudos');
  else if (cleaned.includes('nämen')) playCustomSound('namen', 'kudos');
  else if (cleaned.includes('inte möjligt') || cleaned.includes('omöjligt')) playCustomSound('omojligt', 'kudos');
  else playSound('kudos');
}

// ---------- Persistent DOM: byggs en gång, uppdateras på plats ----------

const cellEls = []; // { btn, holder, piece }
const slotEls = []; // pool-platser, fast plats per pjäs-id
let domBuilt = false;

function buildDom() {
  const board = $('board');
  for (let i = 0; i < 16; i++) {
    const btn = document.createElement('button');
    btn.className = 'cell';
    const r = i >> 2, c = i & 3;
    if ((r + c) % 2) btn.classList.add('alt');
    const holder = document.createElement('div');
    holder.className = 'cell-piece';
    btn.appendChild(holder);
    btn.addEventListener('click', () => onCellTap(i));
    board.appendChild(btn);
    cellEls.push({ btn, holder, piece: null });
  }
  const pool = $('pool');
  for (let p = 0; p < 16; p++) {
    const slot = document.createElement('button');
    slot.className = 'slot';
    slot.title = pieceName(p);
    slot.innerHTML = pieceSVG(p);
    slot.addEventListener('click', () => onSlotTap(p));
    pool.appendChild(slot);
    slotEls.push(slot);
  }
}

// ---------- Egna drag: optimistiskt + skickas till servern ----------

function onCellTap(cell) {
  const s = effective();
  if (!s || s.game.gameOver || s.game.turn !== me) return;
  if (s.game.phase !== 'place' || s.game.board[cell] !== null) return;
  conn.emit('placePiece', cell);
  const n = structuredClone(s);
  const g = n.game;
  g.board[cell] = g.selectedPiece;
  g.selectedPiece = null;
  g.lastMove = cell;
  g.phase = 'select';
  predicted = n;
  applyState(n);
}

function onSlotTap(piece) {
  const s = effective();
  if (!s || s.game.gameOver || s.game.turn !== me) return;
  if (s.game.phase !== 'select' || !s.game.pool.includes(piece)) return;
  conn.emit('selectPiece', piece);
  const n = structuredClone(s);
  const g = n.game;
  g.pool = g.pool.filter((x) => x !== piece);
  g.selectedPiece = piece;
  g.turn = opponent();
  g.phase = 'place';
  predicted = n;
  applyState(n);
}

// ---------- FLIP-flygning: pjäsen glider mellan källa och mål ----------

function flyPiece(pieceId, srcRect, destSvg) {
  if (!destSvg) return;
  const dst = destSvg.getBoundingClientRect();
  if (REDUCED || !srcRect || dst.width === 0 || srcRect.width === 0) {
    settle(destSvg);
    return;
  }
  const clone = document.createElement('div');
  clone.className = 'flying';
  clone.innerHTML = pieceSVG(pieceId);
  clone.style.width = `${dst.width}px`;
  clone.style.height = `${dst.height}px`;
  clone.style.left = `${dst.left}px`;
  clone.style.top = `${dst.top}px`;
  const sx = srcRect.width / dst.width;
  const sy = srcRect.height / dst.height;
  const dx = srcRect.left - dst.left;
  const dy = srcRect.top - dst.top;
  destSvg.style.opacity = '0';
  document.body.appendChild(clone);
  const anim = clone.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transform: 'translate(0, 0) scale(1, 1)' },
    ],
    { duration: 260, easing: 'cubic-bezier(0.25, 0.9, 0.3, 1)' }
  );
  const done = () => {
    clone.remove();
    destSvg.style.opacity = '';
    settle(destSvg);
  };
  anim.onfinish = done;
  anim.oncancel = done;
}

function settle(svg) {
  if (REDUCED || !svg.animate) return;
  svg.animate(
    [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
    { duration: 150, easing: 'ease-out' }
  );
}

// ---------- Tillämpa tillstånd: diffa mot vyn, animera skillnaden ----------

function applyState(s) {
  if (!me || !s) return;
  $('lobby').classList.add('hidden');
  $('game-container').classList.remove('hidden');
  if (!domBuilt) {
    buildDom();
    domBuilt = true;
    updateBoardSize();
  }

  // Populate or update chat history if message count changes or on first load
  const chatMsgContainer = $('chat-messages');
  if (chatMsgContainer) {
    const currentBubbles = chatMsgContainer.querySelectorAll('.chat-bubble').length;
    const incomingCount = (s.messages || []).length;
    if (!view || currentBubbles !== incomingCount) {
      chatMsgContainer.innerHTML = '';
      if (s.messages) {
        s.messages.forEach((msg) => renderMessage(msg, true));
      }
    }
  }

  const g = s.game;
  const old = view ? view.game : null;

  // Vad hände sedan sist? (exakt ett av dessa per drag)
  let placedCell = null;
  let selectedNow = null;
  if (old) {
    for (let i = 0; i < 16; i++) {
      if (old.board[i] === null && g.board[i] !== null) placedCell = i;
    }
    if (old.selectedPiece === null && g.selectedPiece !== null) selectedNow = g.selectedPiece;
  }
  const becameOver = old && !old.gameOver && g.gameOver;
  const becameFresh = old && old.gameOver && !g.gameOver;
  const becameMyTurn = old && !g.gameOver && g.turn === me && old.turn !== me;

  // Fånga källrektanglar INNAN DOM:en uppdateras.
  let flight = null;
  if (placedCell !== null) {
    const src = $('task-piece').querySelector('svg');
    flight = { piece: g.board[placedCell], srcRect: src && src.getBoundingClientRect(), dest: 'cell', cell: placedCell };
  } else if (selectedNow !== null) {
    const src = slotEls[selectedNow].querySelector('svg');
    flight = { piece: selectedNow, srcRect: src && src.getBoundingClientRect(), dest: 'task' };
  }

  renderHeader(s, g);
  renderTask(g);
  renderBoard(g);
  renderPool(g);
  renderButtons(g);
  renderGameOver(s, g);

  // Övergångar efter att DOM:en fått sitt nya innehåll.
  if (flight) {
    playSound(flight.dest === 'cell' ? 'place' : 'select');
    const destSvg =
      flight.dest === 'cell'
        ? cellEls[flight.cell].holder.querySelector('svg')
        : $('task-piece').querySelector('svg');
    flyPiece(flight.piece, flight.srcRect, destSvg);
  }

  if (becameOver) {
    if (!g.draw) {
      playSound('gong');
      shakeBoard();
      if (g.winner === me) startConfetti();
    }
  } else if (becameFresh) {
    stopConfetti();
  }

  if (becameMyTurn) {
    showTurnBanner(g.phase === 'place' ? 'Din tur — placera pjäsen' : 'Din tur — välj en pjäs');
  }

  view = s;
}

// ---------- Delrenderare (muterar bara det som ändrats) ----------

function renderHeader(s, g) {
  const opp = opponent();
  const left = $('avatar-left');
  const right = $('avatar-right');

  const myAvatar = AVATARS[me];
  const oppAvatar = avatarFor(opp);
  const oppName = displayName(opp);

  if (left.getAttribute('src') !== myAvatar) left.src = myAvatar;
  if (right.getAttribute('src') !== oppAvatar) right.src = oppAvatar;

  if ($('name-left').textContent !== me) $('name-left').textContent = me;
  if ($('name-right').textContent !== oppName) $('name-right').textContent = oppName;

  $('sub-left').textContent = 'du';

  $('score').textContent = `${s.scores[me]} – ${s.scores[opp]}`;
  const cap = $('match-cap');
  if (cap) {
    const lead = Math.max(s.scores[me], s.scores[opp]);
    const matchPoint = !g.gameOver && lead === MATCH_TARGET - 1;
    cap.textContent = matchPoint ? 'matchboll' : `först till ${MATCH_TARGET}`;
    cap.classList.toggle('hot', matchPoint);
  }
  const online = mode === 'bot' ? true : s.presence[opp];
  $('sub-right').textContent = mode === 'bot' ? BOT_LEVELS[botLevel] : online ? 'online' : 'offline';
  $('sub-right').classList.toggle('online', online);
  $('card-right').classList.toggle('offline', !online);
  $('dot-left').className = 'status-dot online';
  $('dot-right').className = `status-dot ${online ? 'online' : 'offline'}`;
  $('card-left').classList.toggle('active', !g.gameOver && g.turn === me);
  $('card-right').classList.toggle('active', !g.gameOver && g.turn === opp);
}

function renderTask(g) {
  const tp = $('task-piece');
  const opp = displayName(opponent());
  const myTurn = g.turn === me && !g.gameOver;
  $('task').classList.toggle('mine', myTurn);

  const pieceKey = g.selectedPiece === null ? '' : String(g.selectedPiece);
  if (tp.dataset.piece !== pieceKey) {
    tp.innerHTML = pieceKey === '' ? '<div class="task-placeholder"></div>' : pieceSVG(g.selectedPiece);
    tp.dataset.piece = pieceKey;
  }

  let title, sub;
  if (g.gameOver) {
    if (g.draw) {
      title = 'Oavgjort';
      sub = 'brädet vilar';
    } else {
      title = g.winner === me ? 'Du vann!' : `${displayName(g.winner)} vann`;
      sub = g.endReason === 'falseClaim' ? 'falskt Quarto-utrop' : 'Quarto — fyra i rad';
    }
  } else if (g.phase === 'select') {
    title = myTurn ? `Välj en pjäs till ${opp}` : `${opp} väljer en pjäs åt dig`;
    sub = myTurn ? 'tryck på en pjäs i förrådet' : 'vänta …';
  } else {
    title = myTurn ? 'Placera pjäsen' : `${opp} placerar`;
    sub = pieceName(g.selectedPiece);
  }
  $('task-title').textContent = title;
  $('task-sub').textContent = sub;
}

function renderBoard(g) {
  const canPlace = !g.gameOver && g.turn === me && g.phase === 'place';
  // Vid vinst: lyft fram den vinnande raden genom att dämpa övriga pjäser.
  $('board').classList.toggle('won', g.gameOver && !!g.winningLine);
  for (let i = 0; i < 16; i++) {
    const ce = cellEls[i];
    const piece = g.board[i];
    if (ce.piece !== piece) {
      ce.holder.innerHTML = piece === null ? '' : pieceSVG(piece);
      ce.piece = piece;
    }
    const placeable = canPlace && piece === null;
    ce.btn.classList.toggle('placeable', placeable);
    ce.btn.classList.toggle('last', piece !== null && i === g.lastMove && !g.gameOver);
    ce.btn.classList.toggle('win', !!(g.winningLine && g.winningLine.includes(i)));
    ce.btn.disabled = !placeable;
    ce.btn.setAttribute('aria-label',
      piece !== null ? pieceName(piece)
      : placeable ? `Placera pjäsen på ruta ${i + 1}`
      : `Ruta ${i + 1}, tom`);
  }
}

function renderPool(g) {
  const canSelect = !g.gameOver && g.turn === me && g.phase === 'select';
  $('pool').classList.toggle('armed', canSelect);
  for (let p = 0; p < 16; p++) {
    const inPool = g.pool.includes(p);
    const slot = slotEls[p];
    slot.classList.toggle('taken', !inPool);
    slot.classList.toggle('selectable', canSelect && inPool);
    slot.disabled = !(canSelect && inPool);
  }
}

function renderButtons(g) {
  const myTurn = g.turn === me && !g.gameOver;
  const full = g.board.every((c) => c !== null);
  $('quarto-btn').disabled = !myTurn;
  $('draw-btn').classList.toggle('hidden', !(myTurn && full));
}

function renderGameOver(s, g) {
  const ov = $('gameover');
  const btn = $('new-game-btn');
  if (!g.gameOver) {
    ov.classList.add('hidden');
    return;
  }
  const wasHidden = ov.classList.contains('hidden');
  ov.classList.remove('hidden');
  const mine = !g.draw && g.winner === me;
  ov.classList.toggle('win', mine);

  // Tog vinnaren hela matchen? Då blir det en match-final, inte bara ett parti.
  const matchWin = !g.draw && g.winner && s.scores[g.winner] >= MATCH_TARGET;
  ov.classList.toggle('match', !!matchWin);

  let title, sub;
  if (matchWin) {
    title = mine ? 'Matchen är din!' : `${displayName(g.winner)} tar matchen`;
    sub = `Matchen slutade ${s.scores[me]}–${s.scores[opponent()]}. ${mine ? 'Mästerligt spelat.' : 'Dags för revansch?'}`;
    btn.textContent = 'Ny match';
    btn.dataset.match = '1';
  } else if (g.draw) {
    title = 'Oavgjort';
    sub = 'Alla sexton pjäser lagda — brädet vilar.';
    btn.textContent = 'Nytt parti';
    delete btn.dataset.match;
  } else if (g.endReason === 'falseClaim') {
    title = mine ? 'Du vann!' : `${displayName(g.winner)} vann`;
    sub = mine
      ? `${displayName(opponent())} ropade Quarto utan vinnande rad.`
      : 'Du ropade Quarto utan vinnande rad.';
    btn.textContent = 'Nytt parti';
    delete btn.dataset.match;
  } else {
    title = mine ? 'Quarto — du vann!' : `Quarto! ${displayName(g.winner)} vann`;
    sub = 'Fyra i rad med en gemensam egenskap.';
    btn.textContent = 'Nytt parti';
    delete btn.dataset.match;
  }
  $('gameover-title').textContent = title;
  $('gameover-sub').textContent = sub;
}

function shakeBoard() {
  if (REDUCED) return;
  const board = $('board');
  board.classList.remove('shake');
  void board.offsetWidth;
  board.classList.add('shake');
  setTimeout(() => board.classList.remove('shake'), 650);
}

// ---------- Anslutning ----------

function join(seat) {
  socket.emit('join', seat, (res) => {
    if (!res.ok) return showToast(res.error);
    lastSeq = res.state.seq;
    auth = res.state;
    predicted = null;
    applyState(auth);
  });
}

socket.on('connect', () => {
  if (mode === 'online' && me) join(me);
});

// Gemensam mottagare för nytt tillstånd, oavsett om det kommer från
// servern eller den lokala botsessionen.
function handleState(data) {
  if (data.seq <= lastSeq) return;
  lastSeq = data.seq;
  auth = data;
  predicted = null;
  applyState(data);
}

socket.on('state', (data) => {
  updateLobbyUI(data);
  if (mode === 'bot') return; // serverns delade parti rör inte botpartiet
  handleState(data);
});

socket.on('presence', (presence) => {
  if (mode === 'bot') return;
  if (auth) {
    auth.presence = presence;
    updateLobbyUI(auth);
  }
  if (predicted) predicted.presence = presence;
  const s = effective();
  if (s && view) renderHeader(s, s.game);
});

// ---------- Botläge: lokalt parti utan server ----------

function startBotGame(seat, level) {
  me = seat;
  mode = 'bot';
  botLevel = level;
  lastSeq = -1;
  auth = null;
  predicted = null;
  view = null;
  try {
    localStorage.setItem('quarto.botseat', seat);
  } catch (e) { /* lagring är aldrig kritiskt */ }

  conn = createLocalSession({
    humanSeat: seat,
    level,
    onState: handleState,
    onError: showToast,
    onKudos: showKudos,
  });

  $('game-container').classList.add('bot-mode');
  $('menu-chat-btn').classList.add('hidden');
  $('switch-player').textContent = '⌂ Till lobbyn';
  conn.start();
}

function updateLobbyUI(s) {
  if (!s || !s.presence) return;
  
  const isLeftOnline = s.presence.Emreos;
  const isRightOnline = s.presence.Raquel;

  // Uppdatera Plats 1 (Emreos)
  if ($('lobby-dot-left')) {
    $('lobby-dot-left').classList.toggle('online', isLeftOnline);
  }
  if ($('lobby-action-left')) {
    $('lobby-action-left').textContent = isLeftOnline ? 'Upptagen' : 'Välj';
  }
  if ($('seat-1')) {
    $('seat-1').classList.toggle('occupied', isLeftOnline);
    $('seat-1').disabled = isLeftOnline;
  }

  // Uppdatera Plats 2 (Raquel)
  if ($('lobby-dot-right')) {
    $('lobby-dot-right').classList.toggle('online', isRightOnline);
  }
  if ($('lobby-action-right')) {
    $('lobby-action-right').textContent = isRightOnline ? 'Upptagen' : 'Välj';
  }
  if ($('seat-2')) {
    $('seat-2').classList.toggle('occupied', isRightOnline);
    $('seat-2').disabled = isRightOnline;
  }
}

socket.on('errorMsg', (msg) => {
  if (mode === 'bot') return;
  showToast(msg);
  // Ett avvisat optimistiskt drag rullas tillbaka till serverns sanning.
  if (predicted) {
    predicted = null;
    if (auth) applyState(auth);
  }
});

socket.on('kudos', ({ text }) => {
  if (mode === 'bot') return;
  showKudos(text);
});

// ---------- Lobby & meny ----------



document.querySelectorAll('.seat-card').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = 'online';
    conn = socket;
    me = btn.dataset.player;
    join(me);
  });
});

// Botkortet: välj vem du spelar som (sparas), tryck på en nivå för att börja.
let botSeat = 'Emreos';
try {
  const saved = localStorage.getItem('quarto.botseat');
  if (PLAYERS.includes(saved)) botSeat = saved;
} catch (e) { /* lagring är aldrig kritiskt */ }

function renderBotSeatChips() {
  document.querySelectorAll('.bot-seat-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.seat === botSeat);
  });
}

document.querySelectorAll('.bot-seat-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    botSeat = chip.dataset.seat;
    renderBotSeatChips();
  });
});

document.querySelectorAll('.bot-level').forEach((btn) => {
  btn.addEventListener('click', () => startBotGame(botSeat, btn.dataset.level));
});

renderBotSeatChips();

$('menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('menu').classList.toggle('hidden');
  resetArm(false);
});

document.addEventListener('click', (e) => {
  if (!$('menu').classList.contains('hidden') && !$('menu').contains(e.target)) {
    $('menu').classList.add('hidden');
    resetArm(false);
  }
});

$('switch-player').addEventListener('click', () => {
  location.reload();
});

// Ljud av/på (gäller även vibration). Menyn lämnas öppen så valet syns.
function renderSoundToggle() {
  const btn = $('sound-toggle-btn');
  if (btn) btn.textContent = soundEnabled ? '🔊 Ljud på' : '🔇 Ljud av';
}
if ($('sound-toggle-btn')) {
  $('sound-toggle-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    soundEnabled = !soundEnabled;
    try { localStorage.setItem('quarto.muted', soundEnabled ? '0' : '1'); } catch (e) { /* lagring ej kritisk */ }
    renderSoundToggle();
    if (soundEnabled) playSound('select'); // liten bekräftelseton
  });
}
renderSoundToggle();

// Nollställning av poäng kräver två tryck — inga blockerande dialogrutor.
let resetArmed = false;
let resetTimer = null;
function resetArm(on) {
  resetArmed = on;
  $('reset-scores-btn').textContent = on ? 'Säker? Tryck igen' : '⟲ Nollställ poäng';
  $('reset-scores-btn').classList.toggle('armed', on);
  clearTimeout(resetTimer);
  if (on) resetTimer = setTimeout(() => resetArm(false), 3000);
}

$('reset-scores-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!resetArmed) return resetArm(true);
  resetArm(false);
  $('menu').classList.add('hidden');
  conn.emit('resetScores');
});

// ---------- Spelknappar ----------

// Quarto ropas genom att HÅLLA knappen intryckt en stund. Ett oavsiktligt
// tryck kan annars ge en direkt förlust (falskt utrop) — hållet gör utropet
// medvetet, och en mässingsfyllnad visar förloppet.
const QUARTO_HOLD_MS = 600;
let quartoHoldTimer = null;
let quartoHolding = false;

function startQuartoHold() {
  const btn = $('quarto-btn');
  if (btn.disabled || quartoHolding) return;
  quartoHolding = true;
  btn.style.setProperty('--quarto-hold', QUARTO_HOLD_MS + 'ms');
  btn.classList.add('holding');
  quartoHoldTimer = setTimeout(() => {
    quartoHolding = false;
    btn.classList.remove('holding');
    conn.emit('claimQuarto');
  }, QUARTO_HOLD_MS);
}

function endQuartoHold(hintOnEarly) {
  if (!quartoHolding) return;
  quartoHolding = false;
  clearTimeout(quartoHoldTimer);
  $('quarto-btn').classList.remove('holding');
  if (hintOnEarly) showToast('Håll knappen intryckt för att ropa Quarto', true);
}

(() => {
  const btn = $('quarto-btn');
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); startQuartoHold(); });
  btn.addEventListener('pointerup', () => endQuartoHold(true));
  btn.addEventListener('pointerleave', () => endQuartoHold(false));
  btn.addEventListener('pointercancel', () => endQuartoHold(false));
  btn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startQuartoHold(); }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') endQuartoHold(true);
  });
})();

$('draw-btn').addEventListener('click', () => conn.emit('claimDraw'));

$('new-game-btn').addEventListener('click', () => {
  // Efter en avgjord match: nollställ poängen och starta en ny match.
  if ($('new-game-btn').dataset.match === '1') conn.emit('resetScores');
  conn.emit('newGame');
});

// ---------- Turbanderoll ----------

let turnBannerTimer = null;
function showTurnBanner(text) {
  if (REDUCED) return;
  const banner = $('turn-banner');
  banner.textContent = text;
  banner.classList.remove('hidden', 'show');
  void banner.offsetWidth;
  banner.classList.add('show');
  clearTimeout(turnBannerTimer);
  turnBannerTimer = setTimeout(() => banner.classList.add('hidden'), 1600);
}

// ---------- Guldstoft vid vinst: stillsamt fall, slutar av sig självt ----------

let dustActive = false;
let dustParticles = [];
let dustStarted = 0;
const confettiCanvas = $('confetti-canvas');
const confettiCtx = confettiCanvas ? confettiCanvas.getContext('2d') : null;

function resizeConfettiCanvas() {
  if (confettiCanvas) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
}
function updateBoardSize() {
  const board = $('board');
  if (board) {
    const rect = board.getBoundingClientRect();
    document.documentElement.style.setProperty('--board-size', `${rect.width}px`);
  }
}
window.addEventListener('resize', () => {
  resizeConfettiCanvas();
  updateBoardSize();
});

class DustParticle {
  constructor() {
    this.x = Math.random() * window.innerWidth;
    this.y = Math.random() * -window.innerHeight * 0.6 - 10;
    this.r = Math.random() * 1.8 + 0.8;
    this.alpha = Math.random() * 0.5 + 0.25;
    this.speedY = Math.random() * 1.1 + 0.6;
    this.sway = Math.random() * 1.4 + 0.4;
    this.phase = Math.random() * Math.PI * 2;
  }
  update(t) {
    this.y += this.speedY;
    this.x += Math.sin(t / 900 + this.phase) * this.sway * 0.3;
  }
  draw() {
    if (!confettiCtx) return;
    confettiCtx.beginPath();
    confettiCtx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    confettiCtx.fillStyle = `rgba(168, 133, 74, ${this.alpha})`;
    confettiCtx.fill();
  }
}

function startConfetti() {
  if (dustActive || REDUCED) return;
  dustActive = true;
  dustStarted = performance.now();
  resizeConfettiCanvas();
  dustParticles = [];
  for (let i = 0; i < 90; i++) dustParticles.push(new DustParticle());
  animateDust();
}

function stopConfetti() {
  dustActive = false;
  if (confettiCtx && confettiCanvas) {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

function animateDust() {
  if (!dustActive) return;
  const t = performance.now();
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  for (const p of dustParticles) {
    p.update(t);
    p.draw();
  }
  // Efter ett par sekunder fylls inget på: stoftet faller färdigt och tystnar.
  if (t - dustStarted < 2600) {
    dustParticles.forEach((p) => {
      if (p.y > window.innerHeight) Object.assign(p, new DustParticle(), { y: -10 });
    });
  } else {
    dustParticles = dustParticles.filter((p) => p.y <= window.innerHeight);
    if (dustParticles.length === 0) return stopConfetti();
  }
  requestAnimationFrame(animateDust);
}

// ---------- Kudos: flygande utrop ----------

function showKudos(text) {
  const el = document.createElement('div');
  el.className = 'kudos';
  el.textContent = text;
  el.style.setProperty('--tilt', `${(Math.random() * 6 - 3).toFixed(1)}deg`);
  el.classList.add(['champagne', 'ivory', 'rose'][Math.floor(Math.random() * 3)]);
  document.body.appendChild(el);
  playKudosSound(text);
  setTimeout(() => el.remove(), 1700);
}

// ---------- Toast ----------

let toastTimer = null;
function showToast(msg, silent) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (!silent) playCustomSound('omojligt');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ---------- Chatt: Rendering, Händelser och Geststyrning ----------

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMessage(msg, append = true) {
  const container = $('chat-messages');
  if (!container) return;

  const isMine = msg.sender === me;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isMine ? 'mine' : 'theirs'}`;

  const name = msg.sender;

  const date = new Date(msg.timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  bubble.innerHTML = `
    <span class="chat-msg-sender">${escapeHtml(name)}</span>
    <span class="chat-msg-text">${escapeHtml(msg.text)}</span>
    <span class="chat-msg-time">${timeStr}</span>
  `;

  if (append) {
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  } else {
    container.insertBefore(bubble, container.firstChild);
  }
}

function toggleChat(show) {
  const sidebar = $('chat-sidebar');
  const overlay = $('chat-overlay');
  if (!sidebar || !overlay) return;

  const isOpen = sidebar.classList.contains('open');
  const shouldOpen = show !== undefined ? show : !isOpen;

  if (shouldOpen) clearUnread();

  sidebar.classList.toggle('open', shouldOpen);
  overlay.classList.toggle('hidden', !shouldOpen);

  // Återställ eventuell inline transform från drag
  sidebar.style.transform = '';

  if (shouldOpen) {
    const container = $('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
    
    setTimeout(() => {
      if ($('chat-input')) $('chat-input').focus();
    }, 100);
  }
}

// ---------- Avisering om olästa meddelanden (mobil, chatten stängd) ----------
// På breda skärmar är panelen alltid synlig; på mobil visas en tryckbar pill
// med avsändare + förhandsvisning, plus en mässingsprick på menyknappen som
// ligger kvar tills chatten öppnas.

let unreadCount = 0;
let chatNotifyTimer = null;

function chatVisible() {
  if (window.matchMedia('(min-width: 850px)').matches) return true; // fast panel
  const sidebar = $('chat-sidebar');
  return !!sidebar && sidebar.classList.contains('open');
}

function notifyMessage(msg) {
  unreadCount += 1;
  $('menu-unread').classList.remove('hidden');
  $('menu-chat-btn').textContent = `💬 Chatt (${unreadCount})`;

  $('chat-notify-img').src = AVATARS[msg.sender] || AVATARS[PLAYERS[0]];
  $('chat-notify-sender').textContent = msg.sender;
  $('chat-notify-msg').textContent = msg.text;
  const pill = $('chat-notify');
  pill.classList.remove('hidden', 'show');
  void pill.offsetWidth; // starta om animationen vid tätt följande meddelanden
  pill.classList.add('show');

  playSound('message');
  clearTimeout(chatNotifyTimer);
  chatNotifyTimer = setTimeout(() => $('chat-notify').classList.add('hidden'), 4200);
}

function clearUnread() {
  unreadCount = 0;
  clearTimeout(chatNotifyTimer);
  $('chat-notify').classList.add('hidden');
  $('menu-unread').classList.add('hidden');
  $('menu-chat-btn').textContent = '💬 Chatt';
}

$('chat-notify').addEventListener('click', () => toggleChat(true));

// Chatt-händelselyssnare
socket.on('message', (msg) => {
  if (mode === 'bot') return;
  renderMessage(msg, true);
  if (mode === 'online' && me && msg.sender !== me && !chatVisible()) {
    notifyMessage(msg);
  }
});

if ($('chat-form')) {
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('sendMessage', text);
    input.value = '';
    input.focus();
  });
}

if ($('menu-chat-btn')) {
  $('menu-chat-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('menu').classList.add('hidden');
    toggleChat();
  });
}

if ($('chat-close-btn')) {
  $('chat-close-btn').addEventListener('click', () => {
    toggleChat(false);
  });
}

if ($('chat-overlay')) {
  $('chat-overlay').addEventListener('click', () => {
    toggleChat(false);
  });
}

// --- Swipe- och drag-geststyrning på mobil ---

let touchStartX = 0;
let touchStartY = 0;
let isDraggingSidebar = false;

window.addEventListener('touchstart', (e) => {
  if (mode === 'bot') return; // ingen chatt mot boten
  const sidebar = $('chat-sidebar');
  if (!sidebar) return;

  const isOpen = sidebar.classList.contains('open');
  const touch = e.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;

  // Om chatten är stängd, dra från högerkanten (inom 35px) för att öppna
  if (!isOpen && touchStartX > window.innerWidth - 35) {
    isDraggingSidebar = true;
    sidebar.style.transition = 'none';
  }
  // Om chatten är öppen, dra tillbaka till höger för att stänga (om man drar i panelen eller overlay)
  else if (isOpen) {
    const isInsideSidebar = sidebar.contains(e.target);
    const isOverlay = e.target === $('chat-overlay');
    if (isInsideSidebar || isOverlay) {
      isDraggingSidebar = true;
      sidebar.style.transition = 'none';
    }
  }
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (!isDraggingSidebar) return;
  const sidebar = $('chat-sidebar');
  if (!sidebar) return;

  const isOpen = sidebar.classList.contains('open');
  const touch = e.touches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;

  // Ignorera om rörelsen främst är vertikal (t.ex. vid scroll av meddelanden)
  if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaX) < 10) return;

  if (!isOpen) {
    // Dra ut från höger till vänster
    if (deltaX < 0) {
      const offset = Math.max(0, 320 + deltaX);
      sidebar.style.transform = `translateX(${offset}px)`;
    }
  } else {
    // Dra in från vänster till höger (stäng)
    if (deltaX > 0) {
      const offset = Math.min(320, deltaX);
      sidebar.style.transform = `translateX(${offset}px)`;
    }
  }
}, { passive: true });

window.addEventListener('touchend', (e) => {
  if (!isDraggingSidebar) return;
  isDraggingSidebar = false;

  const sidebar = $('chat-sidebar');
  if (!sidebar) return;

  sidebar.style.transition = '';
  const isOpen = sidebar.classList.contains('open');
  const touch = e.changedTouches[0];
  const deltaX = touch.clientX - touchStartX;

  if (!isOpen) {
    if (deltaX < -80) {
      toggleChat(true);
    } else {
      sidebar.style.transform = '';
      toggleChat(false);
    }
  } else {
    if (deltaX > 80) {
      toggleChat(false);
    } else {
      sidebar.style.transform = '';
      toggleChat(true);
    }
  }
});

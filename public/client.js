/* Quarto-klient.
   Arkitektur: servern är auktoritativ, men egna drag appliceras optimistiskt
   direkt vid tryck (servern bekräftar tyst med samma resultat). DOM:en byggs
   en gång och uppdateras på plats — inga omrenderingar, inga layoutskift.
   Pjäser flyger med FLIP-animation mellan förråd → hand → bräde. */

const socket = io();

const PLAYERS = ['Emreos', 'Raquel'];
const AVATARS = { Emreos: 'emreos.jpg', Raquel: 'raquel.jpg' };

let me = null;

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
// Sidovy: elfenben mot ebenholts, kraftig höjdskillnad, tydligt hål med
// ljus kant för ihåliga pjäser, glansstråk för lyster.

function pieceSVG(id) {
  const dark = id & 1;
  const tall = id & 2;
  const square = id & 4;
  const hollow = id & 8;

  // Champagne-metall mot varm espresso-grafit: maskinbearbetade objekt
  // i samma varma register som det ljusa alabaster-rummet.
  const c = dark
    ? {
        grad: 'qg-d',
        g1: '#5c554c',
        g2: '#211d18',
        top: '#6e665b',
        stroke: '#14110d',
        hole: '#0a0806',
        holeRim: 'rgba(244, 234, 214, 0.45)',
        gloss: 'rgba(255, 250, 240, 0.18)',
      }
    : {
        grad: 'qg-l',
        g1: '#ecd7a4',
        g2: '#9c7840',
        top: '#f4e7c2',
        stroke: '#63491c',
        hole: '#46330f',
        holeRim: 'rgba(55, 40, 12, 0.6)',
        gloss: 'rgba(255, 255, 255, 0.5)',
      };

  const topY = tall ? 7 : 41; // överdriven höjdskillnad gör hög/låg omisskännlig
  const h = 66 - topY;
  let s = `<defs><linearGradient id="${c.grad}" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${c.g1}"/><stop offset="0.55" stop-color="${c.g1}"/>
    <stop offset="1" stop-color="${c.g2}"/></linearGradient></defs>`;

  if (square) {
    s += `<rect x="6" y="${topY}" width="36" height="${h}" rx="3.5" fill="url(#${c.grad})" stroke="${c.stroke}" stroke-width="1.6"/>`;
    s += `<rect x="6" y="${topY}" width="36" height="9" rx="3.5" fill="${c.top}" stroke="${c.stroke}" stroke-width="1.3"/>`;
    s += `<rect x="9.5" y="${topY + 11}" width="4" height="${h - 15}" rx="2" fill="${c.gloss}"/>`;
    if (hollow) {
      s += `<rect x="15" y="${topY + 2.2}" width="18" height="4.8" rx="2.4" fill="${c.hole}" stroke="${c.holeRim}" stroke-width="1.1"/>`;
    }
  } else {
    s += `<path d="M6 ${topY + 5} v${h - 12} a18 7 0 0 0 36 0 v-${h - 12} z" fill="url(#${c.grad})" stroke="${c.stroke}" stroke-width="1.6"/>`;
    s += `<ellipse cx="24" cy="${topY + 5}" rx="18" ry="6.5" fill="${c.top}" stroke="${c.stroke}" stroke-width="1.3"/>`;
    s += `<path d="M10.5 ${topY + 12} v${h - 22} a14 5 0 0 0 3.5 3 v-${h - 22}z" fill="${c.gloss}"/>`;
    if (hollow) {
      s += `<ellipse cx="24" cy="${topY + 5}" rx="9.5" ry="3.4" fill="${c.hole}" stroke="${c.holeRim}" stroke-width="1.1"/>`;
    }
  }

  return `<svg viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${pieceName(id)}">${s}</svg>`;
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

function playSound(kind) {
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
  socket.emit('placePiece', cell);
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
  socket.emit('selectPiece', piece);
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
  renderGameOver(g);

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
  const oppAvatar = AVATARS[opp];

  if (left.getAttribute('src') !== myAvatar) left.src = myAvatar;
  if (right.getAttribute('src') !== oppAvatar) right.src = oppAvatar;

  if ($('name-left').textContent !== me) $('name-left').textContent = me;
  if ($('name-right').textContent !== opp) $('name-right').textContent = opp;

  $('sub-left').textContent = 'du';

  $('score').textContent = `${s.scores[me]} – ${s.scores[opp]}`;
  const online = s.presence[opp];
  $('sub-right').textContent = online ? 'online' : 'offline';
  $('sub-right').classList.toggle('online', online);
  $('card-right').classList.toggle('offline', !online);
  $('dot-left').className = 'status-dot online';
  $('dot-right').className = `status-dot ${online ? 'online' : 'offline'}`;
  $('card-left').classList.toggle('active', !g.gameOver && g.turn === me);
  $('card-right').classList.toggle('active', !g.gameOver && g.turn === opp);
}

function renderTask(g) {
  const tp = $('task-piece');
  const opp = opponent();
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
      title = g.winner === me ? 'Du vann!' : `${g.winner} vann`;
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

function renderGameOver(g) {
  const ov = $('gameover');
  if (!g.gameOver) {
    ov.classList.add('hidden');
    return;
  }
  const wasHidden = ov.classList.contains('hidden');
  ov.classList.remove('hidden');
  const mine = !g.draw && g.winner === me;
  ov.classList.toggle('win', mine);

  let title, sub;
  if (g.draw) {
    title = 'Oavgjort';
    sub = 'Alla sexton pjäser lagda — brädet vilar.';
  } else if (g.endReason === 'falseClaim') {
    title = mine ? 'Du vann!' : `${g.winner} vann`;
    sub = mine
      ? `${opponent()} ropade Quarto utan vinnande rad.`
      : 'Du ropade Quarto utan vinnande rad.';
  } else {
    title = mine ? 'Quarto — du vann!' : `Quarto! ${g.winner} vann`;
    sub = 'Fyra i rad med en gemensam egenskap.';
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
  if (me) join(me);
});

socket.on('state', (data) => {
  updateLobbyUI(data);
  if (data.seq <= lastSeq) return;
  lastSeq = data.seq;
  auth = data;
  predicted = null;
  applyState(data);
});

socket.on('presence', (presence) => {
  if (auth) {
    auth.presence = presence;
    updateLobbyUI(auth);
  }
  if (predicted) predicted.presence = presence;
  const s = effective();
  if (s && view) renderHeader(s, s.game);
});

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
  showToast(msg);
  // Ett avvisat optimistiskt drag rullas tillbaka till serverns sanning.
  if (predicted) {
    predicted = null;
    if (auth) applyState(auth);
  }
});

socket.on('kudos', ({ text }) => showKudos(text));

// ---------- Lobby & meny ----------



document.querySelectorAll('.identity').forEach((btn) => {
  btn.addEventListener('click', () => {
    me = btn.dataset.player;
    join(me);
  });
});

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
  socket.emit('resetScores');
});

// ---------- Spelknappar ----------

$('quarto-btn').addEventListener('click', () => socket.emit('claimQuarto'));
$('draw-btn').addEventListener('click', () => socket.emit('claimDraw'));
$('new-game-btn').addEventListener('click', () => socket.emit('newGame'));

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
function showToast(msg) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  playCustomSound('omojligt');
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

// Chatt-händelselyssnare
socket.on('message', (msg) => {
  renderMessage(msg, true);
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

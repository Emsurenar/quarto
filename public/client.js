/* Quarto-klient: ansluter via Socket.IO, ritar allt utifrån serverns tillstånd. */

const socket = io();

const PLAYERS = ['Emre', 'Rakel'];
let me = localStorage.getItem('quartoPlayer');
if (!PLAYERS.includes(me)) me = null;

let state = null; // { seq, game, scores, presence }
let lastSeq = -1;

const $ = (id) => document.getElementById(id);

// ---------- Pjäsgrafik ----------
// Pjäs-id är 4 bitar: bit0 mörk, bit1 hög, bit2 fyrkantig, bit3 ihålig.
// Sidovy i "lackerat trä": elfenben mot ebenholts, kraftig höjdskillnad,
// tydligt hål med ljus kant för ihåliga pjäser, glansstråk för massiva.

function pieceSVG(id) {
  const dark = id & 1;
  const tall = id & 2;
  const square = id & 4;
  const hollow = id & 8;

  // Elfenben respektive ebenholts-lack, valda för maximal kontrast.
  const c = dark
    ? {
        grad: 'qg-d',
        g1: '#54281a',
        g2: '#1f0d06',
        top: '#6b3520',
        stroke: '#120802',
        hole: '#060301',
        holeRim: 'rgba(255, 214, 140, 0.7)',
        gloss: 'rgba(255, 235, 200, 0.28)',
      }
    : {
        grad: 'qg-l',
        g1: '#f8ecd0',
        g2: '#d3b27c',
        top: '#fdf6e0',
        stroke: '#a8803f',
        hole: '#6e5121',
        holeRim: 'rgba(80, 55, 15, 0.65)',
        gloss: 'rgba(255, 255, 255, 0.55)',
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

// ---------- Ljud (syntetiserat, inga filer) ----------

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

// Webbläsare kräver en användargest innan ljud får spelas.
document.addEventListener('pointerdown', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});

// ---------- Externa ljudfiler med fallback ----------

const customAudios = {
  woah: new Audio('/sounds/woah.wav'),
  namen: new Audio('/sounds/namen.wav'),
  omojligt: new Audio('/sounds/omojligt.wav')
};

function playCustomSound(key, fallbackKind) {
  const audio = customAudios[key];
  if (audio) {
    audio.play().catch(() => {
      if (fallbackKind) playSound(fallbackKind);
    });
  } else if (fallbackKind) {
    playSound(fallbackKind);
  }
}

function playKudosSound(text) {
  const cleaned = text.trim().toLowerCase();
  if (cleaned.includes('woah')) {
    playCustomSound('woah', 'kudos');
  } else if (cleaned.includes('nämen')) {
    playCustomSound('namen', 'kudos');
  } else if (cleaned.includes('inte möjligt') || cleaned.includes('omöjligt')) {
    playCustomSound('omojligt', 'kudos');
  } else {
    playSound('kudos');
  }
}

// ---------- Anslutning ----------

function join(name) {
  socket.emit('join', name, (res) => {
    if (!res.ok) return showToast(res.error);
    lastSeq = res.state.seq;
    state = res.state;
    render();
  });
}

socket.on('connect', () => {
  if (me) join(me);
});

socket.on('state', (data) => {
  if (data.seq <= lastSeq) return;
  lastSeq = data.seq;
  state = data;
  render();
});

socket.on('presence', (presence) => {
  if (state) state.presence = presence;
  renderPresence();
});

socket.on('errorMsg', showToast);
socket.on('kudos', ({ text }) => showKudos(text));

// ---------- Lobby ----------

document.querySelectorAll('.identity').forEach((btn) => {
  btn.addEventListener('click', () => {
    me = btn.dataset.player;
    localStorage.setItem('quartoPlayer', me);
    join(me);
  });
});

$('switch-player').addEventListener('click', () => {
  localStorage.removeItem('quartoPlayer');
  location.reload();
});

// ---------- Actions ----------

$('quarto-btn').addEventListener('click', () => socket.emit('claimQuarto'));
$('draw-btn').addEventListener('click', () => socket.emit('claimDraw'));
$('new-game-btn').addEventListener('click', () => socket.emit('newGame'));
$('reset-scores-btn').addEventListener('click', () => {
  if (confirm('Vill du verkligen nollställa poängställningen?')) {
    socket.emit('resetScores');
  }
});

// ---------- Rendering ----------

// Föregående tillstånd, för ljud- och animationstriggers.
let prevPlaced = -1;
let prevPool = -1;
let prevGameOver = false;
let prevTurn = null;
let prevPhase = null;

function opponent() {
  return me === PLAYERS[0] ? PLAYERS[1] : PLAYERS[0];
}

let turnBannerTimer = null;
function showTurnBanner(text) {
  const banner = $('turn-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.classList.remove('hidden');
  banner.classList.remove('show');
  void banner.offsetWidth; // trigger reflow
  banner.classList.add('show');
  clearTimeout(turnBannerTimer);
  turnBannerTimer = setTimeout(() => {
    banner.classList.add('hidden');
  }, 2000);
}

function render() {
  if (!me || !state) return;
  $('lobby').classList.add('hidden');
  $('game').classList.remove('hidden');

  const g = state.game;
  const myTurn = g.turn === me && !g.gameOver;
  const placed = g.board.filter((c) => c !== null).length;

  // Ljudeffekter utifrån vad som hänt sedan förra tillståndet.
  const justPlaced = prevPlaced >= 0 && placed > prevPlaced;
  if (justPlaced) playSound('place');
  else if (prevPool >= 0 && g.pool.length < prevPool && placed === prevPlaced) playSound('select');
  
  if (!prevGameOver && g.gameOver && !g.draw) {
    playSound('gong');
    // Starta konfetti och skaka brädet vid vinst
    startConfetti();
    const gameScreen = $('game');
    if (gameScreen) {
      gameScreen.classList.remove('shake');
      void gameScreen.offsetWidth; // reflow
      gameScreen.classList.add('shake');
      setTimeout(() => gameScreen.classList.remove('shake'), 600);
    }
  } else if (!g.gameOver) {
    stopConfetti();
  }

  // Visa tur-banderoll om det precis blivit vår tur
  const turnChanged = prevTurn !== g.turn || prevPhase !== g.phase;
  if (turnChanged && myTurn) {
    const opp = opponent();
    const text = g.phase === 'select'
      ? `Din tur: välj en pjäs att ge till ${opp}`
      : 'Din tur: placera pjäsen';
    showTurnBanner(text);
  }

  renderPresence();
  $('score').textContent = `${PLAYERS[0]} ${state.scores[PLAYERS[0]]} – ${state.scores[PLAYERS[1]]} ${PLAYERS[1]}`;

  renderActionText(g, myTurn);
  renderBoard(g, myTurn, justPlaced);
  renderHand(g);
  renderPool(g, myTurn);
  renderButtons(g, myTurn);
  renderBanner(g);

  prevPlaced = placed;
  prevPool = g.pool.length;
  prevGameOver = g.gameOver;
  prevTurn = g.turn;
  prevPhase = g.phase;
}

function renderPresence() {
  if (!me || !state) return;
  const opp = opponent();
  const online = state.presence[opp];
  $('presence-dot').className = `dot ${online ? 'online' : 'offline'}`;
  $('presence-text').textContent = `${opp} är ${online ? 'online' : 'offline'}`;
}

function renderActionText(g, myTurn) {
  const el = $('action-text');
  el.classList.toggle('mine', myTurn);
  if (g.gameOver) {
    el.textContent = '';
    return;
  }
  const opp = opponent();
  if (g.phase === 'select') {
    el.textContent = myTurn
      ? `Din tur: välj en pjäs att ge till ${opp}`
      : `${opp} väljer en pjäs åt dig …`;
  } else {
    el.textContent = myTurn
      ? 'Din tur: placera pjäsen på en ledig ruta'
      : `${opp} placerar pjäsen …`;
  }
}

function renderBoard(g, myTurn, justPlaced) {
  const board = $('board');
  board.innerHTML = '';
  const canPlace = myTurn && g.phase === 'place';
  for (let i = 0; i < 16; i++) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    const piece = g.board[i];
    if (piece !== null) {
      cell.innerHTML = pieceSVG(piece);
      if (i === g.lastMove && !g.gameOver) {
        cell.classList.add('last');
        if (justPlaced) cell.classList.add('pop');
      }
    } else if (canPlace) {
      cell.classList.add('placeable');
      cell.addEventListener('click', () => socket.emit('placePiece', i));
    }
    if (g.winningLine && g.winningLine.includes(i)) cell.classList.add('win');
    board.appendChild(cell);
  }
}

function renderHand(g) {
  const hand = $('hand');
  if (g.selectedPiece === null) {
    hand.classList.add('hidden');
    return;
  }
  hand.classList.remove('hidden');
  const placer = g.turn; // i fasen "place" är det alltid turspelaren som placerar
  $('hand-label').textContent =
    placer === me ? 'Pjäs att placera:' : `${placer} ska placera:`;
  $('hand-name').textContent = pieceName(g.selectedPiece);
  $('hand-piece').innerHTML = pieceSVG(g.selectedPiece);
}

function renderPool(g, myTurn) {
  const pool = $('pool');
  pool.innerHTML = '';
  const canSelect = myTurn && g.phase === 'select';
  for (const piece of g.pool) {
    const btn = document.createElement('button');
    btn.innerHTML = pieceSVG(piece);
    btn.title = pieceName(piece);
    if (canSelect) {
      btn.classList.add('selectable');
      btn.addEventListener('click', () => socket.emit('selectPiece', piece));
    }
    pool.appendChild(btn);
  }
}

function renderButtons(g, myTurn) {
  const boardFull = g.board.every((c) => c !== null);
  $('quarto-btn').classList.toggle('hidden', !myTurn);
  $('draw-btn').classList.toggle('hidden', !(myTurn && boardFull));
  $('new-game-btn').classList.toggle('hidden', !g.gameOver);
}

function renderBanner(g) {
  const banner = $('banner');
  if (!g.gameOver) {
    banner.className = 'banner hidden';
    return;
  }
  banner.classList.remove('hidden');
  if (g.draw) {
    banner.className = 'banner';
    banner.textContent = 'Oavgjort! Brädet vilar.';
    return;
  }
  const mine = g.winner === me;
  banner.className = `banner ${mine ? 'win-mine' : 'win-theirs'}`;
  if (g.endReason === 'falseClaim') {
    banner.textContent = mine
      ? `${opponent()} ropade Quarto utan vinnande rad – du vinner!`
      : 'Falskt Quarto-utrop – du förlorar partiet.';
  } else {
    banner.textContent = mine ? 'Quarto! Du vann! 🎉' : `Quarto! ${g.winner} vann.`;
  }
}

// ---------- Canvas-konfettieffekt ----------

let confettiActive = false;
let confettiParticles = [];
const confettiCanvas = $('confetti-canvas');
const confettiCtx = confettiCanvas ? confettiCanvas.getContext('2d') : null;

function resizeConfettiCanvas() {
  if (confettiCanvas) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
}
window.addEventListener('resize', resizeConfettiCanvas);

class ConfettiParticle {
  constructor() {
    this.x = Math.random() * window.innerWidth;
    this.y = Math.random() * -window.innerHeight - 20;
    this.size = Math.random() * 8 + 6;
    // Använd färgpalett från det nya temat: guld, turkos, ljussand, korall
    this.color = ['#d4af37', '#f3c63f', '#2ec4b6', '#f4ebe1', '#ff5e5b'][Math.floor(Math.random() * 5)];
    this.speedX = Math.random() * 4 - 2;
    this.speedY = Math.random() * 5 + 4;
    this.rotation = Math.random() * 360;
    this.rotationSpeed = Math.random() * 4 - 2;
  }
  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.rotation += this.rotationSpeed;
    if (this.y > window.innerHeight) {
      this.y = -20;
      this.x = Math.random() * window.innerWidth;
    }
  }
  draw() {
    if (!confettiCtx) return;
    confettiCtx.save();
    confettiCtx.translate(this.x, this.y);
    confettiCtx.rotate((this.rotation * Math.PI) / 180);
    confettiCtx.fillStyle = this.color;
    confettiCtx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    confettiCtx.restore();
  }
}

function startConfetti() {
  if (confettiActive) return;
  confettiActive = true;
  resizeConfettiCanvas();
  confettiParticles = [];
  for (let i = 0; i < 120; i++) {
    confettiParticles.push(new ConfettiParticle());
  }
  animateConfetti();
}

function stopConfetti() {
  confettiActive = false;
  if (confettiCtx && confettiCanvas) {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

function animateConfetti() {
  if (!confettiActive) return;
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  for (let p of confettiParticles) {
    p.update();
    p.draw();
  }
  requestAnimationFrame(animateConfetti);
}

// ---------- Kudos: flygande utrop ----------

function showKudos(text) {
  const el = document.createElement('div');
  el.className = 'kudos';
  el.textContent = text;
  el.style.setProperty('--tilt', `${(Math.random() * 16 - 8).toFixed(1)}deg`);
  el.classList.add(['gold', 'red', 'jade'][Math.floor(Math.random() * 3)]);
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

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
// Sidovy: kropp + ovansida, hål ritas på ovansidan för ihåliga pjäser.

function pieceSVG(id) {
  const dark = id & 1;
  const tall = id & 2;
  const square = id & 4;
  const hollow = id & 8;

  const body = dark ? '#54331c' : '#dcab6b';
  const topColor = dark ? '#6e4426' : '#ecc488';
  const stroke = dark ? '#2e1a0c' : '#9c7236';
  const hole = dark ? '#1f1107' : '#8a6228';

  const topY = tall ? 10 : 34;
  const h = 60 - topY;
  let shapes = '';

  if (square) {
    shapes += `<rect x="7" y="${topY}" width="30" height="${h}" rx="3" fill="${body}" stroke="${stroke}" stroke-width="1.5"/>`;
    shapes += `<rect x="7" y="${topY}" width="30" height="7" rx="3" fill="${topColor}" stroke="${stroke}" stroke-width="1.2"/>`;
    if (hollow) shapes += `<rect x="15" y="${topY + 1.6}" width="14" height="3.8" rx="1.8" fill="${hole}"/>`;
  } else {
    shapes += `<path d="M7 ${topY + 4} v${h - 10} a15 6 0 0 0 30 0 v-${h - 10} z" fill="${body}" stroke="${stroke}" stroke-width="1.5"/>`;
    shapes += `<ellipse cx="22" cy="${topY + 4}" rx="15" ry="5.5" fill="${topColor}" stroke="${stroke}" stroke-width="1.2"/>`;
    if (hollow) shapes += `<ellipse cx="22" cy="${topY + 4}" rx="7" ry="2.6" fill="${hole}"/>`;
  }

  return `<svg viewBox="0 0 44 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${pieceName(id)}">${shapes}</svg>`;
}

function pieceName(id) {
  return [
    id & 1 ? 'mörk' : 'ljus',
    id & 2 ? 'hög' : 'låg',
    id & 4 ? 'fyrkantig' : 'rund',
    id & 8 ? 'ihålig' : 'massiv',
  ].join(', ');
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

// ---------- Rendering ----------

function opponent() {
  return me === PLAYERS[0] ? PLAYERS[1] : PLAYERS[0];
}

function render() {
  if (!me || !state) return;
  $('lobby').classList.add('hidden');
  $('game').classList.remove('hidden');

  const g = state.game;
  const myTurn = g.turn === me && !g.gameOver;

  renderPresence();
  $('score').textContent = `${PLAYERS[0]} ${state.scores[PLAYERS[0]]} – ${state.scores[PLAYERS[1]]} ${PLAYERS[1]}`;

  renderActionText(g, myTurn);
  renderBoard(g, myTurn);
  renderHand(g);
  renderPool(g, myTurn);
  renderButtons(g, myTurn);
  renderBanner(g);
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

function renderBoard(g, myTurn) {
  const board = $('board');
  board.innerHTML = '';
  const canPlace = myTurn && g.phase === 'place';
  for (let i = 0; i < 16; i++) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    const piece = g.board[i];
    if (piece !== null) {
      cell.innerHTML = pieceSVG(piece);
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
    banner.classList.add('hidden');
    banner.className = 'banner hidden';
    return;
  }
  banner.classList.remove('hidden');
  if (g.draw) {
    banner.className = 'banner';
    banner.textContent = 'Oavgjort!';
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

// ---------- Toast ----------

let toastTimer = null;
function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

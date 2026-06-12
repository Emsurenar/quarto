// Quarto-spellogik, fristående från nätverkslagret så att den kan enhetstestas.
//
// Pjäser kodas som heltal 0–15 där varje bit är en egenskap:
//   bit 0: 0 = ljus,    1 = mörk
//   bit 1: 0 = låg,     1 = hög
//   bit 2: 0 = rund,    1 = fyrkantig
//   bit 3: 0 = massiv,  1 = ihålig
//
// Turflöde: spelaren vars tur det är ("turn") agerar enligt "phase":
//   phase "select": välj en pjäs ur poolen och ge till motståndaren
//   phase "place":  placera den mottagna pjäsen på en ledig ruta
// Efter en placering går turen INTE över – samma spelare väljer nästa pjäs.

const PLAYERS = ['Emre', 'Rakel'];

const LINES = [];
for (let r = 0; r < 4; r++) LINES.push([4 * r, 4 * r + 1, 4 * r + 2, 4 * r + 3]);
for (let c = 0; c < 4; c++) LINES.push([c, c + 4, c + 8, c + 12]);
LINES.push([0, 5, 10, 15]);
LINES.push([3, 6, 9, 12]);

function otherPlayer(player) {
  return player === PLAYERS[0] ? PLAYERS[1] : PLAYERS[0];
}

// Hittar en vinnande rad på brädet, eller null. Fyra pjäser i rad vinner
// om de delar minst en egenskap (alla har biten satt, eller ingen har den).
function findWinningLine(board) {
  for (const line of LINES) {
    const pieces = line.map((i) => board[i]);
    if (pieces.some((p) => p === null)) continue;
    const allSet = pieces.reduce((acc, p) => acc & p, 0xf);
    const allClear = pieces.reduce((acc, p) => acc & ~p, 0xf);
    if (allSet !== 0 || allClear !== 0) return line;
  }
  return null;
}

function createMatch() {
  const starter = PLAYERS[Math.floor(Math.random() * 2)];
  return {
    scores: { [PLAYERS[0]]: 0, [PLAYERS[1]]: 0 },
    nextStarter: starter,
    game: createGame(starter),
  };
}

function createGame(starter) {
  return {
    board: Array(16).fill(null),
    pool: Array.from({ length: 16 }, (_, i) => i),
    selectedPiece: null,
    turn: starter,
    starter,
    phase: 'select',
    lastMove: null, // senast placerade ruta, för markering i UI:t
    gameOver: false,
    winner: null,
    draw: false,
    winningLine: null,
    endReason: null, // 'quarto' | 'falseClaim' | 'draw'
  };
}

// Räknar "heta" rader genom en nyss placerad ruta: rader med exakt tre
// pjäser som delar minst en egenskap. Används för att belöna spännande drag.
function placementThreats(board, cell) {
  let threats = 0;
  for (const line of LINES) {
    if (!line.includes(cell)) continue;
    const pieces = line.map((i) => board[i]).filter((p) => p !== null);
    if (pieces.length !== 3) continue;
    const allSet = pieces.reduce((acc, p) => acc & p, 0xf);
    const allClear = pieces.reduce((acc, p) => acc & ~p, 0xf);
    if (allSet !== 0 || allClear !== 0) threats += 1;
  }
  return threats;
}

// Alla actions returnerar { ok: true } eller { ok: false, error: '...' }
// och muterar matchens game-objekt vid ok.

function selectPiece(match, player, piece) {
  const g = match.game;
  if (g.gameOver) return { ok: false, error: 'Spelet är slut.' };
  if (g.turn !== player) return { ok: false, error: 'Inte din tur.' };
  if (g.phase !== 'select') return { ok: false, error: 'Du ska placera en pjäs, inte välja.' };
  if (!g.pool.includes(piece)) return { ok: false, error: 'Pjäsen är inte tillgänglig.' };

  g.pool = g.pool.filter((p) => p !== piece);
  g.selectedPiece = piece;
  g.turn = otherPlayer(player);
  g.phase = 'place';
  return { ok: true };
}

function placePiece(match, player, cell) {
  const g = match.game;
  if (g.gameOver) return { ok: false, error: 'Spelet är slut.' };
  if (g.turn !== player) return { ok: false, error: 'Inte din tur.' };
  if (g.phase !== 'place') return { ok: false, error: 'Du ska välja en pjäs, inte placera.' };
  if (!Number.isInteger(cell) || cell < 0 || cell > 15) return { ok: false, error: 'Ogiltig ruta.' };
  if (g.board[cell] !== null) return { ok: false, error: 'Rutan är upptagen.' };

  g.board[cell] = g.selectedPiece;
  g.selectedPiece = null;
  g.lastMove = cell;
  g.phase = 'select';
  // turn förblir samma spelare: hen väljer nu nästa pjäs (eller ropar Quarto).
  return { ok: true };
}

// Spelaren vars tur det är kan när som helst ropa Quarto. Finns en vinnande
// rad vinner hen; annars är utropet falskt och motståndaren vinner direkt.
function claimQuarto(match, player) {
  const g = match.game;
  if (g.gameOver) return { ok: false, error: 'Spelet är slut.' };
  if (g.turn !== player) return { ok: false, error: 'Inte din tur.' };

  const line = findWinningLine(g.board);
  if (line) {
    endGame(match, player, 'quarto', line);
  } else {
    endGame(match, otherPlayer(player), 'falseClaim', null);
  }
  return { ok: true };
}

// När brädet är fullt kan spelaren i tur avsluta partiet oavgjort
// (i stället för att ropa Quarto).
function claimDraw(match, player) {
  const g = match.game;
  if (g.gameOver) return { ok: false, error: 'Spelet är slut.' };
  if (g.turn !== player) return { ok: false, error: 'Inte din tur.' };
  if (g.board.some((c) => c === null)) return { ok: false, error: 'Brädet är inte fullt.' };

  g.gameOver = true;
  g.draw = true;
  g.endReason = 'draw';
  return { ok: true };
}

function endGame(match, winner, reason, line) {
  const g = match.game;
  g.gameOver = true;
  g.winner = winner;
  g.endReason = reason;
  g.winningLine = line;
  match.scores[winner] += 1;
}

// Startar nästa parti; startspelaren alternerar.
function newGame(match) {
  if (!match.game.gameOver) return { ok: false, error: 'Partiet pågår fortfarande.' };
  match.nextStarter = otherPlayer(match.nextStarter);
  match.game = createGame(match.nextStarter);
  return { ok: true };
}

module.exports = {
  PLAYERS,
  LINES,
  otherPlayer,
  findWinningLine,
  placementThreats,
  createMatch,
  createGame,
  selectPiece,
  placePiece,
  claimQuarto,
  claimDraw,
  newGame,
};

// Enhetstester för spellogiken. Körs med: node test/game.test.js
const assert = require('assert');
const {
  PLAYERS,
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
} = require('../game');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Hjälpare: skapa match med känd startspelare.
function matchWithStarter(starter) {
  const match = createMatch();
  match.nextStarter = starter;
  match.game = createGame(starter);
  return match;
}

test('vinstrad hittas: fyra mörka pjäser på en rad', () => {
  const board = Array(16).fill(null);
  // bit 0 satt = mörk: pjäserna 1, 3, 5, 7 är alla mörka
  [1, 3, 5, 7].forEach((p, i) => (board[i] = p));
  assert.deepStrictEqual(findWinningLine(board), [0, 1, 2, 3]);
});

test('vinstrad hittas: gemensam egenskap genom att ingen har biten (alla ljusa)', () => {
  const board = Array(16).fill(null);
  // bit 0 ej satt = ljus: 0, 2, 4, 6 i kolumn 0 (rutor 0,4,8,12)
  board[0] = 0; board[4] = 2; board[8] = 4; board[12] = 6;
  assert.deepStrictEqual(findWinningLine(board), [0, 4, 8, 12]);
});

test('vinstrad hittas på diagonal', () => {
  const board = Array(16).fill(null);
  // 8, 9, 10, 11 har alla bit 3 satt (ihåliga)
  board[0] = 8; board[5] = 9; board[10] = 10; board[15] = 11;
  assert.deepStrictEqual(findWinningLine(board), [0, 5, 10, 15]);
});

test('ingen vinstrad när egenskaperna spretar', () => {
  const board = Array(16).fill(null);
  // 0 (0000), 15 (1111), 5 (0101), 10 (1010) delar ingen egenskap
  board[0] = 0; board[1] = 15; board[2] = 5; board[3] = 10;
  assert.strictEqual(findWinningLine(board), null);
});

test('turflöde: välj → motståndaren placerar → samma spelare väljer igen', () => {
  const m = matchWithStarter('Emre');
  assert.strictEqual(m.game.phase, 'select');
  assert.ok(selectPiece(m, 'Emre', 5).ok);
  assert.strictEqual(m.game.turn, 'Rakel');
  assert.strictEqual(m.game.phase, 'place');
  assert.strictEqual(m.game.selectedPiece, 5);
  assert.ok(placePiece(m, 'Rakel', 0).ok);
  assert.strictEqual(m.game.board[0], 5);
  assert.strictEqual(m.game.turn, 'Rakel'); // Rakel väljer nu pjäs åt Emre
  assert.strictEqual(m.game.phase, 'select');
  assert.ok(!m.game.pool.includes(5));
});

test('regelbrott avvisas: fel tur, fel fas, upptagen ruta, tagen pjäs', () => {
  const m = matchWithStarter('Emre');
  assert.ok(!selectPiece(m, 'Rakel', 3).ok); // inte Rakels tur
  assert.ok(!placePiece(m, 'Emre', 0).ok); // fel fas
  selectPiece(m, 'Emre', 3);
  assert.ok(!selectPiece(m, 'Rakel', 3).ok); // fel fas (ska placera)
  placePiece(m, 'Rakel', 7);
  selectPiece(m, 'Rakel', 4);
  assert.ok(!placePiece(m, 'Emre', 7).ok); // upptagen ruta
  assert.ok(!selectPiece(m, 'Emre', 3).ok); // pjäs 3 redan tagen (och fel fas)
});

test('korrekt Quarto-utrop ger vinst och poäng', () => {
  const m = matchWithStarter('Emre');
  // Bygg rad 0 med fyra mörka pjäser: 1, 3, 5, 7
  selectPiece(m, 'Emre', 1); placePiece(m, 'Rakel', 0);
  selectPiece(m, 'Rakel', 3); placePiece(m, 'Emre', 1);
  selectPiece(m, 'Emre', 5); placePiece(m, 'Rakel', 2);
  selectPiece(m, 'Rakel', 7); placePiece(m, 'Emre', 3);
  assert.ok(claimQuarto(m, 'Emre').ok);
  assert.strictEqual(m.game.winner, 'Emre');
  assert.strictEqual(m.game.endReason, 'quarto');
  assert.deepStrictEqual(m.game.winningLine, [0, 1, 2, 3]);
  assert.strictEqual(m.scores.Emre, 1);
  assert.strictEqual(m.scores.Rakel, 0);
});

test('falskt Quarto-utrop ger motståndaren vinsten', () => {
  const m = matchWithStarter('Emre');
  selectPiece(m, 'Emre', 0); placePiece(m, 'Rakel', 0);
  assert.ok(claimQuarto(m, 'Rakel').ok);
  assert.strictEqual(m.game.winner, 'Emre');
  assert.strictEqual(m.game.endReason, 'falseClaim');
  assert.strictEqual(m.scores.Emre, 1);
});

test('endast spelaren i tur kan ropa Quarto', () => {
  const m = matchWithStarter('Emre');
  assert.ok(!claimQuarto(m, 'Rakel').ok);
});

test('oavgjort kräver fullt bräde', () => {
  const m = matchWithStarter('Emre');
  assert.ok(!claimDraw(m, 'Emre').ok);
});

test('oavgjort på fullt bräde avslutar utan poäng', () => {
  const m = matchWithStarter('Emre');
  m.game.board = Array.from({ length: 16 }, (_, i) => i);
  m.game.pool = [];
  assert.ok(claimDraw(m, 'Emre').ok);
  assert.strictEqual(m.game.draw, true);
  assert.strictEqual(m.game.winner, null);
  assert.strictEqual(m.scores.Emre + m.scores.Rakel, 0);
});

test('nytt parti: startspelaren alternerar och brädet nollställs', () => {
  const m = matchWithStarter('Emre');
  assert.ok(!newGame(m).ok); // pågående parti kan inte startas om
  selectPiece(m, 'Emre', 0); placePiece(m, 'Rakel', 0);
  claimQuarto(m, 'Rakel'); // falskt utrop, partiet slut
  assert.ok(newGame(m).ok);
  assert.strictEqual(m.game.starter, 'Rakel');
  assert.strictEqual(m.game.gameOver, false);
  assert.strictEqual(m.game.pool.length, 16);
  assert.ok(m.game.board.every((c) => c === null));
  assert.strictEqual(m.scores.Emre, 1); // poängen ligger kvar
});

test('inga drag accepteras efter spelets slut', () => {
  const m = matchWithStarter('Emre');
  selectPiece(m, 'Emre', 0); placePiece(m, 'Rakel', 0);
  claimQuarto(m, 'Rakel');
  assert.ok(!selectPiece(m, 'Rakel', 1).ok);
  assert.ok(!placePiece(m, 'Rakel', 1).ok);
  assert.ok(!claimQuarto(m, 'Rakel').ok);
});

test('lastMove pekar på senast placerade rutan', () => {
  const m = matchWithStarter('Emre');
  assert.strictEqual(m.game.lastMove, null);
  selectPiece(m, 'Emre', 4);
  placePiece(m, 'Rakel', 9);
  assert.strictEqual(m.game.lastMove, 9);
});

test('placementThreats räknar rader med tre pjäser och gemensam egenskap', () => {
  const board = Array(16).fill(null);
  // Rad 0 har tre mörka pjäser (1, 3, 5) – placeringen på ruta 2 fullbordar hotet.
  board[0] = 1; board[1] = 3; board[2] = 5;
  assert.strictEqual(placementThreats(board, 2), 1);
  // En ensam pjäs hotar ingenting.
  const lone = Array(16).fill(null);
  lone[0] = 1;
  assert.strictEqual(placementThreats(lone, 0), 0);
  // Tre pjäser utan gemensam egenskap är inget hot: 0 (0000), 15 (1111), 5 (0101).
  const mixed = Array(16).fill(null);
  mixed[0] = 0; mixed[1] = 15; mixed[2] = 5;
  assert.strictEqual(placementThreats(mixed, 2), 0);
  // En placering i ett hörn kan hota flera rader samtidigt:
  // pjäs 1 (mörk) på ruta 0 ger tre mörka i både rad 0 och kolumn 0.
  const corner = Array(16).fill(null);
  corner[0] = 1;                  // placeringen själv
  corner[1] = 3; corner[2] = 5;   // rad 0: tre mörka
  corner[4] = 7; corner[8] = 9;   // kolumn 0: tre mörka
  assert.strictEqual(placementThreats(corner, 0), 2);
  // En fullbordad rad (fyra pjäser) räknas inte som hot.
  corner[3] = 11;
  assert.strictEqual(placementThreats(corner, 0), 1);
});

test('otherPlayer växlar mellan de två spelarna', () => {
  assert.strictEqual(otherPlayer(PLAYERS[0]), PLAYERS[1]);
  assert.strictEqual(otherPlayer(PLAYERS[1]), PLAYERS[0]);
});

console.log(`\ngame.test.js: ${passed} tester gröna`);

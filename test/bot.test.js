// Enhetstester för boten. Körs med: node test/bot.test.js
const assert = require('assert');
const logic = require('../game');
const bot = require('../public/bot');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Hjälpare: bygg ett spelläge direkt (utan att spela fram det).
function gameWith({ board, pool, selectedPiece = null, turn, phase, lastMove = null }) {
  return {
    board,
    pool,
    selectedPiece,
    turn,
    starter: turn,
    phase,
    lastMove,
    gameOver: false,
    winner: null,
    draw: false,
    winningLine: null,
    endReason: null,
  };
}

function boardWith(entries) {
  const board = Array(16).fill(null);
  for (const [cell, piece] of entries) board[cell] = piece;
  return board;
}

// Rad 0 har tre mörka+massiva pjäser (1, 3, 5): ruta 3 vinner med varje pjäs
// som är mörk (bit 0) eller massiv (bit 3 = 0).
function threatGame(extra = {}) {
  return gameWith({
    board: boardWith([[0, 1], [1, 3], [2, 5]]),
    pool: [7, 8, 9, 10],
    turn: 'Raquel',
    phase: 'select',
    lastMove: 2,
    ...extra,
  });
}

test('winningCells hittar den fullbordande rutan', () => {
  const g = threatGame();
  assert.deepStrictEqual(bot.winningCells(g.board, 7), [3]); // mörk → vinner
  assert.deepStrictEqual(bot.winningCells(g.board, 8), []);  // ljus+ihålig → ofarlig
});

for (const level of ['medium', 'hard']) {
  test(`${level}: tar omedelbar vinst och ropar Quarto`, () => {
    const g = threatGame({ phase: 'place', selectedPiece: 7, pool: [8, 9, 10] });
    const a = bot.chooseAction(g, 'Raquel', level, { budget: 100 });
    assert.deepStrictEqual(a, { type: 'place', cell: 3 });
    // Efter placeringen: själv claim:a i select-fasen.
    g.board[3] = 7;
    g.selectedPiece = null;
    g.phase = 'select';
    g.lastMove = 3;
    const b = bot.chooseAction(g, 'Raquel', level, { budget: 100 });
    assert.deepStrictEqual(b, { type: 'claimQuarto' });
  });

  test(`${level}: ger aldrig en direkt vinnande pjäs när säkert val finns`, () => {
    for (let i = 0; i < 30; i++) {
      const g = threatGame(); // pool [7, 8, 9, 10]: 7 och 9 är mörka, 8 och 10 säkra
      const a = bot.chooseAction(g, 'Raquel', level, { budget: 60 });
      assert.strictEqual(a.type, 'select');
      assert.ok([8, 10].includes(a.piece), `gav farlig pjäs ${a.piece}`);
    }
  });

  test(`${level}: ropar Quarto vid turstart om motståndaren missat en rad`, () => {
    const g = gameWith({
      board: boardWith([[0, 1], [1, 3], [2, 5], [3, 7]]), // hel mörk rad, oropad
      pool: [8, 9, 10],
      selectedPiece: 12,
      turn: 'Raquel',
      phase: 'place',
      lastMove: 3,
    });
    const a = bot.chooseAction(g, 'Raquel', level, { budget: 60 });
    assert.deepStrictEqual(a, { type: 'claimQuarto' });
  });
}

test('lätt: ropar på sin egen rad men missar motståndarens', () => {
  // Raden går genom lastMove = botens egen placering → claim.
  const own = gameWith({
    board: boardWith([[0, 1], [1, 3], [2, 5], [3, 7]]),
    pool: [8, 9, 10],
    turn: 'Raquel',
    phase: 'select',
    lastMove: 3,
  });
  assert.deepStrictEqual(bot.chooseAction(own, 'Raquel', 'easy'), { type: 'claimQuarto' });

  // Samma rad men lastMove någon annanstans → boten ger en pjäs i stället.
  const missed = gameWith({
    board: boardWith([[0, 1], [1, 3], [2, 5], [3, 7], [8, 12]]),
    pool: [9, 10],
    turn: 'Raquel',
    phase: 'select',
    lastMove: 8,
  });
  const a = bot.chooseAction(missed, 'Raquel', 'easy');
  assert.strictEqual(a.type, 'select');
});

test('fullt bräde utan rad: alla nivåer ropar remi', () => {
  // Slumpa fram ett fullt bräde utan vinstrad.
  let board;
  do {
    const pieces = Array.from({ length: 16 }, (_, i) => i);
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    board = pieces;
  } while (logic.findWinningLine(board) !== null);

  for (const level of ['easy', 'medium', 'hard']) {
    const g = gameWith({ board: board.slice(), pool: [], turn: 'Raquel', phase: 'select', lastMove: 0 });
    const a = bot.chooseAction(g, 'Raquel', level, { budget: 60 });
    assert.deepStrictEqual(a, { type: 'claimDraw' }, `nivå ${level}`);
  }
});

test('svår: undviker gaffeln — placerar inte pjäsen så att varje gåva förlorar', () => {
  // Rad 0 [0,1,2,_]: tre mörka (1, 3, 5). Kolumn 3 [3,7,11,15]: 7 och 15 ihåliga+mörka,
  // 11 på plats 11. Boten håller pjäs 8 (ljus, låg, rund, ihålig).
  // Att placera 8 på ruta 3 dödar mörka raden (8 är ljus) MEN fullbordar tre
  // ihåliga i kolumn 3 → båda hoten kvar... Vi testar i stället egenskapen
  // direkt: i ett läge med en känd förlorande placering och minst en säker,
  // väljer svår aldrig den förlorande.
  //
  // Läge: rad 0 har 1, 3, 5 (mörka, massiva). Pool: [7, 9] — båda mörka, dvs.
  // varje gåva vinner för motståndaren OM ruta 3 fortfarande är ledig och het.
  // Botens pjäs är 8 (ljus + ihålig): placeras den på ruta 3 dör raden och
  // båda gåvorna blir säkra; placeras den någon annanstans förlorar boten.
  const g = gameWith({
    board: boardWith([[0, 1], [1, 3], [2, 5]]),
    pool: [7, 9],
    selectedPiece: 8,
    turn: 'Raquel',
    phase: 'place',
  });
  for (let i = 0; i < 10; i++) {
    const a = bot.chooseAction(g, 'Raquel', 'hard', { budget: 150 });
    assert.deepStrictEqual(a, { type: 'place', cell: 3 }, 'svår borde desarmera raden');
  }
});

// ---------- Självspel: lagligt hela vägen och rimlig styrkeordning ----------

function applyAction(match, seat, action) {
  switch (action.type) {
    case 'place': return logic.placePiece(match, seat, action.cell);
    case 'select': return logic.selectPiece(match, seat, action.piece);
    case 'claimQuarto': return logic.claimQuarto(match, seat);
    case 'claimDraw': return logic.claimDraw(match, seat);
    default: return { ok: false, error: `okänd handling ${action.type}` };
  }
}

function playGame(levelBySeat, opts) {
  const match = logic.createMatch();
  let steps = 0;
  while (!match.game.gameOver && steps++ < 200) {
    const seat = match.game.turn;
    const action = bot.chooseAction(match.game, seat, levelBySeat[seat], opts);
    assert.ok(action, `${levelBySeat[seat]} returnerade ingen handling`);
    const r = applyAction(match, seat, action);
    assert.ok(r.ok, `olaglig handling av ${levelBySeat[seat]}: ${JSON.stringify(action)} → ${r.error}`);
  }
  assert.ok(match.game.gameOver, 'partiet tog aldrig slut');
  return match.game;
}

test('självspel lätt mot lätt: alltid lagligt, alltid ett avslut', () => {
  for (let i = 0; i < 20; i++) {
    playGame({ Emreos: 'easy', Raquel: 'easy' });
  }
});

test('självspel: svår besegrar lätt klart oftare än tvärtom', () => {
  let hardWins = 0;
  const games = 6;
  for (let i = 0; i < games; i++) {
    const hardSeat = i % 2 === 0 ? 'Emreos' : 'Raquel';
    const easySeat = logic.otherPlayer(hardSeat);
    const g = playGame({ [hardSeat]: 'hard', [easySeat]: 'easy' }, { budget: 100 });
    assert.notStrictEqual(g.endReason, 'falseClaim', 'ingen ska ropa falskt');
    if (g.winner === hardSeat) hardWins++;
  }
  assert.ok(hardWins >= games - 1, `svår vann bara ${hardWins} av ${games} mot lätt`);
});

console.log(`\nbot.test.js: ${passed} tester gröna`);

// Integrationstest: startar servern och låter två socket.io-klienter
// (Emreos och Raquel) spela ett helt parti. Körs med: node test/socket.test.js
process.env.PORT = '3199';
const assert = require('assert');
const { io: ioc } = require('socket.io-client');
const { server } = require('../server');

const URL = 'http://localhost:3199';

function connect(name) {
  return new Promise((resolve, reject) => {
    const socket = ioc(URL, { transports: ['websocket'] });
    socket.on('connect_error', reject);
    socket.on('connect', () => {
      socket.emit('join', name, (res) => {
        if (!res.ok) return reject(new Error(res.error));
        resolve({ socket, state: res.state });
      });
    });
  });
}

// Väntar på nästa händelse av en viss typ, med timeout.
function nextEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout: väntade på "${event}"`)),
      timeoutMs
    );
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Broadcasts är globala och sekvensnumrerade; håll koll på senast sedda
// så att en buffrad äldre broadcast på en annan socket inte misstas för svaret.
let lastSeq = 0;

// Skickar en action och väntar på NÄSTA state-broadcast (seq > lastSeq).
function act(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout: väntade på state efter "${event}"`)),
      3000
    );
    function handler(data) {
      if (data.seq <= lastSeq) return; // gammalt tillstånd, ignorera
      lastSeq = data.seq;
      clearTimeout(timer);
      socket.off('state', handler);
      resolve(data);
    }
    socket.on('state', handler);
    socket.emit(event, ...args);
  });
}

async function main() {
  let passed = 0;
  const ok = (name) => {
    passed++;
    console.log(`  ✓ ${name}`);
  };

  const emre = await connect('Emreos');
  assert.strictEqual(emre.state.presence.Emreos, true);
  assert.strictEqual(emre.state.presence.Raquel, false);
  ok('Emreos ansluter och ser att Raquel är offline');

  const presencePromise = nextEvent(emre.socket, 'presence');
  const rakel = await connect('Raquel');
  const p = await presencePromise;
  assert.strictEqual(p.Raquel, true);
  ok('Emreos får presence-uppdatering direkt när Raquel ansluter');

  // Vem som börjar slumpas vid serverstart – läs det ur tillståndet.
  const starterName = rakel.state.game.turn;
  const other = starterName === 'Emreos' ? 'Raquel' : 'Emreos';
  const sock = { Emreos: emre.socket, Raquel: rakel.socket };
  const starter = sock[starterName];
  const opponent = sock[other];

  // Fel spelare försöker välja pjäs → errorMsg, inget state-broadcast.
  const errPromise = nextEvent(opponent, 'errorMsg');
  opponent.emit('selectPiece', 0);
  const err = await errPromise;
  assert.strictEqual(err, 'Inte din tur.');
  ok('drag i fel tur avvisas med felmeddelande');

  // Starter väljer pjäs 1 (mörk) → motståndaren ser det direkt.
  const opponentSees = nextEvent(opponent, 'state');
  let state = await act(starter, 'selectPiece', 1);
  const opponentState = await opponentSees;
  assert.strictEqual(state.game.selectedPiece, 1);
  assert.strictEqual(opponentState.game.selectedPiece, 1);
  assert.strictEqual(opponentState.game.turn, other);
  assert.strictEqual(opponentState.game.phase, 'place');
  ok('pjäsval syns direkt hos båda spelarna');

  state = await act(opponent, 'placePiece', 0);
  assert.strictEqual(state.game.board[0], 1);
  assert.strictEqual(state.game.turn, other); // placeraren väljer nästa pjäs
  ok('placering synkas och placeraren väljer nästa pjäs');

  // Spela klart en mörk rad: 3, 5, 7 placeras på rad 0 (rutorna 1, 2, 3).
  await act(opponent, 'selectPiece', 3);
  await act(starter, 'placePiece', 1);
  await act(starter, 'selectPiece', 5);
  await act(opponent, 'placePiece', 2);
  await act(opponent, 'selectPiece', 7);
  state = await act(starter, 'placePiece', 3);
  assert.deepStrictEqual(state.game.board.slice(0, 4), [1, 3, 5, 7]);
  ok('helt parti fram till vinstläge synkas korrekt');

  // Den som placerade sista pjäsen ropar Quarto och vinner.
  state = await act(starter, 'claimQuarto');
  assert.strictEqual(state.game.gameOver, true);
  assert.strictEqual(state.game.winner, starterName);
  assert.deepStrictEqual(state.game.winningLine, [0, 1, 2, 3]);
  assert.strictEqual(state.scores[starterName], 1);
  ok('Quarto-utrop ger vinst, vinnande rad och poäng hos båda');

  // Revansch: nytt parti med alternerad startspelare.
  state = await act(opponent, 'newGame');
  assert.strictEqual(state.game.gameOver, false);
  assert.strictEqual(state.game.starter, other); // startspelaren alternerar
  assert.strictEqual(state.game.pool.length, 16);
  assert.strictEqual(state.scores[starterName], 1);
  ok('nytt parti nollställer brädet men behåller poängen');

  // Återanslutning: Raquel "laddar om sidan" och får aktuellt tillstånd.
  rakel.socket.disconnect();
  const offline = await nextEvent(emre.socket, 'presence');
  assert.strictEqual(offline.Raquel, false);
  ok('Emreos ser direkt att Raquel går offline');

  const rakel2 = await connect('Raquel');
  assert.strictEqual(rakel2.state.game.pool.length, 16);
  assert.strictEqual(rakel2.state.scores[starterName], 1);
  ok('omladdning ger tillbaka pågående match med poäng');

  // Nollställ poängställningen via socket
  state = await act(emre.socket, 'resetScores');
  assert.strictEqual(state.scores.Emreos, 0);
  assert.strictEqual(state.scores.Raquel, 0);
  ok('nollställning av poäng via socket uppdaterar båda parter');

  emre.socket.disconnect();
  rakel2.socket.disconnect();
  server.close();
  console.log(`\nsocket.test.js: ${passed} tester gröna`);
  process.exit(0);
}

main().catch((err) => {
  console.error('TEST MISSLYCKADES:', err);
  process.exit(1);
});

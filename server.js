// Quarto-server: Express serverar frontend, Socket.IO synkar spelet i realtid.
// Hela matchen (bräde, tur, poäng) ligger i serverminnet, så ett parti
// överlever sidomladdningar men nollställs om servern startas om.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const logic = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const match = logic.createMatch();
match.metadata = {
  Emreos: { name: 'Emreos', avatar: 'emreos.jpg' },
  Raquel: { name: 'Raquel', avatar: 'raquel.jpg' }
};

// Antal anslutna sockets per spelare (samma person kan ha flera flikar).
const connections = { Emreos: 0, Raquel: 0 };

function presence() {
  return { Emreos: connections.Emreos > 0, Raquel: connections.Raquel > 0 };
}

// Sekvensnummer så att klienter kan ignorera tillstånd som kommer i fel ordning.
let seq = 0;

function fullState() {
  return { seq, game: match.game, scores: match.scores, presence: presence(), metadata: match.metadata };
}

function broadcastState() {
  seq += 1;
  io.emit('state', fullState());
}

// Små utrop som ibland belönar drag. Heta drag (skapar tre i rad med
// gemensam egenskap) belönas oftare, men även vanliga drag kan få beröm —
// slumpen gör att utropet aldrig är en pålitlig signal om brädesläget.
const KUDOS = [
  'Woah!',
  'Nämen!',
  'Det är inte möjligt!',
  'Oj oj oj!',
  'Snyggt!',
  'Listigt …',
  'Vågat!',
  'Aj aj aj!',
  'Mästerligt!',
  'Dramatik!',
];

function maybeKudos(player, cell) {
  if (match.game.gameOver) return;
  const threats = logic.placementThreats(match.game.board, cell);
  const chance = threats > 0 ? 0.65 : 0.15;
  if (Math.random() >= chance) return;
  const text = KUDOS[Math.floor(Math.random() * KUDOS.length)];
  io.emit('kudos', { text, player });
}

io.on('connection', (socket) => {
  let player = null;

  // Skicka aktuellt tillstånd direkt vid anslutning
  socket.emit('state', fullState());

  socket.on('join', (...args) => {
    const seat = args[0];
    let customName = null;
    let customAvatar = null;
    let ack = null;

    if (typeof args[args.length - 1] === 'function') {
      ack = args[args.length - 1];
    }
    if (args.length > 2 && typeof args[1] === 'string') {
      customName = args[1];
    }
    if (args.length > 3 && typeof args[2] === 'string') {
      customAvatar = args[2];
    }

    if (!logic.PLAYERS.includes(seat)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Okänd spelare.' });
      return;
    }
    if (player) connections[player] -= 1; // byter identitet i samma socket
    player = seat;
    connections[player] += 1;

    if (customName && customName.trim()) {
      match.metadata[seat].name = customName.trim();
    } else {
      match.metadata[seat].name = seat;
    }
    if (customAvatar) {
      match.metadata[seat].avatar = customAvatar;
    } else {
      match.metadata[seat].avatar = seat === 'Emreos' ? 'emreos.jpg' : 'raquel.jpg';
    }

    io.emit('presence', presence());
    broadcastState();
    if (typeof ack === 'function') ack({ ok: true, state: fullState() });
  });

  // Gemensam hantering: kör en spellogik-action, skicka fel till aktören
  // eller nytt tillstånd till alla.
  function handle(action, ...args) {
    if (!player) return;
    const result = action(match, player, ...args);
    if (result.ok) broadcastState();
    else socket.emit('errorMsg', result.error);
  }

  socket.on('selectPiece', (piece) => handle(logic.selectPiece, piece));

  socket.on('placePiece', (cell) => {
    if (!player) return;
    const result = logic.placePiece(match, player, cell);
    if (!result.ok) return socket.emit('errorMsg', result.error);
    broadcastState();
    maybeKudos(player, cell);
  });
  socket.on('claimQuarto', () => handle(logic.claimQuarto));
  socket.on('claimDraw', () => handle(logic.claimDraw));

  socket.on('newGame', () => {
    if (!player) return;
    const result = logic.newGame(match);
    if (result.ok) broadcastState();
    else socket.emit('errorMsg', result.error);
  });

  socket.on('resetScores', () => {
    if (!player) return;
    const result = logic.resetScores(match);
    if (result.ok) broadcastState();
    else socket.emit('errorMsg', result.error);
  });

  socket.on('disconnect', () => {
    if (!player) return;
    connections[player] -= 1;
    io.emit('presence', presence());
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Quarto-servern lyssnar på http://localhost:${PORT}`);
});

module.exports = { server, io };

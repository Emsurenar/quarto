// Quarto-server: Express serverar frontend, Socket.IO synkar spelet i realtid.
// Hela matchen (bräde, tur, poäng) ligger i serverminnet, så ett parti
// överlever sidomladdningar men nollställs om servern startas om.

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const logic = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const isTest = process.env.NODE_ENV === 'test';
const STATE_FILE = path.join(__dirname, 'match_state.json');

const match = logic.createMatch();
match.messages = [];

// Läs in sparat tillstånd vid serverstart (om vi inte kör tester)
if (!isTest && fs.existsSync(STATE_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (data.scores) match.scores = data.scores;
    if (data.game) match.game = data.game;
    if (data.messages) match.messages = data.messages;
    if (data.nextStarter) match.nextStarter = data.nextStarter;
    console.log('Matchtillstånd laddat från match_state.json');
  } catch (err) {
    console.error('Kunde inte ladda matchtillstånd:', err);
  }
}

function saveState() {
  if (isTest) return;
  const data = JSON.stringify({
    scores: match.scores,
    nextStarter: match.nextStarter,
    game: match.game,
    messages: match.messages
  }, null, 2);
  fs.writeFile(STATE_FILE, data, 'utf8', (err) => {
    if (err) console.error('Kunde inte spara matchtillstånd:', err);
  });
}

// Antal anslutna sockets per spelare (samma person kan ha flera flikar).
const connections = { Emreos: 0, Raquel: 0 };

function presence() {
  return { Emreos: connections.Emreos > 0, Raquel: connections.Raquel > 0 };
}

// Sekvensnummer så att klienter kan ignorera tillstånd som kommer i fel ordning.
let seq = 0;

function fullState() {
  return { seq, game: match.game, scores: match.scores, presence: presence(), messages: match.messages };
}

function broadcastState() {
  seq += 1;
  io.emit('state', fullState());
  saveState();
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

  socket.on('join', (seat, ack) => {
    if (!logic.PLAYERS.includes(seat)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Okänd spelare.' });
      return;
    }
    if (player) connections[player] -= 1; // byter identitet i samma socket
    player = seat;
    connections[player] += 1;

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

  socket.on('sendMessage', (text) => {
    if (!player) return;
    if (typeof text !== 'string') return;
    const cleanText = text.trim();
    if (!cleanText) return;
    const msg = {
      sender: player,
      text: cleanText.substring(0, 200),
      timestamp: Date.now()
    };
    match.messages = match.messages || [];
    match.messages.push(msg);
    if (match.messages.length > 50) {
      match.messages.shift();
    }
    io.emit('message', msg);
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

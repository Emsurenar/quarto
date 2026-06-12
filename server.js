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

// Antal anslutna sockets per spelare (samma person kan ha flera flikar).
const connections = { Emre: 0, Rakel: 0 };

function presence() {
  return { Emre: connections.Emre > 0, Rakel: connections.Rakel > 0 };
}

// Sekvensnummer så att klienter kan ignorera tillstånd som kommer i fel ordning.
let seq = 0;

function fullState() {
  return { seq, game: match.game, scores: match.scores, presence: presence() };
}

function broadcastState() {
  seq += 1;
  io.emit('state', fullState());
}

io.on('connection', (socket) => {
  let player = null;

  socket.on('join', (name, ack) => {
    if (!logic.PLAYERS.includes(name)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Okänd spelare.' });
      return;
    }
    if (player) connections[player] -= 1; // byter identitet i samma socket
    player = name;
    connections[player] += 1;
    io.emit('presence', presence());
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
  socket.on('placePiece', (cell) => handle(logic.placePiece, cell));
  socket.on('claimQuarto', () => handle(logic.claimQuarto));
  socket.on('claimDraw', () => handle(logic.claimDraw));

  socket.on('newGame', () => {
    if (!player) return;
    const result = logic.newGame(match);
    if (result.ok) broadcastState();
    else socket.emit('errorMsg', result.error);
  });

  socket.on('disconnect', () => {
    if (!player) return;
    connections[player] -= 1;
    io.emit('presence', presence());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Quarto-servern lyssnar på http://localhost:${PORT}`);
});

module.exports = { server, io };

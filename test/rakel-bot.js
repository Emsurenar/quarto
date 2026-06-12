// Testhjälpare: ansluter som Rakel och spelar automatiskt (väljer/placerar
// slumpmässigt, ropar aldrig Quarto). Används för manuell/visuell verifiering.
// Kör: node test/rakel-bot.js [url]
const { io: ioc } = require('socket.io-client');

const URL = process.argv[2] || 'http://localhost:3000';
const socket = ioc(URL, { transports: ['websocket'] });

function actOn(state) {
  const g = state.game;
  if (g.gameOver || g.turn !== 'Rakel') return;
  setTimeout(() => {
    if (g.phase === 'select') {
      const piece = g.pool[Math.floor(Math.random() * g.pool.length)];
      console.log(`Rakel väljer pjäs ${piece}`);
      socket.emit('selectPiece', piece);
    } else {
      const free = g.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
      const cell = free[Math.floor(Math.random() * free.length)];
      console.log(`Rakel placerar på ruta ${cell}`);
      socket.emit('placePiece', cell);
    }
  }, 600);
}

socket.on('connect', () => {
  socket.emit('join', 'Rakel', (res) => {
    console.log('Rakel ansluten.');
    if (res.ok) actOn(res.state);
  });
});

socket.on('state', actOn);
socket.on('errorMsg', (msg) => console.log('Fel:', msg));

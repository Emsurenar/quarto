// Lokal "låtsasserver" för spel mot boten. Samma kontrakt som socketvägen:
// emit('selectPiece' | 'placePiece' | 'claimQuarto' | 'claimDraw' |
// 'newGame' | 'resetScores') och tillstånd via onState-callbacken.
// Allt bor i webbläsaren — det delade onlinepartiet på servern berörs aldrig.
// Partiet sparas i localStorage per (plats, svårighetsgrad) och överlever
// alltså en sidomladdning, precis som serverpartiet gör.

(function (root) {
  const logic = root.QuartoLogic;

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

  function createLocalSession({ humanSeat, level, onState, onError, onKudos }) {
    const botSeat = logic.otherPlayer(humanSeat);
    const storageKey = `quarto.botmatch.v1.${humanSeat}.${level}`;
    const match = restore() || logic.createMatch();
    let seq = 0;
    let botTimer = null;
    let destroyed = false;

    function restore() {
      try {
        const data = JSON.parse(localStorage.getItem(storageKey));
        const g = data && data.game;
        if (!g || !Array.isArray(g.board) || g.board.length !== 16) return null;
        if (!Array.isArray(g.pool) || !logic.PLAYERS.includes(g.turn)) return null;
        return { scores: data.scores, nextStarter: data.nextStarter, game: g };
      } catch (e) {
        return null;
      }
    }

    function persist() {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ scores: match.scores, nextStarter: match.nextStarter, game: match.game })
        );
      } catch (e) {
        /* privat läge utan lagring är inte kritiskt */
      }
    }

    function broadcast() {
      if (destroyed) return;
      seq += 1;
      persist();
      onState(
        structuredClone({
          seq,
          game: match.game,
          scores: match.scores,
          presence: { [humanSeat]: true, [botSeat]: true },
          messages: [],
        })
      );
      scheduleBot();
    }

    // Samma utropslogik som servern: heta drag belönas oftare, men slumpen
    // gör att utropet aldrig är en pålitlig signal om brädesläget.
    function kudosCheck(cell) {
      if (match.game.gameOver || !onKudos) return;
      const threats = logic.placementThreats(match.game.board, cell);
      const chance = threats > 0 ? 0.65 : 0.15;
      if (Math.random() >= chance) return;
      onKudos(KUDOS[Math.floor(Math.random() * KUDOS.length)]);
    }

    // ---------- Botens tur: ett steg i taget med mänsklig betänketid ----------

    function scheduleBot() {
      clearTimeout(botTimer);
      const g = match.game;
      if (destroyed || g.gameOver || g.turn !== botSeat) return;
      botTimer = setTimeout(botStep, 550 + Math.random() * 500);
    }

    function botStep() {
      if (destroyed) return;
      const g = match.game;
      if (g.gameOver || g.turn !== botSeat) return;

      const action = root.QuartoBot.chooseAction(g, botSeat, level) || fallbackAction(g);
      let result = { ok: false, error: 'okänd handling' };
      if (action) {
        if (action.type === 'place') {
          result = logic.placePiece(match, botSeat, action.cell);
          if (result.ok) kudosCheck(action.cell);
        } else if (action.type === 'select') {
          result = logic.selectPiece(match, botSeat, action.piece);
        } else if (action.type === 'claimQuarto') {
          result = logic.claimQuarto(match, botSeat);
        } else if (action.type === 'claimDraw') {
          result = logic.claimDraw(match, botSeat);
        }
      }
      if (!result.ok) {
        // Skyddsnät så att partiet aldrig kan fastna på botens tur.
        const fb = fallbackAction(g);
        if (fb && fb.type === 'place') logic.placePiece(match, botSeat, fb.cell);
        else if (fb && fb.type === 'select') logic.selectPiece(match, botSeat, fb.piece);
        else if (fb) logic.claimDraw(match, botSeat);
      }
      broadcast();
    }

    function fallbackAction(g) {
      if (g.phase === 'place') {
        const free = g.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
        return { type: 'place', cell: free[Math.floor(Math.random() * free.length)] };
      }
      if (g.pool.length) {
        return { type: 'select', piece: g.pool[Math.floor(Math.random() * g.pool.length)] };
      }
      return { type: 'claimDraw' };
    }

    // ---------- Människans handlingar, samma namn som socket-händelserna ----------

    function emit(event, payload) {
      if (destroyed) return;
      let result;
      switch (event) {
        case 'selectPiece':
          result = logic.selectPiece(match, humanSeat, payload);
          break;
        case 'placePiece':
          result = logic.placePiece(match, humanSeat, payload);
          if (result.ok) kudosCheck(payload);
          break;
        case 'claimQuarto':
          result = logic.claimQuarto(match, humanSeat);
          break;
        case 'claimDraw':
          result = logic.claimDraw(match, humanSeat);
          break;
        case 'newGame':
          result = logic.newGame(match);
          break;
        case 'resetScores':
          result = logic.resetScores(match);
          break;
        default:
          return;
      }
      // Broadcast efter klientens optimistiska rendering, som över nätet.
      if (result.ok) queueMicrotask(broadcast);
      else if (onError) onError(result.error);
    }

    function start() {
      broadcast();
    }

    function destroy() {
      destroyed = true;
      clearTimeout(botTimer);
    }

    return { emit, start, destroy };
  }

  root.createLocalSession = createLocalSession;
})(window);

// Quarto-bot i tre svårighetsgrader. Ren beslutslogik utan nätverk och DOM,
// så att den kan enhetstestas i Node och köras direkt i webbläsaren.
//
// Gränssnitt: chooseAction(game, botSeat, level, opts) → exakt en handling:
//   { type: 'claimQuarto' } | { type: 'claimDraw' } |
//   { type: 'place', cell } | { type: 'select', piece }
// Adaptern utför handlingen och frågar igen tills turen lämnar boten.
//
// Nivåer:
//   easy   – placerar och ger slumpmässigt, ser bara sina egna fyror,
//            kan glatt ge bort en vinnande pjäs.
//   medium – tar varje omedelbar vinst, ropar på rader motståndaren missat
//            och ger aldrig bort en direkt vinnande pjäs om det går att undvika.
//   hard   – negamax med alfa–beta över (placering × gåva), iterativ
//            fördjupning under tidsbudget; spelar slutspelet perfekt.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../game'));
  } else {
    root.QuartoBot = factory(root.QuartoLogic);
  }
})(typeof self !== 'undefined' ? self : this, function (logic) {
  const LINES = logic.LINES;

  // Raderna genom varje ruta, för snabba vinstkontroller.
  const CELL_LINES = Array.from({ length: 16 }, (_, c) =>
    LINES.filter((line) => line.includes(c))
  );

  const WIN = 10000;
  const DEFAULT_BUDGET_MS = 600;

  function randomOf(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function emptyCells(board) {
    const out = [];
    for (let i = 0; i < 16; i++) if (board[i] === null) out.push(i);
    return out;
  }

  // Vinner pjäsen om den ställs på rutan? (rutan antas tom)
  function winsAt(board, cell, piece) {
    for (const line of CELL_LINES[cell]) {
      let andSet = piece;
      let andClear = ~piece & 0xf;
      let full = true;
      for (const i of line) {
        if (i === cell) continue;
        const p = board[i];
        if (p === null) {
          full = false;
          break;
        }
        andSet &= p;
        andClear &= ~p & 0xf;
      }
      if (full && (andSet !== 0 || andClear !== 0)) return true;
    }
    return false;
  }

  function winningCells(board, piece) {
    return emptyCells(board).filter((c) => winsAt(board, c, piece));
  }

  // ---------- Lätt ----------

  function easyPlace(g) {
    // Ser en vinnande placering bara ibland; annars ren slump.
    if (Math.random() < 0.35) {
      const wins = winningCells(g.board, g.selectedPiece);
      if (wins.length) return { type: 'place', cell: randomOf(wins) };
    }
    return { type: 'place', cell: randomOf(emptyCells(g.board)) };
  }

  // ---------- Medel ----------

  function mediumPlace(g) {
    const wins = winningCells(g.board, g.selectedPiece);
    if (wins.length) return { type: 'place', cell: randomOf(wins) };
    // Föredra placeringar som lämnar minst en ofarlig pjäs att ge bort.
    const empties = emptyCells(g.board);
    const board = g.board.slice();
    const keep = empties.filter((c) => {
      board[c] = g.selectedPiece;
      const ok = g.pool.some((p) => winningCells(board, p).length === 0);
      board[c] = null;
      return ok;
    });
    return { type: 'place', cell: randomOf(keep.length ? keep : empties) };
  }

  function mediumGive(g) {
    const safe = g.pool.filter((p) => winningCells(g.board, p).length === 0);
    return { type: 'select', piece: randomOf(safe.length ? safe : g.pool) };
  }

  // ---------- Svår: negamax med alfa–beta och iterativ fördjupning ----------
  //
  // Ett "drag" i sökningen är paret (placera pjäsen, välj gåva); båda görs av
  // samma spelare och negationen sker först när motståndaren ska placera.
  // Sökningen antar att båda spelarna alltid ropar Quarto på sina vinster —
  // boten litar aldrig på att människan missar en rad.

  const ABORT = {};

  function createSearch(g, budgetMs) {
    const board = g.board.slice();
    let poolMask = 0;
    for (const p of g.pool) poolMask |= 1 << p;
    const deadline = Date.now() + budgetMs;
    let nodes = 0;

    function checkTime() {
      nodes += 1;
      if ((nodes & 255) === 0 && Date.now() > deadline) throw ABORT;
    }

    // Statisk värdering för spelaren som står i tur att placera `piece`
    // (och som inte kan vinna direkt): många pjäser i poolen som passar en
    // het rad är dåligt, eftersom det är hen som ska ge bort nästa pjäs.
    function evalLeaf(poolMaskNow) {
      const hot = [];
      for (const line of LINES) {
        let andSet = 0xf;
        let andClear = 0xf;
        let n = 0;
        for (const i of line) {
          const p = board[i];
          if (p === null) continue;
          n += 1;
          andSet &= p;
          andClear &= ~p & 0xf;
        }
        if (n === 3 && (andSet | andClear)) hot.push([andSet, andClear]);
      }
      if (!hot.length) return 0;
      let dangerous = 0;
      for (let p = 0; p < 16; p++) {
        if (!(poolMaskNow & (1 << p))) continue;
        for (const [andSet, andClear] of hot) {
          if ((andSet & p) !== 0 || (andClear & ~p & 0xf) !== 0) {
            dangerous += 1;
            break;
          }
        }
      }
      return -(dangerous * 3 + hot.length);
    }

    // Värdet för spelaren som ska placera `piece`. ply = avstånd från roten,
    // används för att föredra snabba vinster och sena förluster.
    function valuePlace(piece, poolMaskNow, depth, ply, alpha, beta) {
      checkTime();
      for (let c = 0; c < 16; c++) {
        if (board[c] === null && winsAt(board, c, piece)) return WIN - ply;
      }
      if (depth <= 0) return evalLeaf(poolMaskNow);

      let best = -Infinity;
      outer: for (let c = 0; c < 16; c++) {
        if (board[c] !== null) continue;
        board[c] = piece;
        if (poolMaskNow === 0) {
          // Sista pjäsen lagd utan vinst: remi.
          board[c] = null;
          if (0 > best) best = 0;
          if (best > alpha) alpha = best;
          if (alpha >= beta) break;
          continue;
        }
        for (let p = 0; p < 16; p++) {
          const bit = 1 << p;
          if (!(poolMaskNow & bit)) continue;
          const v = -valuePlace(p, poolMaskNow & ~bit, depth - 1, ply + 1, -beta, -alpha);
          if (v > best) best = v;
          if (best > alpha) alpha = best;
          if (alpha >= beta) {
            board[c] = null;
            break outer;
          }
        }
        board[c] = null;
      }
      return best;
    }

    // Rot för placeringsval: poängsätt varje ledig ruta (utan omedelbar vinst,
    // det är redan avfärdat) med sin bästa gåva.
    function rootPlace(piece, depth, order) {
      let best = -Infinity;
      let bestCell = null;
      let alpha = -Infinity;
      for (const c of order) {
        board[c] = piece;
        let v;
        if (poolMask === 0) {
          v = 0;
        } else {
          v = -Infinity;
          for (let p = 0; p < 16; p++) {
            const bit = 1 << p;
            if (!(poolMask & bit)) continue;
            const s = -valuePlace(p, poolMask & ~bit, depth - 1, 1, -Infinity, -alpha);
            if (s > v) v = s;
            if (v > alpha) alpha = v;
          }
        }
        board[c] = null;
        if (v > best) {
          best = v;
          bestCell = c;
        }
        if (v > alpha) alpha = v;
      }
      return { move: bestCell, score: best };
    }

    // Rot för gåvoval: poängsätt varje pjäs i poolen.
    function rootGive(depth, order) {
      let best = -Infinity;
      let bestPiece = null;
      let alpha = -Infinity;
      for (const p of order) {
        const bit = 1 << p;
        const v = -valuePlace(p, poolMask & ~bit, depth - 1, 1, -Infinity, -alpha);
        if (v > best) {
          best = v;
          bestPiece = p;
        }
        if (v > alpha) alpha = v;
      }
      return { move: bestPiece, score: best };
    }

    return { board, rootPlace, rootGive };
  }

  // Iterativ fördjupning: sök allt djupare tills tidsbudgeten tar slut eller
  // läget är avgjort. Rotdragen blandas per varv så att likvärdiga drag
  // varieras mellan partier.
  function deepen(g, budgetMs, run) {
    const start = Date.now();
    const maxDepth = emptyCells(g.board).length;
    let best = null;
    for (let depth = 1; depth <= maxDepth; depth++) {
      if (Date.now() - start > budgetMs) break;
      try {
        const r = run(depth);
        if (r.move !== null) best = r;
        if (r.score >= WIN - 64 || r.score <= -WIN + 64) break;
      } catch (e) {
        if (e !== ABORT) throw e;
        break;
      }
    }
    return best;
  }

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function hardPlace(g, budgetMs) {
    const wins = winningCells(g.board, g.selectedPiece);
    if (wins.length) return { type: 'place', cell: randomOf(wins) };
    const empties = emptyCells(g.board);
    if (empties.length === 1) return { type: 'place', cell: empties[0] };

    const search = createSearch(g, budgetMs);
    const order = shuffled(empties);
    const best = deepen(g, budgetMs, (depth) => search.rootPlace(g.selectedPiece, depth, order));
    if (best && best.move !== null) return { type: 'place', cell: best.move };
    return mediumPlace(g); // skyddsnät: hann inte ens ett varv
  }

  function hardGive(g, budgetMs) {
    if (g.pool.length === 1) return { type: 'select', piece: g.pool[0] };
    const search = createSearch(g, budgetMs);
    const order = shuffled(g.pool);
    const best = deepen(g, budgetMs, (depth) => search.rootGive(depth, order));
    if (best && best.move !== null) return { type: 'select', piece: best.move };
    return mediumGive(g);
  }

  // ---------- Gemensam ingång ----------

  function chooseAction(game, botSeat, level, opts = {}) {
    const g = game;
    if (g.gameOver || g.turn !== botSeat) return null;
    const budget = opts.budget || DEFAULT_BUDGET_MS;
    const line = logic.findWinningLine(g.board);

    if (g.phase === 'place') {
      // Vid turstart kan motståndaren ha lämnat en vinstrad oropad —
      // den som är i tur får ropa på den. Lätt nivå märker inget.
      if (line && level !== 'easy') return { type: 'claimQuarto' };
      if (level === 'easy') return easyPlace(g);
      if (level === 'medium') return mediumPlace(g);
      return hardPlace(g, budget);
    }

    // phase 'select': boten har just placerat (eller inleder partiet).
    if (line) {
      const ownLine = g.lastMove !== null && line.includes(g.lastMove);
      if (level !== 'easy' || ownLine) return { type: 'claimQuarto' };
    }
    if (g.pool.length === 0) return { type: 'claimDraw' };
    if (level === 'easy') return { type: 'select', piece: randomOf(g.pool) };
    if (level === 'medium') return mediumGive(g);
    return hardGive(g, budget);
  }

  return { chooseAction, winningCells, winsAt };
});

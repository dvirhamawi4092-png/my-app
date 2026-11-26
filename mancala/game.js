/*
 * Mancala (Kalah rules)
 * Board indices:
 *   0..5   – player 0 pits (bottom / left side)
 *   6      – player 0 store
 *   7..12  – player 1 pits (top / right side)
 *   13     – player 1 store
 * Sowing goes counter-clockwise through increasing indices, skipping the opponent's store.
 */
(() => {
  "use strict";

  const STORE = [6, 13];
  const STEP_MS = 230;

  // ---------- Pure rules (used by both the game and the AI) ----------
  const ownsPit = (p, i) => (p === 0 ? i >= 0 && i <= 5 : i >= 7 && i <= 12);
  const opposite = (i) => 12 - i;
  const sideSum = (b, p) => {
    let s = 0;
    const start = p === 0 ? 0 : 7;
    for (let i = start; i < start + 6; i++) s += b[i];
    return s;
  };
  const legalMoves = (b, p) => {
    const out = [];
    const start = p === 0 ? 0 : 7;
    for (let i = start; i < start + 6; i++) if (b[i] > 0) out.push(i);
    return out;
  };

  /** Apply a move on a count board. Returns {board, next, over}. */
  function simulate(board, p, pit) {
    const b = board.slice();
    let n = b[pit];
    b[pit] = 0;
    let i = pit;
    while (n > 0) {
      i = (i + 1) % 14;
      if (i === STORE[1 - p]) continue;
      b[i]++;
      n--;
    }
    let next = 1 - p;
    if (i === STORE[p]) {
      next = p;
    } else if (ownsPit(p, i) && b[i] === 1 && b[opposite(i)] > 0) {
      b[STORE[p]] += b[i] + b[opposite(i)];
      b[i] = 0;
      b[opposite(i)] = 0;
    }
    let over = false;
    if (sideSum(b, 0) === 0 || sideSum(b, 1) === 0) {
      over = true;
      for (let k = 0; k < 6; k++) { b[6] += b[k]; b[k] = 0; }
      for (let k = 7; k < 13; k++) { b[13] += b[k]; b[k] = 0; }
    }
    return { board: b, next, over };
  }

  // ---------- AI (minimax + alpha-beta) ----------
  function evaluate(b, me) {
    const opp = 1 - me;
    return (b[STORE[me]] - b[STORE[opp]]) * 4 + (sideSum(b, me) - sideSum(b, opp));
  }

  function minimax(b, p, depth, alpha, beta, me) {
    const moves = legalMoves(b, p);
    if (depth === 0 || moves.length === 0) return evaluate(b, me);
    // Move ordering: moves that give an extra turn first
    moves.sort((x, y) => {
      const ex = (x + b[x]) % 13 === STORE[p] % 13 ? 1 : 0;
      const ey = (y + b[y]) % 13 === STORE[p] % 13 ? 1 : 0;
      return ey - ex;
    });
    if (p === me) {
      let best = -Infinity;
      for (const m of moves) {
        const r = simulate(b, p, m);
        const v = r.over
          ? (r.board[STORE[me]] - r.board[STORE[1 - me]]) * 1000
          : minimax(r.board, r.next, depth - 1, alpha, beta, me);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = Infinity;
    for (const m of moves) {
      const r = simulate(b, p, m);
      const v = r.over
        ? (r.board[STORE[me]] - r.board[STORE[1 - me]]) * 1000
        : minimax(r.board, r.next, depth - 1, alpha, beta, me);
      if (v < best) best = v;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseMove(b, p, level) {
    const moves = legalMoves(b, p);
    if (moves.length === 1) return moves[0];
    if (level === "easy" && Math.random() < 0.45) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    const depth = { easy: 1, medium: 4, hard: 9 }[level] || 4;
    let best = -Infinity;
    let bestMoves = [];
    for (const m of moves) {
      const r = simulate(b, p, m);
      const v = r.over
        ? (r.board[STORE[p]] - r.board[STORE[1 - p]]) * 1000
        : minimax(r.board, r.next, depth - 1, -Infinity, Infinity, p);
      if (v > best) { best = v; bestMoves = [m]; }
      else if (v === best) bestMoves.push(m);
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  // ---------- Sound ----------
  let audioCtx = null;
  let soundOn = true;
  function click(pitch = 1) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(520 * pitch, t);
      o.frequency.exponentialRampToValueAtTime(260 * pitch, t + 0.08);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.11);
    } catch (_) { /* audio not available */ }
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const layer = $("stone-layer");
  const statusEl = $("status");
  const pitEls = [];

  // Grid placement for horizontal (hr/hc) and vertical portrait (vr/vc) layouts
  function gridPos(i) {
    if (i === 13) return { hr: "1 / 3", hc: "1", vr: "1", vc: "1 / 3" };
    if (i === 6) return { hr: "1 / 3", hc: "8", vr: "8", vc: "1 / 3" };
    if (i < 6) return { hr: "2", hc: String(i + 2), vr: String(i + 2), vc: "1" };
    const j = i - 7; // 0..5, opposite of pit 5-j
    return { hr: "1", hc: String(7 - j), vr: String(7 - j), vc: "2" };
  }

  for (let i = 0; i < 14; i++) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "pit";
    if (i === 6 || i === 13) el.classList.add("store");
    el.classList.add(i <= 6 ? "side0" : "side1");
    el.dataset.idx = i;
    const g = gridPos(i);
    el.style.setProperty("--hr", g.hr);
    el.style.setProperty("--hc", g.hc);
    el.style.setProperty("--vr", g.vr);
    el.style.setProperty("--vc", g.vc);
    const c = document.createElement("span");
    c.className = "count";
    el.appendChild(c);
    boardEl.insertBefore(el, layer);
    pitEls.push(el);
    el.addEventListener("click", () => onPitClick(i));
  }

  // ---------- Game state ----------
  const settings = { mode: "ai", level: "medium", first: "0", stones: "4" };
  let pits = [];     // pits[i] = array of stone objects {el, color, jx, jy, rot}
  let turn = 0;
  let busy = false;
  let over = false;
  let gameId = 0;    // invalidates pending async work after restart / undo
  let history = [];  // snapshots taken before each human move: {pits, turn}
  const aiPlayer = 1;

  const names = () => settings.mode === "ai" ? ["אתה", "המחשב"] : ["שחקן אדום", "שחקן כחול"];
  const counts = () => pits.map((p) => p.length);
  const isAiTurn = () => settings.mode === "ai" && turn === aiPlayer;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function newGame() {
    gameId++;
    layer.innerHTML = "";
    pits = Array.from({ length: 14 }, () => []);
    const per = parseInt(settings.stones, 10);
    let colorToggle = 0;
    for (let i = 0; i < 14; i++) {
      if (i === 6 || i === 13) continue;
      for (let k = 0; k < per; k++) {
        const color = (colorToggle++ + i) % 2 === 0 ? "red" : "blue";
        const el = document.createElement("div");
        el.className = "stone " + color;
        layer.appendChild(el);
        pits[i].push({ el, color, jx: Math.random() - 0.5, jy: Math.random() - 0.5, rot: Math.random() * 360 });
      }
    }
    turn = settings.mode === "ai" ? parseInt(settings.first, 10) : 0;
    busy = false;
    over = false;
    history = [];
    $("overlay").hidden = true;
    pitEls.forEach((el) => el.classList.remove("last", "capture"));
    const n = names();
    $("tag-0").querySelector(".name").textContent = n[0];
    $("tag-1").querySelector(".name").textContent = n[1];
    layout(false);
    updateUI();
    maybeAi();
  }

  // ---------- Layout of stones inside pits ----------
  function layout(animate = true) {
    if (!pits.length) return;
    const pitSize = pitEls[0].offsetWidth;
    const s = Math.max(10, Math.round(pitSize * 0.25));
    layer.style.setProperty("--stone", s + "px");
    if (!animate) layer.classList.add("no-anim");

    for (let i = 0; i < 14; i++) {
      const el = pitEls[i];
      const list = pits[i];
      const cx = el.offsetLeft + el.offsetWidth / 2;
      const cy = el.offsetTop + el.offsetHeight / 2;
      const rx = Math.max(1, el.offsetWidth / 2 - s * 0.62);
      const ry = Math.max(1, el.offsetHeight / 2 - s * 0.62);
      const n = list.length;
      // Sunflower spiral; compress when there are too many stones
      const stepBase = (s * 0.58) / Math.min(rx, ry);
      const maxU = stepBase * Math.sqrt(Math.max(0, n - 1) + 0.6);
      const scale = maxU > 1 ? 1 / maxU : 1;
      const seed = i * 1.3;
      for (let k = 0; k < n; k++) {
        const st = list[k];
        const u = k === 0 && n === 1 ? 0 : stepBase * Math.sqrt(k + 0.6) * scale;
        const th = k * 2.39996 + seed;
        const jit = s * 0.07;
        const x = cx + Math.cos(th) * u * rx + st.jx * jit - s / 2;
        const y = cy + Math.sin(th) * u * ry + st.jy * jit - s / 2;
        st.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${st.rot}deg)`;
        st.el.style.zIndex = String(k + 1);
      }
    }
    if (!animate) {
      // force reflow, then re-enable transitions
      void layer.offsetWidth;
      layer.classList.remove("no-anim");
    }
  }

  new ResizeObserver(() => layout(false)).observe(boardEl);
  window.addEventListener("orientationchange", () => setTimeout(() => layout(false), 200));

  // ---------- UI ----------
  function setStatus(html) { statusEl.innerHTML = html; }

  function turnText() {
    const n = names();
    const cls = turn === 0 ? "p1c" : "p2c";
    if (settings.mode === "ai") {
      return turn === aiPlayer ? `<span class="${cls}">המחשב חושב…</span>` : `<span class="${cls}">התור שלך</span>`;
    }
    return `התור של <span class="${cls}">${n[turn]}</span>`;
  }

  function updateUI() {
    for (let i = 0; i < 14; i++) {
      pitEls[i].querySelector(".count").textContent = pits[i].length;
      const playable = !busy && !over && !isAiTurn() && ownsPit(turn, i) && pits[i].length > 0;
      pitEls[i].classList.toggle("playable", playable);
      pitEls[i].setAttribute("aria-label", (i === 6 || i === 13 ? "מחסן" : "גומה") + `: ${pits[i].length} אבנים`);
    }
    $("tag-0").querySelector(".score").textContent = pits[6].length;
    $("tag-1").querySelector(".score").textContent = pits[13].length;
    $("tag-0").classList.toggle("active", !over && turn === 0);
    $("tag-1").classList.toggle("active", !over && turn === 1);
    $("undo-btn").disabled = history.length === 0 || busy;
  }

  // Undo: return to the position before the last human move.
  // Against the computer this also takes back the computer's replies.
  function undo() {
    if (busy || history.length === 0) return;
    const snap = history.pop();
    gameId++; // cancel any pending status message / AI move
    pits = snap.pits.map((p) => p.slice());
    turn = snap.turn;
    over = false;
    busy = false;
    $("overlay").hidden = true;
    pitEls.forEach((el) => el.classList.remove("last", "capture"));
    layout();
    updateUI();
    setStatus(`<span class="flash">המהלך בוטל ↶</span>`);
    const myGame = gameId;
    setTimeout(() => { if (myGame === gameId && !busy) setStatus(turnText()); }, 900);
  }

  function onPitClick(i) {
    if (busy || over || isAiTurn()) return;
    if (!ownsPit(turn, i) || pits[i].length === 0) return;
    history.push({ pits: pits.map((p) => p.slice()), turn });
    playMove(i);
  }

  async function playMove(pit) {
    const myGame = gameId;
    busy = true;
    pitEls.forEach((el) => el.classList.remove("last"));
    updateUI();

    const p = turn;
    const hand = pits[pit].splice(0);
    layout();
    let i = pit;
    while (hand.length) {
      i = (i + 1) % 14;
      if (i === STORE[1 - p]) continue;
      const st = hand.shift();
      pits[i].push(st);
      layout();
      updateUI();
      click(1 + (hand.length % 3) * 0.08);
      await sleep(STEP_MS);
      if (myGame !== gameId) return;
    }
    pitEls[i].classList.add("last");

    let extra = false;
    let msg = "";
    if (i === STORE[p]) {
      extra = true;
      msg = `<span class="flash">תור נוסף! ✨</span>`;
    } else if (ownsPit(p, i) && pits[i].length === 1 && pits[opposite(i)].length > 0) {
      const o = opposite(i);
      const gained = pits[o].length + 1;
      pitEls[i].classList.add("capture");
      pitEls[o].classList.add("capture");
      await sleep(350);
      if (myGame !== gameId) return;
      pits[STORE[p]].push(...pits[o].splice(0), ...pits[i].splice(0));
      layout();
      updateUI();
      click(1.5);
      msg = `<span class="flash">לכידה! +${gained} 💎</span>`;
      await sleep(500);
      if (myGame !== gameId) return;
      pitEls[i].classList.remove("capture");
      pitEls[o].classList.remove("capture");
    }

    // End of game?
    const c = counts();
    if (sideSum(c, 0) === 0 || sideSum(c, 1) === 0) {
      await sleep(300);
      if (myGame !== gameId) return;
      for (let k = 0; k < 6; k++) pits[6].push(...pits[k].splice(0));
      for (let k = 7; k < 13; k++) pits[13].push(...pits[k].splice(0));
      layout();
      over = true;
      busy = false;
      updateUI();
      await sleep(700);
      if (myGame !== gameId) return;
      endGame();
      return;
    }

    if (!extra) turn = 1 - p;
    busy = false;
    updateUI();
    if (msg) {
      setStatus(msg);
      await sleep(900);
      if (myGame !== gameId) return;
    }
    setStatus(turnText());
    maybeAi();
  }

  async function maybeAi() {
    setStatus(turnText());
    if (over || !isAiTurn()) return;
    const myGame = gameId;
    busy = true;
    updateUI();
    await sleep(650);
    if (myGame !== gameId) return;
    const move = chooseMove(counts(), aiPlayer, settings.level);
    busy = false;
    playMove(move);
  }

  function endGame() {
    const a = pits[6].length;
    const b = pits[13].length;
    const n = names();
    let title, emoji;
    if (a === b) {
      title = "תיקו!";
      emoji = "🤝";
    } else if (settings.mode === "ai") {
      const won = a > b;
      title = won ? "ניצחת!" : "המחשב ניצח";
      emoji = won ? "🏆" : "🤖";
    } else {
      title = `${a > b ? n[0] : n[1]} ניצח!`;
      emoji = "🏆";
    }
    setStatus("המשחק נגמר");
    $("result-emoji").textContent = emoji;
    $("result-title").textContent = title;
    $("result-score").textContent = `${n[0]} ${a} : ${b} ${n[1]}`;
    $("overlay").hidden = false;
  }

  // ---------- Menu ----------
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  }

  function refreshMenu() {
    document.querySelectorAll(".ai-only").forEach((el) => el.classList.toggle("hidden", settings.mode !== "ai"));
  }

  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
      settings[seg.dataset.name] = btn.dataset.value;
      refreshMenu();
    });
  });

  $("start-btn").addEventListener("click", () => {
    showScreen("game");
    requestAnimationFrame(newGame);
  });
  $("restart-btn").addEventListener("click", newGame);
  $("undo-btn").addEventListener("click", undo);
  $("again-btn").addEventListener("click", newGame);
  $("menu-btn").addEventListener("click", () => { gameId++; $("overlay").hidden = true; showScreen("menu"); });
  $("to-menu-btn").addEventListener("click", () => { gameId++; $("overlay").hidden = true; showScreen("menu"); });
  $("sound-btn").addEventListener("click", () => {
    soundOn = !soundOn;
    $("sound-btn").textContent = soundOn ? "🔊" : "🔇";
  });

  // ---------- Add to home screen (PWA) ----------
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  const installBtn = $("install-btn");
  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferredPrompt = null;

  // Show the button whenever we're in a browser tab (not already opened from the home screen)
  installBtn.hidden = isStandalone();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  function showInstallHelp() {
    const steps = isIOS
      ? ["לוחצים על כפתור השיתוף <b>⬆️</b> בתחתית ספארי", "בוחרים <b>\"הוסף למסך הבית\"</b>", "לוחצים <b>\"הוסף\"</b>"]
      : ["לוחצים על התפריט <b>⋮</b> בפינה של הדפדפן", "בוחרים <b>\"הוספה למסך הבית\"</b> או <b>\"התקנת אפליקציה\"</b>", "מאשרים <b>\"הוספה\"</b> / <b>\"התקנה\"</b>"];
    $("install-steps").innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
    $("install-help").hidden = false;
  }

  installBtn.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === "accepted") installBtn.hidden = true;
    } else {
      showInstallHelp();
    }
  });
  $("install-close").addEventListener("click", () => { $("install-help").hidden = true; });

  refreshMenu();
})();

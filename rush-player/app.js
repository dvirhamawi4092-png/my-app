/* נגן שירים ותווים – plays songs together with their sheet music / tabs.
 * Tabs (Guitar Pro / MusicXML) are rendered with alphaTab, PDFs with pdf.js.
 * Everything runs locally in the browser; files never leave the device. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = {
    sidebar: $('sidebar'), menuBtn: $('menuBtn'), dropZone: $('dropZone'),
    fileInput: $('fileInput'), folderInput: $('folderInput'), demoBtn: $('demoBtn'),
    filter: $('filter'), songList: $('songList'), songTitle: $('songTitle'),
    empty: $('empty'), view: $('view'), scoreWrap: $('scoreWrap'), alpha: $('alphaTab'),
    pages: $('pages'), loading: $('loading'),
    modeWrap: $('modeWrap'), modeSel: $('modeSel'), trackWrap: $('trackWrap'), trackSel: $('trackSel'),
    offsetWrap: $('offsetWrap'), offset: $('offset'), scrollWrap: $('scrollWrap'), autoScroll: $('autoScroll'),
    metroWrap: $('metroWrap'), metro: $('metro'), zoom: $('zoom'),
    transport: $('transport'), playBtn: $('playBtn'), seek: $('seek'), curTime: $('curTime'), durTime: $('durTime'),
    speed: $('speed'), speedVal: $('speedVal'), volume: $('volume'),
    aBtn: $('aBtn'), bBtn: $('bBtn'), abClear: $('abClear'),
    audio: $('audio'),
  };

  // ---------- file classification & grouping ----------
  const EXT = {
    audio: ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac', 'opus', 'webm'],
    tab: ['gp', 'gp3', 'gp4', 'gp5', 'gpx', 'musicxml', 'xml', 'mxl', 'capx', 'cap'],
    pdf: ['pdf'],
    image: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  };
  const extOf = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  const kindOf = (n) => Object.keys(EXT).find((k) => EXT[k].includes(extOf(n))) || null;

  function cleanName(fileName) {
    let s = fileName.replace(/\.[^.]+$/, '').replace(/_+/g, ' ');
    s = s.replace(/^\s*\d{1,3}\s*[-.)]\s*/, '');                    // "01 - " track numbers
    s = s.replace(/^\s*rush\s*[-–:]\s*/i, '').replace(/\s*[-–]\s*rush\s*$/i, '');
    s = s.replace(/[([][^)\]]*[)\]]/g, '');                           // "(tab)", "[2112 remaster]"
    s = s.replace(/\b(guitar pro|tabs?|sheet music|score|notes|official audio)\b/gi, '');
    s = s.replace(/(תווים|טאבים|טאב)/g, '');
    s = s.replace(/\s*[-–]\s*$/, '').replace(/\s+/g, ' ').trim();
    return s || fileName;
  }
  const keyOf = (name) => cleanName(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  const songs = new Map(); // key -> song
  let current = null;

  function addFiles(fileList) {
    let added = 0;
    for (const f of fileList) {
      const kind = kindOf(f.name);
      if (!kind) continue;
      const key = keyOf(f.name);
      let s = songs.get(key);
      if (!s) { s = { key, name: cleanName(f.name), audio: null, tab: null, pdf: null, images: [] }; songs.set(key, s); }
      if (kind === 'image') s.images.push(f);
      else if (kind === 'tab') {
        // prefer Guitar Pro over MusicXML when both exist
        if (!s.tab || (extOf(s.tab.name).startsWith('gp') === false && extOf(f.name).startsWith('gp'))) s.tab = f;
      } else s[kind] = f;
      if (kind === 'audio') s.name = cleanName(f.name);
      added++;
    }
    for (const s of songs.values()) s.images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    renderList();
    if (added && !current) {
      const first = [...songs.values()].sort(byName)[0];
      if (first) openSong(first);
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

  function renderList() {
    const q = el.filter.value.trim().toLowerCase();
    el.songList.innerHTML = '';
    for (const s of [...songs.values()].sort(byName)) {
      if (q && !s.name.toLowerCase().includes(q)) continue;
      const li = document.createElement('li');
      if (s === current) li.className = 'active';
      const name = document.createElement('span');
      name.className = 'name'; name.textContent = s.name; name.dir = 'auto';
      const badges = document.createElement('span');
      badges.className = 'badges';
      const add = (t) => { const b = document.createElement('span'); b.className = 'badge'; b.textContent = t; badges.append(b); };
      if (s.audio) add('🎵');
      if (s.tab || s.demo) add('TAB');
      if (s.pdf) add('PDF');
      if (s.images.length) add('🖼');
      li.append(name, badges);
      li.onclick = () => { openSong(s); el.sidebar.classList.remove('open'); };
      el.songList.append(li);
    }
  }

  // ---------- alphaTab ----------
  let api = null, tabReady = false, playerReady = false, score = null;
  let synthTime = 0, synthEnd = 0, wantedTrack = 0;
  const isDrums = (t) => t.staves.some((st) => st.isPercussion) || t.playbackInfo.primaryChannel === 9;

  function ensureApi() {
    if (api) return api;
    const base = new URL('.', location.href).href;
    api = new alphaTab.AlphaTabApi(el.alpha, {
      core: {
        fontDirectory: base + 'vendor/font/',
        scriptFile: base + 'vendor/alphaTab.min.js',
        useWorkers: location.protocol !== 'file:',
      },
      display: { scale: parseFloat(el.zoom.value), layoutMode: alphaTab.LayoutMode.Page },
      player: {
        enablePlayer: true, enableCursor: true, enableUserInteraction: true,
        soundFont: base + 'vendor/soundfont/sonivox.sf2',
        scrollElement: el.scoreWrap, scrollOffsetY: -40,
      },
    });
    api.scoreLoaded.on((sc) => {
      score = sc;
      el.trackSel.innerHTML = '';
      sc.tracks.forEach((t, i) => {
        const o = document.createElement('option');
        o.value = i; o.textContent = (isDrums(t) ? '🥁 ' : '') + (t.name || ('כלי ' + (i + 1)));
        el.trackSel.append(o);
      });
      el.trackSel.value = wantedTrack;
      el.trackWrap.hidden = sc.tracks.length < 2;
    });
    api.renderFinished.on(() => { el.loading.hidden = true; tabReady = true; });
    api.playerReady.on(() => { playerReady = true; applyTabAudioSettings(); });
    api.playerStateChanged.on(() => { if (mode === 'synth') updatePlayBtn(); });
    api.playerPositionChanged.on((e) => {
      synthTime = e.currentTime; synthEnd = e.endTime;
      if (mode !== 'synth') return;
      const sp = speed();
      if (loopA != null && loopB != null && e.currentTime * sp >= loopB) { api.timePosition = loopA / sp; return; }
      updateTimeUI(e.currentTime / 1000, e.endTime / 1000);
    });
    api.error.on((e) => { el.loading.hidden = true; console.error(e); alert('שגיאה בטעינת התווים: ' + (e && e.message || e)); });
    return api;
  }

  function applyTabAudioSettings() {
    if (!api) return;
    api.masterVolume = mode === 'synth' ? parseFloat(el.volume.value) : 0; // muted when following the recording
    api.metronomeVolume = mode === 'synth' && el.metro.checked ? 1 : 0;
    api.playbackSpeed = speed();
  }

  // ---------- pdf / images ----------
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;
  let pagesToken = 0;

  async function showPages(song) {
    const token = ++pagesToken;
    el.pages.innerHTML = '';
    if (song.pdf) {
      el.loading.hidden = false;
      try {
        const data = new Uint8Array(await song.pdf.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data }).promise;
        for (let p = 1; p <= doc.numPages; p++) {
          if (token !== pagesToken) return;
          const page = await doc.getPage(p);
          const vp1 = page.getViewport({ scale: 1 });
          const scale = Math.min(2.5, (Math.min(el.scoreWrap.clientWidth, 1000) * (window.devicePixelRatio || 1) * 1.3) / vp1.width);
          const vp = page.getViewport({ scale });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          el.pages.append(c); applyZoom();
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          if (p === 1) el.loading.hidden = true;
        }
      } catch (e) { console.error(e); alert('לא הצלחתי לפתוח את ה-PDF'); }
      el.loading.hidden = true;
    }
    for (const img of song.images) {
      const i = new Image();
      i.src = URL.createObjectURL(img); i.alt = img.name;
      el.pages.append(i);
    }
    applyZoom();
  }

  function applyZoom() {
    const z = parseFloat(el.zoom.value);
    for (const c of el.pages.children) { c.style.width = `calc(${z} * min(100%, 1000px))`; c.style.maxWidth = 'none'; }
  }

  // ---------- opening a song ----------
  let mode = 'none';            // 'audio' | 'synth' | 'none'
  let audioUrl = null;
  let loopA = null, loopB = null; // seconds (audio) / song-ms (synth)

  function openSong(s) {
    stopAll();
    current = s; tabReady = false; playerReady = false; score = null; synthTime = synthEnd = 0;
    clearLoop();
    renderList();
    el.songTitle.textContent = s.name;
    el.empty.hidden = true; el.view.hidden = false;

    const hasTab = !!(s.tab || s.demo);
    const hasPages = !!(s.pdf || s.images.length);

    // audio
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    if (s.audio) { audioUrl = URL.createObjectURL(s.audio); el.audio.src = audioUrl; }
    else el.audio.removeAttribute('src');
    el.audio.load();

    // UI fields
    el.modeWrap.hidden = !(s.audio && hasTab);
    el.modeSel.value = 'audio';
    el.offset.value = s.offset != null ? s.offset : 0;
    el.offsetWrap.hidden = !(s.audio && hasTab);
    el.scrollWrap.hidden = !(hasPages && !hasTab);
    el.trackWrap.hidden = true;
    updateMode();

    // notation
    el.alpha.style.display = hasTab ? '' : 'none';
    el.pages.innerHTML = '';
    el.scoreWrap.scrollTop = 0;
    if (hasTab) {
      el.loading.hidden = false;
      const a = ensureApi();
      const p = s.demo ? Promise.resolve(buildDemoScore(a.settings))
        : s.tab.arrayBuffer().then((buf) => alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(buf), a.settings));
      p.then((sc) => {
        if (current !== s) return;
        wantedTrack = Math.max(0, sc.tracks.findIndex(isDrums)); // open the drum part by default
        a.renderScore(sc, [wantedTrack]);
      }).catch((e) => { console.error(e); fail(); });
    } else if (hasPages) {
      showPages(s);
    } else {
      el.loading.hidden = true;
    }
    updateTimeUI(0, 0);
  }
  const fail = () => { el.loading.hidden = true; alert('פורמט התווים לא נתמך'); };

  function updateMode() {
    const s = current;
    if (!s) { mode = 'none'; }
    else if (s.audio) mode = (s.tab || s.demo) ? el.modeSel.value : 'audio';
    else mode = (s.tab || s.demo) ? 'synth' : 'none';
    el.transport.hidden = mode === 'none';
    el.metroWrap.hidden = mode !== 'synth';
    applyTabAudioSettings();
    updatePlayBtn();
  }

  function stopAll() {
    el.audio.pause();
    if (api && api.playerState === 1) api.pause();
  }

  // ---------- transport ----------
  const speed = () => parseFloat(el.speed.value);
  const fmt = (t) => { if (!isFinite(t) || t < 0) t = 0; const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
  let seeking = false;

  function isPlaying() {
    if (mode === 'audio') return !el.audio.paused;
    if (mode === 'synth') return !!api && api.playerState === 1;
    return false;
  }
  function updatePlayBtn() { el.playBtn.textContent = isPlaying() ? '❚❚' : '▶'; el.playBtn.setAttribute('aria-label', isPlaying() ? 'השהה' : 'נגן'); }

  function updateTimeUI(t, d) {
    el.curTime.textContent = fmt(t);
    el.durTime.textContent = fmt(d);
    if (!seeking) el.seek.value = d > 0 ? Math.round((t / d) * 1000) : 0;
  }

  function togglePlay() {
    if (mode === 'audio') {
      if (el.audio.paused) {
        if (api && (current.tab || current.demo) && playerReady) api.play(); // unlock audio context during the click
        el.audio.play().catch((e) => console.warn(e));
      } else el.audio.pause();
    } else if (mode === 'synth') {
      if (!playerReady) return;
      api.playPause();
    }
  }

  function seekFrac(f) {
    if (mode === 'audio' && el.audio.duration) el.audio.currentTime = f * el.audio.duration;
    else if (mode === 'synth' && api && synthEnd) api.timePosition = f * synthEnd;
  }

  function currentPos() { // seconds (audio) / song ms (synth)
    return mode === 'audio' ? el.audio.currentTime : synthTime * speed();
  }
  function clearLoop() { loopA = loopB = null; el.aBtn.classList.remove('on'); el.bBtn.classList.remove('on'); }

  // keep the tab cursor following the real recording
  let lastFix = 0, lastPausedTarget = -1;
  function syncTabToAudio(now) {
    if (!api || !playerReady || !tabReady) return;
    const sp = speed();
    const target = ((el.audio.currentTime - (parseFloat(el.offset.value) || 0)) * 1000) / sp; // alphaTab works in wall-clock ms
    const playing = !el.audio.paused && !el.audio.ended;
    if (playing && target >= 0) {
      lastPausedTarget = -1;
      if (api.playerState !== 1) { api.timePosition = target; api.play(); lastFix = now; }
      else if (Math.abs(api.timePosition - target) > 250 && now - lastFix > 800) { api.timePosition = target; lastFix = now; }
    } else {
      if (api.playerState === 1) api.pause();
      const t = Math.max(0, target);
      if (Math.abs(t - lastPausedTarget) > 30) { api.timePosition = t; lastPausedTarget = t; }
    }
  }

  function autoScrollPages(t, d) {
    if (!el.autoScroll.checked || !d || el.audio.paused || !el.pages.children.length) return;
    const max = el.scoreWrap.scrollHeight - el.scoreWrap.clientHeight;
    if (max <= 0) return;
    // keep a little lead so the upcoming lines are visible
    const target = Math.min(max, Math.max(0, (t / d) * (el.scoreWrap.scrollHeight) - el.scoreWrap.clientHeight * 0.35));
    el.scoreWrap.scrollTop += (target - el.scoreWrap.scrollTop) * 0.08;
  }

  function tick(now) {
    if (mode === 'audio' && current) {
      const t = el.audio.currentTime, d = el.audio.duration || 0;
      if (loopA != null && loopB != null && t >= loopB) el.audio.currentTime = loopA;
      updateTimeUI(t, d);
      if (current.tab || current.demo) syncTabToAudio(now);
      else autoScrollPages(t, d);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- events ----------
  el.playBtn.onclick = togglePlay;
  el.audio.addEventListener('play', updatePlayBtn);
  el.audio.addEventListener('pause', updatePlayBtn);
  el.audio.addEventListener('ended', updatePlayBtn);
  el.seek.addEventListener('input', () => { seeking = true; });
  el.seek.addEventListener('change', () => { seekFrac(el.seek.value / 1000); seeking = false; });
  el.speed.addEventListener('input', () => {
    el.speedVal.textContent = Math.round(speed() * 100) + '%';
    el.audio.playbackRate = speed();
    el.audio.preservesPitch = true;
    applyTabAudioSettings();
    lastFix = 0;
  });
  el.volume.addEventListener('input', () => { el.audio.volume = parseFloat(el.volume.value); applyTabAudioSettings(); });
  el.metro.addEventListener('change', applyTabAudioSettings);
  el.modeSel.addEventListener('change', () => {
    const wasPlaying = isPlaying();
    stopAll(); updateMode();
    if (wasPlaying) togglePlay();
  });
  el.offset.addEventListener('change', () => { if (current) current.offset = parseFloat(el.offset.value) || 0; lastFix = 0; lastPausedTarget = -1; });
  el.trackSel.addEventListener('change', () => { if (api && score) api.renderTracks([score.tracks[+el.trackSel.value]]); });
  el.zoom.addEventListener('change', () => {
    applyZoom();
    if (api && current && (current.tab || current.demo)) { api.settings.display.scale = parseFloat(el.zoom.value); api.updateSettings(); api.render(); }
  });
  el.aBtn.onclick = () => { loopA = currentPos(); if (loopB != null && loopB <= loopA) loopB = null; el.aBtn.classList.add('on'); el.bBtn.classList.toggle('on', loopB != null); };
  el.bBtn.onclick = () => { const p = currentPos(); if (loopA != null && p > loopA) { loopB = p; el.bBtn.classList.add('on'); } };
  el.abClear.onclick = clearLoop;

  el.fileInput.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  el.folderInput.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  el.filter.addEventListener('input', renderList);
  el.menuBtn.onclick = () => el.sidebar.classList.toggle('open');

  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); el.dropZone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) el.dropZone.classList.remove('over'); }));
  document.addEventListener('drop', async (e) => {
    const items = e.dataTransfer && e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const files = [];
      const walk = (entry) => new Promise((res) => {
        if (entry.isFile) entry.file((f) => { files.push(f); res(); }, res);
        else if (entry.isDirectory) {
          const r = entry.createReader(); const all = [];
          const read = () => r.readEntries(async (ents) => {
            if (!ents.length) { await Promise.all(all.map(walk)); res(); } else { all.push(...ents); read(); }
          }, res);
          read();
        } else res();
      });
      await Promise.all([...items].map((i) => i.webkitGetAsEntry()).filter(Boolean).map(walk));
      addFiles(files);
    } else if (e.dataTransfer) addFiles(e.dataTransfer.files);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=search], input[type=number], select')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  });

  // Original demo drum groove (written for this app) so the player can be tried without files.
  // Each bar: 8 eighth-note steps, each step a list of General MIDI drum numbers.
  const K = 36, SN = 38, HH = 42, OH = 46, CR = 49, T1 = 48, T2 = 45, FT = 43;
  const DEMO_BARS = [
    [[K, HH, CR], [HH], [SN, HH], [HH], [K, HH], [K, HH], [SN, HH], [HH]],
    [[K, HH], [HH], [SN, HH], [HH], [K, HH], [K, OH], [SN, HH], [HH]],
    [[K, HH], [HH], [SN, HH], [HH], [K, HH], [K, HH], [SN, HH], [HH]],
    [[K, HH], [HH], [SN, HH], [K], [SN], [T1], [T2], [FT]],
  ];
  function buildDemoScore(settings) {
    const m = alphaTab.model;
    const score = new m.Score();
    score.title = 'Demo Groove'; score.tempo = 104; score.tempoLabel = '';
    const track = new m.Track();
    track.name = 'Drums'; track.ensureStaveCount(1);
    track.playbackInfo.primaryChannel = 9; track.playbackInfo.secondaryChannel = 9; track.playbackInfo.program = 0;
    score.addTrack(track);
    const staff = track.staves[0];
    staff.isPercussion = true; staff.showTablature = false; staff.showStandardNotation = true;
    for (let r = 0; r < 2; r++) DEMO_BARS.forEach((steps, bi) => {
      const mb = new m.MasterBar();
      mb.timeSignatureNumerator = 4; mb.timeSignatureDenominator = 4;
      if (r === 0 && bi === 0) mb.tempoAutomation = m.Automation.buildTempoAutomation(false, 0, 104, 2);
      score.addMasterBar(mb);
      const bar = new m.Bar(); bar.clef = m.Clef.Neutral; staff.addBar(bar);
      const voice = new m.Voice(); bar.addVoice(voice);
      for (const step of steps) {
        const beat = new m.Beat(); beat.duration = m.Duration.Eighth;
        for (const midi of step) { const n = new m.Note(); n.percussionArticulation = midi; beat.addNote(n); }
        voice.addBeat(beat);
      }
    });
    score.finish(settings);
    return score;
  }
  el.demoBtn.onclick = () => {
    let s = songs.get('__demo');
    if (!s) { s = { key: '__demo', name: 'דוגמה – תופים (Demo Groove)', audio: null, tab: null, pdf: null, images: [], demo: true }; songs.set('__demo', s); }
    openSong(s); el.sidebar.classList.remove('open');
  };

  window.__player = { addFiles, songs, get api() { return api; }, get mode() { return mode; } }; // for debugging
})();

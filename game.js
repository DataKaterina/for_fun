/* Где ты, шпион? Логика игры. Работает без сервера, всё хранится на телефоне. */
(() => {
  'use strict';

  // ---------- мелкие помощники ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const THEMES = window.THEMES;
  const LOCATIONS = window.LOCATIONS;
  const THEME_NAMES = Object.keys(THEMES);
  const LEVEL_NAMES = { 1: 'лёгкая', 2: 'средняя', 3: 'сложная' };

  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 20;

  const reducedMotion = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) { /* не критично */ } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const plural = (n, [one, few, many]) => {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };

  // Всё, что приходит от человека (имена), попадает в DOM только через textContent.
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  };

  // ---------- настройки и история ----------
  // Всё лежит в localStorage этого браузера: ни регистрации, ни сервера.
  const KEY = 'spy-dossier.v2';
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } },
    save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* приватный режим */ } },
  };

  // Пустые levels и themes означают «любые».
  const DEFAULTS = {
    players: [],
    spies: '1',
    levels: [],
    themes: [],
    knowTheme: false,
    spiesKnow: false,
    timerOn: false,
    timer: 8,
    used: [], // названия мест, которые уже выпадали
  };

  function normalize(raw) {
    const s = Object.assign({}, DEFAULTS, raw);
    const known = new Set(LOCATIONS.map((l) => l.name));
    s.players = Array.isArray(s.players)
      ? s.players.filter((x) => typeof x === 'string').slice(0, MAX_PLAYERS) : [];
    s.spies = ['1', '2', '3'].includes(String(s.spies)) ? String(s.spies) : '1';
    s.levels = Array.isArray(s.levels) ? s.levels.filter((x) => [1, 2, 3].includes(x)) : [];
    s.themes = Array.isArray(s.themes) ? s.themes.filter((t) => THEME_NAMES.includes(t)) : [];
    s.timer = [5, 8, 10].includes(Number(s.timer)) ? Number(s.timer) : 8;
    s.used = Array.isArray(s.used) ? Array.from(new Set(s.used.filter((x) => known.has(x)))) : [];
    for (const k of ['knowTheme', 'spiesKnow', 'timerOn']) s[k] = !!s[k];
    return s;
  }

  const settings = normalize(store.load());
  const persist = () => store.save(settings);

  const maxSpies = (n) => Math.max(1, Math.floor((n - 1) / 2));
  const hasFilters = () => settings.levels.length > 0 || settings.themes.length > 0;
  const pool = () => LOCATIONS.filter((l) =>
    (!settings.levels.length || settings.levels.includes(l.level)) &&
    (!settings.themes.length || settings.themes.includes(l.theme)));
  const freshOf = (list) => {
    const used = new Set(settings.used);
    return list.filter((l) => !used.has(l.name));
  };

  // ---------- экраны ----------
  const screens = {
    setup: $('#screen-setup'),
    deal: $('#screen-deal'),
    ready: $('#screen-ready'),
    play: $('#screen-play'),
    reveal: $('#screen-reveal'),
  };
  let current = 'setup';
  let inGame = false;
  let round = null;

  function show(name) {
    if (name !== 'play') leavePlay();
    current = name;
    for (const [k, node] of Object.entries(screens)) node.hidden = k !== name;
    inGame = name === 'deal' || name === 'ready' || name === 'play';
    if (name === 'setup') refresh();
    window.scrollTo(0, 0);
    const f = $('[data-focus]', screens[name]);
    if (f) f.focus({ preventScroll: true });
  }

  // ---------- экран настроек ----------
  const playersEl = $('#players');
  const nameInput = $('#player-name');
  const msgEl = $('#player-msg');
  const startBtn = $('#start');

  const normName = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 20);

  $('#themes').replaceChildren(
    ...THEME_NAMES.map((t) =>
      el('label', { class: 'chip' },
        el('input', { type: 'checkbox', name: 'theme', value: t }),
        el('span', { text: t }))));

  $('#add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = normName(nameInput.value);
    if (!name) { msgEl.textContent = 'Впиши имя игрока.'; nameInput.focus(); return; }
    if (settings.players.length >= MAX_PLAYERS) { msgEl.textContent = `За столом помещается до ${MAX_PLAYERS} игроков.`; return; }
    if (settings.players.some((p) => p.toLowerCase() === name.toLowerCase())) {
      msgEl.textContent = 'Такое имя уже есть. Добавь фамилию или цифру.';
      return;
    }
    settings.players.push(name);
    nameInput.value = '';
    msgEl.textContent = '';
    persist();
    refresh();
    nameInput.focus();
  });

  playersEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = Number(b.dataset.i);
    const act = b.dataset.act;
    const p = settings.players;
    let focusSel = null;
    if (act === 'up' && i > 0) { [p[i - 1], p[i]] = [p[i], p[i - 1]]; focusSel = `button[data-act="up"][data-i="${i - 1}"]`; }
    if (act === 'down' && i < p.length - 1) { [p[i + 1], p[i]] = [p[i], p[i + 1]]; focusSel = `button[data-act="down"][data-i="${i + 1}"]`; }
    if (act === 'del') p.splice(i, 1);
    persist();
    refresh();
    const f = focusSel && $(focusSel, playersEl);
    (f || nameInput).focus();
  });

  function iconBtn(act, i, glyph, label, disabled) {
    return el('button', { type: 'button', class: 'icon-btn', 'data-act': act, 'data-i': String(i), 'aria-label': label, disabled }, glyph);
  }

  function renderPlayers() {
    const p = settings.players;
    playersEl.replaceChildren(...p.map((name, i) =>
      el('li', null,
        el('span', { class: 'seat', text: `${i + 1}.` }),
        el('span', { class: 'pname', text: name }),
        el('span', { class: 'row-actions' },
          iconBtn('up', i, '↑', `Поднять: ${name}`, i === 0),
          iconBtn('down', i, '↓', `Опустить: ${name}`, i === p.length - 1),
          iconBtn('del', i, '×', `Убрать: ${name}`, false)))));
  }

  function syncInputs() {
    $$('input[name="spies"]').forEach((i) => { i.checked = i.value === settings.spies; });
    $$('input[name="timer"]').forEach((i) => { i.checked = Number(i.value) === settings.timer; });
    $$('input[name="level"]').forEach((i) => { i.checked = settings.levels.includes(Number(i.value)); });
    $$('input[name="theme"]').forEach((i) => { i.checked = settings.themes.includes(i.value); });
    $$('input[name="mode"]').forEach((i) => { i.checked = !!settings[i.value]; });
    $('#filters').open = hasFilters();
  }

  function describeFilters() {
    if (!hasFilters()) return 'Тема и сложность выбираются случайно.';
    const t = settings.themes.length
      ? (settings.themes.length <= 2
        ? settings.themes.join(', ')
        : `${settings.themes.length} ${plural(settings.themes.length, ['тема', 'темы', 'тем'])}`)
      : 'любая тема';
    const l = settings.levels.length
      ? `сложность: ${settings.levels.map((x) => LEVEL_NAMES[x]).join(', ')}`
      : 'любая сложность';
    return `Сейчас: ${t}, ${l}.`;
  }

  function refresh() {
    renderPlayers();
    const n = settings.players.length;
    const max = maxSpies(n);

    if (Number(settings.spies) > max) {
      settings.spies = String(max);
      persist();
    }
    $$('input[name="spies"]').forEach((i) => {
      i.checked = i.value === settings.spies;
      i.disabled = Number(i.value) > max;
    });
    $('#spies-hint').textContent = n < MIN_PLAYERS
      ? 'Сколько шпионов можно, зависит от числа игроков.'
      : `На ${n} ${plural(n, ['игрока', 'игрока', 'игроков'])} можно до ${max} ${plural(max, ['шпиона', 'шпионов', 'шпионов'])}.`;

    const all = pool();
    const fresh = freshOf(all).length;
    $('#pool-summary').textContent = describeFilters();
    $('#pool-count').textContent = all.length === 0
      ? 'Под такие настройки мест нет. Сбрось выбор.'
      : fresh === 0
        ? `Все ${all.length} ${plural(all.length, ['место', 'места', 'мест'])} из этого набора уже были. Следующий раунд начнёт круг заново.`
        : `Новых мест в этом наборе: ${fresh} из ${all.length}.`;
    $('#history-reset').hidden = settings.used.length === 0;
    $('#filters-reset').hidden = !hasFilters();
    $('#timer-opts').hidden = !settings.timerOn;

    const ok = n >= MIN_PLAYERS && all.length > 0;
    startBtn.disabled = !ok;
    $('#start-hint').textContent = n < MIN_PLAYERS
      ? `Нужно минимум ${MIN_PLAYERS} игрока. Сейчас ${n}.`
      : '';
  }

  screens.setup.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    switch (t.name) {
      case 'spies': settings.spies = t.value; break;
      case 'timer': settings.timer = Number(t.value); break;
      case 'level': settings.levels = $$('input[name="level"]:checked').map((i) => Number(i.value)); break;
      case 'theme': settings.themes = $$('input[name="theme"]:checked').map((i) => i.value); break;
      case 'mode': settings[t.value] = t.checked; break;
      default: return;
    }
    persist();
    refresh();
  });

  $('#filters-reset').addEventListener('click', () => {
    settings.levels = [];
    settings.themes = [];
    persist();
    syncInputs();
    $('#filters').open = true;
    refresh();
  });

  $('#history-reset').addEventListener('click', () => {
    if (!window.confirm('Сбросить историю? Все места снова станут новыми.')) return;
    settings.used = [];
    persist();
    refresh();
  });

  // ---------- раунд ----------
  function newRound() {
    const players = settings.players.slice();
    const n = players.length;
    const spyCount = Math.min(Number(settings.spies), maxSpies(n));

    // Берём только места, которых ещё не было. Если набор кончился, круг начинается заново.
    const all = pool();
    let fresh = freshOf(all);
    if (!fresh.length) {
      const names = new Set(all.map((l) => l.name));
      settings.used = settings.used.filter((x) => !names.has(x));
      fresh = all;
    }
    const loc = pick(fresh);

    const spyIdx = new Set(shuffle(players.map((_, i) => i)).slice(0, spyCount));
    round = {
      loc,
      spyCount,
      outcome: null,
      committed: false, // место попадает в историю, когда кто-то открыл первую карточку
      starter: rand(n),
      roles: players.map((name, i) => ({ name, spy: spyIdx.has(i) })),
    };
  }

  function beginRound() {
    newRound();
    dealIndex = 0;
    cardOpen = false;
    cardBusy = false;
    renderDeal();
    show('deal');
  }

  startBtn.addEventListener('click', () => { if (!startBtn.disabled) beginRound(); });

  // ---------- раздача карточек ----------
  const card = $('#card');
  const cardBack = $('#card-back');
  let dealIndex = 0;
  let cardOpen = false;
  let cardBusy = false;

  function fillBack(role) {
    cardBack.replaceChildren();
    const out = [];
    if (role.spy) {
      out.push(el('div', { class: 'stamp stamp-spy', text: 'Шпион' }));
      out.push(el('div', { class: 'redact', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')));
      out.push(el('p', { class: 'dossier-note', text: 'Места ты не знаешь. Слушай ответы и притворяйся, что в теме.' }));
      if (settings.knowTheme) out.push(el('p', { class: 'dossier-field', text: `Тема: ${round.loc.theme}` }));
      if (settings.spiesKnow && round.spyCount > 1) {
        const mates = round.roles.filter((r) => r.spy && r !== role).map((r) => r.name);
        out.push(el('p', { class: 'dossier-field', text: `${plural(mates.length, ['Твой сообщник', 'Твои сообщники', 'Твои сообщники'])}: ${mates.join(', ')}` }));
      }
    } else {
      out.push(el('p', { class: 'dossier-loc', text: round.loc.name }));
      if (settings.knowTheme) out.push(el('p', { class: 'dossier-field', text: `Тема: ${round.loc.theme}` }));
      out.push(el('p', { class: 'dossier-note', text: 'Не называй место вслух. Спрашивай так, чтобы шпион не догадался.' }));
    }
    cardBack.append(...out);
  }

  function renderDeal() {
    const role = round.roles[dealIndex];
    $('#deal-progress').textContent = `Игрок ${dealIndex + 1} из ${round.roles.length}`;
    $('#deal-name').textContent = role.name;
    $('#deal-hint').textContent = 'Убедись, что экран видишь только ты.';
    card.classList.remove('is-open');
    fillBack(role);
  }

  const anim = (node, frames, opts) =>
    (node.animate && !reducedMotion()) ? node.animate(frames, opts).finished.catch(() => {}) : Promise.resolve();
  const clearAnims = (node) => { if (node.getAnimations) node.getAnimations().forEach((a) => a.cancel()); };

  async function onCard() {
    if (cardBusy || !round) return;
    cardBusy = true;
    const wait = reducedMotion() ? 0 : 550;

    if (!cardOpen) {
      cardOpen = true;
      if (!round.committed) {
        round.committed = true;
        settings.used.push(round.loc.name);
        persist();
      }
      card.classList.add('is-open');
      buzz(20);
      $('#deal-hint').textContent = 'Запомни. Нажми ещё раз, чтобы закрыть карточку и передать телефон дальше.';
      await sleep(wait);
      cardBusy = false;
      return;
    }

    cardOpen = false;
    card.classList.remove('is-open');
    await sleep(wait);
    cardBack.replaceChildren();

    if (dealIndex < round.roles.length - 1) {
      await anim(card, [
        { transform: 'translateX(0) rotate(0deg)', opacity: 1 },
        { transform: 'translateX(-120%) rotate(-8deg)', opacity: 0 },
      ], { duration: 260, easing: 'ease-in', fill: 'forwards' });
      dealIndex++;
      renderDeal();
      clearAnims(card);
      await anim(card, [
        { transform: 'translateX(120%) rotate(8deg)', opacity: 0 },
        { transform: 'translateX(0) rotate(0deg)', opacity: 1 },
      ], { duration: 260, easing: 'ease-out' });
      cardBusy = false;
    } else {
      cardBusy = false;
      show('ready');
    }
  }

  card.addEventListener('click', onCard);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCard(); }
  });

  $$('[data-exit]').forEach((b) => b.addEventListener('click', () => {
    if (window.confirm('Выйти в настройки? Роли этого раунда пропадут.')) {
      round = null;
      show('setup');
    }
  }));

  // ---------- игра: первый игрок, таймер, финал ----------
  const clockBox = $('#clock-box');
  const pauseBtn = $('#pause');
  const T = { total: 0, remaining: 0, endAt: 0, running: false, done: false, id: 0 };
  let playToken = 0;
  let wake = null;

  const fmt = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  function drawClock() {
    $('#clock').textContent = fmt(T.remaining);
    $('#bar').style.width = `${T.total ? (T.remaining / T.total) * 100 : 0}%`;
    clockBox.classList.toggle('warn', T.remaining <= 30000);
  }

  function tick() {
    if (!T.running) return;
    T.remaining = Math.max(0, T.endAt - Date.now());
    drawClock();
    if (T.remaining === 0) timeUp();
  }

  function stopTimer() { clearInterval(T.id); T.running = false; }

  function startTimer(minutes) {
    stopTimer();
    T.total = minutes * 60000;
    T.remaining = T.total;
    T.endAt = Date.now() + T.remaining;
    T.running = true;
    T.done = false;
    pauseBtn.textContent = 'Пауза';
    pauseBtn.disabled = false;
    drawClock();
    T.id = setInterval(tick, 250);
  }

  function timeUp() {
    stopTimer();
    T.done = true;
    pauseBtn.disabled = true;
    $('#clock-note').textContent = 'Время вышло. Голосуйте, кто шпион.';
    buzz([250, 120, 250]);
  }

  pauseBtn.addEventListener('click', () => {
    if (T.done) return;
    if (T.running) {
      T.remaining = Math.max(0, T.endAt - Date.now());
      stopTimer();
      pauseBtn.textContent = 'Продолжить';
    } else {
      T.endAt = Date.now() + T.remaining;
      T.running = true;
      T.id = setInterval(tick, 250);
      pauseBtn.textContent = 'Пауза';
    }
  });

  async function lockScreen() {
    try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (_) { /* не критично */ }
  }
  function unlockScreen() {
    try { if (wake) wake.release(); } catch (_) { /* не критично */ }
    wake = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && current === 'play' && !wake) lockScreen();
  });

  // Две кнопки завершения. Каждая срабатывает со второго нажатия, чтобы не закрыть раунд случайно.
  const endButtons = [
    { btn: $('#end-found'), outcome: 'found', label: 'Победили свои' },
    { btn: $('#end-spy'), outcome: 'spy', label: 'Победил шпион' },
  ];
  let armed = null;
  let armTimer = 0;

  function disarm() {
    armed = null;
    clearTimeout(armTimer);
    for (const e of endButtons) {
      e.btn.classList.remove('armed');
      e.btn.textContent = e.label;
    }
  }

  for (const e of endButtons) {
    e.btn.addEventListener('click', () => {
      if (armed === e) {
        disarm();
        round.outcome = e.outcome;
        showReveal();
        return;
      }
      disarm();
      armed = e;
      e.btn.classList.add('armed');
      e.btn.textContent = 'Точно? Нажми ещё раз';
      armTimer = setTimeout(disarm, 3000);
    });
  }

  function leavePlay() {
    playToken++;
    stopTimer();
    unlockScreen();
    disarm();
  }

  async function startPlay() {
    show('play');
    const token = ++playToken;
    const names = round.roles.map((r) => r.name);
    const starterEl = $('#starter');
    const multi = round.spyCount > 1;

    endButtons[1].label = multi ? 'Победили шпионы' : 'Победил шпион';
    disarm();

    const timed = settings.timerOn;
    $('#clock-note').textContent = '';
    clockBox.hidden = !timed;
    pauseBtn.hidden = !timed;
    $('#no-timer-note').hidden = timed;
    if (timed) {
      T.total = settings.timer * 60000;
      T.remaining = T.total;
      drawClock();
      pauseBtn.disabled = true;
    }

    if (!reducedMotion() && names.length > 1) {
      let last = '';
      for (let i = 0; i < 14; i++) {
        let nm;
        do { nm = pick(names); } while (nm === last);
        last = nm;
        starterEl.textContent = nm;
        await sleep(60 + i * 14);
        if (token !== playToken) return;
      }
    }
    starterEl.textContent = names[round.starter];
    buzz(40);
    if (timed) startTimer(settings.timer);
    lockScreen();
  }

  $('#pick-starter').addEventListener('click', startPlay);

  // ---------- итог ----------
  const sheetRow = (label, value) =>
    el('div', { class: 'row' }, el('dt', { text: label }), el('dd', { text: value }));

  function showReveal() {
    const spies = round.roles.filter((r) => r.spy).map((r) => r.name);
    const end = endButtons.find((e) => e.outcome === round.outcome);
    $('#reveal-title').textContent = end.label;
    $('#reveal-sheet').replaceChildren(
      sheetRow('Место', round.loc.name),
      sheetRow('Тема', round.loc.theme),
      sheetRow(spies.length > 1 ? 'Шпионы' : 'Шпион', spies.join(', ')));
    show('reveal');
  }

  $('#again').addEventListener('click', beginRound);
  $('#to-setup').addEventListener('click', () => { round = null; show('setup'); });

  // Случайная перезагрузка посреди раздачи сбросит роли, так что спросим.
  window.addEventListener('beforeunload', (e) => {
    if (inGame) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- старт ----------
  syncInputs();
  refresh();
})();

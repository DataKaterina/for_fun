/* Да, но…: логика игры. Без имён, очков и сервера. */
(function () {
  'use strict';

  var CATS = window.YB_CATEGORIES;
  var CARDS = window.YB_CARDS;
  var TIMER_SECONDS = 20;
  var STORE_KEY = 'yesbut.settings.v1';

  var MODE_HINTS = {
    duel: 'Вдвоём. Роли меняются на каждой карточке, на экране видно, чья очередь.',
    company: 'Телефон ходит по кругу. Прочитал вслух, передал соседу слева: он портит и читает следующую.'
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    setup: $('screen-setup'), play: $('screen-play'),
    modeHint: $('mode-hint'), cats: $('cats'), catsHint: $('cats-hint'),
    timerOn: $('timer-on'), start: $('start'),
    counter: $('counter'), role: $('role'), card: $('card'),
    cardCat: $('card-cat'), cardText: $('card-text'),
    hintBtn: $('hint-btn'), hintBox: $('hint-box'),
    timerBox: $('timer-box'), clock: $('clock'), bar: $('bar'),
    timerBtn: $('timer-btn'), timerNote: $('timer-note'),
    back: $('back'), skip: $('skip'), next: $('next'), exit: $('exit')
  };

  var catName = {};
  CATS.forEach(function (c) { catName[c.id] = c.name; });

  var state = { mode: 'duel', cats: ['mix'], timer: false };
  var pool = [];      // карточки выбранных категорий
  var deck = [];      // перемешанная очередь, из неё берём без повторов
  var history = [];   // показанные карточки: { card, turn }
  var pos = -1;
  var tick = null;
  var deadline = 0;

  /* ---------- настройки ---------- */

  function loadSettings() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!raw) return;
      if (raw.mode === 'duel' || raw.mode === 'company') state.mode = raw.mode;
      if (Array.isArray(raw.cats)) {
        var ok = raw.cats.filter(function (id) { return id === 'mix' || catName[id]; });
        if (ok.length) state.cats = ok;
      }
      state.timer = raw.timer === true;
    } catch (e) { /* без хранилища играем с настройками по умолчанию */ }
  }

  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* не страшно */ }
  }

  function buildCats() {
    var all = [{ id: 'mix', name: 'Микс' }].concat(CATS);
    all.forEach(function (c) {
      var label = document.createElement('label');
      label.className = 'chip';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'cat';
      input.value = c.id;
      var span = document.createElement('span');
      span.textContent = c.name;
      label.appendChild(input);
      label.appendChild(span);
      els.cats.appendChild(label);
    });
  }

  function catInputs() { return Array.prototype.slice.call(els.cats.querySelectorAll('input')); }

  function renderSettings() {
    var modes = document.querySelectorAll('input[name="mode"]');
    Array.prototype.forEach.call(modes, function (m) { m.checked = m.value === state.mode; });
    catInputs().forEach(function (i) { i.checked = state.cats.indexOf(i.value) !== -1; });
    els.timerOn.checked = state.timer;
    els.modeHint.textContent = MODE_HINTS[state.mode];
    els.catsHint.textContent = 'Карточек в колоде: ' + buildPool(state.cats).length;
  }

  function onCatChange(e) {
    var changed = e.target.value;
    var chosen = catInputs().filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
    if (changed === 'mix' && e.target.checked) chosen = ['mix'];
    else if (changed !== 'mix') chosen = chosen.filter(function (id) { return id !== 'mix'; });
    if (!chosen.length) chosen = ['mix'];
    state.cats = chosen;
    renderSettings();
    saveSettings();
  }

  function buildPool(ids) {
    if (ids.indexOf('mix') !== -1) return CARDS.slice();
    return CARDS.filter(function (c) { return ids.indexOf(c.c) !== -1; });
  }

  /* ---------- колода ---------- */

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function draw(avoid) {
    if (!deck.length) {
      deck = shuffle(pool.slice());
      // не начинаем новый круг с той же карточки, на которой закончили
      if (avoid && deck.length > 1 && deck[deck.length - 1] === avoid) {
        var k = Math.floor(Math.random() * (deck.length - 1));
        var t = deck[k]; deck[k] = deck[deck.length - 1]; deck[deck.length - 1] = t;
      }
    }
    return deck.pop();
  }

  /* ---------- экран игры ---------- */

  function roleText(turn) {
    if (state.mode === 'duel') {
      var reader = turn % 2 === 0 ? 1 : 2;
      return 'Читает игрок ' + reader + ' · Портит игрок ' + (reader === 1 ? 2 : 1);
    }
    return 'Прочитай вслух и передай телефон соседу слева. Он портит и читает следующую.';
  }

  function render() {
    var cur = history[pos];
    els.cardCat.textContent = catName[cur.card.c];
    els.cardText.textContent = cur.card.t;
    els.role.textContent = roleText(cur.turn);
    els.counter.textContent = 'Карточка ' + (pos + 1);
    els.back.disabled = pos === 0;

    els.hintBox.hidden = true;
    els.hintBox.textContent = '';
    els.hintBtn.setAttribute('aria-expanded', 'false');
    els.hintBtn.textContent = 'Подсказка';

    resetTimer();

    // перезапуск анимации появления
    els.card.style.animation = 'none';
    void els.card.offsetWidth;
    els.card.style.animation = '';
  }

  function showHint() {
    var cur = history[pos];
    var open = els.hintBox.hidden;
    if (open) {
      els.hintBox.innerHTML = '';
      var b = document.createElement('b');
      b.textContent = 'Но… ';
      els.hintBox.appendChild(b);
      els.hintBox.appendChild(document.createTextNode(cur.card.h));
    }
    els.hintBox.hidden = !open;
    els.hintBtn.setAttribute('aria-expanded', String(open));
    els.hintBtn.textContent = open ? 'Спрятать подсказку' : 'Подсказка';
  }

  function next() {
    if (pos < history.length - 1) {
      pos++;
    } else {
      var cur = history[pos];
      history.push({ card: draw(cur.card), turn: cur.turn + 1 });
      pos++;
    }
    render();
  }

  function back() {
    if (pos > 0) { pos--; render(); }
  }

  function skip() {
    // карточка не зашла: заменяем её, очередь не сдвигается
    var cur = history[pos];
    history.length = pos + 1;
    history[pos] = { card: draw(cur.card), turn: cur.turn };
    render();
  }

  /* ---------- таймер ---------- */

  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  function paintClock(left) {
    els.clock.textContent = String(Math.max(0, Math.ceil(left)));
    els.bar.style.width = Math.max(0, (left / TIMER_SECONDS) * 100) + '%';
    els.timerBox.classList.toggle('warn', left <= 5);
  }

  function resetTimer() {
    stopTick();
    els.timerBox.hidden = !state.timer;
    els.timerBox.classList.remove('warn', 'up');
    els.timerBtn.textContent = 'Запустить таймер';
    els.timerNote.textContent = '';
    paintClock(TIMER_SECONDS);
  }

  function startTimer() {
    stopTick();
    els.timerBox.classList.remove('up');
    els.timerNote.textContent = '';
    els.timerBtn.textContent = 'Заново';
    deadline = Date.now() + TIMER_SECONDS * 1000;
    paintClock(TIMER_SECONDS);
    tick = setInterval(function () {
      var left = (deadline - Date.now()) / 1000;
      if (left <= 0) {
        stopTick();
        paintClock(0);
        els.timerBox.classList.add('up');
        els.timerNote.textContent = 'Время вышло! Что успел, то и облом.';
        els.timerBtn.textContent = 'Запустить заново';
        try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) { /* без вибрации */ }
      } else {
        paintClock(left);
      }
    }, 250);
  }

  /* ---------- переходы между экранами ---------- */

  function startGame() {
    pool = buildPool(state.cats);
    deck = shuffle(pool.slice());
    history = [{ card: deck.pop(), turn: 0 }];
    pos = 0;
    els.setup.hidden = true;
    els.play.hidden = false;
    render();
    window.scrollTo(0, 0);
    els.cardText.focus({ preventScroll: true });
  }

  function exitGame() {
    stopTick();
    els.play.hidden = true;
    els.setup.hidden = false;
    window.scrollTo(0, 0);
    var h = els.setup.querySelector('[data-focus]');
    if (h) h.focus({ preventScroll: true });
  }

  /* ---------- запуск ---------- */

  loadSettings();
  buildCats();
  renderSettings();

  document.querySelectorAll('input[name="mode"]').forEach(function (m) {
    m.addEventListener('change', function () {
      state.mode = m.value;
      renderSettings();
      saveSettings();
    });
  });
  els.cats.addEventListener('change', onCatChange);
  els.timerOn.addEventListener('change', function () {
    state.timer = els.timerOn.checked;
    saveSettings();
  });

  els.start.addEventListener('click', startGame);
  els.next.addEventListener('click', next);
  els.back.addEventListener('click', back);
  els.skip.addEventListener('click', skip);
  els.hintBtn.addEventListener('click', showHint);
  els.timerBtn.addEventListener('click', startTimer);
  els.exit.addEventListener('click', exitGame);

  document.addEventListener('keydown', function (e) {
    if (els.play.hidden) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'BUTTON' || tag === 'INPUT') return;
    if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') back();
  });
})();

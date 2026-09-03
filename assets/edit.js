/* Кондуит — редактор. Работает в браузере телефона, без сервера.

   Схема простая: правишь на экране — жмёшь «Сохранить» — изменение уходит в
   репозиторий, публичный сайт обновляется сам примерно за минуту. Ничего между
   этим не копится: несохранённое живёт только пока открыта страница.

   Токен лежит в localStorage этого браузера и уходит единственному адресату —
   api.github.com. */

(function () {
  "use strict";

  var DATA = null;      // {config, types, students, series}
  var TOKEN = null;
  var SENT = {};        // "01" -> что сохранено; сайт обновляется не мгновенно
  var GONE = {};        // "01" -> когда удалено; сайт ещё показывает старое

  /* Серии правятся не по одной: state.days держит рабочую копию каждой серии,
     которую завели или тронули. Поэтому добавленная серия сразу видна в списке,
     а переключение между сериями ничего не теряет. state.series — указатель на
     открытую копию, она же лежит в state.days.

     Ключ серии — слот: он же имя файла и он же ключ в state.days. Номер серии
     живёт отдельным полем и слоту не равен: перенумеровать серию можно, а
     переименовать её файл — значит потерять историю правок. */
  var state = {
    view: "series",
    roster: null,       // правка списка учеников, пока не сохранена
    zachet: null,       // правка списка файлов зачёта, пока не сохранена
    days: {},           // слот -> рабочая копия серии
    removed: {},        // слот -> подпись серии, помеченной к удалению
    series: null,       // открытая серия, она же элемент days
    graves: null,       // правка гробария, пока не сохранена
    typesEdit: null,    // правка тем, пока не сохранена
    busy: false,
    note: "",
    noteKind: "",       // good | bad | ""
    confirmSub: null,
    confirmDelete: false,
    confirmRevert: false,
    confirmProblem: null,   // id задачи, у которой спрошено удаление
    confirmGrave: null,     // то же для гроба
    confirmType: null,      // id раздела, у которого спрошено удаление
    confirmStudent: null,   // id ученика, у которого спрошено удаление
    confirmFile: null,      // имя файла зачёта, у которого спрошено удаление
    sig: null,              // переключатель подписи; null — не трогали
    pickTheme: null,    // id задачи, у которой открыт выбор темы
    pickWeight: null,   // id задачи, у которой открыта своя цена
    pickDate: null,   // какая из двух дат правится: given | date
    pickSolver: null,   // номер гроборешения, у которого открыт выбор ученика
    pickGrave: null,    // то же для выбора гроба
    confirmSolution: null   // гроборешение, у которого спрошено удаление
  };

  /* Что уже отправлено. Нужен потому, что сайт переразворачивается не сразу:
     сравнивать правку с данными сайта нельзя — минуту после сохранения они
     ещё старые, и всё выглядело бы несохранённым. */
  var SAVED = {
    types: null, graves: null, days: {}, sig: null,
    roster: null, zachet: null
  };


  /* Список учеников правится в редакторе, поэтому всё внутри читает рабочую
     копию, а не то, что пришло с сайта: заведённый ученик должен появиться в
     кондуите сразу, не дожидаясь сохранения. */
  /* Весь список из файла, вместе с выбывшими: их имена нужны — они стоят в
     кондуитах тех серий, где эти люди занимались. */
  function fullRoster() { return state.roster || DATA.students; }

  // список группы: выбывшие в него не входят
  function roster() {
    return fullRoster().filter(function (s) { return !s.out; });
  }

  function nameOf(id) {
    var s = fullRoster().filter(function (x) { return x.id === id; })[0];
    return s ? s.name : id;
  }

  function editRoster() {
    if (!state.roster) state.roster = JSON.parse(JSON.stringify(DATA.students));
    return state.roster;
  }

  /* Выбывший помечается, а не стирается: убрать строку значило бы потерять имя
     во всех прошлых кондуитах, где оно стоит. Из общего списка и из рейтинга
     он при этом уходит. */
  function rosterPayload(list) {
    return (list || []).map(function (s) {
      var out = { id: s.id, name: s.name };
      if (s.out) out.out = true;
      return out;
    });
  }

  function rosterDirty() {
    if (!state.roster) return false;
    return JSON.stringify(rosterPayload(state.roster)) !==
      (SAVED.roster || JSON.stringify(rosterPayload(DATA.students)));
  }

  var tokenDraft = "";  // набранный, но ещё не запомненный токен: живёт до ухода

  var LS_TOKEN = "conduit-token";
  var LS_SENT = "conduit-sent";
  var LS_GONE = "conduit-gone";
  var LS_SAVED_AT = "conduit-saved-at";

  /* Пауза между сохранениями. Держит от случайной очереди отправок: сайт
     переразворачивается около минуты, и частые записи подряд наступают друг
     другу на пятки. Отметка лежит в localStorage, поэтому перезагрузка
     страницы её не обходит. */
  var COOLDOWN = 2 * 60 * 1000;

  function markSaveTime() { lsSet(LS_SAVED_AT, String(Date.now())); }

  function cooldownLeft() {
    var at = Number(lsGet(LS_SAVED_AT, 0));
    if (!at) return 0;
    var left = at + COOLDOWN - Date.now();
    return left > 0 ? left : 0;
  }

  function mmss(ms) {
    var s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ":" + pad2(s % 60);
  }
  var LETTERS = "абвгде";

  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  var MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек"];
  var WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  var WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг",
    "пятница", "суббота", "воскресенье"];

  // ── помощники ───────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function withNum(n, one, few, many) { return n + " " + plural(n, one, few, many); }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function parseISO(iso) {
    var p = String(iso).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function toISO(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function shortDate(iso) {
    var p = String(iso).split("-");
    if (p.length !== 3) return iso;
    return Number(p[2]) + " " + MONTHS_SHORT[Number(p[1]) - 1];
  }

  function longDate(iso) {
    var d = parseISO(iso);
    var wd = (d.getDay() + 6) % 7;
    return d.getDate() + " " + MONTHS[d.getMonth()] + ", " + WEEKDAYS_FULL[wd];
  }

  // без дня недели: для узкой кнопки, где полная запись не помещается
  function dayMonth(iso) {
    var d = parseISO(iso);
    return d.getDate() + " " + MONTHS[d.getMonth()];
  }

  function todayISO() { return toISO(new Date()); }

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* приватный режим */ }
  }

  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (e) { /* пусто */ }
  }

  // ── кодирование для GitHub API ──────────────────────────

  function b64FromUtf8(s) {
    var bytes = new TextEncoder().encode(s);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function utf8FromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ── GitHub API ──────────────────────────────────────────

  function repo() { return (DATA && DATA.config.repo) || {}; }

  function api(path, opts) {
    var r = repo();
    if (!r.owner || !r.name) {
      return Promise.reject(new Error("в data/config.json не указан репозиторий"));
    }
    opts = opts || {};
    var headers = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (TOKEN) headers.Authorization = "Bearer " + TOKEN;
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch("https://api.github.com/repos/" + r.owner + "/" + r.name + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body
    }).then(function (res) {
      return res.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { /* не json */ }
        if (!res.ok) {
          var msg = (j && j.message) || ("HTTP " + res.status);
          if (res.status === 401) msg = "токен не принят — проверь, не истёк ли он";
          if (res.status === 403) msg = "нет прав — нужен доступ Contents: Read and write";
          if (res.status === 404) msg = "не найдено — проверь ник, имя репозитория и права токена";
          if (res.status === 409) msg = "файл изменился на сервере — обнови страницу и повтори";
          if (res.status === 422) msg = "GitHub не принял файл: " + msg;
          /* Код и путь в конце — чтобы по одному снимку экрана было понятно,
             что именно и на каком файле не прошло. */
          throw new Error(msg + " [" + res.status + " " + path.split("?")[0] + "]");
        }
        return j;
      });
    }, function () {
      throw new Error("нет связи с GitHub");
    });
  }

  function getFile(path) {
    return api("/contents/" + path + "?ref=" + (repo().branch || "main"))
      .then(function (j) { return { sha: j.sha, text: utf8FromB64(j.content) }; })
      .catch(function (e) {
        if (/не найдено/.test(e.message)) return null;
        throw e;
      });
  }

  /* Только сведения о файле: размер и метка версии. Для pdf это важно —
     getFile тянет и раскодирует содержимое, а нам нужно лишь знать, лежит ли
     он уже на месте. */
  function statFile(path) {
    return api("/contents/" + path + "?ref=" + (repo().branch || "main"))
      .then(function (j) { return { sha: j.sha, size: j.size }; })
      .catch(function (e) {
        if (/не найдено/.test(e.message)) return null;
        throw e;
      });
  }

  function putFile(path, text, message, sha, base64) {
    var body = {
      message: message,
      content: base64 || b64FromUtf8(text),
      branch: repo().branch || "main"
    };
    if (sha) body.sha = sha;
    return api("/contents/" + path, { method: "PUT", body: JSON.stringify(body) });
  }

  // ── серии ───────────────────────────────────────────────

  function loadSent() {
    try { SENT = JSON.parse(lsGet(LS_SENT, "{}")) || {}; } catch (e) { SENT = {}; }
    try { GONE = JSON.parse(lsGet(LS_GONE, "{}")) || {}; } catch (e) { GONE = {}; }
  }

  /* Сайт переразворачивается не мгновенно, поэтому только что сохранённая
     серия ещё минуту не видна в данных. Помним, что уехало: иначе «+ серия»
     займёт чужой слот, а номер выдастся уже занятый. Заодно из этой записи
     рисуется кнопка серии, пока сайт не догнал. */
  function markSent(d) {
    SENT[pad2(d.n)] = {
      at: new Date().toISOString(),
      series: seriesNo(d),
      date: d.date
    };
    lsSet(LS_SENT, JSON.stringify(SENT));
  }

  function sentInfo(k) {
    var v = SENT[k];
    return v && typeof v === "object" ? v : {};
  }

  /* Удалённая серия исчезает из данных так же не сразу. Пока сайт её
     показывает, кнопка стоит в ленте запертой — иначе серия, которую только что
     убрали, снова выглядела бы обычной и её можно было бы открыть на правку. */
  function markGone(n) {
    GONE[pad2(n)] = new Date().toISOString();
    lsSet(LS_GONE, JSON.stringify(GONE));
  }

  /* Отметка живёт, пока сайт не догонит, но не дольше получаса: серию могли
     удалить с другого устройства, и тогда ждать её появления бессмысленно —
     запертая кнопка осталась бы в ленте навсегда, заняв заодно свой слот. */
  var SENT_LIFE = 30 * 60 * 1000;

  function stale(v) {
    var at = Date.parse(v && typeof v === "object" ? v.at : v);
    return !at || Date.now() - at > SENT_LIFE;
  }

  function pruneSent() {
    var changed = false;
    Object.keys(SENT).forEach(function (k) {
      if (dayBySlot(Number(k)) || stale(SENT[k])) { delete SENT[k]; changed = true; }
    });
    if (changed) lsSet(LS_SENT, JSON.stringify(SENT));

    var gchanged = false;
    Object.keys(GONE).forEach(function (k) {
      if (!dayBySlot(Number(k)) || stale(GONE[k])) { delete GONE[k]; gchanged = true; }
    });
    if (gchanged) lsSet(LS_GONE, JSON.stringify(GONE));
  }

  function dayBySlot(n) {
    return DATA.series.filter(function (s) { return s.n === n; })[0] || null;
  }

  /* Номер серии. У старых файлов отдельного поля нет — там слот и был номером,
     поэтому он и служит запасным значением. */
  function seriesNo(d) {
    return d.series === undefined || d.series === null ? d.n : d.series;
  }

  /* Что написано на кнопке серии — её номер. Номера может не быть только у
     записи о недавно отправленной серии, снятой со старой страницы: там
     честнее вопрос, чем чужое число. */
  function dayMark(d) {
    return d.series === null || d.series === undefined ? "?" : String(d.series);
  }

  function dayLabel(d) { return "Серия " + seriesNo(d); }

  // слот — ключ файла, наружу не показывается
  function nextSlot() {
    var max = 0;
    DATA.series.forEach(function (s) { if (s.n > max) max = s.n; });
    Object.keys(state.days).forEach(function (k) { if (Number(k) > max) max = Number(k); });
    Object.keys(SENT).forEach(function (k) { if (Number(k) > max) max = Number(k); });
    Object.keys(GONE).forEach(function (k) { if (Number(k) > max) max = Number(k); });
    return max + 1;
  }

  // занятые номера серий; удалённые из счёта выбывают
  function seriesNumbers(exceptSlot) {
    var out = {};
    allDays().forEach(function (d) {
      if (d.removed || d.gone || d.n === exceptSlot) return;
      if (d.series === null || d.series === undefined) return;
      out[d.series] = true;
    });
    return out;
  }

  /* Следующий номер — за последним, а не первый свободный: серии идут подряд
     во времени, и новая с номером из старой дыры встала бы посреди списка. */
  function nextSeriesNo(exceptSlot) {
    var max = 0;
    Object.keys(seriesNumbers(exceptSlot)).forEach(function (k) {
      if (Number(k) > max) max = Number(k);
    });
    return max + 1;
  }

  /* Список серии — кто по ней занимался. Заводится он с общего списка на тот
     день, когда серию завели, и дальше живёт своей жизнью: часть кружка уезжает
     на сборы, и занятие им не в пропуск — его у них просто не было. От длины
     этого списка считается и цена задач.

     У серии без своего списка он равен нынешнему общему — так читаются файлы,
     записанные до того, как списки появились. */
  function rosterIds(d) {
    return Array.isArray(d.roster) ? d.roster
      : roster().map(function (s) { return s.id; });
  }

  // пришедшие — всегда подмножество списка серии, иначе счёт разъедется
  function presentIds(d) {
    var ids = rosterIds(d);
    if (!Array.isArray(d.present)) return ids.slice();
    return ids.filter(function (id) { return d.present.indexOf(id) !== -1; });
  }

  // дата выдачи; у серий, заведённых до того, как дат стало две, её нет
  function givenOf(d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(d.given)) ? d.given : d.date;
  }

  /* Занятие по серии может быть ещё впереди: листок уже выдан, темы известны, а
     кондуит пуст. Такую серию сайт не показывает и не считает. */
  function isHeld(d) { return d.held !== false; }

  function blankDay(slot) {
    var ids = roster().map(function (s) { return s.id; });
    var solved = {};
    ids.forEach(function (id) { solved[id] = []; });
    return {
      n: slot, series: nextSeriesNo(slot),
      given: todayISO(), date: todayISO(), held: true,
      roster: ids, present: ids.slice(),
      problems: [], solved: solved
    };
  }

  function copyDay(s) {
    var ids = rosterIds(s);
    var d = JSON.parse(JSON.stringify({
      n: s.n, series: seriesNo(s), date: s.date,
      given: givenOf(s), held: isHeld(s),
      roster: ids, present: presentIds(s),
      problems: s.problems || [], solved: s.solved || {},
      pdf: s.pdf || undefined
    }));
    ids.forEach(function (id) { if (!d.solved[id]) d.solved[id] = []; });
    return d;
  }

  /* Открываем рабочую копию. Если её ещё нет — берём с сайта или заводим
     пустую; в обоих случаях копия остаётся в state.days, поэтому правка
     переживает переход на другую серию. */
  function workingDay(n) {
    if (!state.days[n]) {
      var s = dayBySlot(n);
      state.days[n] = s ? copyDay(s) : blankDay(n);
    }
    return state.days[n];
  }

  function openSeries(n) {
    state.series = workingDay(n);
    state.note = "";
    state.noteKind = "";
    state.pickTheme = null;
    state.pickWeight = null;
    state.pickDate = null;
    state.confirmDelete = false;
    state.confirmProblem = null;
    render();
  }

  // список серий для ленты: и то, что на сайте, и заведённое здесь
  function allDays() {
    var map = {};
    function entry(d, extra) {
      var e = { n: d.n, date: d.date, series: seriesNo(d) };
      Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
      return e;
    }

    DATA.series.forEach(function (s) { map[s.n] = entry(s); });
    Object.keys(state.days).forEach(function (k) {
      var d = state.days[k];
      map[d.n] = entry(d, { local: !dayBySlot(d.n) });
    });
    Object.keys(SENT).forEach(function (k) {
      var n = Number(k);
      if (map[n]) return;
      var info = sentInfo(k);
      map[n] = {
        n: n, date: info.date || null,
        series: info.series === undefined ? null : info.series, pending: true
      };
    });
    /* Ключи здесь с ведущим нулём («03»), а карта — по самому слоту («3»).
       Без Number() серия с однозначным слотом не запиралась после удаления: её
       можно было открыть и сохранить, то есть создать заново. */
    Object.keys(GONE).forEach(function (k) {
      var n = Number(k);
      if (map[n]) map[n].gone = true;
    });
    Object.keys(state.removed).forEach(function (k) {
      var n = Number(k);
      if (map[n]) map[n].removed = true;
    });
    /* Порядок — по номеру серии: он и есть её место в череде занятий. Серия
       без номера (запись об отправке со старой страницы) уходит в конец. */
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) {
        var an = a.series === null || a.series === undefined ? 1e9 : a.series;
        var bn = b.series === null || b.series === undefined ? 1e9 : b.series;
        return an - bn || a.n - b.n;
      });
  }

  function removedNumbers() {
    return Object.keys(state.removed).map(Number)
      .sort(function (a, b) { return a - b; });
  }

  function touch() {
    state.note = "";
    state.noteKind = "";
  }

  function renameProblem(oldId, newId) {
    state.series.problems.forEach(function (p) { if (p.id === oldId) p.id = newId; });
    Object.keys(state.series.solved).forEach(function (sid) {
      var list = state.series.solved[sid];
      var i = list.indexOf(oldId);
      if (i !== -1) list[i] = newId;
    });
  }

  function removeProblem(pid) {
    state.series.problems = state.series.problems.filter(function (p) { return p.id !== pid; });
    Object.keys(state.series.solved).forEach(function (sid) {
      state.series.solved[sid] = state.series.solved[sid].filter(function (x) { return x !== pid; });
    });
  }

  function numPrefix(id) {
    var m = String(id).match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  /* Упражнение — не тема, а вид задания, и отдельной пометки ему не нужно:
     упражнения идут под нулевым номером, так что номер и есть признак.
     Ставится он тем же полем, что и у прочих задач. */
  function isExercise(p) { return numPrefix(p.id) === 0; }

  /* Первая задача серии — упражнение: с него она и начинается. Дальше номера идут
     обычным чередом, а если упражнение не нужно — номер правится вручную. */
  function addProblem() {
    var ps = state.series.problems;
    var max = -1;
    ps.forEach(function (p) {
      var n = numPrefix(p.id);
      if (n > max) max = n;
    });
    var first = types()[0];
    if (!first) return;   // без тем задаче нечего присвоить
    ps.push({
      id: String(max + 1),
      type: first.id,
      sub: first.subs && first.subs.length ? first.subs[0].id : null
    });
    touch();
  }

  // семья пунктов последней задачи: 5 → [5], 5а/5б → [5а, 5б]
  function lastFamily() {
    var ps = state.series.problems;
    if (!ps.length) return [];
    var lastNum = numPrefix(ps[ps.length - 1].id);
    return ps.filter(function (p) { return numPrefix(p.id) === lastNum; });
  }

  // букв ровно шесть: после «е» новый пункт совпал бы с прежним по номеру
  function canAddPart() {
    return lastFamily().length < LETTERS.length;
  }

  function addPart() {
    var ps = state.series.problems;
    if (!ps.length) return addProblem();
    if (!canAddPart()) return;

    var lastNum = numPrefix(ps[ps.length - 1].id);
    var family = lastFamily();
    var sample = family[family.length - 1];

    if (family.length === 1 && String(sample.id) === String(lastNum)) {
      renameProblem(sample.id, lastNum + LETTERS[0]);
      insertAfter(sample, { id: lastNum + LETTERS[1], type: sample.type, sub: sample.sub });
    } else {
      insertAfter(sample, {
        id: lastNum + LETTERS[family.length], type: sample.type, sub: sample.sub
      });
    }
    touch();
  }

  function insertAfter(anchor, item) {
    var i = state.series.problems.indexOf(anchor);
    state.series.problems.splice(i === -1 ? state.series.problems.length : i + 1, 0, item);
  }

  /* Посещаемость стоит прямо в кондуите последним столбцом: отмечать её удобнее
     там же, где ставятся плюсы. По умолчанию отмечены все — снимать проще тех,
     кого не было. */
  function editPresent(d) {
    if (!Array.isArray(d.present)) d.present = presentIds(d);
    return d.present;
  }

  function wasThere(d, id) { return editPresent(d).indexOf(id) !== -1; }

  function togglePresent(d, id) {
    var list = editPresent(d);
    var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
    touch();
  }

  function editSeriesRoster(d) {
    if (!Array.isArray(d.roster)) d.roster = rosterIds(d);
    return d.roster;
  }

  /* Убрали из списка серии — уходит и из пришедших: сказать «был» о том, кого в
     списке нет, значит запутать счёт посещений. */
  function toggleInSeries(d, id) {
    var list = editSeriesRoster(d);
    var i = list.indexOf(id);
    if (i === -1) {
      list.push(id);
      if (!d.solved[id]) d.solved[id] = [];
      editPresent(d).push(id);
    } else {
      list.splice(i, 1);
      d.present = editPresent(d).filter(function (x) { return x !== id; });
    }
    touch();
  }

  function validate(d) {
    d = d || state.series;
    if (!d) return "нечего сохранять";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "не указана дата";
    if (!rosterIds(d).length) return "в списке серии никого";
    if (!d.problems.length) return "не добавлено ни одной задачи";
    var seen = {};
    for (var i = 0; i < d.problems.length; i++) {
      var p = d.problems[i];
      var id = String(p.id).trim();
      if (!id) return "у задачи пустой номер";
      if (seen[id]) return "номер «" + id + "» встречается дважды";
      seen[id] = true;
      if (!p.type) return "у задачи " + id + " не выбрана тема";
    }
    return null;
  }

  function cmpIds(a, b) {
    return numPrefix(a) - numPrefix(b) || String(a).localeCompare(String(b), "ru");
  }

  // то, что уедет в файл: по нему же определяется, изменилась ли серия
  function dayPayload(d) {
    var ids = rosterIds(d);
    var payload = {
      n: d.n,
      series: seriesNo(d),
      given: givenOf(d),
      date: d.date,
      held: isHeld(d),
      title: "Серия " + seriesNo(d),
      roster: ids.slice(),
      present: presentIds(d),
      problems: (d.problems || []).map(function (p) {
        var out = {
          id: String(p.id).trim(),
          type: p.type,
          sub: p.sub || null,
          exercise: isExercise(p)
        };
        // поле только у задач со своей ценой: иначе оно висело бы у всех подряд
        var w = customWeight(p);
        if (w !== null) out.weight = w;
        return out;
      }),
      solved: {}
    };
    if (d.pdf && d.pdf.file) {
      payload.pdf = { file: d.pdf.file, size: d.pdf.size, at: d.pdf.at };
    }

    /* Пишем весь список серии и вдобавок чужие непустые отметки: человека могли
       убрать из списка, и стирать заодно его плюсы — не дело записи одной серии.
       Они не считаются нигде, но лежат на месте и вернутся вместе с ним. */
    ids.forEach(function (id) {
      payload.solved[id] = ((d.solved || {})[id] || []).slice().sort(cmpIds);
    });
    Object.keys(d.solved || {}).forEach(function (sid) {
      if (payload.solved[sid] || !(d.solved[sid] || []).length) return;
      payload.solved[sid] = d.solved[sid].slice().sort(cmpIds);
    });
    return payload;
  }

  function dayDirty(d) {
    var now = JSON.stringify(dayPayload(d));
    if (SAVED.days[d.n]) return now !== SAVED.days[d.n];
    var s = dayBySlot(d.n);
    return !s || now !== JSON.stringify(dayPayload(s));
  }

  function dirtyDays() {
    return Object.keys(state.days)
      .map(function (k) { return state.days[k]; })
      .filter(dayDirty)
      .sort(function (a, b) { return seriesNo(a) - seriesNo(b) || a.n - b.n; });
  }

  /* Отправка одного файла. Ничего не рисует и не переключает состояние занятости
     — этим ведает saveAll: за одно нажатие может уехать несколько серий,
     гробарий и темы. */
  function putDayFile(d) {
    return function () {
      var file = "data/series/" + pad2(d.n) + ".json";
      var payload = dayPayload(d);
      // в подписи к правке — плюсы тех, кто в списке серии: они и считаются
      var pluses = payload.roster.reduce(function (a, id) {
        return a + (payload.solved[id] || []).length;
      }, 0);

      /* Серия, о которой редактор не знает, но файл под её именем есть, — это
         всегда чужие данные: список серий не прочитался, или страница открыта
         со старым списком. Записать поверх — потерять серию целиком, поэтому
         отказываемся. Своя узнаётся по данным сайта, по отметке отправки или по
         тому, что мы уже писали её в этот заход. */
      var known = !!dayBySlot(d.n) || !!SENT[pad2(d.n)] || !!SAVED.days[d.n];

      return getFile(file)
        .then(function (cur) {
          if (cur && !known) {
            throw new Error("файл " + pad2(d.n) +
              ".json уже есть в репозитории — обнови страницу");
          }
          return putFile(file, JSON.stringify(payload, null, 2) + "\n",
            "Серия " + seriesNo(d) + " (" + shortDate(d.date) + "): " +
              withNum(payload.problems.length, "задача", "задачи", "задач") + ", " +
              withNum(pluses, "плюс", "плюса", "плюсов"),
            cur && cur.sha);
        })
        .then(function () {
          markSent(d);
          SAVED.days[d.n] = JSON.stringify(payload);
        });
    };
  }

  /* Одна кнопка на всё несохранённое. Порядок важен: темы уходят первыми,
     иначе задача с новым подразделом попадёт на сайт раньше подраздела. */
  function saveAll() {
    if (state.busy) return;
    if (!TOKEN) return needToken();

    if (cooldownLeft() > 0) return;

    var days = dirtyDays();
    var gone = removedNumbers();
    var jobs = [];
    /* Файлы идут раньше всех записей, которые на них ссылаются. Удаления
       раньше загрузок: имя нового файла делается из названия и может совпасть
       с только что убранным — иначе новый лёг бы и тут же был стёрт. */
    goneBlobs().slice().forEach(function (path) { jobs.push(dropBlobFile(path)); });
    stagedBlobs().slice().forEach(function (b) { jobs.push(putBlobFile(b)); });
    // список учеников уходит следом: на него ссылается всё остальное
    if (rosterDirty()) jobs.push(putStudentsFile);
    if (typesDirty()) jobs.push(putTypesFile);
    days.forEach(function (d) { jobs.push(putDayFile(d)); });
    gone.forEach(function (n) { jobs.push(dropDayFile(n)); });
    if (gravesDirty()) jobs.push(putGravesFile);
    if (configDirty()) jobs.push(putConfigFile);
    if (zachetDirty()) jobs.push(putZachetFile);
    if (!jobs.length) return;

    // список серий правим последним и одной записью
    jobs.push(function () {
      return syncManifest(
        days.map(function (d) { return pad2(d.n) + ".json"; }),
        gone.map(function (n) { return pad2(n) + ".json"; })
      ).then(function () {
        /* Пометка удаления снимается только теперь. Раньше её снимало само
           удаление файла — и если запись списка потом срывалась, о висячей
           строке никто уже не помнил. */
        gone.forEach(function (n) { delete state.removed[n]; });
      });
    });

    state.busy = true;
    state.note = "";
    state.noteKind = "";
    render();

    jobs.reduce(function (chain, job) {
      return chain.then(job);
    }, Promise.resolve())
      .then(function () {
        state.busy = false;
        state.note = "Сохранено";
        state.noteKind = "good";
        markSaveTime();
        return reload();
      })
      .catch(function (err) {
        state.busy = false;
        state.note = "Не сохранилось: " + err.message;
        state.noteKind = "bad";
        render();
      });
  }

  /* Удаление файла серии. Как и запись, происходит только по кнопке
     сохранения: до неё серия лишь помечена к удалению и вычеркнута в ленте.
     После удаления она ещё минуту видна в данных сайта — на это время кнопка
     запирается и исчезает сама, когда сайт догонит. */
  function dropDayFile(n) {
    return function () {
      var file = "data/series/" + pad2(n) + ".json";
      var label = state.removed[n];
      return getFile(file).then(function (cur) {
        if (!cur) return null;
        return api("/contents/" + file, {
          method: "DELETE",
          body: JSON.stringify({
            message: (typeof label === "string" ? label : "Серия") + " — удалено",
            sha: cur.sha,
            branch: repo().branch || "main"
          })
        });
      }).then(function () {
        delete SENT[pad2(n)];
        lsSet(LS_SENT, JSON.stringify(SENT));
        markGone(n);
        delete state.days[n];
        delete SAVED.days[n];
      });
    };
  }

  var MANIFEST = "data/series/manifest.json";

  /* Список серий разбирается строго. Нечитаемый список, посчитанный пустым,
     первой же записью стёр бы с сайта все серии, кроме одной. Лучше отказать с
     внятной причиной. */
  function readManifest(cur) {
    if (!cur) return [];
    var list;
    try { list = JSON.parse(cur.text).series; } catch (e) { list = null; }
    if (!Array.isArray(list)) {
      throw new Error("список серий (manifest.json) испорчен — правь его вручную");
    }
    return list.slice();
  }

  /* Настоящий список файлов серий — из самого репозитория. Считать список по
     памяти страницы нельзя: любая осечка (не прошла запись, оборвалась связь,
     правили с двух устройств) навсегда оставляла в нём либо лишнюю строку, либо
     дыру, а вычислить это заново было неоткуда. */
  function listSeriesFiles() {
    return api("/contents/data/series?ref=" + (repo().branch || "main"))
      .then(function (list) {
        if (!Array.isArray(list)) throw new Error("не читается папка data/series");
        return list.filter(function (f) {
          return f.type === "file" && /^\d+\.json$/.test(f.name);
        }).map(function (f) { return f.name; });
      });
  }

  /* Список серий пишется один раз за сохранение и целиком: он равен тому, что
     лежит в папке. Только что записанное добавляется, только что удалённое
     вычитается — на случай, если GitHub отдаст ещё не обновившуюся папку (после
     записи он какое-то время показывает прежнее состояние; отсюда и были
     когда-то серия без строки в списке, и строка без файла).

     Из-за этого же порядок самолечащийся: любое прошлое расхождение уходит при
     ближайшем сохранении, даже если о нём никто не помнит.

     Одна попытка повтора — на случай устаревшей метки версии. */
  function syncManifest(add, drop, retry) {
    return listSeriesFiles().then(function (files) {
      var next = files.filter(function (f) { return drop.indexOf(f) === -1; });
      add.forEach(function (f) { if (next.indexOf(f) === -1) next.push(f); });
      next.sort();

      return getFile(MANIFEST).then(function (cur) {
        var list = readManifest(cur);
        if (JSON.stringify(next) === JSON.stringify(list)) return null;

        /* Пустой список равносилен стёртому сайту. Своим ходом он получиться
           не может: если серии не удаляли, а считать нечего — что-то не так с
           ответом GitHub, и писать это в репозиторий нельзя. */
        if (!next.length && list.length && !drop.length) {
          throw new Error("список серий вышел пустым — сохранение отменено");
        }

        return putFile(MANIFEST, JSON.stringify({ series: next }, null, 2) + "\n",
          "Список серий обновлён", cur && cur.sha)
          .catch(function (err) {
            if (retry || !/изменился на сервере/.test(err.message)) throw err;
            return syncManifest(add, drop, true);
          });
      });
    });
  }

  /* Настройки сайта живут в data/config.json — значит, видны всем и переживают
     перезагрузку страницы. Файл читается заново перед записью и меняется
     точечно: в нём же лежит отметка сборки, и затирать её правкой со старой
     страницы нельзя. */
  function sigOn() {
    if (state.sig !== null) return state.sig;
    if (SAVED.sig !== null) return SAVED.sig;
    return !!(DATA.config.signature && DATA.config.signature.on);
  }

  function sigDirty() {
    if (state.sig === null) return false;
    var was = SAVED.sig !== null
      ? SAVED.sig : !!(DATA.config.signature && DATA.config.signature.on);
    return state.sig !== was;
  }

  /* Вес задачи = n − число решивших. n — сколько человек занималось по этой
     серии, то есть длина её списка: задачу, которую сдали все, никто не считает
     за достижение, а задача-одиночка стоит почти в цену всей группы. Список у
     каждой серии свой, поэтому и n у них разное.

     Гробы к занятию не привязаны и считаются от всего списка группы. Единица
     снизу — для пустого списка: n = 0 обнулило бы всё. */
  function baseOf(list) { return Math.max((list || []).length, 1); }

  function seriesBase(d) { return baseOf(rosterIds(d)); }

  function gravesBase() { return baseOf(roster()); }

  /* Ниже одного очка вес не опускается — то же правило, что и на сайте. Задачу,
     которую взяли все, обнулять не за что: она была решена, просто всеми. */
  function weightOf(k, base) { return Math.max(base - k, 1); }

  /* Цену задачи можно задать вручную. Формула знает только число решивших, а
     задача бывает дорога и не поэтому: её давали с подсказкой, или она стоила
     целого вечера. Заданная вручную цена от числа решивших не зависит вовсе.

     Пустого поля тут не бывает: не задана — значит считается формулой. */
  function customWeight(p) {
    var w = p && p.weight;
    return typeof w === "number" && isFinite(w) && w >= 0 ? Math.round(w) : null;
  }

  function priceOf(p, solvers, base) {
    var w = customWeight(p);
    return w === null ? weightOf(solvers, base) : w;
  }

  function configDirty() { return sigDirty(); }

  /* Пишем только то, что правили. Обе настройки разом писать нельзя: значение
     нетронутой берётся из памяти страницы, а она устаревает — правка одной
     настройки откатывала бы чужое изменение другой. */
  /* Файл читается заново и меняется точечно: в нём же лежит отметка сборки, и
     затирать её правкой со старой страницы нельзя. */
  function putConfigFile() {
    var sig = state.sig;
    return getFile("data/config.json").then(function (cur) {
      if (!cur) throw new Error("нет data/config.json");
      var cfg = JSON.parse(cur.text);
      cfg.signature = cfg.signature || {};
      cfg.signature.on = sig;
      return putFile("data/config.json", JSON.stringify(cfg, null, 2) + "\n",
        "Настройки: " + (sig ? "подпись включена" : "подпись выключена"), cur.sha);
    }).then(function () { SAVED.sig = sig; });
  }

  function putStudentsFile() {
    var payload = rosterPayload(roster());
    return getFile("data/students.json").then(function (cur) {
      return putFile("data/students.json", JSON.stringify(payload, null, 2) + "\n",
        "Ученики: " + withNum(payload.length, "человек", "человека", "человек"),
        cur && cur.sha);
    }).then(function () { SAVED.roster = JSON.stringify(payload); });
  }

  // ── приложенные файлы ───────────────────────────────────

  /* Один склад на все pdf: листки серий, гробарий и зачёт. Выбранный файл
     лежит здесь с содержимым, пока не нажато «Сохранить», — как и всякая
     правка в редакторе.

     Записи в json ссылаются на файл по имени, поэтому сами файлы уезжают
     раньше: сначала удаления, потом загрузки, и только потом списки. */
  var PDF_MAX = 8 * 1024 * 1024;    // больше телефон и не отдаст по-человечески

  function stagedBlobs() { return state.blobs || (state.blobs = []); }
  function goneBlobs() { return state.blobsGone || (state.blobsGone = []); }

  function stageBlob(path, data, size, title, replace) {
    unstageBlob(path);
    stagedBlobs().push({
      path: path, data: data, size: size, title: title, replace: !!replace
    });
    // файл вернули на то же имя — значит, удалять его уже не надо
    state.blobsGone = goneBlobs().filter(function (x) { return x !== path; });
  }

  function unstageBlob(path) {
    state.blobs = stagedBlobs().filter(function (b) { return b.path !== path; });
  }

  function stagedBlob(path) {
    return stagedBlobs().filter(function (b) { return b.path === path; })[0] || null;
  }

  // файл, который ещё не уезжал, удалять из репозитория незачем
  function dropBlob(path) {
    if (stagedBlob(path)) return unstageBlob(path);
    if (goneBlobs().indexOf(path) === -1) goneBlobs().push(path);
  }

  function blobsDirty() { return stagedBlobs().length + goneBlobs().length; }

  /* Имя файла в репозитории делаем сами: телефон отдаёт что угодно, вплоть до
     пробелов и кириллицы, а это имя попадёт в ссылку. */
  function pdfName(title, taken, fallback) {
    var base = translit(title) || fallback || "file";
    var name = base + ".pdf", i = 2;
    while (taken.indexOf(name) !== -1) { name = base + "-" + i + ".pdf"; i += 1; }
    return name;
  }

  /* Двоичный файл уходит тем же путём, что и текстовый: base64 в теле запроса.
     Режем по кусочкам — на мегабайтном файле fromCharCode.apply от целого
     массива переполняет стек аргументов. */
  function b64FromBytes(buf) {
    var bytes = new Uint8Array(buf);
    var out = "", step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(out);
  }

  /* Читаем выбранный файл и отдаём его дальше. Проверки здесь же: pdf ли это и
     не великоват ли — телефон отдаст что угодно, вплоть до видео. */
  function readPdf(f, then) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) {
      state.note = "Нужен pdf";
      state.noteKind = "bad";
      return render();
    }
    if (f.size > PDF_MAX) {
      state.note = "Файл больше " + fileSize(PDF_MAX) + " — столько не уедет";
      state.noteKind = "bad";
      return render();
    }
    var reader = new FileReader();
    reader.onload = function () { then(b64FromBytes(reader.result), f); };
    reader.onerror = function () {
      state.note = "Файл не прочитался";
      state.noteKind = "bad";
      render();
    };
    reader.readAsArrayBuffer(f);
  }

  function putBlobFile(b) {
    return function () {
      return statFile(b.path).then(function (cur) {
        /* Тот же файл уже на месте — значит, прошлая отправка успела пройти, а
           сорвалось что-то следующее. Повтор не должен спотыкаться об это. */
        if (cur && cur.size === b.size) return null;
        /* У листка имя закреплено за записью (серия, гробарий), и новый ложится
           поверх старого. У файла зачёта имя выдаётся по названию и совпасть
           может с чем угодно — такой чужой файл переписывать нельзя. */
        if (cur && !b.replace) {
          throw new Error("файл " + b.path.split("/").pop() +
            " уже есть в репозитории — переименуй запись");
        }
        return putFile(b.path, null, "Файл: " + (b.title || b.path),
          cur && cur.sha, b.data);
      }).then(function () { unstageBlob(b.path); });
    };
  }

  function dropBlobFile(path) {
    return function () {
      return statFile(path).then(function (cur) {
        if (!cur) return null;
        return api("/contents/" + path, {
          method: "DELETE",
          body: JSON.stringify({
            message: "Файл удалён: " + path.split("/").pop(),
            sha: cur.sha,
            branch: repo().branch || "main"
          })
        });
      }).then(function () {
        state.blobsGone = goneBlobs().filter(function (x) { return x !== path; });
      });
    };
  }

  /* Размер словами: килобайты до мегабайта, дальше мегабайты с десятой. Точный
     байт никому не нужен — важно понять, уедет ли это с телефона. */
  function fileSize(n) {
    if (typeof n !== "number" || !isFinite(n) || n <= 0) return "";
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " КБ";
    return (n / 1024 / 1024).toFixed(1).replace(".", ",") + " МБ";
  }

  /* Карточка приложенного листка: выбрать, показать, убрать. Одна на серию и на
     гробарий. Называется он везде одинаково — «Листок»: чей это листок, видно
     по месту, где он лежит. Осмысленное имя нужно уже скачанному файлу, и его
     даёт сайт. */
  function pdfCard(current, opts) {
    var card = el("div", "card");

    if (current && current.file) {
      var line = el("div", "subline wide");
      var main = el("span", "subline-name", "Листок");
      if (stagedBlob(opts.dir + current.file)) {
        main.appendChild(el("i", "badge", "новый"));
      }
      line.appendChild(main);
      line.appendChild(el("span", "subline-val muted", fileSize(current.size)));
      line.appendChild(deleteCell(state.confirmFile === opts.dir + current.file,
        function () {
          state.confirmFile = opts.dir + current.file;
          render();
        }, function () {
          dropBlob(opts.dir + current.file);
          opts.onDrop();
          state.confirmFile = null;
          render();
        }));
      card.appendChild(line);
      return card;
    }

    var file = el("input");
    file.type = "file";
    file.accept = "application/pdf,.pdf";
    file.className = "hidden-file";
    file.addEventListener("change", function () {
      readPdf(file.files && file.files[0], function (data, f) {
        stageBlob(opts.dir + opts.name, data, f.size, "Листок", true);
        // дата загрузки уедет в файл: из неё делается имя скачанного гробария
        opts.onPick({ file: opts.name, size: f.size, at: todayISO() });
        render();
      });
    });

    var row = el("div", "frow gap");
    row.appendChild(button("Выбрать pdf", "ghost-btn", function () { file.click(); }));
    row.appendChild(file);
    card.appendChild(row);
    card.appendChild(el("div", "savecard-note",
      "pdf до " + fileSize(PDF_MAX) + "; уедет по кнопке сохранения"));
    return card;
  }

  // ── зачёт ───────────────────────────────────────────────

  /* Приложенные pdf: список в data/zachet.json, сами файлы в data/zachet/.
     Со счётом они не связаны — это просто раздаточный материал. */
  var ZACHET_DIR = "data/zachet/";

  function zachetList() {
    if (!state.zachet) {
      state.zachet = JSON.parse(JSON.stringify(
        (DATA.zachet && DATA.zachet.items) || []));
    }
    return state.zachet;
  }

  function zachetPayload(list) {
    return (list || []).map(function (it) {
      return { title: it.title, file: it.file, size: it.size, at: it.at };
    });
  }

  function zachetDirty() {
    if (!state.zachet) return false;
    var was = SAVED.zachet ||
      JSON.stringify(zachetPayload((DATA.zachet && DATA.zachet.items) || []));
    return JSON.stringify(zachetPayload(state.zachet)) !== was;
  }

  function addZachet(title, f, data) {
    var taken = zachetList().map(function (it) { return it.file; });
    var name = pdfName(title, taken, "zachet");
    stageBlob(ZACHET_DIR + name, data, f.size, title);
    zachetList().push({
      title: title, file: name, size: f.size, at: todayISO()
    });
    touchZachet();
  }

  function removeZachet(name) {
    dropBlob(ZACHET_DIR + name);
    state.zachet = zachetList().filter(function (x) { return x.file !== name; });
    state.confirmFile = null;
    touchZachet();
  }

  function touchZachet() {
    state.note = "";
    state.noteKind = "";
  }

  function putZachetFile() {
    var payload = zachetPayload(zachetList());
    return getFile("data/zachet.json").then(function (cur) {
      return putFile("data/zachet.json", JSON.stringify({ items: payload }, null, 2) + "\n",
        "Зачёт: " + withNum(payload.length, "файл", "файла", "файлов"),
        cur && cur.sha);
    }).then(function () { SAVED.zachet = JSON.stringify(payload); });
  }

  function needToken() {
    state.view = "save";
    state.note = "Нужен токен";
    state.noteKind = "bad";
    render();
  }

  // ── гробарий ────────────────────────────────────────────

  /* Гробы живут отдельным файлом: они не привязаны к серии, копятся весь год
     и на сайте включаются в рейтинг отдельным переключателем. Номер всегда
     «Гn» — поэтому он не редактируется, а выдаётся следующим свободным.

     Кто что взял — не сетка «ученики × гробы», а отдельные записи. Гробы дело
     штучное: сетка под них стоит почти пустой, и надбавку за конкретное
     решение в клетке «+» показать негде. */

  /* Предел надбавки — не правило счёта, а страховка от зажатой кнопки:
     столько нажатий подряд не бывает. */
  var BONUS_MAX = 9999;

  function ensureGraves() {
    if (!state.graves) {
      state.graves = {
        pdf: (DATA.graves || {}).pdf || undefined,
        problems: JSON.parse(JSON.stringify((DATA.graves || {}).problems || [])),
        solutions: readSolutions(DATA.graves)
      };
    }
    return state.graves;
  }

  /* У файлов, записанных до разделения, вместо списка решений лежит карта
     solved: читаем и её, иначе первое же сохранение стёрло бы старые плюсы. */
  function readSolutions(g) {
    g = g || {};
    if (Array.isArray(g.solutions)) {
      return g.solutions.map(function (s) {
        return {
          student: s.student || null,
          problem: s.problem || null,
          bonus: solutionBonus(s)
        };
      });
    }
    var out = [];
    Object.keys(g.solved || {}).forEach(function (sid) {
      (g.solved[sid] || []).forEach(function (pid) {
        out.push({ student: sid, problem: pid, bonus: 0 });
      });
    });
    return out;
  }

  /* Надбавка ставится за само решение и прибавляется к цене гроба. Ниже нуля
     не бывает: это надбавка, а не штраф. */
  function solutionBonus(s) {
    var v = s && s.bonus;
    return typeof v === "number" && isFinite(v) && v > 0
      ? Math.min(Math.round(v), BONUS_MAX) : 0;
  }

  function graveNum(id) {
    var m = String(id).match(/(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  /* Пункты одного гроба идут по букве: номер у них общий, и без второго
     сравнения Г3а и Г3б встали бы как придётся. */
  function cmpGraves(a, b) {
    return graveNum(a) - graveNum(b) || String(a).localeCompare(String(b), "ru");
  }

  // буква пункта, если она есть: Г3а → «а», Г3 → «»
  function graveSuffix(id) {
    var m = String(id).match(/^Г\d+(.*)$/);
    return m ? m[1] : "";
  }

  function sortGraves() {
    ensureGraves().problems.sort(function (a, b) { return cmpGraves(a.id, b.id); });
  }

  function renameGrave(oldId, newId) {
    var g = ensureGraves();
    g.problems.forEach(function (p) { if (p.id === oldId) p.id = newId; });
    g.solutions.forEach(function (s) { if (s.problem === oldId) s.problem = newId; });
  }

  /* Решения пишем по порядку гробов, внутри гроба — по алфавиту. Порядок в
     файле от порядка нажатий тогда не зависит, и в истории видно правку, а не
     перетасовку. Незаполненные записи наружу не уходят. */
  function gravesPayload(g) {
    // имена берём вместе с выбывшими: иначе их решения сползли бы в конец
    var name = {};
    fullRoster().forEach(function (s) { name[s.id] = s.name; });

    var list = readSolutions(g).filter(function (s) {
      return s.student && s.problem;
    }).map(function (s) {
      return { student: s.student, problem: s.problem, bonus: solutionBonus(s) };
    });

    list.sort(function (a, b) {
      return cmpGraves(a.problem, b.problem) ||
        String(name[a.student] || a.student)
          .localeCompare(String(name[b.student] || b.student), "ru");
    });

    var out = {
      problems: (((g && g.problems) || [])).map(function (p) {
        var out = { id: p.id, type: p.type, sub: p.sub || null };
        var w = customWeight(p);
        if (w !== null) out.weight = w;
        return out;
      }),
      solutions: list
    };
    if (g && g.pdf && g.pdf.file) {
      out.pdf = { file: g.pdf.file, size: g.pdf.size, at: g.pdf.at };
    }
    return out;
  }

  function gravesDirty() {
    if (!state.graves) return false;
    return JSON.stringify(gravesPayload(state.graves)) !==
      (SAVED.graves || JSON.stringify(gravesPayload(DATA.graves)));
  }

  function touchGraves() {
    state.note = "";
    state.noteKind = "";
  }

  function addGrave() {
    var g = ensureGraves();
    var max = 0;
    g.problems.forEach(function (p) {
      var n = graveNum(p.id);
      if (n > max) max = n;
    });
    var first = types()[0];
    if (!first) return;   // без тем задаче нечего присвоить
    g.problems.push({
      id: "Г" + (max + 1),
      type: first.id,
      sub: first.subs && first.subs.length ? first.subs[0].id : null
    });
    sortGraves();
    touchGraves();
  }

  // семья пунктов последнего гроба: Г3 → [Г3], Г3а/Г3б → [Г3а, Г3б]
  function lastGraveFamily() {
    var ps = ensureGraves().problems;
    if (!ps.length) return [];
    var last = graveNum(ps[ps.length - 1].id);
    return ps.filter(function (p) { return graveNum(p.id) === last; });
  }

  // букв ровно шесть — как и у задачи серии
  function canAddGravePart() {
    return lastGraveFamily().length < LETTERS.length;
  }

  function insertGraveAfter(anchor, item) {
    var ps = ensureGraves().problems;
    var i = ps.indexOf(anchor);
    ps.splice(i === -1 ? ps.length : i + 1, 0, item);
  }

  /* Пункт гроба — то же, что пункт задачи серии: Г3 превращается в Г3а, и
     рядом встаёт Г3б. Решения при переименовании не теряются: renameGrave
     правит и их. Цена у пунктов своя — каждый считается отдельной задачей. */
  function addGravePart() {
    var ps = ensureGraves().problems;
    if (!ps.length) return addGrave();
    if (!canAddGravePart()) return;

    var last = graveNum(ps[ps.length - 1].id);
    var family = lastGraveFamily();
    var sample = family[family.length - 1];

    if (family.length === 1 && sample.id === "Г" + last) {
      renameGrave(sample.id, "Г" + last + LETTERS[0]);
      insertGraveAfter(sample, {
        id: "Г" + last + LETTERS[1], type: sample.type, sub: sample.sub
      });
    } else {
      insertGraveAfter(sample, {
        id: "Г" + last + LETTERS[family.length], type: sample.type, sub: sample.sub
      });
    }
    sortGraves();
    touchGraves();
  }

  function removeGrave(id) {
    var g = ensureGraves();
    g.problems = g.problems.filter(function (p) { return p.id !== id; });
    // решения удалённого гроба уходят с ним: без задачи они ничего не значат
    g.solutions = g.solutions.filter(function (s) { return s.problem !== id; });
    touchGraves();
  }

  // ── гроборешения ────────────────────────────────────────

  function solutions() { return ensureGraves().solutions; }

  function studentById(id) {
    return roster().filter(function (s) { return s.id === id; })[0] || null;
  }

  function graveById(id) {
    return ensureGraves().problems.filter(function (p) { return p.id === id; })[0] || null;
  }

  // сколько человек взяло гроб — от этого его цена и зависит
  function graveSolvers(id) {
    return solutions().filter(function (s) { return s.problem === id; }).length;
  }

  // цена гроба считается той же формулой, но от всего списка группы
  function gravePrice(id) {
    return priceOf(graveById(id), graveSolvers(id), gravesBase());
  }

  function solutionValue(s) {
    return s.problem ? gravePrice(s.problem) + solutionBonus(s) : 0;
  }

  /* Пустая запись: ни ученика, ни гроба. Подставлять первых попавшихся нельзя —
     это утверждение о том, кто что решил, и делать его должен человек. Пока
     запись не заполнена, вкладка сохранения её не выпустит. */
  function addSolution() {
    solutions().push({ student: null, problem: null, bonus: 0 });
    touchGraves();
  }

  function removeSolution(i) {
    solutions().splice(i, 1);
    state.confirmSolution = null;
    state.pickSolver = null;
    state.pickGrave = null;
    touchGraves();
  }

  /* Дважды одно и то же решение не записывается: это и лишний плюс в рейтинге,
     и лишний решивший, от которого сам гроб подешевел бы. */
  function solutionTaken(sid, pid, except) {
    return solutions().some(function (s, i) {
      return i !== except && s.student === sid && s.problem === pid;
    });
  }

  function unfilledSolutions() {
    return solutions().filter(function (s) { return !s.student || !s.problem; }).length;
  }

  function putGravesFile() {
    var payload = gravesPayload(state.graves);

    return getFile("data/graves.json").then(function (cur) {
      return putFile("data/graves.json", JSON.stringify(payload, null, 2) + "\n",
        "Гробарий: " + withNum(payload.problems.length, "гроб", "гроба", "гробов") +
        ", " + withNum(payload.solutions.length, "решение", "решения", "решений"),
        cur && cur.sha);
    }).then(function () { SAVED.graves = JSON.stringify(payload); });
  }

  function viewGraves(host) {
    // не прочитался — не показываем пустой список: правка ушла бы поверх него
    if (!DATA.gravesOk) return host.appendChild(brokenCard("гробарий"));

    var g = ensureGraves();

    var card = el("div", "card");
    g.problems.forEach(function (p) { card.appendChild(graveRow(p)); });

    var actions = el("div", "frow gap");
    actions.appendChild(button("гроб", "ghost-btn add", function () {
      addGrave();
      render();
    }));
    var gpart = button("пункт", "ghost-btn add", function () {
      addGravePart();
      render();
    });
    // дошли до «е» — дальше пункт совпал бы с уже существующим
    gpart.disabled = g.problems.length > 0 && !canAddGravePart();
    actions.appendChild(gpart);
    card.appendChild(actions);
    host.appendChild(card);

    var shp = el("div", "section-head");
    shp.appendChild(el("span", "section-title", "Листок"));
    host.appendChild(shp);
    host.appendChild(pdfCard(g.pdf, {
      dir: PDF_DIR,
      name: "grobariy.pdf",
      onPick: function (info) { g.pdf = info; touchGraves(); },
      onDrop: function () { delete g.pdf; touchGraves(); }
    }));

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Кто решил"));
    host.appendChild(sh);

    if (!g.problems.length) {
      var none = el("div", "card");
      none.appendChild(el("div", "summary", "Сначала заведи гроб — решать пока нечего."));
      host.appendChild(none);
      return;
    }

    var scard = el("div", "card");
    g.solutions.forEach(function (s, i) { scard.appendChild(solutionBlock(s, i)); });

    var sact = el("div", "frow gap");
    sact.appendChild(button("гроборешение", "ghost-btn add", function () {
      addSolution();
      render();
    }));
    scard.appendChild(sact);
    host.appendChild(scard);

    if (g.solutions.length) {
      var total = g.solutions.reduce(function (a, s) { return a + solutionValue(s); }, 0);
      host.appendChild(el("div", "summary",
        withNum(g.solutions.length, "решение", "решения", "решений") +
        ", " + withNum(total, "очко", "очка", "очков")));
    }
  }

  /* Блок гроборешения: кто, какой гроб и надбавка за него. Всё выбирается
     своими списками — системных полей на этой странице нет. */
  function solutionBlock(s, i) {
    var block = el("div", "tblock");

    var whoOpen = state.pickSolver === i;
    var whatOpen = state.pickGrave === i;

    var top = el("div", "frow top");
    var st = studentById(s.student);
    /* Ученика могли убрать из списка: решение остаётся в файле, но не считается.
       Пустая запись и запись на выбывшего — разные вещи, и подпись разная. */
    var who = st ? st.name : (s.student ? "нет в списке" : "кто?");
    top.appendChild(field("Решивший", picker(who, null, whoOpen,
      function () {
        state.pickSolver = whoOpen ? null : i;
        state.pickGrave = null;
        render();
      })));

    var p = graveById(s.problem);
    var t = p ? typeById(p.type) : null;
    var sub = p ? subOf(t, p) : null;
    var label = p
      ? p.id + (sub ? " · " + sub.name : (t ? " · " + t.name : ""))
      : "какой?";
    top.appendChild(field("Гроб", picker(label,
      p ? themeMark(p) : null, whatOpen,
      function () {
        state.pickGrave = whatOpen ? null : i;
        state.pickSolver = null;
        render();
      })));
    block.appendChild(top);

    if (whoOpen) block.appendChild(solverChooser(s, i));
    if (whatOpen) block.appendChild(graveChooser(s, i));

    var bottom = el("div", "frow gap");
    bottom.appendChild(field("Надбавка", bonusStepper(s)));
    bottom.appendChild(priceBox(s));
    bottom.appendChild(deleteCell(state.confirmSolution === i, function () {
      state.confirmSolution = i;
      state.pickSolver = null;
      state.pickGrave = null;
      render();
    }, function () {
      removeSolution(i);
      render();
    }));
    block.appendChild(bottom);

    return block;
  }

  function picker(label, mark, open, fn) {
    var b = el("button", "picker-btn" + (open ? " open" : ""));
    b.type = "button";
    var box = el("span", "picker-label");
    if (mark) box.appendChild(mark);
    box.appendChild(document.createTextNode(label));
    b.appendChild(box);
    b.appendChild(el("span", "picker-caret", "▾"));
    b.addEventListener("click", fn);
    return b;
  }

  function solverChooser(s, i) {
    var box = el("div", "chooser");
    var chips = el("div", "chips");
    roster().forEach(function (st) {
      // у кого этот гроб уже записан — второй раз он его не решал
      if (s.problem && solutionTaken(st.id, s.problem, i)) return;
      var b = el("button", "chip pick", st.name);
      b.type = "button";
      b.setAttribute("aria-pressed", st.id === s.student ? "true" : "false");
      b.addEventListener("click", function () {
        s.student = st.id;
        state.pickSolver = null;
        touchGraves();
        render();
      });
      chips.appendChild(b);
    });
    box.appendChild(chips);
    return box;
  }

  function graveChooser(s, i) {
    var box = el("div", "chooser");
    var chips = el("div", "chips");
    ensureGraves().problems.forEach(function (p) {
      if (s.student && solutionTaken(s.student, p.id, i)) return;
      var b = el("button", "chip pick");
      b.type = "button";
      b.setAttribute("aria-pressed", p.id === s.problem ? "true" : "false");
      b.appendChild(themeMark(p));
      b.appendChild(document.createTextNode(p.id));
      b.addEventListener("click", function () {
        s.problem = p.id;
        state.pickGrave = null;
        touchGraves();
        render();
      });
      chips.appendChild(b);
    });
    box.appendChild(chips);
    return box;
  }

  /* Надбавка — тот же счётчик, что был у дополнительных баллов: поля для ввода
     числа здесь нет, на телефоне оно неудобно. */
  function bonusStepper(s) {
    var v = solutionBonus(s);
    var step = el("div", "stepper");

    var minus = button("−", "step-btn", function () {
      s.bonus = Math.max(0, v - 1);
      touchGraves();
      render();
    });
    minus.disabled = v <= 0;
    minus.setAttribute("aria-label", "убрать балл надбавки");
    step.appendChild(minus);

    step.appendChild(el("span", "step-val" + (v ? " on" : ""), v));

    var plus = button("+", "step-btn", function () {
      s.bonus = Math.min(BONUS_MAX, v + 1);
      touchGraves();
      render();
    });
    plus.disabled = v >= BONUS_MAX;
    plus.setAttribute("aria-label", "добавить балл надбавки");
    step.appendChild(plus);

    return step;
  }

  /* Цена решения = цена гроба плюс надбавка. Слагаемые показываем: без них
     разные суммы за один и тот же гроб выглядели бы ошибкой счёта. */
  function priceBox(s) {
    var box = el("div", "solution-price");
    if (!s.problem) {
      box.appendChild(el("span", "muted", "гроб не выбран"));
      return box;
    }
    var price = gravePrice(s.problem);
    var extra = solutionBonus(s);
    box.appendChild(el("span", "price-label", "цена"));
    var val = el("span", "price-val");
    if (extra) {
      val.appendChild(el("i", "price-sum", price + " + " + extra + " = "));
      val.appendChild(document.createTextNode(String(price + extra)));
    } else {
      val.appendChild(document.createTextNode(String(price)));
    }
    box.appendChild(val);
    return box;
  }

  function graveRow(p) {
    var asking = state.confirmGrave === p.id;
    var wrap = el("div", "prow-wrap");
    var row = el("div", "prow grave" + (asking ? " asking" : ""));

    /* Правится только число: буква Г стоит рядом как подпись, чтобы не искать
       кириллицу на телефонной клавиатуре. Буква пункта — тоже подпись, справа:
       перенумеровать Г3а в Г5а можно, а превратить пункт в целый гроб — нет,
       на его месте осталась бы дыра в семье. */
    var suffix = graveSuffix(p.id);
    // колонку номера расширяем только там, где есть буква: у остальных она
    // отняла бы место у названия темы, а на телефоне его и так в обрез
    if (suffix) row.className += " part";
    var idBox = el("div", "grave-id");
    idBox.appendChild(el("span", "grave-pre", "Г"));

    var numIn = el("input");
    numIn.className = "input tiny";
    numIn.type = "number";
    numIn.inputMode = "numeric";
    numIn.min = "1";
    numIn.value = graveNum(p.id);
    numIn.addEventListener("change", function () {
      var v = parseInt(numIn.value, 10);
      var id = "Г" + v + suffix;
      var taken = ensureGraves().problems.some(function (x) {
        return x !== p && x.id === id;
      });
      if (!v || v < 1 || taken) { numIn.value = graveNum(p.id); return; }
      renameGrave(p.id, id);
      sortGraves();
      touchGraves();
      render();
    });
    idBox.appendChild(numIn);
    if (suffix) idBox.appendChild(el("span", "grave-post", suffix));
    row.appendChild(idBox);

    var t = typeById(p.type);
    var sub = subOf(t, p);
    var ok = typed(p);
    var open = state.pickTheme === p.id;

    var pick = el("button", "picker-btn" + (open ? " open" : ""));
    pick.type = "button";
    var label = el("span", "picker-label");
    label.appendChild(themeMark(p));
    label.appendChild(document.createTextNode(
      !t ? "тема?" : t.name + (sub ? " · " + sub.name : (ok ? "" : " · ?"))));
    pick.appendChild(label);
    pick.appendChild(el("span", "picker-caret", "▾"));
    pick.addEventListener("click", function () {
      state.pickTheme = open ? null : p.id;
      state.pickWeight = null;
      render();
    });
    row.appendChild(pick);

    var solvers = graveSolvers(p.id);
    row.appendChild(weightChip(p, solvers, gravesBase()));

    row.appendChild(deleteCell(asking, function () {
      state.confirmGrave = p.id;
      state.pickTheme = null;
      state.pickWeight = null;
      render();
    }, function () {
      removeGrave(p.id);
      state.confirmGrave = null;
      render();
    }));

    wrap.appendChild(row);
    if (open) wrap.appendChild(themeChooser(p, touchGraves));
    else if (state.pickWeight === p.id) {
      wrap.appendChild(weightChooser(p, solvers, gravesBase(), touchGraves));
    }
    return wrap;
  }

  // ── темы ────────────────────────────────────────────────

  function types() { return state.typesEdit || (DATA ? DATA.types : []); }

  function typeById(id) {
    return types().filter(function (t) { return t.id === id; })[0] || null;
  }

  function editTypes() {
    if (!state.typesEdit) state.typesEdit = JSON.parse(JSON.stringify(DATA.types));
    return state.typesEdit;
  }

  function typesDirty() {
    if (!state.typesEdit) return false;
    return JSON.stringify(state.typesEdit) !==
      (SAVED.types || JSON.stringify(DATA.types));
  }

  /* Тема задачи задана правильно, если её подраздел есть в списке тем. После
     удаления подраздела задача остаётся без темы: в кондуите её видно серой,
     в рейтинг она не идёт. */
  function subOf(t, p) {
    return t && (t.subs || []).filter(function (s) { return s.id === p.sub; })[0];
  }

  function typed(p) {
    var t = typeById(p.type);
    if (!t) return false;
    return (t.subs || []).length ? !!subOf(t, p) : !p.sub;
  }

  function putTypesFile() {
    var payload = state.typesEdit;
    return getFile("data/types.json").then(function (cur) {
      return putFile("data/types.json", JSON.stringify(payload, null, 2) + "\n",
        "Темы обновлены", cur && cur.sha);
    }).then(function () { SAVED.types = JSON.stringify(payload); });
  }

  function translit(name) {
    var table = {
      "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
      "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
      "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
      "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
      "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya", " ": "-", "-": "-"
    };
    var out = "";
    String(name).toLowerCase().split("").forEach(function (ch) {
      out += table[ch] !== undefined ? table[ch] : (/[a-z0-9]/.test(ch) ? ch : "");
    });
    return out.replace(/-+/g, "-").replace(/^-|-$/g, "") || "tema";
  }

  function uniqueId(base, taken) {
    var id = base, i = 2;
    while (taken.indexOf(id) !== -1) { id = base + "-" + i; i += 1; }
    return id;
  }

  // ── детали интерфейса ───────────────────────────────────

  /* Кружок остался только там, где он и есть кружок, а не знак темы: выбор
     цвета раздела. Только чистый цвет, без градиента. */
  function dot(slot) {
    var d = el("span", "dot");
    d.style.background = "var(--s" + slot + ")";
    return d;
  }

  /* Знак темы. Рисунок лежит в спрайте (assets/icons.js), сюда приходит только
     ключ; цвет раздела значок получает через color, потому что нарисован
     currentColor. Без цвета — серый: так же, как раньше выглядел кружок у
     задачи без темы. */
  function mark(icon, slot, title) {
    var g = Icons.make(icon, title);
    g.style.color = slot ? "var(--s" + slot + ")" : "var(--axis)";
    return g;
  }

  /* Значок темы задачи или гроба. Тема бывает выбрана наполовину — раздел есть,
     подраздел нет, — и это не тема: в рейтинг такая задача не идёт, поэтому и
     знак у неё пустой. */
  function themeMark(p) {
    var t = typeById(p.type);
    if (!t || !typed(p)) return mark("none", 0);
    var sub = subOf(t, p);
    return mark((sub && sub.icon) || t.icon, t.slot);
  }

  /* Стрелка «назад» рисуется в svg. Ни шрифтовой символ, ни фигура из рамок
     на телефоне не показывались: у первого не оказалось глифа, вторая терялась
     на дробной толщине. У svg нет ни той, ни другой зависимости. */
  function backArrow() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    svg.setAttribute("aria-hidden", "true");

    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M9.5 3.5 5 8l4.5 4.5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");

    svg.appendChild(path);
    return svg;
  }

  function backButton(fn) {
    var b = el("button", "icon-btn back");
    b.type = "button";
    b.appendChild(backArrow());
    b.addEventListener("click", fn);
    return b;
  }

  /* Что-то из данных не прочиталось. Правку в этом месте не показываем вовсе:
     пустой экран, уехавший в репозиторий, стёр бы настоящие данные. */
  function brokenCard(what) {
    var card = el("div", "card warn");
    card.appendChild(el("div", "warn-title", "Не прочитался " + what));
    card.appendChild(el("div", "warn-line",
      "Обнови страницу. Пока не прочитается — не правим, чтобы не записать пустое."));
    return card;
  }

  function button(text, cls, fn) {
    var b = el("button", cls || "ghost-btn", text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function field(label, node, cls) {
    var f = el("div", "field" + (cls ? " " + cls : ""));
    f.appendChild(el("span", "field-label", label));
    f.appendChild(node);
    return f;
  }

  /* Свой выбор даты вместо системного: у мобильных браузеров он выглядит
     по-разному и всегда чужеродно. Дат у серии две — выдачи и занятия; какую
     правим, говорит ключ, он же служит признаком открытого календаря. */
  function dateField(key, plain) {
    var open = state.pickDate === key;
    var box = el("div", "datefield");

    var btn = el("button", "picker-btn" + (open ? " open" : ""));
    btn.type = "button";
    /* Подпись — той же обёрткой, что и в прочих выпадающих полях: она не даёт
       длинной дате разъехаться на две строки, а обрезает её. На узкой кнопке
       день недели не пишем вовсе — он и не поместился бы. */
    btn.appendChild(el("span", "picker-label",
      plain ? dayMonth(state.series[key]) : longDate(state.series[key])));
    btn.appendChild(el("span", "picker-caret", "▾"));
    btn.addEventListener("click", function () {
      state.pickDate = open ? null : key;
      state.pickTheme = null;
      state.calMonth = null;
      render();
    });
    box.appendChild(btn);

    if (open) box.appendChild(calendar(key));
    return box;
  }

  function calendar(key) {
    var cur = parseISO(state.series[key]);
    var shown = state.calMonth ? parseISO(state.calMonth + "-01")
      : new Date(cur.getFullYear(), cur.getMonth(), 1);

    var wrap = el("div", "calendar");

    var head = el("div", "cal-head");
    head.appendChild(button("‹", "cal-nav", function () {
      var m = new Date(shown.getFullYear(), shown.getMonth() - 1, 1);
      state.calMonth = m.getFullYear() + "-" + pad2(m.getMonth() + 1);
      render();
    }));
    head.appendChild(el("span", "cal-title",
      MONTHS_NOM[shown.getMonth()] + " " + shown.getFullYear()));
    head.appendChild(button("›", "cal-nav", function () {
      var m = new Date(shown.getFullYear(), shown.getMonth() + 1, 1);
      state.calMonth = m.getFullYear() + "-" + pad2(m.getMonth() + 1);
      render();
    }));
    wrap.appendChild(head);

    var grid = el("div", "cal-grid");
    WEEKDAYS.forEach(function (w) { grid.appendChild(el("span", "cal-wd", w)); });

    var first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    var offset = (first.getDay() + 6) % 7;
    var days = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();
    var today = todayISO();

    for (var i = 0; i < offset; i++) grid.appendChild(el("span", "cal-empty"));
    for (var d = 1; d <= days; d++) {
      (function (day) {
        var iso = toISO(new Date(shown.getFullYear(), shown.getMonth(), day));
        var b = el("button", "cal-day" +
          (iso === state.series[key] ? " sel" : "") +
          (iso === today ? " today" : ""), day);
        b.type = "button";
        b.addEventListener("click", function () {
          state.series[key] = iso;
          state.pickDate = null;
          state.calMonth = null;
          touch();
          render();
        });
        grid.appendChild(b);
      })(d);
    }
    wrap.appendChild(grid);

    var foot = el("div", "cal-foot");
    foot.appendChild(button("сегодня", "mini-btn", function () {
      state.series[key] = todayISO();
      state.pickDate = null;
      state.calMonth = null;
      touch();
      render();
    }));
    foot.appendChild(button("закрыть", "mini-btn", function () {
      state.pickDate = null;
      render();
    }));
    wrap.appendChild(foot);

    return wrap;
  }

  // ── вид: серия ──────────────────────────────────────────

  var lastSeriesN = null;

  function viewSeries(host) {
    /* Список серий не прочитался — лента пуста не потому, что серий нет.
       Заводить серию в таком состоянии нельзя: она заняла бы чужое имя файла. */
    if (!DATA.daysOk) return host.appendChild(brokenCard("список серий"));

    var picker = el("div", "card");
    var chips = el("div", "chips");
    allDays().forEach(function (d) {
      if (d.removed) chips.appendChild(removedChip(d));
      else chips.appendChild(dayChip(d));
    });

    /* Серия заводится этой кнопкой и сразу встаёт в ленту — как подраздел в
       темах. В репозиторий она уедет позже, из вкладки «Сохранение». */
    var add = el("button", "chip day new");
    add.type = "button";
    add.setAttribute("aria-pressed", "false");
    add.appendChild(el("b", null, "+"));
    add.appendChild(el("small", null, "серия"));
    add.addEventListener("click", function () { openSeries(nextSlot()); });
    chips.appendChild(add);

    picker.appendChild(chips);
    host.appendChild(picker);

    if (!state.series) { lastSeriesN = null; return; }

    var body = el("div", "series-body");
    lastSeriesN = state.series.n;
    host.appendChild(body);
    host = body;

    // шапка серии
    var meta = el("div", "card");
    var mrow = el("div", "frow top");

    // Занятый номер не принимаем — иначе две серии носили бы один номер.
    var numInput = el("input");
    numInput.type = "number";
    numInput.inputMode = "numeric";
    numInput.min = "1";
    numInput.value = seriesNo(state.series);
    numInput.className = "input short";
    numInput.addEventListener("change", function () {
      var was = seriesNo(state.series);
      var v = parseInt(numInput.value, 10);
      if (!v || v < 1 || (v !== was && seriesNumbers(state.series.n)[v])) {
        numInput.value = was;
        return;
      }
      state.series.series = v;
      touch();
      render();
    });
    mrow.appendChild(field("Номер серии", numInput, "narrow"));
    mrow.appendChild(field("Выдана", dateField("given", true), "date"));
    meta.appendChild(mrow);

    var drow = el("div", "frow top");
    drow.appendChild(field("Занятие", dateField("date")));
    meta.appendChild(drow);
    meta.appendChild(heldToggle(state.series));
    host.appendChild(meta);

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Задачи"));
    host.appendChild(sh);

    var pcard = el("div", "card");
    state.series.problems.forEach(function (p) { pcard.appendChild(problemRow(p)); });

    var actions = el("div", "frow gap");
    actions.appendChild(button("задача", "ghost-btn add",
      function () { addProblem(); render(); }));
    var part = button("пункт", "ghost-btn add", function () { addPart(); render(); });
    // дошли до «е» — дальше пункт совпал бы с уже существующим
    part.disabled = state.series.problems.length > 0 && !canAddPart();
    actions.appendChild(part);
    pcard.appendChild(actions);
    host.appendChild(pcard);

    if (state.series.problems.length) {
      var sh2 = el("div", "section-head");
      sh2.appendChild(el("span", "section-title", "Кондуит"));
      host.appendChild(sh2);
      host.appendChild(conduitGrid(state.series));
    }

    var sh3 = el("div", "section-head");
    sh3.appendChild(el("span", "section-title", "Листок"));
    host.appendChild(sh3);
    host.appendChild(seriesPdfCard(state.series));

    /* Список серии стоит последним: правится он редко, а места занимает много.
       Всё, чем пользуются на каждом занятии, должно быть выше него. */
    var sh4 = el("div", "section-head");
    sh4.appendChild(el("span", "section-title", "Список серии"));
    host.appendChild(sh4);
    host.appendChild(rosterCard(state.series));

    host.appendChild(deleteBar());
  }

  /* Пока занятие не прошло, сайт показывает серию и её листок, но не кондуит:
     пустая сетка ничего не говорит, а листок уже нужен. */
  function heldToggle(d) {
    var on = isHeld(d);
    var row = el("div", "frow gap");
    var b = el("button", "chip pick",
      on ? "занятие прошло" : "занятие ещё не прошло");
    b.type = "button";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.addEventListener("click", function () {
      d.held = !on;
      touch();
      render();
    });
    row.appendChild(b);
    if (!on) row.appendChild(el("span", "savecard-note", "кондуит на сайте скрыт"));
    return row;
  }

  /* Список серии: кто по ней занимался. Заводится он с общего списка, а дальше
     живёт своей жизнью — убирать отсюда стоит тех, кого занятие не касалось:
     уехавших на сборы, финал, турнир. Пропуском это не считается, и цена задач
     считается без них. */
  function rosterCard(d) {
    var card = el("div", "card");
    var ids = editSeriesRoster(d);
    var all = roster();

    var head = el("div", "filter-head");
    head.appendChild(el("span", "filter-title",
      withNum(ids.length, "ученик", "ученика", "учеников")));
    head.appendChild(mini("весь список", function () {
      all.forEach(function (st) {
        if (ids.indexOf(st.id) === -1) toggleInSeries(d, st.id);
      });
      render();
    }));
    card.appendChild(head);

    /* Кроме общего списка показываем тех, кто в этой серии есть, а из группы уже
       выбыл: иначе их отсюда было бы не убрать. */
    var extra = ids.filter(function (id) {
      return !all.some(function (st) { return st.id === id; });
    }).map(function (id) { return { id: id, name: nameOf(id) }; });

    var chips = el("div", "chips");
    all.concat(extra).sort(function (a, b) {
      return a.name.localeCompare(b.name, "ru");
    }).forEach(function (st) {
      var b = el("button", "chip pick", st.name);
      b.type = "button";
      b.setAttribute("aria-pressed", ids.indexOf(st.id) !== -1 ? "true" : "false");
      b.addEventListener("click", function () {
        toggleInSeries(d, st.id);
        render();
      });
      chips.appendChild(b);
    });
    card.appendChild(chips);
    card.appendChild(el("div", "savecard-note",
      "цена задачи считается от этого списка: n = " + seriesBase(d)));
    return card;
  }

  var PDF_DIR = "data/pdf/";

  /* Листок серии. Имя файла — по слоту, а не по номеру серии: номер можно
     поменять, и тогда файл потерялся бы. Имя закреплено за записью, поэтому
     новый листок просто ложится поверх старого. */
  function seriesPdfCard(d) {
    return pdfCard(d.pdf, {
      dir: PDF_DIR,
      name: "seriya-" + pad2(d.n) + ".pdf",
      onPick: function (info) { d.pdf = info; touch(); },
      onDrop: function () { delete d.pdf; touch(); }
    });
  }

  function mini(text, fn) {
    var b = el("button", "mini-btn", text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // вычеркнутая серия возвращается повторным касанием — тупика быть не должно
  function removedChip(d) {
    var b = el("button", "chip day gone");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.appendChild(el("b", null, dayMark(d)));
    b.appendChild(el("small", null, "удалить"));
    b.addEventListener("click", function () {
      delete state.removed[d.n];
      render();
    });
    return b;
  }

  /* Кнопка серии: номер и дата под ним.

     Заперты две кнопки: только что сохранённая и только что удалённая. Обе
     ждут, пока сайт переразвернётся: правка по ним ушла бы мимо данных. */
  function dayChip(d) {
    var waiting = d.pending || d.gone;
    var b = el("button", "chip day" + (waiting ? " pending" : "") +
      (d.local ? " local" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed",
      state.series && state.series.n === d.n ? "true" : "false");
    b.appendChild(el("b", null, dayMark(d)));
    b.appendChild(el("small", null,
      d.gone ? "удалён" : (d.pending && !d.date ? "ждём" : shortDate(d.date))));
    b.addEventListener("click", function () {
      if (waiting) {
        state.note = d.gone ? "Серия удалена" : "Серия сохранена";
        state.noteKind = "good";
        return render();
      }
      openSeries(d.n);
    });
    return b;
  }

  /* Удаление серии меняет только экран редактора. Серия, которой на сайте ещё
     нет, просто выбрасывается из памяти; записанная — помечается к удалению и
     уедет с ближайшим сохранением. */
  function dropDay() {
    var n = state.series.n;
    if (dayBySlot(n)) state.removed[n] = dayLabel(state.series);
    delete state.days[n];
    delete SAVED.days[n];
    state.series = null;
    state.confirmDelete = false;
    lastSeriesN = null;
    render();
  }

  /* Кнопка стоит по центру: слева от неё ничего нет, и прижатая к правому краю
     она смотрелась брошенной. Второе нажатие и есть предупреждение — словами
     оно ничего не добавляет. */
  function deleteBar() {
    var card = el("div", "card savecard center");

    if (state.confirmDelete) {
      card.appendChild(button("Удалить", "primary-btn danger", dropDay));
      card.appendChild(backButton(function () {
        state.confirmDelete = false;
        render();
      }));
    } else {
      card.appendChild(button("Удалить серию", "primary-btn danger", function () {
        state.confirmDelete = true;
        render();
      }));
    }
    return card;
  }

  /* Крестик, который спрашивает второй раз: первое нажатие раздваивает его на
     «удалить» и «передумал». Один и тот же для задачи, гроба и подраздела —
     удаление везде необратимо и стоит одинаково дорого. */
  function deleteCell(asking, ask, drop) {
    if (!asking) return button("×", "icon-btn del", ask);
    var box = el("span", "confirm");
    box.appendChild(button("×", "icon-btn danger", drop));
    box.appendChild(backButton(function () {
      state.confirmProblem = null;
      state.confirmGrave = null;
      state.confirmSub = null;
      state.confirmType = null;
      state.confirmSolution = null;
      state.confirmStudent = null;
      state.confirmFile = null;
      render();
    }));
    return box;
  }

  function problemRow(p) {
    var asking = state.confirmProblem === p.id;
    var wrap = el("div", "prow-wrap");
    var row = el("div", "prow" + (asking ? " asking" : ""));

    var idIn = el("input");
    idIn.className = "input tiny";
    idIn.value = p.id;
    idIn.addEventListener("change", function () {
      var v = String(idIn.value).trim();
      if (!v) { idIn.value = p.id; return; }
      renameProblem(p.id, v);
      touch();
      render();
    });
    row.appendChild(idIn);

    var t = typeById(p.type);
    var sub = subOf(t, p);
    var ok = typed(p);
    var open = state.pickTheme === p.id;

    var pick = el("button", "picker-btn" + (open ? " open" : ""));
    pick.type = "button";
    var label = el("span", "picker-label");
    label.appendChild(themeMark(p));
    if (isExercise(p)) label.appendChild(el("span", "badge", "упр."));
    label.appendChild(document.createTextNode(
      !t ? "тема?" : t.name + (sub ? " · " + sub.name : (ok ? "" : " · ?"))));
    pick.appendChild(label);
    pick.appendChild(el("span", "picker-caret", "▾"));
    pick.addEventListener("click", function () {
      state.pickTheme = open ? null : p.id;
      state.pickWeight = null;
      state.pickDate = null;
      render();
    });
    row.appendChild(pick);

    var solvers = solversOf(p.id);
    row.appendChild(weightChip(p, solvers, seriesBase(state.series)));

    row.appendChild(deleteCell(asking, function () {
      state.confirmProblem = p.id;
      state.pickTheme = null;
      state.pickWeight = null;
      render();
    }, function () {
      removeProblem(p.id);
      state.confirmProblem = null;
      touch();
      render();
    }));

    wrap.appendChild(row);
    // панели раскрываются по одной: обе разом заняли бы пол-экрана
    if (open) wrap.appendChild(themeChooser(p, touch));
    else if (state.pickWeight === p.id) {
      wrap.appendChild(weightChooser(p, solvers, seriesBase(state.series), touch));
    }
    return wrap;
  }

  /* Цена задачи в строке: приглушённая, пока считается формулой, и плотная,
     когда задана вручную. Касание раскрывает панель под строкой — поля для
     ввода числа здесь, как и везде в редакторе, нет. */
  function weightChip(p, solvers, base) {
    var b = el("button",
      "wchip" + (customWeight(p) === null ? "" : " on"), priceOf(p, solvers, base));
    b.type = "button";
    b.setAttribute("data-pid", p.id);
    b.setAttribute("aria-label", "цена задачи " + p.id);
    b.addEventListener("click", function () {
      state.pickWeight = state.pickWeight === p.id ? null : p.id;
      state.pickTheme = null;
      state.pickDate = null;
      render();
    });
    return b;
  }

  /* По одному и по десять: от единицы до цены всей группы дотянуться хватает, а
     набирать число на телефоне неудобно. «По формуле» возвращает задачу к
     автоматической цене — иначе из ручной не было бы выхода. */
  function weightChooser(p, solvers, base, touch) {
    var box = el("div", "chooser");
    var now = priceOf(p, solvers, base);

    /* Ноль руками поставить можно, и это не то же самое, что «нет цены»:
       формула ниже единицы не опускается нарочно, а вручную задача обнуляется
       намеренно — когда её решили все или когда она не должна считаться. */
    function set(v) {
      p.weight = Math.max(0, Math.min(999, v));
      touch();
      render();
    }

    var row = el("div", "wrow");
    var less10 = button("−10", "step-btn wide", function () { set(now - 10); });
    var less = button("−", "step-btn", function () { set(now - 1); });
    less10.disabled = less.disabled = now <= 0;
    row.appendChild(less10);
    row.appendChild(less);
    row.appendChild(el("span", "step-val on", now));
    row.appendChild(button("+", "step-btn", function () { set(now + 1); }));
    row.appendChild(button("+10", "step-btn wide", function () { set(now + 10); }));
    box.appendChild(row);

    var foot = el("div", "wfoot");
    var own = customWeight(p) !== null;
    foot.appendChild(el("span", "wnote", own
      ? "по формуле было бы " + weightOf(solvers, base)
      : "считается по формуле"));
    var back = button("по формуле", "mini-btn", function () {
      delete p.weight;
      touch();
      render();
    });
    back.disabled = !own;
    foot.appendChild(back);
    box.appendChild(foot);

    return box;
  }

  /* Сколько человек взяло эту задачу в открытой серии — от этого зависит её
     цена. Считаем по списку серии: плюс того, кого в нём нет, остался от
     прежнего состава и цену сдвигать не должен. */
  function solversOf(pid) {
    var d = state.series;
    if (!d) return 0;
    var solved = d.solved || {};
    return rosterIds(d).filter(function (id) {
      var list = solved[id];
      return list && list.indexOf(pid) !== -1;
    }).length;
  }

  /* Один и тот же выбор темы для задачи серии и для гроба: правка помечает
     разные файлы, отсюда второй параметр. */
  function themeChooser(p, touch) {
    var box = el("div", "chooser");

    var cats = el("div", "chips");
    types().forEach(function (t) {
      var b = el("button", "chip pick cat");
      b.type = "button";
      b.setAttribute("aria-pressed", t.id === p.type ? "true" : "false");
      b.style.setProperty("--accent", "var(--s" + t.slot + ")");
      b.appendChild(mark(t.icon, t.slot));
      b.appendChild(document.createTextNode(t.name));
      b.addEventListener("click", function () {
        p.type = t.id;
        p.sub = t.subs && t.subs.length ? t.subs[0].id : null;
        touch();
        render();
      });
      cats.appendChild(b);
    });
    box.appendChild(cats);

    var t = typeById(p.type);
    if (t && (t.subs || []).length) {
      var subs = el("div", "chips subs-row");
      t.subs.forEach(function (s) {
        var b = el("button", "chip sub pick");
        b.type = "button";
        b.style.setProperty("--accent", "var(--s" + t.slot + ")");
        b.setAttribute("aria-pressed", s.id === p.sub ? "true" : "false");
        b.appendChild(mark(s.icon || t.icon, t.slot));
        b.appendChild(document.createTextNode(s.name));
        b.addEventListener("click", function () {
          p.sub = s.id;
          state.pickTheme = null;
          touch();
          render();
        });
        subs.appendChild(b);
      });
      box.appendChild(subs);
    }

    return box;
  }

  /* Как и на сайте: фамилии — отдельной таблицей слева, клетки прокручиваются
     справа. Залипающий столбец на телефоне налезал на имена.

     Строки — список этой серии, а не общий: кого в ней не было, того в кондуите
     и нет. Последний столбец — посещаемость: отмечать её удобнее там же, где
     ставятся плюсы, а не отдельным списком под таблицей.

     Подписи пересчитываются на месте, без перерисовки таблицы, — иначе на
     каждом плюсе сбивалась бы прокрутка. */
  function conduitGrid(d) {
    var problems = d.problems;
    var solved = d.solved;
    var rows = seriesRows(d);
    var base = seriesBase(d);
    var leader = leaderId();
    var split = el("div", "conduit-split");

    function marked(sid, pid) {
      var list = solved[sid];
      return !!list && list.indexOf(pid) !== -1;
    }

    function rowCount(sid) { return (solved[sid] || []).length; }

    function colCount(pid) {
      return rows.filter(function (st) { return marked(st.id, pid); }).length;
    }

    function allCount() {
      return rows.reduce(function (a, st) { return a + rowCount(st.id); }, 0);
    }

    function hereCount() {
      return rows.filter(function (st) { return wasThere(d, st.id); }).length;
    }

    var names = el("table", "conduit names");
    var nHead = el("thead");
    var nhr = el("tr");
    nhr.appendChild(el("th", "pname", "Ученик"));
    nHead.appendChild(nhr);
    names.appendChild(nHead);

    var nBody = el("tbody");
    rows.forEach(function (st) {
      var tr = el("tr", "crow");
      var cell = el("td", "pname");
      var box = el("span", "name-box");
      box.appendChild(el("span", "nm", st.name));
      if (DATA.config.admin === st.id) box.appendChild(el("i", "badge-admin", "◆"));
      if (leader === st.id) box.appendChild(el("i", "badge-leader"));
      cell.appendChild(box);
      tr.appendChild(cell);
      nBody.appendChild(tr);
    });
    names.appendChild(nBody);

    var nFoot = el("tfoot");
    var nf1 = el("tr");
    nf1.appendChild(el("td", "pname", "решили"));
    nFoot.appendChild(nf1);
    var nf2 = el("tr", "weights");
    nf2.appendChild(el("td", "pname", "вес"));
    nFoot.appendChild(nf2);
    names.appendChild(nFoot);
    split.appendChild(names);

    var scroll = el("div", "conduit-scroll");
    var table = el("table", "conduit cells edit");

    var thead = el("thead");
    var hr = el("tr");
    problems.forEach(function (p) {
      var ok = typed(p);
      var cell = el("th");
      var box = el("div", "phead");
      box.appendChild(el("div", "phead-id" + (ok ? "" : " untyped"), p.id));
      box.appendChild(themeMark(p));
      cell.appendChild(box);
      hr.appendChild(cell);
    });
    hr.appendChild(el("th", "pcount", "всего"));
    hr.appendChild(el("th", "pcount patt", "был"));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    rows.forEach(function (st) {
      var tr = el("tr", "crow");
      problems.forEach(function (p) {
        var td = el("td", "cell");
        var isOn = marked(st.id, p.id);
        var b = el("button", "mark" + (isOn ? " on" : ""), isOn ? "+" : "");
        b.type = "button";
        b.setAttribute("aria-label", st.name + ", " + p.id);
        b.addEventListener("click", function () {
          var list = solved[st.id] || (solved[st.id] = []);
          var i = list.indexOf(p.id);
          if (i === -1) list.push(p.id); else list.splice(i, 1);

          var on = i === -1;
          b.className = "mark" + (on ? " on pop" : " drop");
          b.textContent = on ? "+" : "";
          setTimeout(function () {
            b.classList.remove(on ? "pop" : "drop");
          }, 260);
          refresh();
        });
        td.appendChild(b);
        tr.appendChild(td);
      });
      tr.appendChild(el("td", "pcount rowcount", rowCount(st.id)));

      /* Клетка посещаемости — не плюс: она говорит «был», а не «сделал».
         Поэтому и выглядит иначе — кружком, а не квадратом со знаком. */
      var att = el("td", "cell patt");
      var ab = el("button", "mark att" + (wasThere(d, st.id) ? " on" : ""));
      ab.type = "button";
      ab.setAttribute("aria-label", st.name + " — был на занятии");
      ab.addEventListener("click", function () {
        togglePresent(d, st.id);
        var on = wasThere(d, st.id);
        ab.className = "mark att" + (on ? " on pop" : " drop");
        setTimeout(function () { ab.classList.remove(on ? "pop" : "drop"); }, 260);
        refresh();
      });
      att.appendChild(ab);
      tr.appendChild(att);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    var tfoot = el("tfoot");
    var f1 = el("tr");
    problems.forEach(function (p) { f1.appendChild(el("td", "colcount", colCount(p.id))); });
    f1.appendChild(el("td", "pcount total", allCount()));
    f1.appendChild(el("td", "pcount patt here", hereCount()));
    tfoot.appendChild(f1);
    var f2 = el("tr", "weights");
    problems.forEach(function (p) {
      f2.appendChild(el("td", "colweight", priceOf(p, colCount(p.id), base)));
    });
    f2.appendChild(el("td", "pcount"));
    f2.appendChild(el("td", "pcount patt"));
    tfoot.appendChild(f2);
    table.appendChild(tfoot);

    scroll.appendChild(table);
    split.appendChild(scroll);

    function refresh() {
      var trs = table.querySelectorAll("tbody tr");
      rows.forEach(function (st, i) {
        var c = trs[i] && trs[i].querySelector(".rowcount");
        if (c) c.textContent = rowCount(st.id);
      });

      var cols = table.querySelectorAll(".colcount");
      var ws = table.querySelectorAll(".colweight");
      problems.forEach(function (p, i) {
        var n = colCount(p.id);
        if (cols[i]) cols[i].textContent = n;
        if (ws[i]) ws[i].textContent = priceOf(p, n, base);
      });
      var total = table.querySelector(".total");
      if (total) total.textContent = allCount();
      var here = table.querySelector(".here");
      if (here) here.textContent = hereCount();

      /* Цена в строке задачи считается от числа решивших — значит, меняется от
         каждого касания клетки. Перерисовывать ради неё весь экран нельзя:
         сбилась бы прокрутка сетки, поэтому правим одни подписи. */
      Array.prototype.forEach.call(document.querySelectorAll(".wchip"),
        function (chip) {
          var pid = chip.getAttribute("data-pid");
          var found = problems.filter(function (x) {
            return String(x.id) === pid;
          })[0];
          if (found) chip.textContent = priceOf(found, colCount(found.id), base);
        });
      touch();
    }

    return split;
  }

  // строки кондуита: список этой серии по алфавиту
  function seriesRows(d) {
    return rosterIds(d).map(function (id) {
      return { id: id, name: nameOf(id) };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, "ru"); });
  }

  /* Первый в рейтинге — по всем сериям, которые уже на сайте, так же как на публичной
     странице. Открытая правка сюда не входит: иначе метка прыгала бы на каждый
     поставленный плюс. */
  function leaderId() {
    var score = {};
    roster().forEach(function (s) { score[s.id] = 0; });
    DATA.series.forEach(function (s) {
      if (!isHeld(s)) return;    // занятие ещё не прошло — считать нечего
      var ids = rosterIds(s);
      var base = baseOf(ids);
      (s.problems || []).forEach(function (p) {
        var solvers = ids.filter(function (id) {
          var list = s.solved[id];
          return list && list.indexOf(p.id) !== -1;
        });
        var weight = priceOf(p, solvers.length, base);
        solvers.forEach(function (id) {
          if (score[id] !== undefined) score[id] += weight;
        });
      });
    });

    // гробы с надбавками — тоже очки, и на сайте они считаются так же
    var taken = readSolutions(DATA.graves);
    ((DATA.graves && DATA.graves.problems) || []).forEach(function (p) {
      var mine = taken.filter(function (x) { return x.problem === p.id; });
      var weight = priceOf(p, mine.length, gravesBase());
      mine.forEach(function (x) {
        if (score[x.student] === undefined) return;
        score[x.student] += weight + solutionBonus(x);
      });
    });

    var best = null;
    Object.keys(score).forEach(function (id) {
      if (score[id] > 0 && (!best || score[id] > score[best])) best = id;
    });
    return best;
  }

  // ── вид: темы ───────────────────────────────────────────

  function viewThemes(host) {
    var card = el("div", "card");
    types().forEach(function (t) {
      var block = el("div", "tblock");

      var head = el("div", "tblock-head");
      var nameBox = el("span", "type-name");
      nameBox.appendChild(iconPick(t.id, t.icon, t.slot, function (key) {
        var cat = editTypes().filter(function (x) { return x.id === t.id; })[0];
        cat.icon = key;
      }));
      nameBox.appendChild(el("b", null, t.name));
      head.appendChild(nameBox);

      /* Раздел удаляется целиком, вместе с подразделами: задачи из него
         остаются без темы и в рейтинг не идут, пока им не выберут тему заново.
         Цвет при этом освобождается — им можно красить новый раздел.

         Последний раздел не убираем: задаче всегда нужна тема, а взять её было
         бы неоткуда. */
      if (types().length > 1) {
        head.appendChild(deleteCell(state.confirmType === t.id, function () {
          state.confirmType = t.id;
          render();
        }, function () {
          state.typesEdit = editTypes().filter(function (x) { return x.id !== t.id; });
          state.confirmType = null;
          render();
        }));
      }
      block.appendChild(head);

      if (state.pickIcon === t.id) block.appendChild(iconChooser(t.slot));

      (t.subs || []).forEach(function (s) {
        var key = t.id + "/" + s.id;
        var line = el("div", "subline");
        var subName = el("span", "subline-name");
        subName.appendChild(iconPick(key, s.icon || t.icon, t.slot, function (k) {
          var cat = editTypes().filter(function (x) { return x.id === t.id; })[0];
          cat.subs.filter(function (x) { return x.id === s.id; })[0].icon = k;
        }));
        subName.appendChild(el("span", "ell", s.name));
        line.appendChild(subName);

        /* Задачи удалённого подраздела остаются без темы и выпадают из
           рейтинга, пока им не выберут тему заново. */
        line.appendChild(deleteCell(state.confirmSub === key, function () {
          state.confirmSub = key;
          render();
        }, function () {
          var draft = editTypes();
          var cat = draft.filter(function (x) { return x.id === t.id; })[0];
          cat.subs = cat.subs.filter(function (x) { return x.id !== s.id; });
          state.confirmSub = null;
          render();
        }));
        block.appendChild(line);
        if (state.pickIcon === key) block.appendChild(iconChooser(t.slot));
      });

      var add = el("div", "frow gap");
      var input = el("input");
      input.className = "input";
      input.placeholder = "новый подраздел";
      add.appendChild(input);
      add.appendChild(button("+", "icon-btn add", function () {
        var name = String(input.value).trim();
        if (!name) return;
        var draft = editTypes();
        var taken = [];
        draft.forEach(function (x) {
          (x.subs || []).forEach(function (s) { taken.push(s.id); });
        });
        var cat = draft.filter(function (x) { return x.id === t.id; })[0];
        if (!cat.subs) cat.subs = [];
        cat.subs.push({
          id: uniqueId(translit(name), taken), name: name, icon: "none"
        });
        render();
      }));
      block.appendChild(add);

      card.appendChild(block);
    });
    host.appendChild(card);

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Новый раздел"));
    host.appendChild(sh);

    var card2 = el("div", "card");
    var row = el("div", "frow gap");
    var nameIn = el("input");
    nameIn.className = "input";
    nameIn.placeholder = "название раздела";
    row.appendChild(nameIn);

    var slotSel = el("div", "chips");
    var used = types().map(function (t) { return t.slot; });
    var chosen = { slot: 0, icon: "none" };
    for (var i = 1; i <= 8; i++) {
      if (used.indexOf(i) !== -1) continue;
      if (!chosen.slot) chosen.slot = i;
      (function (slot) {
        var b = el("button", "chip color-chip");
        b.type = "button";
        b.setAttribute("aria-pressed", chosen.slot === slot ? "true" : "false");
        b.appendChild(dot(slot));
        b.addEventListener("click", function () {
          chosen.slot = slot;
          Array.prototype.forEach.call(slotSel.children, function (c, idx) {
            c.setAttribute("aria-pressed", c === b ? "true" : "false");
          });
        });
        slotSel.appendChild(b);
      })(i);
    }
    /* Значок нового раздела выбирается прямо здесь, россыпью, а не всплывающим
       окном: он такая же его часть, как название и цвет, и забыть о нём не
       должно быть возможности. */
    var iconSel = el("div", "chips");
    Icons.keys().forEach(function (k) {
      var b = el("button", "chip pick icon-chip");
      b.type = "button";
      b.title = Icons.name(k);
      b.setAttribute("aria-label", Icons.name(k));
      b.setAttribute("aria-pressed", chosen.icon === k ? "true" : "false");
      b.appendChild(mark(k, 0));
      b.addEventListener("click", function () {
        chosen.icon = k;
        Array.prototype.forEach.call(iconSel.children, function (c) {
          c.setAttribute("aria-pressed", c === b ? "true" : "false");
        });
      });
      iconSel.appendChild(b);
    });

    row.appendChild(button("+", "icon-btn add", function () {
      var name = String(nameIn.value).trim();
      if (!name || !chosen.slot) return;
      var draft = editTypes();
      draft.push({
        id: uniqueId(translit(name), draft.map(function (t) { return t.id; })),
        name: name,
        slot: chosen.slot,
        icon: chosen.icon,
        subs: []
      });
      render();
    }));
    card2.appendChild(row);
    if (slotSel.children.length) {
      card2.appendChild(field("Цвет", slotSel));
    } else {
      card2.appendChild(el("div", "summary", "Все восемь цветов заняты."));
    }
    card2.appendChild(field("Значок", iconSel));
    host.appendChild(card2);
  }

  /* Кнопка со значком темы: нажатие раскрывает россыпь под строкой. Значок
     хранится в types.json рядом с названием, поэтому новая тема получает свой
     знак без правки кода — в этом весь смысл выбора здесь. */
  function iconPick(key, icon, slot, apply) {
    var open = state.pickIcon === key;
    var b = el("button", "icon-pick" + (open ? " open" : ""));
    b.type = "button";
    b.setAttribute("aria-label", "значок: " + Icons.name(icon));
    b.appendChild(mark(icon, slot));
    b.addEventListener("click", function () {
      state.pickIcon = open ? null : key;
      state.iconApply = apply;
      render();
    });
    return b;
  }

  function iconChooser(slot) {
    var box = el("div", "chooser");
    var chips = el("div", "chips");
    Icons.keys().forEach(function (k) {
      var b = el("button", "chip pick icon-chip");
      b.type = "button";
      b.title = Icons.name(k);
      b.setAttribute("aria-label", Icons.name(k));
      b.appendChild(mark(k, slot));
      b.addEventListener("click", function () {
        if (state.iconApply) state.iconApply(k);
        state.pickIcon = null;
        state.iconApply = null;
        render();
      });
      chips.appendChild(b);
    });
    box.appendChild(chips);
    return box;
  }

  // ── вид: ученики ────────────────────────────────────────

  /* Список группы. Правится здесь же, уезжает по общей кнопке сохранения.
     Порядок — по алфавиту: так его и читают, и так он стоит в кондуите. */
  function viewStudents(host) {
    var list = roster().slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "ru");
    });

    var card = el("div", "card");
    list.forEach(function (st) { card.appendChild(studentRow(st)); });
    if (!list.length) {
      card.appendChild(el("div", "block-none", "Пока никого."));
    }
    host.appendChild(card);

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Новый ученик"));
    host.appendChild(sh);

    var add = el("div", "card");
    var row = el("div", "frow gap");
    var input = el("input");
    input.className = "input";
    input.placeholder = "фамилия и имя";
    row.appendChild(input);
    row.appendChild(button("+", "icon-btn add", function () {
      var name = String(input.value).trim();
      if (!name) return;
      var draft = editRoster();
      var was = draft.filter(function (x) { return x.name === name; })[0];
      if (was && !was.out) {
        state.note = "Такой ученик уже есть";
        state.noteKind = "bad";
        return render();
      }
      /* Вернулся тот, кого убирали: снимаем пометку вместо новой строки — тогда
         к нему возвращаются и прежние плюсы, они всё это время лежали в файлах
         серий под тем же id. */
      if (was) delete was.out;
      else {
        draft.push({
          id: uniqueId(translit(name), draft.map(function (x) { return x.id; })),
          name: name
        });
      }
      input.value = "";
      state.note = "";
      state.noteKind = "";
      render();
    }));
    add.appendChild(row);
    host.appendChild(add);
  }

  /* Сколько плюсов у ученика — по данным сайта. Число нужно перед удалением:
     оно говорит, сколько работы перестанет считаться. */
  function studentPluses(id) {
    var n = 0;
    DATA.series.forEach(function (s) {
      n += ((s.solved || {})[id] || []).length;
    });
    readSolutions(DATA.graves).forEach(function (x) {
      if (x.student === id) n += 1;
    });
    return n;
  }

  function studentRow(st) {
    var asking = state.confirmStudent === st.id;
    var line = el("div", "subline wide");

    /* Имя правится на месте: id при этом не меняется, иначе все плюсы этого
       человека отвязались бы. Ошибку в фамилии так можно исправить, ничего не
       потеряв. */
    var name = el("input");
    name.className = "input flat";
    name.value = st.name;
    name.addEventListener("change", function () {
      var v = String(name.value).trim();
      var busy = editRoster().some(function (x) {
        return x.id !== st.id && x.name === v;
      });
      if (!v || busy) {
        name.value = st.name;
        if (busy) {
          state.note = "Такой ученик уже есть";
          state.noteKind = "bad";
          render();
        }
        return;
      }
      var mine = editRoster().filter(function (x) { return x.id === st.id; })[0];
      if (mine) mine.name = v;
      render();
    });
    var box = el("span", "name-edit");
    box.appendChild(name);
    if (DATA.config.admin === st.id) box.appendChild(el("i", "badge-admin", "◆"));
    line.appendChild(box);

    // у кого плюсов ещё нет — пустое место: прочерк тут ничего не добавляет
    var n = studentPluses(st.id);
    line.appendChild(el("span", "subline-val", n ? "+" + n : ""));

    /* Выбывший помечается, а не стирается. Его плюсы остаются в файлах серий, а
       имя — в кондуитах тех занятий, где он был: строка списка не должна уносить
       с собой чужую работу. В общем списке и в рейтинге его больше нет, а
       вернуть его можно, заведя с тем же именем. */
    line.appendChild(deleteCell(asking, function () {
      state.confirmStudent = st.id;
      render();
    }, function () {
      var mine = editRoster().filter(function (x) { return x.id === st.id; })[0];
      if (mine) mine.out = true;
      state.confirmStudent = null;
      render();
    }));
    return line;
  }

  // ── вид: зачёт ──────────────────────────────────────────

  /* Файлы к зачёту: pdf, которые надо раздать. Выбранный файл читается прямо
     здесь и лежит в памяти страницы, пока не нажато «Сохранить». */
  function viewZachet(host) {
    if (!DATA.zachetOk) return host.appendChild(brokenCard("список зачёта"));

    var list = zachetList();
    var card = el("div", "card");
    list.forEach(function (it) { card.appendChild(zachetRow(it)); });
    if (!list.length) card.appendChild(el("div", "block-none", "Пока пусто."));
    host.appendChild(card);

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Новый файл"));
    host.appendChild(sh);

    var add = el("div", "card");

    var titleIn = el("input");
    titleIn.className = "input";
    titleIn.placeholder = "название";
    titleIn.value = state.zachetTitle || "";
    titleIn.addEventListener("input", function () {
      state.zachetTitle = titleIn.value;
    });
    add.appendChild(field("Название", titleIn));

    /* Своя кнопка вместо системного поля: у того подпись «файл не выбран» на
       чужом языке и вид, который не подчинить. Настоящее поле спрятано. */
    var file = el("input");
    file.type = "file";
    file.accept = "application/pdf,.pdf";
    file.className = "hidden-file";
    file.addEventListener("change", function () {
      readPdf(file.files && file.files[0], function (data, f) {
        addZachet(String(state.zachetTitle || "").trim() ||
          f.name.replace(/\.pdf$/i, ""), f, data);
        state.zachetTitle = "";
        render();
      });
    });

    var row = el("div", "frow gap");
    row.appendChild(button("Выбрать pdf", "ghost-btn", function () { file.click(); }));
    row.appendChild(file);
    add.appendChild(row);
    add.appendChild(el("div", "savecard-note",
      "pdf до " + fileSize(PDF_MAX) + "; уедет по кнопке сохранения"));
    host.appendChild(add);
  }

  function zachetRow(it) {
    var path = ZACHET_DIR + it.file;
    var line = el("div", "subline wide");

    var main = el("span", "subline-name");
    main.appendChild(document.createTextNode(it.title));
    if (stagedBlob(path)) main.appendChild(el("i", "badge", "новый"));
    line.appendChild(main);

    line.appendChild(el("span", "subline-val muted", fileSize(it.size)));

    line.appendChild(deleteCell(state.confirmFile === path, function () {
      state.confirmFile = path;
      render();
    }, function () {
      removeZachet(it.file);
      render();
    }));
    return line;
  }

  // ── вид: сохранение ─────────────────────────────────────

  /* Единственное место, откуда что-либо уезжает в репозиторий. Правки во всех
     вкладках живут в памяти страницы, здесь видно, что накопилось, и одна
     кнопка отправляет всё разом. */
  /* Задачи, у которых подраздела больше нет в списке тем. Они не считаются в
     рейтинге, и молча это заметить нельзя — поэтому список висит здесь, пока
     их не переразметят. Смотрим и записанное на сайте, и открытую правку. */
  function untypedTasks() {
    var found = [];

    // у серии с рабочей копией смотрим копию, у остального — то, что на сайте
    var days = {};
    DATA.series.forEach(function (s) { days[s.n] = s; });
    Object.keys(state.days).forEach(function (k) { days[k] = state.days[k]; });

    Object.keys(days).map(Number).sort(function (a, b) { return a - b; })
      .forEach(function (n) {
        var d = days[n];
        var bad = (d.problems || []).filter(function (p) { return !typed(p); });
        if (bad.length) found.push([dayLabel(d), bad]);
      });

    var gr = (state.graves || DATA.graves).problems || [];
    var badGraves = gr.filter(function (p) { return !typed(p); });
    if (badGraves.length) found.push(["Гробарий", badGraves]);

    return found;
  }

  /* Возврат к тому, что на сайте: рабочие копии серий, правка тем и гробария
     просто выбрасываются. Открытая серия переоткрывается заново, если она на
     сайте есть, иначе экран остаётся без открытой. */
  /* Обратный счёт правит только надпись на кнопке. Перерисовывать весь экран
     раз в секунду нельзя: под кнопкой поле токена, оно теряло бы ввод. */
  var cdTimer = null;

  function countdown(btn, active) {
    clearInterval(cdTimer);
    cdTimer = setInterval(function () {
      var left = cooldownLeft();
      if (left <= 0) {
        clearInterval(cdTimer);
        cdTimer = null;
        btn.textContent = "Сохранить";
        btn.disabled = !active;
        return;
      }
      btn.textContent = mmss(left);
    }, 1000);
  }

  function revertAll() {
    var n = state.series ? state.series.n : null;
    state.days = {};
    state.removed = {};
    SAVED.days = {};
    state.typesEdit = null;
    SAVED.types = null;
    state.graves = null;
    SAVED.graves = null;
    state.series = null;
    state.confirmRevert = false;
    state.confirmSub = null;
    state.confirmProblem = null;
    state.confirmGrave = null;
    state.confirmType = null;
    state.confirmSolution = null;
    state.confirmStudent = null;
    state.confirmFile = null;
    state.pickSolver = null;
    state.pickGrave = null;
    state.pickWeight = null;
    state.roster = null;
    SAVED.roster = null;
    state.zachet = null;
    SAVED.zachet = null;
    state.blobs = [];
    state.blobsGone = [];
    state.zachetTitle = "";
    state.sig = null;
    SAVED.sig = null;
    lastSeriesN = null;
    if (n !== null && dayBySlot(n)) openSeries(n);
    else render();
  }

  /* Серия помечена как не прошедшая, но плюсы в ней уже стоят: скорее всего
     занятие было, а переключатель остался. На сайте такой кондуит не виден, и
     заметить это самому неоткуда — поэтому говорим здесь. */
  function heldMissed() {
    return Object.keys(state.days).map(function (k) { return state.days[k]; })
      .filter(function (d) {
        if (isHeld(d)) return false;
        return Object.keys(d.solved || {}).some(function (id) {
          return (d.solved[id] || []).length > 0;
        });
      });
  }

  function viewSave(host) {
    var missed = heldMissed();
    if (missed.length) {
      var hw = el("div", "card warn");
      hw.appendChild(el("div", "warn-title", "Занятие помечено как не прошедшее"));
      missed.forEach(function (d) {
        var line = el("div", "warn-line");
        line.appendChild(el("span", "warn-where", dayLabel(d)));
        line.appendChild(el("span", "warn-ids", "кондуит на сайте не виден"));
        hw.appendChild(line);
      });
      host.appendChild(hw);
    }

    var untyped = untypedTasks();
    if (untyped.length) {
      var warn = el("div", "card warn");
      warn.appendChild(el("div", "warn-title", "Задачи без темы — не считаются"));
      untyped.forEach(function (pair) {
        var line = el("div", "warn-line");
        line.appendChild(el("span", "warn-where", pair[0]));
        line.appendChild(el("span", "warn-ids", pair[1].map(function (p) {
          return p.id;
        }).join(", ")));
        warn.appendChild(line);
      });
      host.appendChild(warn);
    }

    var days = dirtyDays();
    var gone = removedNumbers();
    var items = [];
    if (rosterDirty()) items.push("Ученики");
    if (typesDirty()) items.push("Темы");
    days.forEach(function (d) { items.push(dayLabel(d)); });
    gone.forEach(function (n) {
      items.push((state.removed[n] || "Серия") + " · удалить");
    });
    if (gravesDirty()) items.push("Гробарий");
    if (zachetDirty()) items.push("Зачёт");
    if (configDirty()) items.push("Настройки");

    var problem = null;
    for (var i = 0; i < days.length && !problem; i++) {
      var bad = validate(days[i]);
      if (bad) problem = dayLabel(days[i]) + ": " + bad;
    }

    /* Незаполненное гроборешение наружу не выпускаем: запись без ученика или
       без гроба ничего не значит, а молча выбросить её при сохранении — значит
       потерять начатое, ничего не сказав. */
    if (!problem && state.graves) {
      var half = unfilledSolutions();
      if (half) {
        problem = "Гробарий: " +
          withNum(half, "гроборешение не заполнено", "гроборешения не заполнены",
            "гроборешений не заполнено");
      }
    }

    var left = cooldownLeft();
    var card = el("div", "card savecard");
    var main = el("div", "savecard-main");
    main.appendChild(el("div", "savecard-title",
      items.length ? items.join(" · ") : "Изменений нет"));
    if (problem) main.appendChild(el("div", "savecard-note", problem));
    else if (left && items.length) {
      main.appendChild(el("div", "savecard-note", "перерыв между сохранениями"));
    }
    card.appendChild(main);

    var save = button(state.busy ? "…" : (left ? mmss(left) : "Сохранить"),
      "primary-btn", saveAll);
    save.disabled = state.busy || !items.length || !!problem || !!left;
    card.appendChild(save);
    host.appendChild(card);

    if (left) countdown(save, items.length && !problem);

    /* Откат всего несохранённого. Спрашиваем вторым нажатием: правки живут
       только в памяти страницы, вернуть их после отката неоткуда. */
    if (items.length) {
      var rev = el("div", "card savecard center");
      if (state.confirmRevert) {
        rev.appendChild(button("Отменить всё", "primary-btn danger", revertAll));
        rev.appendChild(backButton(function () {
          state.confirmRevert = false;
          render();
        }));
      } else {
        rev.appendChild(button("Отменить изменения", "primary-btn danger", function () {
          state.confirmRevert = true;
          render();
        }));
      }
      host.appendChild(rev);
    }

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Доступ"));
    host.appendChild(sh);

    var token = el("div", "card");
    var input = el("input");
    input.className = "input";
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = TOKEN ? "••••••••  (введите, чтобы заменить)" : "github_pat_…";
    /* Набранное держим в памяти: экран перерисовывается от любой кнопки рядом,
       а вставлять длинный токен второй раз — мучение. */
    input.value = tokenDraft;
    input.addEventListener("input", function () { tokenDraft = input.value; });
    token.appendChild(field("Токен", input));

    var row = el("div", "frow gap");
    // не «Сохранить»: эта кнопка ничего не отправляет, а запоминает токен здесь
    row.appendChild(button("Запомнить", "ghost-btn", function () {
      var v = String(input.value).trim();
      if (!v) return;
      TOKEN = v;
      lsSet(LS_TOKEN, v);
      tokenDraft = "";
      input.value = "";
      check();
    }));
    row.appendChild(button("Проверить доступ", "ghost-btn", check));
    row.appendChild(button("Удалить", "ghost-btn", function () {
      TOKEN = null;
      lsDel(LS_TOKEN);
      tokenDraft = "";
      state.note = "Токен удалён";
      state.noteKind = "";
      render();
    }));
    token.appendChild(row);
    host.appendChild(token);

    host.appendChild(eggToggle());
  }

  /* Стоит особняком в самом низу и ничего не подписывает: включённое видно по
     цвету. Как и всё прочее, уезжает только по кнопке сохранения. */
  function eggToggle() {
    var foot = el("div", "footrow");
    var b = el("button", "egg-btn");
    b.type = "button";
    b.setAttribute("aria-pressed", sigOn() ? "true" : "false");
    b.setAttribute("aria-label", "Подпись");

    var NS = "http://www.w3.org/2000/svg";
    /* Значок нарочно ничего не означает: пустой кружок против залитого. */
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    var circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", "8");
    circle.setAttribute("cy", "8");
    circle.setAttribute("r", "4.6");
    circle.setAttribute("fill", sigOn() ? "currentColor" : "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "1.6");
    svg.appendChild(circle);
    b.appendChild(svg);

    b.addEventListener("click", function () {
      state.sig = !sigOn();
      state.note = "";
      state.noteKind = "";
      render();
    });
    foot.appendChild(b);
    return foot;
  }

  function check() {
    if (!TOKEN) {
      state.note = "Токен не задан";
      state.noteKind = "bad";
      return render();
    }
    state.note = "";
    state.noteKind = "";
    render();
    api("").then(function (j) {
      var can = j.permissions && j.permissions.push;
      state.note = can ? "Доступ есть" : "Запись не разрешена";
      state.noteKind = can ? "good" : "bad";
      render();
    }).catch(function (e) {
      state.note = "Не вышло: " + e.message;
      state.noteKind = "bad";
      render();
    });
  }

  // ── каркас ──────────────────────────────────────────────

  var lastScene = null;

  // всё движение выключается системной настройкой — она не про красоту
  function reduced() {
    return !!(window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* Переходом браузера анимируется только смена вкладки — тем же, что и на
     сайте. Всё прочее перерисовывается сразу: правка должна отзываться на
     касание мгновенно, а не через кадр перехода. */

  /* Указатель полосы вкладок. Он один и переезжает с вкладки на вкладку;
     положение считается по месту самой вкладки, поэтому остаётся верным при
     любой ширине экрана. Координата берётся в системе содержимого полосы, то
     есть вместе с её прокруткой, — тогда указатель едет с ней заодно. */
  var thumbReady = false;

  function moveThumb() {
    var tabs = document.querySelector(".tabs");
    if (!tabs) return;
    var active = tabs.querySelector('.tab[aria-selected="true"]');
    if (!active) return;

    var t = tabs.getBoundingClientRect();
    var a = active.getBoundingClientRect();
    var edge = parseFloat(getComputedStyle(tabs).borderLeftWidth) || 0;

    // первый раз ставим без переезда: указателю неоткуда ехать
    if (!thumbReady) tabs.classList.add("no-anim");
    tabs.style.setProperty("--thumb-x", (a.left - t.left - edge + tabs.scrollLeft) + "px");
    tabs.style.setProperty("--thumb-w", a.width + "px");
    if (!thumbReady) {
      void tabs.offsetWidth;
      tabs.classList.remove("no-anim");
      thumbReady = true;
    }

    /* Вкладок может быть больше, чем помещается: подвозим выбранную к краю,
       чтобы указатель не уезжал за пределы видимого. */
    var pad = 12;
    if (a.left < t.left + pad) {
      tabs.scrollBy({ left: a.left - t.left - pad - 8, behavior: "smooth" });
    } else if (a.right > t.right - pad) {
      tabs.scrollBy({ left: a.right - t.right + pad + 8, behavior: "smooth" });
    }
  }

  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.setAttribute("aria-selected", t.dataset.view === state.view ? "true" : "false");
    });
    moveThumb();
  }

  var swapToken = 0;

  function render() {
    var moved = state.view !== lastScene;
    lastScene = state.view;
    // указатель трогается сразу: полоса вкладок при смене не перерисовывается
    syncTabs();

    if (moved && !reduced()) return fadeSwap();
    if (moved) window.scrollTo(0, 0);

    /* Перерисовка на месте: правка на том же экране. Прокрутку держим, а с ней
       и высоту: опустевший на мгновение экран короче, и браузер успевал прижать
       прокрутку к началу сам. */
    var main = document.getElementById("main");
    var keep = window.scrollY;
    main.style.minHeight = main.offsetHeight + "px";
    paint();
    main.style.minHeight = "";
    if (window.scrollY !== keep) window.scrollTo(0, keep);
  }

  /* Быстрая, но плавная прокрутка наверх. Новый экран должен начинаться
     сначала, а прыжок туда читается как сбой. Своя, а не системная: у
     системной длительность не задаётся, и с длинного списка она тянется
     полсекунды и дольше. */
  function toTop(then) {
    var from = window.scrollY;
    if (reduced() || from < 2 || document.hidden) {
      window.scrollTo(0, 0);
      return then();
    }

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      window.scrollTo(0, 0);
      then();
    }

    var dur = Math.min(260, 120 + from * 0.16);
    var t0 = performance.now();
    requestAnimationFrame(function step(t) {
      if (done) return;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      window.scrollTo(0, Math.round(from * (1 - e)));
      if (k < 1) requestAnimationFrame(step);
      else finish();
    });

    /* Страховка. Кадры могут не приходить вовсе — окно свёрнуто, вкладка ушла в
       фон, — и тогда экран не сменился бы вообще. Отсчёт времени работает и
       там, где кадров нет. */
    setTimeout(finish, dur + 250);
  }


  /* Смена экрана: страница отматывается наверх на глазах, со старым
     содержимым, оно уходит — и только тогда приходит новое. Переход браузера
     здесь не годится: он подменяет всё окно снимками, и указатель замер бы
     вместо того, чтобы переехать. Метка — на случай двух быстрых нажатий. */
  function fadeSwap() {
    var main = document.getElementById("main");
    var mine = ++swapToken;
    /* Сначала отматываем наверх — на глазах, со старым содержимым, — и только
       потом меняем его. Наоборот было бы непонятно: листаешь пустоту. */
    toTop(function () {
      if (mine !== swapToken) return;
      main.style.setProperty("--out-dy", "-4px");
      main.classList.remove("entering");
      main.classList.add("leaving");
      setTimeout(function () {
        if (mine !== swapToken) return;
        main.classList.remove("leaving");
        paint();
        enter(main);
      }, 80);
    });
  }

  /* Класс держится только на время движения. Оставленный навсегда, он держал бы
     и отдельный слой отрисовки под весь экран — на телефоне это лишняя память
     ни за чем. Чужое движение всплывает сюда же изнутри, поэтому проверяем, что
     доиграло именно наше. */
  var enterBound = false;

  function bindEnter(main) {
    if (enterBound) return;
    enterBound = true;
    main.addEventListener("animationend", function (e) {
      if (e.target === main) main.classList.remove("entering");
    });
  }

  /* Запуск появления. Класс снимается и ставится заново в один заход: без
     этого повторная смена на тот же экран не переиграла бы анимацию. Кадр между
     снятием и постановкой не показывается — всё происходит до отрисовки, а
     обращение к offsetWidth нужно как раз затем, чтобы браузер успел заметить
     снятие и счесть постановку новой анимацией. */
  function enter(main) {
    bindEnter(main);
    main.classList.remove("entering");
    void main.offsetWidth;
    main.classList.add("entering");
  }

  /* Отрисовка экрана. Сама она мгновенная и собирает всё разом: появление
     навешивается снаружи, одним движением на весь #main. Поэлементного
     появления здесь нет нарочно — пока экран проявлялся по частям, было видно,
     как страница складывается. */
  function paint() {
    var main = document.getElementById("main");
    clear(main);
    clearInterval(cdTimer);
    cdTimer = null;
    syncTabs();

    if (state.note) {
      var banner = el("div", "banner " + (state.noteKind || ""));
      banner.appendChild(el("span", null, state.note));
      banner.appendChild(button("×", "banner-close", function () {
        state.note = "";
        state.noteKind = "";
        render();
      }));
      main.appendChild(banner);
    }

    if (state.view === "series") viewSeries(main);
    else if (state.view === "graves") viewGraves(main);
    else if (state.view === "zachet") viewZachet(main);
    else if (state.view === "themes") viewThemes(main);
    else if (state.view === "students") viewStudents(main);
    else if (state.view === "save") viewSave(main);
  }


  function setupChrome() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.addEventListener("click", function () {
        state.view = t.dataset.view;
        state.note = "";
        state.noteKind = "";
        state.confirmSub = null;
        state.confirmProblem = null;
        state.confirmGrave = null;
        state.confirmType = null;
        state.confirmSolution = null;
        state.confirmStudent = null;
        state.confirmFile = null;
        state.confirmDelete = false;
        state.confirmRevert = false;
        state.pickTheme = null;
        state.pickWeight = null;
        state.pickSolver = null;
        state.pickGrave = null;
        render();
      });
    });
  }

  // ── загрузка ────────────────────────────────────────────

  function loadFromFiles() {
    function get(path) {
      return fetch("data/" + path + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) {
            // код нужен, чтобы отличить «файла нет» от «не прочиталось»
            var e = new Error(path + ": " + r.status);
            e.status = r.status;
            throw e;
          }
          return r.json();
        });
    }
    /* Гробарий и список серий читаем мягко: редактор должен открыться и тогда,
       когда что-то из этого пропало. Но прочиталось оно или нет — запоминаем:
       непрочитанное нельзя переписывать, иначе пустой экран уехал бы в
       репозиторий поверх настоящих данных. */
    var gravesOk = true;
    var soft = get("graves.json").catch(function () {
      gravesOk = false;
      return { problems: [], solved: {} };
    });
    var daysOk = true;
    var days = get("series/manifest.json").catch(function () {
      daysOk = false;
      return null;
    });
    var zachetOk = true;
    var zach = get("zachet.json").catch(function (e) {
      // файла может не быть вовсе — это не порча данных, а пустой список
      if (!e || e.status !== 404) zachetOk = false;
      return { items: [] };
    });

    return Promise.all([
      get("config.json"), get("types.json"), get("students.json"), days, soft, zach
    ]).then(function (res) {
      /* Ученики стоят по алфавиту: в кондуите ищут человека, а не место.
         Сравнивается полное имя, поэтому однофамильцы идут по именам. */
      res[2].sort(function (a, b) { return a.name.localeCompare(b.name, "ru"); });

      var files = res[3] && Array.isArray(res[3].series) ? res[3].series : [];
      if (res[3] && !Array.isArray(res[3].series)) daysOk = false;

      // пропавший файл серии не должен мешать открыть редактор
      return Promise.all(files.map(function (f) {
        return get("series/" + f).catch(function () { return null; });
      }))
        .then(function (all) {
          var series = all.filter(Boolean);
          // лента идёт по номерам серий
          series.sort(function (a, b) {
            return seriesNo(a) - seriesNo(b) ||
              String(a.date).localeCompare(String(b.date));
          });
          return {
            config: res[0], types: res[1], students: res[2],
            series: series, daysOk: daysOk, gravesOk: gravesOk,
            zachetOk: zachetOk,
            zachet: { items: (res[5] && res[5].items) || [] },
            graves: {
              pdf: res[4].pdf,
              problems: res[4].problems || [],
              solutions: res[4].solutions,
              solved: res[4].solved || {}
            }
          };
        });
    });
  }

  function reload() {
    return loadFromFiles().then(function (d) {
      DATA = d;
      pruneSent();
      // рабочую копию серии, догнавшую сайт, держать больше незачем
      Object.keys(state.days).forEach(function (k) {
        var day = state.days[k];
        if (day === state.series) return;
        var s = dayBySlot(day.n);
        if (s && JSON.stringify(dayPayload(day)) === JSON.stringify(dayPayload(s))) {
          delete state.days[k];
          delete SAVED.days[k];
        }
      });
      /* Правку держим в памяти, пока сайт не догонит: иначе сразу после
         сохранения экран показал бы старые данные, будто правка потерялась. */
      if (state.typesEdit &&
          JSON.stringify(state.typesEdit) === JSON.stringify(DATA.types)) {
        state.typesEdit = null;
        SAVED.types = null;
      }
      if (state.graves &&
          JSON.stringify(gravesPayload(state.graves)) ===
          JSON.stringify(gravesPayload(DATA.graves))) {
        state.graves = null;
        SAVED.graves = null;
      }
      if (state.roster &&
          JSON.stringify(rosterPayload(state.roster)) ===
          JSON.stringify(rosterPayload(DATA.students))) {
        state.roster = null;
        SAVED.roster = null;
      }
      if (state.zachet && !blobsDirty() &&
          JSON.stringify(zachetPayload(state.zachet)) ===
          JSON.stringify(zachetPayload(DATA.zachet.items))) {
        state.zachet = null;
        SAVED.zachet = null;
      }
      if (state.sig !== null && state.sig ===
          !!(DATA.config.signature && DATA.config.signature.on)) {
        state.sig = null;
        SAVED.sig = null;
      }
      render();
    }).catch(function () { render(); });
  }

  /* Как на сайте: отклик на касание — классом и анимацией, а не :active,
     который на телефоне для быстрого тапа не успевает примениться. Клетки
     кондуита исключены — у них своя анимация плюса. */
  var TAPPABLE = "button:not(.mark), .chip, a.ghost-btn";

  document.addEventListener("DOMContentLoaded", function () {
    document.title = "Статистика — редактор";
    document.addEventListener("pointerdown", function (e) {
      var node = e.target.closest && e.target.closest(TAPPABLE);
      if (!node || node.disabled) return;
      node.classList.remove("tap");
      void node.offsetWidth;
      node.classList.add("tap");
    }, { passive: true });

    TOKEN = lsGet(LS_TOKEN, null);
    // при повороте экрана вкладки меняют ширину, указатель должен успеть
    window.addEventListener("resize", moveThumb);
    loadSent();
    loadFromFiles().then(function (d) {
      // страница могла прийти из кэша Pages — тогда уходим на свежую
      var meta = document.querySelector('meta[name="build"]');
      var fresh = d.config.build;
      if (meta && fresh && meta.content !== fresh &&
          new URLSearchParams(location.search).get("b") !== fresh) {
        location.replace(location.pathname + "?b=" + fresh);
        return;
      }
      DATA = d;
      pruneSent();
      setupChrome();
      render();
    }).catch(function (err) {
      var main = document.getElementById("main");
      var box = el("div", "card");
      box.appendChild(el("div", "section-title", "Не удалось загрузить данные"));
      box.appendChild(el("div", "summary", String(err.message || err)));
      main.appendChild(box);
    });
  });
})();

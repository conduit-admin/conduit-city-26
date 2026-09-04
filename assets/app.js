/* Кондуит — весь подсчёт идёт в браузере читателя: страница читает файлы из
   data/ и считает рейтинг на месте. Сервера и базы данных нет.

   Темы двухуровневые: раздел (Алгебра, Геометрия, Комбинаторика, Теория чисел)
   и необязательный подраздел. Единица фильтрации — «лист»: раздел без
   подразбиения или пара раздел+подраздел. Задаче разбитого раздела подраздел
   ставят всегда; если он всё же пуст или незнаком, лист заводится по факту
   данных — иначе такая задача молча выпала бы из рейтинга. */

(function () {
  "use strict";

  var DATA = null;    // {config, types, students, series}
  var UNITS = [];     // плоский список единиц зачёта: решившие, вес, лист темы
  var CAT = {};       // id раздела -> раздел
  var LEAVES = [];    // [{key, catId, catName, subId, subName, slot, label}]
  var LEAF = {};      // key -> лист
  var NAME = {};      // id -> имя; в этой карте есть и выбывшие из списка
  var FULL = null;    // рейтинг по всему сразу — им определяется первый в нём

  var state = {
    view: "rating",
    leaves: new Set(),
    series: new Set(),
    kinds: new Set(["problem", "exercise", "grave"]),
    openSeries: 1,
    openStudent: null
  };

  var GRAVES = "graves";   // такая же «серия» в списке кондуитов, только без даты

  /* Упражнение — не тема, а вид задания: узнаётся по нулевому номеру (0, 0а).
     То же правило в редакторе — одно на оба места, иначе задача считалась бы
     упражнением на сайте и задачей в редакторе. */
  function numPrefix(id) {
    var m = String(id).match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  function isExercise(p) { return numPrefix(p.id) === 0; }

  /* Кому корона и подпись. Оба — про одного человека, и заданы они здесь, а не
     в настройках: настройка, у которой одно верное значение и то навсегда, —
     не настройка, а лишний рычаг, который однажды дёрнут по ошибке.

     Ключ — id ученика, а не имя: переименование в редакторе id не меняет,
     поэтому и корона с подписью его переживают. */
  var HONOURED = "aksenova-elizaveta";
  var HONOUR = "Totus tuus";

  function signature(id) {
    return id === HONOURED ? HONOUR : null;
  }

  /* Вес задачи = n − число решивших, где n — сколько человек занималось по этой
     серии. Список у каждой серии свой, поэтому и n у них разное: задача, которую
     давали десятерым, и задача на весь кружок стоят по-разному — и правильно.
     Гробы считаются от всего списка: они не привязаны к занятию. */
  function baseOf(list) { return Math.max((list || []).length, 1); }

  /* Ниже одного очка вес не опускается. Задача, которую взяли все, всё-таки
     была решена: обнулять её значило бы, что плюс за неё не стоит ничего — а он
     стоит, просто самую малость. Правило то же в редакторе. */
  function weightOf(solvers, base) { return Math.max(base - solvers, 1); }

  /* Цену задачи можно задать вручную — тогда формула к ней не применяется.
     Ставится она в редакторе: формула знает только число решивших, а задача
     бывает дорога и не поэтому. */
  function priceOf(p, solvers, base) {
    var w = p && p.weight;
    return typeof w === "number" && isFinite(w) && w >= 0
      ? Math.round(w) : weightOf(solvers, base);
  }

  /* Номер серии — то, что видно снаружи. В файле рядом лежит служебный слот n:
     он же имя файла и ключ внутри редактора, и меняться он не должен, чтобы
     перенумерованная серия не потеряла свой файл. */
  function seriesNo(s) {
    return s.series === undefined || s.series === null ? s.n : s.series;
  }

  // единицы зачёта помнят слот серии — наружу показывается её номер
  function seriesNoBySlot(sn) {
    var s = DATA.series.filter(function (x) { return x.n === sn; })[0];
    return s ? seriesNo(s) : sn;
  }

  /* Список серии — те, кто по ней занимался. Он задаётся, когда серию заводят, и
     за общим списком дальше не следует: уехавшие на турнир занятие не пропустили
     — его у них просто не было. Имена берутся из общего списка, в нём же
     остаются выбывшие, иначе старый кондуит потерял бы фамилии.

     У серии без своего списка он равен нынешнему общему — так читаются файлы,
     записанные до того, как списки появились. */
  function rosterOf(s) {
    if (Array.isArray(s.roster)) return s.roster;
    return DATA.students.map(function (x) { return x.id; });
  }

  function rosterRows(s) {
    return rosterOf(s).map(function (id) {
      return { id: id, name: NAME[id] || id };
    });
  }

  /* Серия, по которой занятие ещё не прошло: листок и темы у неё уже есть, а
     кондуит пуст и ничего не говорит. Такую серию не считаем нигде — иначе она
     отняла бы у всех проценты, ничего не дав взамен. */
  function held(s) { return s.held !== false; }

  // дата выдачи: у серий, заведённых до того, как дат стало две, её нет
  function givenDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s.given)) ? s.given : null;
  }

  /* Серия без пропусков — та, где был каждый из её списка. Список у серии свой,
     поэтому уехавшие на турнир её не портят: их в этом списке нет. */
  function noMisses(s) {
    if (!attended(s) || !held(s)) return false;
    return rosterOf(s).every(function (id) { return s.present.indexOf(id) !== -1; });
  }

  /* В кондуите ученики стоят по алфавиту, а не по результату серии: кондуит —
     ведомость, в ней ищут человека, а не место. Полное имя сравнивается
     целиком, поэтому однофамильцы идут по именам. */
  function byName(rows) {
    return rows.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "ru");
    });
  }

  function hasTasks(s) { return (s.problems || []).length > 0; }

  /* Посещаемость. Считаются только прошедшие занятия и только те, кто был в
     списке серии: занятие, которого у человека не было, он не пропускал. */
  function attended(s) { return Array.isArray(s.present); }

  function wasThere(s, id) {
    return attended(s) && s.present.indexOf(id) !== -1;
  }

  function attendance(id) {
    var was = 0, of = 0;
    DATA.series.forEach(function (s) {
      if (!attended(s) || !held(s)) return;
      if (rosterOf(s).indexOf(id) === -1) return;
      of += 1;
      if (wasThere(s, id)) was += 1;
    });
    return { was: was, of: of };
  }

  /* Строка «скачать pdf». Называется листок везде одинаково — «Листок»: чей он,
     видно по месту, где он лежит. А вот у скачанного файла имя должно говорить
     само за себя, поэтому оно приходит отдельно. */
  function pdfRow(file, download, size) {
    var row = el("a", "lik-row");
    row.href = "data/pdf/" + encodeURIComponent(file);
    row.setAttribute("download", download + ".pdf");
    var main = el("span", "lik-main");
    main.appendChild(el("span", "lik-title", "Листок"));
    main.appendChild(el("span", "lik-meta",
      "PDF" + (fileSize(size) ? " · " + fileSize(size) : "")));
    row.appendChild(main);
    row.appendChild(el("span", "lik-get", "↓"));
    return row;
  }

  // в рейтинге только прошедшие занятия: в остальных считать нечего
  function realSeries() {
    return DATA.series.filter(function (s) { return hasTasks(s) && held(s); });
  }

  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек"];

  // ── мелкие помощники ────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function num(n) { return Number(n).toLocaleString("ru-RU"); }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function prettyDate(iso, short) {
    var p = String(iso).split("-");
    if (p.length !== 3) return iso;
    var m = (short ? MONTHS_SHORT : MONTHS)[Number(p[1]) - 1];
    return Number(p[2]) + " " + m;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // с годом: имя скачанного файла живёт дольше учебного года
  function fullDate(iso) {
    var p = String(iso).split("-");
    return p.length === 3 ? prettyDate(iso) + " " + p[0] : String(iso);
  }

  function pct(x) { return Math.round(x * 100) + "%"; }

  /* Средний балл — сколько очков в среднем приносит один плюс: видно, берёт
     человек дорогие задачи или много дешёвых. */
  function avgScore(score, pluses) {
    return pluses ? (score / pluses).toFixed(3) : "—";
  }

  function isAdmin(id) { return DATA.config.admin && id === DATA.config.admin; }

  /* Имя со значками. Значки — настоящие элементы, а не псевдоэлемент: их может
     быть два сразу, у каждого свой цвет, и порядок важен — сначала редактор,
     потом корона. Имя обрезается, значки — никогда. */
  function nameCell(tag, cls, student) {
    var node = el(tag, cls);
    var box = el("span", "name-box");
    box.appendChild(el("span", "nm", student.name));
    if (isAdmin(student.id)) box.appendChild(el("i", "badge-admin", "◆"));
    if (isLeader(student.id)) box.appendChild(el("i", "badge-leader"));
    node.appendChild(box);
    return node;
  }

  // ── подготовка данных ───────────────────────────────────

  function leafKey(catId, subId) { return catId + "/" + (subId || ""); }

  /* Задача, чей подраздел удалили из списка тем, остаётся без темы: лист под
     неё не заводится, и в рейтинг она не идёт, пока ей не выберут тему заново.
     В кондуите она при этом видна — с серой полоской вместо цветной. */
  function unitLeaf(p) {
    var key = leafKey(p.type, p.sub);
    return LEAF[key] ? key : null;
  }

  /* Гробарий — задачи вне серий: они не привязаны ко дню и потому не попадают
     под отбор по сериям, зато включаются и выключаются отдельным признаком. */
  function graves() { return (DATA.graves && DATA.graves.problems) || []; }

  /* Гроборешение — отдельная запись «кто какой гроб взял». Гробы штучные, и
     сетка «ученики × гробы» под них не годится: она почти пуста, а надбавку за
     конкретное решение в клетке «+» показать нечем.

     У файлов, записанных до разделения, вместо списка решений лежит карта
     solved — читаем и её, иначе на старых данных гробарий оказался бы пуст. */
  function graveSolutions() {
    var g = DATA.graves || {};
    if (Array.isArray(g.solutions)) return g.solutions;
    var out = [];
    Object.keys(g.solved || {}).forEach(function (sid) {
      (g.solved[sid] || []).forEach(function (pid) {
        out.push({ student: sid, problem: pid, bonus: 0 });
      });
    });
    return out;
  }

  /* Надбавка ставится за само решение, а не человеку вообще: она прибавляется
     к цене гроба и вместе с ней достаётся тому, кто его взял. */
  function solutionBonus(s) {
    var v = s && s.bonus;
    return typeof v === "number" && isFinite(v) && v > 0 ? v : 0;
  }

  // сколько принёс этот плюс имеющему его ученику: цена задачи плюс надбавка
  function unitValue(u, id) {
    return u.weight + ((u.bonus && u.bonus[id]) || 0);
  }

  /* Зачёт — приложенные pdf. Со счётом они никак не связаны: это просто файлы,
     которые надо раздать. Список лежит в data/zachet.json, сами файлы — в
     data/zachet/. */
  function zachet() {
    var items = DATA.zachet && DATA.zachet.items;
    return Array.isArray(items) ? items : [];
  }

  /* Размер словами: килобайты до мегабайта, дальше мегабайты с десятой. Точный
     байт никому не нужен — важно понять, ждать ли загрузку с телефона. */
  function fileSize(n) {
    if (typeof n !== "number" || !isFinite(n) || n <= 0) return "";
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " КБ";
    return (n / 1024 / 1024).toFixed(1).replace(".", ",") + " МБ";
  }

  function buildIndex() {
    CAT = {};
    DATA.types.forEach(function (t) { CAT[t.id] = t; });

    LEAVES = [];
    LEAF = {};
    DATA.types.forEach(function (t) {
      var subs = t.subs || [];
      subs.forEach(function (sub) {
        add(t, sub.id, sub.name, t.name + " · " + sub.name, sub.icon);
      });
      /* Раздел без подразбиения — один лист на весь раздел, и значок у него
         тоже свой, разделa. */
      if (!subs.length) add(t, null, null, t.name, t.icon);
    });

    function add(t, subId, subName, label, icon) {
      var leaf = {
        key: leafKey(t.id, subId),
        catId: t.id,
        catName: t.name,
        subId: subId,
        subName: subName,
        slot: t.slot,
        icon: icon,
        label: label
      };
      LEAVES.push(leaf);
      LEAF[leaf.key] = leaf;
    }

    UNITS = [];
    DATA.series.forEach(function (s) {
      if (!held(s)) return;    // занятие ещё не прошло — считать нечего
      var ids = rosterOf(s);
      var base = baseOf(ids);
      s.problems.forEach(function (p) {
        /* Решившие — только из списка серии. Плюс человека, которого в этом
           списке нет, остался от прежнего состава: он лежит в файле, но в счёт
           не идёт, иначе сдвинул бы цену задачи. */
        var solvers = ids.filter(function (id) {
          var list = s.solved[id];
          return list && list.indexOf(p.id) !== -1;
        });
        UNITS.push({
          sn: s.n,
          id: p.id,
          leafKey: unitLeaf(p),
          catId: p.type,
          kind: isExercise(p) ? "exercise" : "problem",
          solvers: solvers,
          solverSet: new Set(solvers),
          roster: new Set(ids),
          weight: priceOf(p, solvers.length, base)
        });
      });
    });

    /* Гроб собирается из своих решений: чужой ученик в счёт не идёт, повтор —
       тоже. И то и другое сдвинуло бы число решивших, а значит и цену гроба. */
    var known = {};
    DATA.students.forEach(function (s) { known[s.id] = true; });
    var solutions = graveSolutions();

    graves().forEach(function (p) {
      var solvers = [];
      var bonus = {};
      solutions.forEach(function (s) {
        if (s.problem !== p.id || !known[s.student]) return;
        if (solvers.indexOf(s.student) !== -1) return;
        solvers.push(s.student);
        bonus[s.student] = solutionBonus(s);
      });
      UNITS.push({
        sn: null,
        id: p.id,
        leafKey: unitLeaf(p),
        catId: p.type,
        kind: "grave",
        solvers: solvers,
        solverSet: new Set(solvers),
        roster: null,          // гроб доступен всем: он не привязан к занятию
        bonus: bonus,
        weight: priceOf(p, solvers.length, baseOf(DATA.students))
      });
    });

    state.leaves = new Set(LEAVES.map(function (l) { return l.key; }));
    state.series = new Set(realSeries().map(function (s) { return s.n; }));
    /* Открыт по умолчанию последний кондуит, а не последняя серия: у серии, по
       которой занятия ещё не было, показывать нечего. */
    var live = realSeries();
    state.openSeries = live.length ? live[live.length - 1].n
      : (DATA.series.length ? DATA.series[DATA.series.length - 1].n : GRAVES);

    /* Первый считается по всему сразу и не зависит от фильтров: он помечен
       одинаково на любой вкладке и при любом отборе. */
    FULL = computeRating(state.series, state.leaves, ALL_KINDS);
  }

  /* Корона — у первого места и у неё, всегда. Если её обойдут, корон окажется
     две: одна за место, другая просто так, и это ровно то, что имелось в виду. */
  function isLeader(id) {
    if (id === HONOURED) return true;
    return !!FULL && FULL.rows.length > 0 &&
      FULL.place[id] === 1 && FULL.rows[0].score > 0;
  }

  var KINDS = [["problem", "Задачи"], ["exercise", "Упражнения"], ["grave", "Гробы"]];
  var ALL_KINDS = new Set(KINDS.map(function (p) { return p[0]; }));

  function catLeaves(catId) {
    return LEAVES.filter(function (l) { return l.catId === catId; });
  }

  function computeRating(seriesSet, leafSet, kindSet) {
    kindSet = kindSet || state.kinds;
    var rows = DATA.students.map(function (s) {
      return {
        id: s.id, name: s.name, score: 0, pluses: 0, bonus: 0,
        avail: 0, ceil: 0
      };
    });
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });

    var available = 0, ceiling = 0;
    UNITS.forEach(function (u) {
      if (u.sn !== null && !seriesSet.has(u.sn)) return;
      if (!leafSet.has(u.leafKey) || !kindSet.has(u.kind)) return;
      available += 1;
      ceiling += u.weight;
      /* Потолок у каждого свой: серия, в списке которой человека не было, ему не
         в укор — она не входит ни в его задачи, ни в его возможные очки. */
      rows.forEach(function (r) {
        if (u.roster && !u.roster.has(r.id)) return;
        r.avail += 1;
        r.ceil += u.weight;
      });
      u.solvers.forEach(function (id) {
        var r = byId[id];
        if (!r) return;
        // надбавка за решение достаётся только тому, кому её поставили
        var extra = (u.bonus && u.bonus[id]) || 0;
        r.score += u.weight + extra;
        r.pluses += 1;
        r.bonus += extra;
      });
    });

    /* Сначала очки, при равенстве — по алфавиту. Место у каждого своё: делить
       одно место на двоих в таблице из двух десятков человек неудобно. */
    rows.sort(function (a, b) {
      return b.score - a.score || a.name.localeCompare(b.name, "ru");
    });
    rows.forEach(function (r, i) { r.rank = i + 1; });

    var place = {};
    rows.forEach(function (r) { place[r.id] = r.rank; });

    return { rows: rows, available: available, ceiling: ceiling, place: place };
  }

  function filtered() { return computeRating(state.series, state.leaves, state.kinds); }

  // ── общие детали ────────────────────────────────────────

  /* Знак темы. Рисунок лежит в спрайте (assets/icons.js), сюда приходит только
     ключ; цвет раздела значок получает через color, потому что нарисован
     currentColor. Раньше на этом месте стоял просто цветной кружок: он говорил
     раздел, но молчал о подразделе. Значок говорит и то, и другое.

     Темы у задачи может не быть вовсе — тогда серый пустой квадрат: место
     занято, но ничего не сказано, и в рейтинг такая задача не идёт. */
  function mark(icon, slot, title) {
    var g = Icons.make(icon, title);
    g.style.color = slot ? "var(--s" + slot + ")" : "var(--axis)";
    return g;
  }

  function leafMark(leaf, title) {
    return leaf ? mark(leaf.icon, leaf.slot, title) : mark("none", 0, title);
  }

  function mini(text, fn) {
    var b = el("button", "mini-btn", text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // кнопка серии: номер и дата под ним
  function seriesChip(s, pressed, extraClass, onClick) {
    var b = el("button", "chip day" + (extraClass ? " " + extraClass : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.appendChild(el("b", null, seriesNo(s)));
    // у серии, по которой занятия ещё не было, дата — намерение, а не факт
    b.appendChild(el("small", null, held(s) ? prettyDate(s.date, true) : "скоро"));
    b.addEventListener("click", onClick);
    return b;
  }

  /* До первой серии считать нечего — показываем список учеников, чтобы страница
     не выглядела сломанной. Серия при этом может уже быть заведена, но пустой:
     говорить «серий нет» тогда неправда. */
  function viewEmpty(host) {
    var card = el("div", "card");
    card.appendChild(el("div", "section-title",
      DATA.series.length ? "Задач пока нет" : "Серий пока нет"));
    host.appendChild(card);

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Ученики"));
    host.appendChild(sh);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data");
    var tbody = el("tbody");
    DATA.students.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "ru");
    }).forEach(function (s, i) {
      var tr = el("tr");
      tr.appendChild(el("td", "rank", i + 1));
      tr.appendChild(nameCell("td", "left name", s));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* Плитки одинаковы все, кроме двух. Подкраска когда-то была у каждой своя —
     из-за неё страница и выглядела пёстрой рядом с редактором, где панель одна
     на всех; её убрали совсем. Цвет вернулся точечно: две плашки по краям ряда,
     и обе перечислены в README поимённо. */
  function tile(label, value, note, cls) {
    var t = el("div", "tile" + (cls ? " " + cls : ""));
    t.appendChild(el("div", "tile-label", label));
    t.appendChild(el("div", "tile-value", value));
    if (note) t.appendChild(el("div", "tile-note", note));
    return t;
  }

  function th(text, cls) { return el("th", cls, text); }

  /* Места без последней из выбранных серий — чтобы показать, кто на ней
     поднялся, а кто опустился. Считается по тому же отбору: «прошлое» здесь
     значит «то же самое, но без последнего занятия». Одна серия ни с чем не
     сравнивается, и стрелок тогда нет вовсе. */
  function prevPlaces() {
    var live = realSeries().filter(function (x) { return state.series.has(x.n); });
    if (live.length < 2) return null;
    var without = new Set();
    state.series.forEach(function (n) { without.add(n); });
    without.delete(live[live.length - 1].n);
    return computeRating(without, state.leaves, state.kinds).place;
  }

  // ── фильтры ─────────────────────────────────────────────

  function renderFilters(host) {
    var card = el("div", "card filters");

    // темы
    var r1 = el("div", "filter-row");
    var h1 = el("div", "filter-head");
    h1.appendChild(el("span", "filter-title", "Темы"));
    h1.appendChild(el("span", "filter-rule"));
    h1.appendChild(mini("все", function () {
      state.leaves = new Set(LEAVES.map(function (l) { return l.key; }));
      render();
    }));
    h1.appendChild(mini("ни одной", function () {
      state.leaves = new Set();
      render();
    }));
    r1.appendChild(h1);

    DATA.types.forEach(function (t) {
      var leaves = catLeaves(t.id);
      if (!leaves.length) return;
      var on = leaves.filter(function (l) { return state.leaves.has(l.key); }).length;

      var group = el("div", "tgroup");

      var cat = el("button", "chip cat" + (on && on < leaves.length ? " partial" : ""));
      cat.type = "button";
      cat.setAttribute("aria-pressed", on ? "true" : "false");
      /* Цвет раздела уходит переменной: из неё стили собирают и заливку
         плашки, и цвет значка — а на включённой плашке значок белеет. Красить
         его здесь нельзя, иначе он останется цветным на цветном. */
      cat.style.setProperty("--accent", "var(--s" + t.slot + ")");
      cat.appendChild(Icons.make(t.icon));
      cat.appendChild(document.createTextNode(t.name));
      cat.addEventListener("click", function () {
        var all = on === leaves.length;
        leaves.forEach(function (l) {
          if (all) state.leaves.delete(l.key); else state.leaves.add(l.key);
        });
        render();
      });
      group.appendChild(cat);

      if (leaves.length > 1 || leaves[0].subName) {
        var subs = el("div", "subs");
        leaves.forEach(function (l) {
          var b = el("button", "chip sub");
          b.type = "button";
          b.setAttribute("aria-pressed", state.leaves.has(l.key) ? "true" : "false");
          b.appendChild(leafMark(l));
          b.appendChild(document.createTextNode(l.subName || t.name));
          b.addEventListener("click", function () {
            if (state.leaves.has(l.key)) state.leaves.delete(l.key);
            else state.leaves.add(l.key);
            render();
          });
          subs.appendChild(b);
        });
        group.appendChild(subs);
      }

      r1.appendChild(group);
    });
    card.appendChild(r1);

    // вид задания — признак, с темой не связанный
    var r3 = el("div", "filter-row");
    var h3 = el("div", "filter-head");
    h3.appendChild(el("span", "filter-title", "Что считаем"));
    r3.appendChild(h3);

    /* Те же ярлыки, что и у тем: слитный переключатель здесь пробовали, но он
       был единственным предметом такого вида на всей странице — и разъезжался,
       когда включённая часть набирала вес шрифта и становилась шире. */
    var c3 = el("div", "chips");
    KINDS.forEach(function (pair) {
      var on = state.kinds.has(pair[0]);
      var b = el("button", "chip", pair[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () {
        if (on) state.kinds.delete(pair[0]); else state.kinds.add(pair[0]);
        render();
      });
      c3.appendChild(b);
    });
    r3.appendChild(c3);
    card.appendChild(r3);

    // пустые серии сюда не попадают — считать в них нечего
    var days = realSeries();
    if (!days.length) {   // отбирать нечего: до первой серии строка пуста
      host.appendChild(card);
      return filtered();
    }

    var r2 = el("div", "filter-row");
    var h2 = el("div", "filter-head");
    h2.appendChild(el("span", "filter-title", "Серии"));
    h2.appendChild(el("span", "filter-rule"));
    h2.appendChild(mini("все", function () {
      state.series = new Set(days.map(function (s) { return s.n; }));
      render();
    }));
    h2.appendChild(mini("последние 5", function () {
      state.series = new Set(days.slice(-5).map(function (s) { return s.n; }));
      render();
    }));
    /* Отбор по сериям, где был весь список серии. Показываем только когда он
       и правда что-то отсекает: иначе это была бы вторая кнопка «все». */
    var clean = days.filter(noMisses);
    if (clean.length && clean.length < days.length) {
      h2.appendChild(mini("где все были", function () {
        state.series = new Set(clean.map(function (s) { return s.n; }));
        render();
      }));
    }
    h2.appendChild(mini("ни одной", function () {
      state.series = new Set();
      render();
    }));
    r2.appendChild(h2);

    var c2 = el("div", "chips");
    days.forEach(function (s) {
      c2.appendChild(seriesChip(s, state.series.has(s.n), null, function () {
        if (state.series.has(s.n)) state.series.delete(s.n);
        else state.series.add(s.n);
        render();
      }));
    });
    r2.appendChild(c2);
    card.appendChild(r2);

    host.appendChild(card);
    return filtered();
  }

  // ── вид: рейтинг ────────────────────────────────────────

  function viewRating(host) {
    if (!UNITS.length) return viewEmpty(host);

    var f = renderFilters(host);
    var prev = prevPlaces();

    /* Ширины колонок закреплены: при автоматической раскладке они зависят от
       самого длинного числа в столбце, и таблица переезжала при каждом
       переключении фильтра. */
    var wrap = el("div", "table-wrap");
    var table = el("table", "data fixed");
    var thead = el("thead");
    var hr = el("tr");
    hr.appendChild(th("№", "rank"));
    hr.appendChild(th("Ученик", "left"));
    hr.appendChild(th("Очки", "c-score"));
    hr.appendChild(th("Задачи", "c-tasks"));
    hr.appendChild(th("Ср. балл", "c-avg"));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    f.rows.forEach(function (r) {
      var tr = el("tr", "clickable");
      tr.addEventListener("click", function () {
        state.openStudent = r.id;
        render();
      });

      var rank = el("td", "rank" + (r.rank <= 3 ? " rank-top" : "") +
        (r.rank === 1 ? " rank-1" : ""));
      rank.appendChild(el("b", "rank-num", r.rank));
      /* Стрелка рисуется рамкой, а не знаком: шрифт на телефоне может не знать
         нужный глиф, а треугольник из рамок есть всегда. */
      if (prev && prev[r.id]) {
        var d = prev[r.id] - r.rank;
        if (d) rank.appendChild(el("span", "delta " + (d > 0 ? "up" : "down"),
          String(Math.abs(d))));
      }
      tr.appendChild(rank);

      tr.dataset.id = r.id;

      var nm = nameCell("td", "left name", r);
      // Полоска доли: сколько человек взял от своего потолка. Плоская заливка.
      var bar = el("span", "rowbar");
      var share = (r.ceil + r.bonus) ? r.score / (r.ceil + r.bonus) : 0;
      bar.style.width = Math.max(0, Math.min(100, Math.round(share * 100))) + "%";
      nm.insertBefore(bar, nm.firstChild);
      tr.appendChild(nm);

      tr.appendChild(el("td", "score", num(r.score)));
      tr.appendChild(el("td", "muted", r.pluses));
      tr.appendChild(el("td", "muted", avgScore(r.score, r.pluses)));

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // строка «Всего» — сколько очков даёт всё учтённое, если решить целиком
    var tfoot = el("tfoot");
    var fr = el("tr", "total-row");
    fr.appendChild(el("td", "rank"));
    fr.appendChild(el("td", "left name", "Всего"));
    fr.appendChild(el("td", "score", num(f.ceiling)));
    fr.appendChild(el("td", "muted", f.available));
    fr.appendChild(el("td", "muted", avgScore(f.ceiling, f.available)));
    tfoot.appendChild(fr);
    table.appendChild(tfoot);

    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* Кондуит собран из двух таблиц: слева фамилии, справа прокручиваемые клетки.
     Раньше столбец фамилий залипал внутри одной таблицы, и на телефоне клетки
     при прокрутке налезали на имена — залипание конфликтует со слоями, которые
     браузер заводит под анимации. Две таблицы такого конфликта не создают.
     Высоты строк заданы жёстко, поэтому половинки идут вровень. */
  function conduitTables(problems, rows, cellFor, footFor, countFor, att) {
    var split = el("div", "conduit-split");

    var names = el("table", "conduit names");
    var nHead = el("thead");
    var nhr = el("tr");
    nhr.appendChild(el("th", "pname", "Ученик"));
    nHead.appendChild(nhr);
    names.appendChild(nHead);

    var nBody = el("tbody");
    rows.forEach(function (r) {
      var tr = el("tr", "crow");
      tr.appendChild(nameCell("td", "pname", r));
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
    var cells = el("table", "conduit cells");

    var thead = el("thead");
    var hr = el("tr");
    problems.forEach(function (p, i) {
      var leaf = LEAF[leafKey(p.type, p.sub)];
      var cell = el("th", "phead-cell");
      cell.dataset.col = i;
      var box = el("div", "phead");
      box.appendChild(el("div", "phead-id" + (leaf ? "" : " untyped"), p.id));
      /* Подпись значку нужна только здесь: во всех прочих местах рядом стоит
         название темы, а в шапке столбца его нет. */
      box.appendChild(leafMark(leaf, leaf ? leaf.label : "без темы"));
      cell.appendChild(box);
      /* Касание номера задачи гасит остальные столбцы: «кто взял эту» — самый
         частый вопрос к кондуиту, а глазами вести по строке неудобно. */
      cell.addEventListener("click", function () { setHot(i); });
      hr.appendChild(cell);
    });
    hr.appendChild(el("th", "pcount", "всего"));
    if (att) hr.appendChild(el("th", "pcount patt", "был"));
    thead.appendChild(hr);
    cells.appendChild(thead);

    var total = 0;
    var tbody = el("tbody");
    rows.forEach(function (r) {
      var tr = el("tr", "crow");
      problems.forEach(function (p, i) {
        var td = el("td", "cell");
        td.dataset.col = i;
        td.appendChild(cellFor(p, r));
        tr.appendChild(td);
      });
      var n = countFor(r);
      total += n;
      tr.appendChild(el("td", "pcount rowcount", n));

      /* Пустая строка сама по себе двусмысленна: то ли ничего не решил, то ли
         его на занятии не было. Столбец посещаемости и отвечает на это. */
      if (att) {
        var acell = el("td", "cell patt");
        var mark = el("div", "mark att" + (att.was(r.id) ? " on" : ""));
        acell.appendChild(mark);
        tr.appendChild(acell);
      }
      tbody.appendChild(tr);
    });
    cells.appendChild(tbody);

    var tfoot = el("tfoot");
    var f1 = el("tr");
    var f2 = el("tr", "weights");
    problems.forEach(function (p, i) {
      var pair = footFor(p);
      var c1 = el("td", null, pair[0]);
      var c2 = el("td", null, pair[1]);
      c1.dataset.col = i;
      c2.dataset.col = i;
      f1.appendChild(c1);
      f2.appendChild(c2);
    });
    f1.appendChild(el("td", "pcount total", total));
    f2.appendChild(el("td", "pcount"));
    if (att) {
      f1.appendChild(el("td", "pcount patt", att.count));
      f2.appendChild(el("td", "pcount patt"));
    }
    tfoot.appendChild(f1);
    tfoot.appendChild(f2);
    cells.appendChild(tfoot);

    scroll.appendChild(cells);
    split.appendChild(scroll);

    var hot = null;

    function setHot(i) {
      hot = hot === i ? null : i;
      cells.classList.toggle("has-hot", hot !== null);
      Array.prototype.forEach.call(cells.querySelectorAll("[data-col]"),
        function (n) {
          n.classList.toggle("hot", Number(n.dataset.col) === hot);
        });
    }

    return split;
  }

  // ── вид: кондуиты ───────────────────────────────────────

  function viewSeries(host) {
    if (!DATA.series.length && !graves().length) {
      var none = el("div", "card");
      none.appendChild(el("div", "section-title", "Серий пока нет"));
      host.appendChild(none);
      return;
    }

    var picker = el("div", "card");

    // до первой серии строка выбора пуста — показывать её незачем
    if (DATA.series.length) {
      var r1 = el("div", "filter-row");
      var head = el("div", "filter-head");
      head.appendChild(el("span", "filter-title", "Серия"));
      r1.appendChild(head);
      var chips = el("div", "chips");
      DATA.series.forEach(function (s) {
        chips.appendChild(seriesChip(s, s.n === state.openSeries, "pick", function () {
          state.openSeries = s.n;
          render();
        }));
      });
      r1.appendChild(chips);
      picker.appendChild(r1);
    }

    /* Гробарий — не серия, поэтому стоит отдельной строкой, а не в их ряду.
       Пустого не показываем: кнопка вела бы на «гробов пока нет». */
    if (graves().length) {
      var r2 = el("div", "filter-row");
      var gb = el("button", "chip day wide");
      gb.type = "button";
      gb.setAttribute("aria-pressed", state.openSeries === GRAVES ? "true" : "false");
      gb.appendChild(el("b", null, "Гробарий"));
      gb.addEventListener("click", function () {
        state.openSeries = GRAVES;
        render();
      });
      r2.appendChild(gb);
      picker.appendChild(r2);
    }

    host.appendChild(picker);

    if (state.openSeries === GRAVES) return viewGraveList(host);

    var s = DATA.series.filter(function (x) { return x.n === state.openSeries; })[0];
    if (!s) return;

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Серия " + seriesNo(s)));
    sh.appendChild(el("span", "section-note", seriesNote(s)));
    host.appendChild(sh);

    if (s.pdf && s.pdf.file) {
      var pcard = el("div", "card");
      pcard.appendChild(pdfRow(s.pdf.file, "Серия " + seriesNo(s), s.pdf.size));
      host.appendChild(pcard);
    }

    /* Занятия ещё не было: листок уже выдан, а кондуит пуст и ничего не значит.
       Показывать пустую сетку — только вводить в заблуждение. */
    if (!held(s)) {
      var soon = el("div", "card");
      soon.appendChild(el("div", "section-title", "Занятие ещё не прошло"));
      host.appendChild(soon);
      return;
    }

    // в пустой серии показывать нечего — одна шапка с датой
    if (!s.problems.length) return;

    var byId = {};
    UNITS.forEach(function (u) { if (u.sn === s.n) byId[u.id] = u; });

    // в кондуите — список этой серии, а не нынешний общий
    var order = byName(rosterRows(s));

    host.appendChild(conduitTables(s.problems, order, function (p, r) {
      return byId[p.id].solverSet.has(r.id) ? el("div", "mark on", "+") : el("div", "mark");
    }, function (p) {
      return [byId[p.id].solvers.length, byId[p.id].weight];
    }, function (r) {
      return s.problems.filter(function (p) {
        return byId[p.id].solverSet.has(r.id);
      }).length;
    }, attended(s) ? {
      was: function (id) { return wasThere(s, id); },
      count: s.present.length
    } : null));
  }

  /* Подпись под номером серии: когда её выдали и когда по ней было занятие.
     Обычно это разные дни — листок раздают заранее. */
  function seriesNote(s) {
    var out = [];
    var g = givenDate(s);
    if (g) out.push("выдана " + prettyDate(g));
    out.push("занятие " + prettyDate(s.date));
    if (held(s) && attended(s)) {
      out.push("был " + s.present.length + " из " + rosterOf(s).length);
    }
    return out.join(" · ");
  }

  // порядок по номеру: файл обычно уже отсортирован, но полагаться на это незачем
  function graveNum(id) {
    var m = String(id).match(/(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  /* Гробарий — списком, а не сеткой. Гробы штучные: сетка «ученики × гробы»
     стоит почти пустой, и в клетке «+» негде показать надбавку за решение.

     Стоят все гробы подряд, взятые и нет: гробарий — это ещё и объявление,
     что вообще лежит нерешённым, а тема у каждого говорит, за что браться. */
  function viewGraveList(host) {
    var list = graves();
    if (!list.length) {
      var none = el("div", "card");
      none.appendChild(el("div", "section-title", "Гробов пока нет"));
      host.appendChild(none);
      return;
    }

    var byId = {};
    UNITS.forEach(function (u) { if (u.kind === "grave") byId[u.id] = u; });

    var student = {};
    DATA.students.forEach(function (s) { student[s.id] = s; });

    var sh = el("div", "section-head");
    sh.appendChild(el("span", "section-title", "Гробарий"));
    host.appendChild(sh);

    var gpdf = DATA.graves && DATA.graves.pdf;
    if (gpdf && gpdf.file) {
      var gcard = el("div", "card");
      gcard.appendChild(pdfRow(gpdf.file,
        "Гробарий" + (gpdf.at ? " " + fullDate(gpdf.at) : ""), gpdf.size));
      host.appendChild(gcard);
    }

    var card = el("div", "card");
    list.slice().sort(function (a, b) {
      return graveNum(a.id) - graveNum(b.id);
    }).forEach(function (p) {
      var u = byId[p.id];
      var leaf = LEAF[leafKey(p.type, p.sub)];

      var block = el("div", "tblock");

      var head = el("div", "grave-head");
      head.appendChild(el("b", "grave-num", p.id));
      var theme = el("span", "grave-theme");
      theme.appendChild(leafMark(leaf));
      theme.appendChild(document.createTextNode(leaf ? leaf.label : "без темы"));
      head.appendChild(theme);
      block.appendChild(head);

      if (u.solvers.length) {
        byName(u.solvers.map(function (sid) { return student[sid]; }))
          .forEach(function (st) { block.appendChild(graveLine(st, u)); });
      } else {
        // цену нерешённого не пишем: она сложится, только когда его возьмут
        block.appendChild(el("div", "block-none", "пока никто"));
      }

      card.appendChild(block);
    });
    host.appendChild(card);
  }

  /* Строка решения: кто взял и сколько это принесло. Надбавку показываем
     слагаемым — иначе 31 у одного и 23 у другого за один и тот же гроб
     выглядели бы опечаткой. */
  function graveLine(st, u) {
    var line = el("div", "grave-line");
    line.appendChild(nameCell("span", "grave-who", st));

    var extra = (u.bonus && u.bonus[st.id]) || 0;
    var val = el("span", "grave-val");
    if (extra) {
      val.appendChild(el("i", "grave-sum", "+" + num(u.weight) + " +" + num(extra) + " ="));
      val.appendChild(document.createTextNode(" " + num(u.weight + extra)));
    } else {
      val.appendChild(document.createTextNode("+" + num(u.weight)));
    }
    line.appendChild(val);
    return line;
  }

  // ── вид: зачёт ──────────────────────────────────────────

  /* Список файлов и больше ничего: сюда заходят с одной целью — забрать pdf,
     поэтому вся строка и есть кнопка скачивания. */
  function viewZachet(host) {
    var items = zachet();
    if (!items.length) {
      var none = el("div", "card");
      none.appendChild(el("div", "section-title", "Пока пусто"));
      host.appendChild(none);
      return;
    }

    var card = el("div", "card");
    items.forEach(function (it) {
      var row = el("a", "lik-row");
      // зачёт лежит своей папкой: сборной свалки файлов лучше не заводить
      row.href = "data/zachet/" + encodeURIComponent(it.file);
      // без этого телефон открывает pdf во вкладке, а его просили скачать
      row.setAttribute("download", it.title + ".pdf");

      var main = el("span", "lik-main");
      main.appendChild(el("span", "lik-title", it.title));
      main.appendChild(el("span", "lik-meta",
        "PDF" + (fileSize(it.size) ? " · " + fileSize(it.size) : "")));
      row.appendChild(main);

      row.appendChild(el("span", "lik-get", "↓"));
      card.appendChild(row);
    });
    host.appendChild(card);
  }

  // ── вид: ученики ────────────────────────────────────────

  function viewStudentCard(host, id) {
    var student = DATA.students.filter(function (s) { return s.id === id; })[0];
    var f = filtered();
    var row = f.rows.filter(function (r) { return r.id === id; })[0];

    var sh = el("div", "section-head big");
    sh.appendChild(nameCell("span", "section-title", student));
    host.appendChild(sh);

    /* Плотные плашки стоят по краям ряда: «Место» — то, ради чего карточку
       открывают, «Самый ценный плюс» — то, ради чего её дочитывают. Четыре
       подробности между ними остаются стеклянными. Температуры разные и не
       случайно: место — холодное, итоговое, про сравнение с другими; лучший
       плюс — тёплый, про один свой вечер. */
    var tiles = el("div", "tiles");
    tiles.appendChild(tile("Место", row.rank + " / " + DATA.students.length,
      null, "solid cold"));
    /* Потолок у каждого свой: серии, в списках которых его не было, в него не
       входят. С надбавками этого ученика — они начислены за его решения, и без
       них «11 из 6» выглядело бы ошибкой счёта. */
    tiles.appendChild(tile("Очки", num(row.score),
      "из " + num(row.ceil + row.bonus)));
    tiles.appendChild(tile("Задачи", row.pluses + " / " + row.avail));

    // половина задач — рубеж, который стоит отметить
    var share = row.avail ? row.pluses / row.avail : 0;
    var pctTile = tile("Процент", pct(share));
    if (share >= 0.5) pctTile.className = "tile hi";
    tiles.appendChild(pctTile);

    var att = attendance(id);
    if (att.of) {
      tiles.appendChild(tile("Занятия", att.was + " / " + att.of,
        att.was === att.of ? "ни одного пропуска" : null));
    }

    var best = bestProblem(id);
    tiles.appendChild(tile("Самый ценный плюс", best ? "+" + best.value : "—",
      best ? (best.u.sn === null ? "гроб " + best.u.id
        : "серия " + seriesNoBySlot(best.u.sn) + ", задача " + best.u.id) : null,
      "solid warm"));
    host.appendChild(tiles);

    var sh2 = el("div", "section-head");
    sh2.appendChild(el("span", "section-title", "По темам"));
    host.appendChild(sh2);

    var card = el("div", "card");
    DATA.types.forEach(function (t) {
      var leaves = catLeaves(t.id);
      if (!leaves.length) return;

      var catStat = statFor(leaves.map(function (l) { return l.key; }), id);
      if (!catStat.total) return;   // тема без задач ничего не говорит

      var block = el("div", "tblock");
      block.appendChild(statLine(t.name, mark(t.icon, t.slot), catStat, t.slot, false));

      if (leaves.length > 1 || leaves[0].subName) {
        leaves.forEach(function (l) {
          var st = statFor([l.key], id);
          if (!st.total) return;
          // у подраздела значок свой: раньше здесь не было метки вовсе
          block.appendChild(statLine(l.subName || t.name, leafMark(l), st, t.slot, true));
        });
      }

      card.appendChild(block);
    });
    host.appendChild(card);

    // гробы — списком: их немного, и каждый стоит дорого
    if (graves().length) {
      var sh3 = el("div", "section-head");
      sh3.appendChild(el("span", "section-title", "Гробы"));
      host.appendChild(sh3);

      var box = el("div", "series-mini");
      var mine = UNITS.filter(function (u) {
        return u.kind === "grave" && u.solverSet.has(id);
      });
      if (mine.length) {
        mine.forEach(function (u) {
          var chip = el("span", "smini");
          chip.appendChild(el("b", null, u.id));
          chip.appendChild(document.createTextNode(" +" + unitValue(u, id)));
          box.appendChild(chip);
        });
      } else {
        box.appendChild(el("span", "muted", "—"));
      }
      host.appendChild(box);
    }

    // пока серий нет, разбор по сериям — одна шапка; показывать нечего
    if (realSeries().length) {
      var sh4 = el("div", "section-head");
      sh4.appendChild(el("span", "section-title", "По сериям"));
      host.appendChild(sh4);
      host.appendChild(seriesBlocks(id));
    }

    var sign = signature(id);
    if (sign) host.appendChild(el("div", "egg", sign));
  }

  /* Строка «название — шкала — сколько из скольких». Ширины колонок заданы
     жёстко, чтобы шкала стояла на одном месте независимо от длины названия;
     у подтемы шкала мельче, но начинается там же. */
  function statLine(name, mark, stat, slot, small) {
    var line = el("div", "pline" + (small ? " sub" : ""));

    var label = el("span", "pline-name");
    if (mark) label.appendChild(mark);
    label.appendChild(document.createTextNode(name));
    line.appendChild(label);

    line.appendChild(meter(stat.total ? stat.got / stat.total : 0, slot, small));
    line.appendChild(el("span", "pline-val", stat.got + "/" + stat.total));
    return line;
  }

  /* По сериям — что именно взято в каждой. Одни итоги говорят меньше: по
     номерам задач видно, дорогие человек берёт или много дешёвых, и какая
     серия ему не далась. Итоги стоят в шапке серии. */
  function seriesBlocks(id) {
    var card = el("div", "card");

    realSeries().forEach(function (s) {
      // серия, в списке которой его не было, к нему и не относится
      if (rosterOf(s).indexOf(id) === -1) return;
      var mine = [], total = 0, score = 0, ceiling = 0;
      UNITS.forEach(function (u) {
        if (u.sn !== s.n) return;
        total += 1;
        ceiling += u.weight;
        if (u.solverSet.has(id)) {
          mine.push(u);
          score += unitValue(u, id);
        }
      });

      var block = el("div", "tblock");

      var head = el("div", "dblock-head");
      var name = el("span", "dblock-name", "Серия " + seriesNo(s));
      name.appendChild(el("span", "dblock-date", prettyDate(s.date, true)));
      // пропуск отмечаем, приход — нет: он и так виден по плюсам
      if (attended(s) && !wasThere(s, id)) {
        name.appendChild(el("span", "dblock-miss", "не был"));
      }
      head.appendChild(name);
      head.appendChild(el("span", "dblock-val",
        mine.length + " / " + total + " · " + num(score) + " / " + num(ceiling)));
      block.appendChild(head);

      if (mine.length) {
        var box = el("div", "series-mini");
        mine.forEach(function (u) {
          var chip = el("span", "smini");
          chip.appendChild(el("b", null, u.id));
          chip.appendChild(document.createTextNode(" +" + unitValue(u, id)));
          box.appendChild(chip);
        });
        block.appendChild(box);
      } else {
        block.appendChild(el("div", "block-none", "ни одной"));
      }

      card.appendChild(block);
    });

    return card;
  }

  function statFor(keys, studentId) {
    var set = new Set(keys);
    var total = 0, got = 0, score = 0;
    UNITS.forEach(function (u) {
      if (u.sn !== null && !state.series.has(u.sn)) return;
      if (u.roster && !u.roster.has(studentId)) return;
      if (!set.has(u.leafKey) || !state.kinds.has(u.kind)) return;
      total += 1;
      if (u.solverSet.has(studentId)) { got += 1; score += u.weight; }
    });
    return { total: total, got: got, score: score };
  }

  /* Шкала набрана мелкими блоками, а не одной заливкой. Причина внешняя: в
     Samsung Internet крупная плоская заливка гаснет, а мелкая — нет; кружок
     темы 9×9 и полоска в кондуите 20×3 приходят нетронутыми, широкая полоса
     решаемости — приглушённой. Побочная польза: долю теперь видно по числу
     закрашенных блоков, а не только по цвету. */
  var METER_STEPS = 10;   // одна шкала на весь сайт: 10 квадратов — это 100%

  function meter(share, slot, small) {
    var box = el("div", "meter" + (small ? " small" : ""));
    var on = Math.round(share * METER_STEPS);
    if (share > 0 && on === 0) on = 1;   // ненулевую долю показываем всегда
    for (var i = 0; i < METER_STEPS; i++) {
      var seg = el("i");
      if (i < on) seg.style.background = "var(--s" + slot + ")";
      box.appendChild(seg);
    }
    return box;
  }

  /* Самый ценный плюс — по тому, сколько он принёс этому ученику: у гроба с
     надбавкой цена своя, и сравнивать голые веса было бы неверно. */
  function bestProblem(id) {
    var best = null;
    UNITS.forEach(function (u) {
      if (!u.solverSet.has(id)) return;
      var v = unitValue(u, id);
      if (!best || v > best.value) best = { u: u, value: v };
    });
    return best;
  }

  // ── каркас ──────────────────────────────────────────────

  var lastScene = null;

  // всё движение выключается системной настройкой — она не про красоту
  function reduced() {
    return !!(window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* Смена экрана идёт переходом браузера: он снимает кадр «до», кадр «после» и
     проявляет один в другой. Имя открываемого ученика помечено общей меткой и
     поэтому переезжает из строки в заголовок карточки, а не мигает. Где такого
     API нет, остаётся прежнее появление классом.

     Смена отбора — не смена экрана: строки те же, у них меняются только места.
     Их доигрываем сами, переход браузера тут был бы лишним. */

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

  var lastView = state.view;
  var swapToken = 0;

  /* Смена экрана — всегда одна и та же: содержимое уходит, приходит новое.
     Переход браузера здесь пробовался и убран: он подменяет снимками всё окно,
     из-за чего дёргалась шапка, замирал указатель на вкладках и путалась
     прокрутка при открытии ученика из середины списка.

     Смена отбора экрана не меняет: строки те же, у них меняются только места.
     Их доигрываем отдельно. */
  function render() {
    /* Указатель трогается сразу, не дожидаясь содержимого: он живёт в полосе
       вкладок, а она при смене вкладки не перерисовывается вовсе. */
    var tabMoved = state.view !== lastView;
    lastView = state.view;
    syncTabs();

    var scene = state.view + "/" + (state.openStudent || "");
    var moved = scene !== lastScene;
    lastScene = scene;

    if (moved) {
      if (reduced()) {
        window.scrollTo(0, 0);
        paint();
      } else fadeSwap(tabMoved ? "tab" : state.openStudent ? "open" : "back");
      return;
    }

    /* Перерисовка на месте: сменили отбор, экран тот же. Прокрутку держим —
       иначе страница прыгала к началу на каждое касание ярлыка. Высоту на это
       время придерживаем: опустевший на мгновение экран короче, и браузер
       успевал прижать прокрутку сам. */
    var main = document.getElementById("main");
    var keep = window.scrollY;
    var before = (!state.openStudent && state.view === "rating")
      ? rowTops() : null;
    main.style.minHeight = main.offsetHeight + "px";
    paint();
    main.style.minHeight = "";
    if (window.scrollY !== keep) window.scrollTo(0, keep);
    if (before) flipRows(before);
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


  /* Куда уходит старое содержимое и откуда приходит новое. Смысл в
     направлении: открыли карточку — она приходит снизу, будто шагнули вглубь;
     вернулись в список — он опускается сверху, тем же путём назад; сменили
     вкладку — движение нейтральное, соседний экран не глубже и не выше.
     Величины намеренно маленькие: это подсказка о направлении, а не переезд. */
  var OUT_DY = { tab: "-4px", open: "-6px", back: "6px" };
  var IN_DY = { tab: "8px", open: "12px", back: "-9px" };

  /* Смена экрана: страница отматывается наверх на глазах, со старым
     содержимым, оно уходит — и только тогда приходит новое. Переход браузера
     здесь не годится: он подменяет всё окно снимками, и указатель на полосе
     вкладок замер бы вместо того, чтобы переехать. Метка нужна на случай двух
     быстрых нажатий подряд: рисует только последнее. */
  function fadeSwap(mode) {
    var main = document.getElementById("main");
    var mine = ++swapToken;

    /* Содержимое сначала уходит, и только потом подменяется. */
    function swap() {
      main.style.setProperty("--out-dy", OUT_DY[mode]);
      main.classList.remove("entering");
      main.classList.add("leaving");
      setTimeout(function () {
        if (mine !== swapToken) return;
        // прыжок к началу делаем на погасшем экране: его не видно
        if (mode !== "tab") window.scrollTo(0, 0);
        main.classList.remove("leaving");
        paint();
        enter(main, IN_DY[mode]);
      }, 80);
    }

    /* Внутри одной вкладки (открыли карточку ученика) список наверх не мотаем:
       он пролетел бы весь на глазах. Между вкладками — наоборот, отматываем
       плавно, там это и просили. */
    if (mode !== "tab") return swap();
    toTop(function () {
      if (mine === swapToken) swap();
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

  /* Запуск появления. Класс снимается и ставится заново в один заход: без этого
     повторная смена на тот же экран не переиграла бы анимацию. Кадр между
     снятием и постановкой не показывается — всё происходит до отрисовки, а
     обращение к offsetWidth нужно как раз затем, чтобы браузер успел заметить
     снятие и счесть постановку новой анимацией. */
  function enter(main, dy) {
    bindEnter(main);
    main.style.setProperty("--in-dy", dy);
    main.classList.remove("entering");
    void main.offsetWidth;
    main.classList.add("entering");
  }

  /* Отрисовка экрана. Сама она мгновенная и собирает всё разом: появление
     навешивается снаружи, одним движением на весь #main. Поэлементного
     появления здесь нет нарочно — пока экран проявлялся по частям, было видно,
     как страница складывается, особенно на рейтинге, где строк три десятка. */
  function paint() {
    var main = document.getElementById("main");
    clear(main);
    syncTabs();

    if (state.view === "rating") {
      if (state.openStudent) viewStudentCard(main, state.openStudent);
      else viewRating(main);
    } else if (state.view === "series") viewSeries(main);
    else if (state.view === "zachet") viewZachet(main);

  }

  /* Где стояли строки до перерисовки. Приём известен как FLIP: запомнить
     положение, перерисовать, сдвинуть обратно и отпустить — разница доигрывается
     сама. Без этого работа фильтра не видна: места меняются подменой кадра. */
  function rowTops() {
    var map = {};
    Array.prototype.forEach.call(
      document.querySelectorAll("table.data tbody tr[data-id]"),
      function (tr) { map[tr.dataset.id] = tr.getBoundingClientRect().top; });
    return map;
  }

  function flipRows(before) {
    if (reduced() || !document.body.animate) return;
    Array.prototype.forEach.call(
      document.querySelectorAll("table.data tbody tr[data-id]"),
      function (tr) {
        var was = before[tr.dataset.id];
        if (was === undefined) return;
        var dy = was - tr.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        tr.animate(
          [{ transform: "translateY(" + dy + "px)" }, { transform: "none" }],
          { duration: 340, easing: "cubic-bezier(.2,.7,.3,1)" });
      });
  }


  function setupChrome() {
    /* В шапке стоит знак, а не название: заполнять её из настроек больше нечем.
       Название с подзаголовком остались у вкладки браузера — там они и нужны,
       чтобы отличить страницу среди десятка открытых. */
    document.title = DATA.config.title + " — " + (DATA.config.subtitle || "");

    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.addEventListener("click", function () {
        state.view = t.dataset.view;
        state.openStudent = null;
        render();
      });
    });
  }

  /* Если страница пришла из кэша, а данные уже новее — перезагружаемся по
     адресу с новой меткой: тот же кэш по нему промахнётся и отдаст свежий HTML.
     Метка в адресе заодно защищает от петли: второй раз условие не сработает. */
  function checkStale(config) {
    var meta = document.querySelector('meta[name="build"]');
    var page = meta ? meta.content : null;
    var fresh = config.build;
    if (!page || !fresh || page === fresh) return false;
    if (new URLSearchParams(location.search).get("b") === fresh) return false;
    location.replace(location.pathname + "?b=" + fresh);
    return true;
  }

  function boot(data) {
    if (checkStale(data.config)) return;
    DATA = data;
    DATA.graves = DATA.graves || { problems: [], solved: {} };
    DATA.graves.problems = DATA.graves.problems || [];
    DATA.graves.solved = DATA.graves.solved || {};
    DATA.zachet = DATA.zachet || { items: [] };
    DATA.zachet.items = DATA.zachet.items || [];
    /* Выбывшего помечают, а не стирают: в общем списке и в рейтинге его больше
       нет, но имя нужно — оно стоит в кондуитах тех серий, где он занимался. */
    NAME = {};
    DATA.students.forEach(function (st) { NAME[st.id] = st.name; });
    DATA.students = DATA.students.filter(function (st) { return !st.out; });
    DATA.students.sort(function (a, b) { return a.name.localeCompare(b.name, "ru"); });
    /* Порядок ленты — по номеру серии: он и есть её место в череде занятий.
       Дата разрешает спор, если два файла носят один номер. */
    DATA.series.sort(function (a, b) {
      return seriesNo(a) - seriesNo(b) ||
        String(a.date).localeCompare(String(b.date));
    });
    buildIndex();
    setupChrome();
    render();
  }

  function loadFromFiles() {
    var base = "data/";
    function get(path) {
      return fetch(base + path, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error(path + ": " + r.status);
        return r.json();
      });
    }
    // гробария может не быть — это не повод не открыть сайт
    var soft = get("graves.json").catch(function () {
      return { problems: [], solved: {} };
    });
    /* И список серий тоже: без него страница покажет учеников и гробарий, но
       откроется. Пусть любая порча данных отнимает часть, а не всё. */
    var days = get("series/manifest.json").catch(function () { return null; });
    // файлов зачёта может не быть вовсе — это не повод не открыть сайт
    var zach = get("zachet.json").catch(function () { return { items: [] }; });

    return Promise.all([
      get("config.json"), get("types.json"), get("students.json"), days, soft, zach
    ]).then(function (res) {
      var files = res[3] && Array.isArray(res[3].series) ? res[3].series : [];
      /* Пропавший файл серии не должен ронять страницу целиком: раз в списке
         осталась запись без файла, показываем остальные дни, а не пустой
         экран с ошибкой. */
      return Promise.all(files.map(function (f) {
        return get("series/" + f).catch(function () { return null; });
      })).then(function (series) {
        return {
          config: res[0], types: res[1], students: res[2],
          series: series.filter(Boolean), graves: res[4], zachet: res[5]
        };
      });
    });
  }

  /* Отклик на касание сделан классом и анимацией, а не :active. На телефоне
     :active почти не виден: браузер придерживает его, пока не поймёт, что
     касание — не начало прокрутки, и на быстром тапе состояние успевает
     появиться и исчезнуть за несколько миллисекунд. Анимация же, раз начавшись,
     доигрывает до конца независимо от того, как долго держали палец. */
  var TAPPABLE = "button:not(.mark), .chip, a.ghost-btn, a.lik-row, tr.clickable";

  function enableTapFeedback() {
    document.addEventListener("pointerdown", function (e) {
      var node = e.target.closest && e.target.closest(TAPPABLE);
      if (!node || node.disabled) return;
      node.classList.remove("tap");
      void node.offsetWidth;      // перезапуск анимации на повторном касании
      node.classList.add("tap");
    }, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", function () {
    enableTapFeedback();
    // при повороте экрана вкладки меняют ширину, указатель должен успеть за ними
    window.addEventListener("resize", moveThumb);
    loadFromFiles().then(boot).catch(function (err) {
      var main = document.getElementById("main");
      clear(main);
      var box = el("div", "card");
      box.appendChild(el("div", "section-title", "Не удалось загрузить данные"));
      box.appendChild(el("div", "tile-note", String(err.message || err)));
      main.appendChild(box);
    });
  });
})();

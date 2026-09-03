/* Значки тем.
 *
 * Рисунки лежат здесь по одному разу — в спрайте из <symbol>, вставленном в
 * страницу при первом обращении. Каждый значок на экране это <svg><use></svg>,
 * две строчки разметки, а не полтора десятка путей. Значков на рейтинге разом
 * бывает под сорок, и разница заметна.
 *
 * Цвет значок берёт от текста (stroke: currentColor), поэтому раскрашивать его
 * не нужно: он встаёт на место цветного кружка и получает тот же цвет раздела.
 *
 * Заливка и обводка наследуются внутрь <use>, а вот селекторы — нет: правило
 * вида «.ic .f { fill: … }» до содержимого символа не достанет. Поэтому у
 * закрашенных фигур fill и stroke заданы атрибутами прямо в разметке.
 *
 * Рисунки нарочно однолинейные и без заливки фона: страница сейчас без цвета,
 * и значок должен читаться как знак, а не как картинка.
 */
(function (root) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  /* Ключ — что нарисовано, а не какая это тема: значок можно переназначить
     любому разделу, и привязка к смыслу рисунка переживёт переименование. */
  var GLYPH = {
    x: {
      /* Разведён шире, чем просится: рядом с полновесными фигурами вроде графа
         или доски компактный икс читался мелким. */
      name: "икс",
      d: '<path d="M6.2 5.8C9.2 9.2 14.8 14.8 17.8 18.2"/>' +
         '<path d="M17.8 5.8C14.8 9.2 9.2 14.8 6.2 18.2"/>'
    },
    le: {
      name: "знак ≤",
      d: '<path d="M16.5 4.5L7 9.5L16.5 14.5"/><path d="M7 19h9.5"/>'
    },
    poly: {
      name: "кривая с корнями",
      d: '<path d="M3.5 13h17"/>' +
         '<path d="M4.5 17.5C6.5 17.5 6.5 6.5 9 6.5C11.5 6.5 11.5 19 14 19C16.5 19 16.5 5.5 19.5 5.5"/>'
    },
    seq: {
      name: "последовательность",
      d: '<circle cx="4" cy="18.5" r="1.7" fill="currentColor" stroke="none"/>' +
         '<circle cx="8.5" cy="14.8" r="1.7" fill="currentColor" stroke="none"/>' +
         '<circle cx="13" cy="11.1" r="1.7" fill="currentColor" stroke="none"/>' +
         '<circle cx="16.6" cy="8.3" r="0.9" fill="currentColor" stroke="none"/>' +
         '<circle cx="18.9" cy="6.5" r="0.9" fill="currentColor" stroke="none"/>' +
         '<circle cx="21.2" cy="4.7" r="0.9" fill="currentColor" stroke="none"/>'
    },
    integral: {
      name: "интеграл",
      d: '<path d="M16 5C16 2.5 12.8 2.5 12.6 6L11.4 18C11.2 21.5 8 21.5 8 19"/>'
    },
    matrix: {
      name: "матрица",
      d: '<path d="M8.5 4.5H6v15h2.5"/><path d="M15.5 4.5H18v15h-2.5"/>' +
         '<circle cx="10.2" cy="9.5" r="1.2" fill="currentColor" stroke="none"/>' +
         '<circle cx="13.8" cy="9.5" r="1.2" fill="currentColor" stroke="none"/>' +
         '<circle cx="10.2" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>' +
         '<circle cx="13.8" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>'
    },
    func: {
      name: "функция",
      d: '<path d="M9 20V8.2C9 5.2 11.2 4.2 12.6 5.4"/><path d="M6.6 11.6h5.2"/>' +
         '<path d="M15.4 10h4.6"/><path d="M15.4 14h4.6"/>'
    },
    triangle: {
      name: "треугольник",
      d: '<path d="M12 4.5L20 18.5L4 18.5Z"/>'
    },
    incircle: {
      name: "треугольник в круге",
      d: '<circle cx="12" cy="12" r="8"/><path d="M12 4L18.93 16L5.07 16Z"/>'
    },
    cube: {
      name: "куб",
      d: '<path d="M12 4.6L19.4 8.6v6.8L12 19.4L4.6 15.4V8.6Z"/>' +
         '<path d="M12 11.6L19.4 8.6M12 11.6L4.6 8.6M12 11.6v7.8"/>'
    },
    triless: {
      name: "знак в треугольнике",
      d: '<path d="M12 4L20.5 19L3.5 19Z"/><path d="M14 11.8L10.2 14.4L14 17"/>'
    },
    branch: {
      name: "ветвление",
      d: '<path d="M12 6.6L5.6 17.6M12 6.6v11M12 6.6l6.4 11"/>' +
         '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/>' +
         '<circle cx="5" cy="18.8" r="1.6" fill="currentColor" stroke="none"/>' +
         '<circle cx="12" cy="18.8" r="1.6" fill="currentColor" stroke="none"/>' +
         '<circle cx="19" cy="18.8" r="1.6" fill="currentColor" stroke="none"/>'
    },
    turns: {
      name: "ход и ответ",
      d: '<path d="M5 9.5h14"/><path d="M16.2 6.9L19 9.5L16.2 12.1"/>' +
         '<path d="M19 15.5H5"/><path d="M7.8 12.9L5 15.5L7.8 18.1"/>'
    },
    graph: {
      name: "граф",
      d: '<path d="M10.7 7.6L6.8 15.4M13.3 7.6l3.9 7.8M7.8 17.5h8.4"/>' +
         '<circle cx="12" cy="5.5" r="2.2" fill="currentColor" stroke="none"/>' +
         '<circle cx="5.5" cy="17.5" r="2.2" fill="currentColor" stroke="none"/>' +
         '<circle cx="18.5" cy="17.5" r="2.2" fill="currentColor" stroke="none"/>'
    },
    grid: {
      name: "клетчатая доска",
      d: '<rect x="4" y="4" width="16" height="16" rx="1.6"/>' +
         '<path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16"/>' +
         '<rect x="9.33" y="9.33" width="5.34" height="5.34" fill="currentColor" stroke="none"/>'
    },
    hull: {
      name: "точки и оболочка",
      d: '<path d="M12 4L20 10L17 19H7L4 10Z"/>' +
         '<circle cx="12" cy="10.5" r="1.2" fill="currentColor" stroke="none"/>' +
         '<circle cx="9" cy="14.8" r="1.2" fill="currentColor" stroke="none"/>' +
         '<circle cx="15" cy="14.8" r="1.2" fill="currentColor" stroke="none"/>'
    },
    tally: {
      name: "счётные палочки",
      d: '<path d="M6 6v12M9.5 6v12M13 6v12M16.5 6v12"/><path d="M4.5 17.5L18 6.8"/>'
    },
    die: {
      name: "игральная кость",
      d: '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/>' +
         '<circle cx="8.7" cy="8.7" r="1.4" fill="currentColor" stroke="none"/>' +
         '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>' +
         '<circle cx="15.3" cy="15.3" r="1.4" fill="currentColor" stroke="none"/>'
    },
    congr: {
      /* Знак сравнения наклонён нарочно: ровные три полоски читаются как
         кнопка меню, а наклонённые — как математический знак. */
      name: "знак сравнения",
      d: '<path d="M6.2 9.2L17.8 7.4M6.2 13L17.8 11.2M6.2 16.8L17.8 15"/>'
    },
    column: {
      name: "колонна",
      d: '<path d="M6.4 5.4h11.2"/><path d="M9 8.2v7.6M12 8.2v7.6M15 8.2v7.6"/>' +
         '<path d="M6.4 18.6h11.2"/>'
    },
    none: {
      /* Тема не выбрана. Пустой квадрат нарочно повторяет форму прежнего
         кружка: место занято, но ничего не сказано. */
      name: "без значка",
      d: '<rect x="6.5" y="6.5" width="11" height="11" rx="3.2"/>'
    }
  };

  /* Порядок в выборе — по разделам, как они идут на сайте: так значок ищется
     глазами, а не перебором. */
  var ORDER = [
    "x", "le", "poly", "seq", "integral", "matrix", "func",
    "triangle", "incircle", "cube", "triless",
    "branch", "turns", "graph", "grid", "hull", "tally", "die",
    "congr", "column",
    "none"
  ];

  var ready = false;

  /* Спрайт прячется нулевым размером, а не display: none: скрытый так символ
     в части браузеров перестаёт отдаваться по ссылке. */
  function ensure() {
    if (ready) return;
    ready = true;

    var body = "";
    ORDER.forEach(function (k) {
      body += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + GLYPH[k].d + "</symbol>";
    });

    var host = document.createElement("div");
    host.innerHTML =
      '<svg xmlns="' + NS + '" aria-hidden="true" focusable="false" ' +
      'style="position:absolute;width:0;height:0;overflow:hidden">' + body + "</svg>";
    document.body.appendChild(host.firstChild);
  }

  /* Значок всегда рядом с названием темы, поэтому для чтения вслух он лишний:
     прочитано будет само название. Где названия нет — в шапке столбца
     кондуита — подпись передаётся отдельным параметром. */
  function make(key, title) {
    ensure();
    var k = GLYPH[key] ? key : "none";

    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "ic");
    svg.setAttribute("viewBox", "0 0 24 24");
    if (title) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", title);
    } else {
      svg.setAttribute("aria-hidden", "true");
    }

    var use = document.createElementNS(NS, "use");
    use.setAttribute("href", "#i-" + k);
    svg.appendChild(use);
    return svg;
  }

  root.Icons = {
    make: make,
    keys: function () { return ORDER.slice(); },
    name: function (key) { return GLYPH[key] ? GLYPH[key].name : GLYPH.none.name; },
    has: function (key) { return !!GLYPH[key]; }
  };
})(window);

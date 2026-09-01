"""Версия статики.

    python tools/build.py

Сайт собирать не нужно: GitHub Pages раздаёт корень репозитория как есть, а
index.html читает файлы из data/ прямо в браузере. Поэтому правка с телефона
меняет сайт без всякой пересборки.

Скрипт нужен только после правки стилей или скриптов. Он проставляет версию в
ссылки на них (assets/style.css?v=…) и в мета-тег страницы. Без этого браузер
телефона может неделю показывать старый кэш, и правки выглядят
«не применившимися».
"""

import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PAGES = ["index.html", "edit.html"]

ASSET_RE = re.compile(r'(?P<attr>href|src)="(?P<path>assets/[\w.-]+)(?:\?v=[^"]*)?"')
BUILD_META_RE = re.compile(r'<meta name="build" content="[^"]*">')


def stamp_pages(version: str) -> None:
    """Версия в ссылках на стили и в мета-теге.

    Мета нужна, чтобы страница могла заметить, что сама устарела: GitHub Pages
    отдаёт HTML из кэша ещё минут десять после выкладки, и тогда свежая версия
    стилей просто не запрашивается. Скрипт сверяет мету с версией из config.json
    (его всегда тянут мимо кэша) и перезагружается на свежую.
    """
    meta = f'<meta name="build" content="{version}">'
    for name in PAGES:
        path = ROOT / name
        text = path.read_text(encoding="utf-8")
        stamped = ASSET_RE.sub(
            lambda m: f'{m.group("attr")}="{m.group("path")}?v={version}"', text
        )
        if BUILD_META_RE.search(stamped):
            stamped = BUILD_META_RE.sub(meta, stamped)
        else:
            stamped = stamped.replace("</head>", meta + "\n</head>", 1)
        if stamped != text:
            path.write_text(stamped, encoding="utf-8")


def stamp_config(version: str) -> None:
    path = DATA / "config.json"
    config = json.loads(path.read_text(encoding="utf-8"))
    config["build"] = version
    path.write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    version = datetime.now().strftime("%Y%m%d%H%M")
    stamp_pages(version)
    stamp_config(version)
    print(f"версия статики: {version}")


if __name__ == "__main__":
    main()

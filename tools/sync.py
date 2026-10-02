#!/usr/bin/env python3
"""Download xkcd's licensed archive and build the notebook's offline data files.

    python3 tools/sync.py
    python3 tools/sync.py --offline                # rebuild from cached comics only
    python3 tools/sync.py --refresh-transcripts    # also re-read every explain xkcd transcript

Requires requests and Pillow. Downloads are resumable. Only xkcd.com, imgs.xkcd.com and explain xkcd's
wiki (www.explainxkcd.com, one request at a time) are requested.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from html import escape, unescape
import json
from pathlib import Path
import re
import threading
import time
from urllib.parse import quote, urljoin, urlparse

import requests

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / "data" / "metadata"
IMAGES = ROOT / "images"
HIRES = ROOT / "data" / "hires"
IMAGES_2X = IMAGES / "2x"
EXPLAIN = ROOT / "data" / "explain"
WIKI = "https://www.explainxkcd.com/wiki/"
# The newest comics are checked again on every sync: their metadata, 2x images and community transcripts
# can still appear or change in the first days.
RECENT = 10
SHARE = ROOT / "comic"
# Where the notebook is published. Link previews need absolute URLs, so share pages are built against it.
SITE_URL = "https://nanabozho.github.io/xkcd/"
LOCAL = threading.local()


def write_json(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def get(url, params=None):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {"xkcd.com", "imgs.xkcd.com", "www.explainxkcd.com"}:
        raise ValueError(f"Unexpected download host: {url}")
    if not hasattr(LOCAL, "session"):
        LOCAL.session = requests.Session()
        LOCAL.session.headers["User-Agent"] = "XKCDPersonalNotebook/1.0 (noncommercial archive; https://github.com/nanabozho/xkcd)"
    for attempt in range(4):
        try:
            response = LOCAL.session.get(url, params=params, timeout=(15, 90))
            if response.status_code == 404:
                response.raise_for_status()
            if response.status_code == 429:
                time.sleep(min(60, int(response.headers.get("Retry-After", "15"))))
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            if (error.response is not None and error.response.status_code == 404) or attempt == 3:
                raise
            time.sleep(2 ** attempt)


def clean(value):
    value = unescape(str(value or ""))
    # Some older API entries contain UTF-8 decoded as Latin-1.
    if "Ã" in value or "â€" in value or "Â" in value:
        try:
            value = value.encode("latin1").decode("utf-8")
        except (UnicodeError, ValueError):
            pass
    return value.strip()


def image_path(record, url=None, folder=IMAGES):
    suffix = Path(urlparse(url or record.get("img", "")).path).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        suffix = ".png"
    return folder / f"{record['num']:04d}{suffix}"


def save_image(url, path, number):
    response = get(url.replace("http://", "https://", 1))
    if not response.headers.get("Content-Type", "").startswith("image/"):
        raise ValueError(f"Comic #{number}: response is not an image")
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(response.content)
    temp.replace(path)


def hires_url(number):
    """The cached srcset entry, resolved like the browser would against the comic's page (some are site-relative)."""
    cache = HIRES / f"{number:04d}.json"
    raw = read_json(cache)["url"] if cache.exists() else ""
    return urljoin(f"https://xkcd.com/{number}/", raw) if raw else ""


def hires(record, recheck=False):
    """Most comics since 2012 have a double-resolution image that only the comic's page lists (srcset)."""
    number = record["num"]
    cache = HIRES / f"{number:04d}.json"
    if recheck or not cache.exists():
        page = get(f"https://xkcd.com/{number}/").text
        block = re.search(r'<div id="comic">(.*?)</div>', page, re.S)
        tag = block and re.search(r"<img\b[^>]*>", block.group(1))
        found = tag and re.search(r'srcset="[^"]*?(\S+)\s+2x', tag.group(0))
        write_json(cache, {"num": number, "url": urljoin(f"https://xkcd.com/{number}/", found.group(1)) if found else ""})
    url = hires_url(number)
    if url and not image_path(record, url, IMAGES_2X).exists():
        save_image(url, image_path(record, url, IMAGES_2X), number)


def download(number, recheck=False):
    path = META / f"{number:04d}.json"
    previous = read_json(path) if path.exists() else {}
    if recheck or not previous:
        record = get(f"https://xkcd.com/{number}/info.0.json").json()
        if record.get("num") != number:
            raise ValueError(f"API returned wrong comic for #{number}")
        write_json(path, record)
    record = read_json(path)
    image = image_path(record)
    # Hoverboard and Garden expose a directory URL instead of a static image.
    has_static_image = bool(record.get("img")) and not urlparse(record["img"]).path.endswith("/")
    if has_static_image and (not image.exists() or record["img"] != previous.get("img", record["img"])):
        save_image(record["img"], image, number)
    if has_static_image:
        hires(record, recheck)
    return number


def wiki_pages(titles):
    """The current wikitext of explain xkcd pages, 50 per request; numbers redirect, e.g. 1838 → 1838: Machine Learning."""
    found, redirects = {}, {}
    for start in range(0, len(titles), 50):
        params = {"action": "query", "prop": "revisions", "rvprop": "content|ids|timestamp", "rvslots": "main",
                  "redirects": 1, "format": "json", "formatversion": 2, "titles": "|".join(titles[start:start + 50])}
        more = {}
        while True:  # Large pages can spill into continuation responses.
            data = get(WIKI + "api.php", {**params, **more}).json()
            query = data.get("query", {})
            redirects.update({r["from"]: r["to"] for r in query.get("redirects", [])})
            found.update({p["title"]: p for p in query.get("pages", []) if p.get("revisions")})
            time.sleep(1)  # A volunteer-run wiki: one request at a time, with a pause.
            if "continue" not in data:
                break
            more = data["continue"]
    return {title: found.get(redirects.get(title, title)) for title in titles}


INCOMPLETE = re.compile(r"\{\{\s*incomplete transcript", re.I)


def transcript_section(wikitext):
    found = re.search(r"^==\s*Transcript\s*==[ \t]*$(.*?)(?=^==[^=]|\{\{\s*comic discussion|\Z)", wikitext, re.S | re.M | re.I)
    return found.group(1).strip() if found else ""


def fetch_transcripts(numbers):
    """Cache explain xkcd's transcript for each comic. A comic the wiki has no transcript for yet gets no file,
    so the next sync asks again."""
    pages = wiki_pages([str(n) for n in numbers])
    entries, subpages = {}, {}
    for n in numbers:
        page = pages[str(n)]
        if not page or not page["title"].startswith(f"{n}:"):
            continue
        revision = page["revisions"][0]
        section = transcript_section(revision["slots"]["main"]["content"])
        entries[n] = {"num": n, "page": page["title"], "revid": revision["revid"], "timestamp": revision["timestamp"], "wikitext": section}
        # A few interactive comics keep their long transcript on a subpage, e.g. 1608: Hoverboard/Transcript.
        sub = re.search(r"\[\[\s*(" + str(n) + r":[^\]|]*/Transcript)\s*(?:\|[^\]]*)?\]\]", section)
        if sub and len(plain(section)) < 400:
            subpages[n] = sub.group(1)
    if subpages:
        found = wiki_pages(list(subpages.values()))
        for n, title in subpages.items():
            if found[title]:
                revision = found[title]["revisions"][0]
                entries[n].update(page=found[title]["title"], revid=revision["revid"], timestamp=revision["timestamp"],
                                  wikitext=revision["slots"]["main"]["content"])
    for n, entry in entries.items():
        if plain(entry["wikitext"]):
            write_json(EXPLAIN / f"{n:04d}.json", entry)
    return sum(bool(plain(e["wikitext"])) for e in entries.values())


def template(match):
    """Inline templates that carry words keep them ({{w|Ocean}} links to Wikipedia); notices such as
    {{incomplete transcript}} or {{Citation needed}} are dropped."""
    name, *args = [part.strip() for part in match.group(1).split("|")]
    if name.lower() in {"w", "wiki", "wikipedia", "xkcd", "what if", "tvtropes"} and args:
        return args[-1]
    return ""


def table_row(line):
    cells = re.split(r"\s*(?:\|\||!!)\s*", line.lstrip("|!").strip())
    # A cell may start with its own attributes: style="..." | text
    return " · ".join(re.sub(r'^[^|\[\]{}]*=\s*"[^"]*"[^|]*\|(?!\|)\s*', "", cell) for cell in cells if cell.strip())


# Only real HTML tags are markup; transcripts also quote angle-bracket text such as <illegible> or <your name>.
HTML_TAGS = ("b|big|blockquote|br|center|code|dd|del|div|dl|dt|em|font|hr|i|ins|kbd|li|math|ol|p|poem|pre|q|s|samp|"
             "small|span|strike|strong|sub|sup|table|td|th|tr|tt|u|ul|var")


def plain(wikitext):
    """explain xkcd's transcript wikitext as readable plain text: the same words, without the markup."""
    kept = []  # <nowiki> text is literal: set it aside until the markup is gone.
    text = re.sub(r"<nowiki>(.*?)</nowiki>", lambda m: kept.append(m.group(1)) or f"\0{len(kept) - 1}\0", wikitext, flags=re.S | re.I)
    text = re.sub(r"<nowiki\s*/>", "", text, flags=re.I)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)
    while True:  # Innermost templates first, so nested ones resolve.
        text, count = re.subn(r"\{\{([^{}]*)\}\}", template, text)
        if not count:
            break
    text = re.sub(r"\[\[\s*(?:File|Image|Category):[^\]]*\]\]", "", text, flags=re.I)
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[(?:https?:)?//\S+(?:\s+([^\]]*))?\]", lambda m: m.group(1) or "", text)
    text = re.sub(r"<br\s*/?>|<(?:tr|dd|dt|li|p|div)\b[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"</t[dh]>", " · ", text, flags=re.I)
    text = re.sub(rf"</?(?:{HTML_TAGS})\b[^>]*>", "", text, flags=re.I)
    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"__[A-Z]+__", "", text)
    lines = []
    text = re.sub(r"\0(\d+)\0", lambda m: kept[int(m.group(1))], text)
    for line in unescape(text).replace("\u00a0", " ").splitlines():
        line = re.sub(r"^[:*#;]+\s*", "", line.strip())
        if re.match(r"^\{\||^\|\}|^\|-", line):
            continue
        if line.startswith("|+"):
            line = line[2:]
        elif line.startswith(("|", "!")):
            line = table_row(line)
        line = re.sub(r"^=+\s*(.*?)\s*=+$", r"\1", line)
        lines.append(re.sub(r"[ \t]{2,}", " ", line).strip().removesuffix(" ·"))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def records():
    return sorted((read_json(p) for p in META.glob("*.json")), key=lambda r: r["num"])


def share_page(c, size2x):
    """A page per comic whose link preview shows that comic. Preview crawlers never see #fragments and
    don't run scripts, so they read these tags; people are forwarded to the comic in the notebook."""
    n, url = c["num"], f"{SITE_URL}comic/{c['num']}/"
    title = f"xkcd #{n}: {c['title']}"
    alt = c["alt"] if len(c["alt"]) <= 280 else c["alt"][:279].rstrip() + "…"
    description = (alt + " · " if alt else "") + "Comic by Randall Munroe (xkcd.com), CC BY-NC 2.5. Unofficial notebook."
    tags = [("og:type", "article"), ("og:site_name", "xkcd Notebook"), ("og:title", title),
            ("og:description", description), ("og:url", url)]
    card = "summary"
    if c["image"]:
        # The standard image, unless it is below the size large previews need and a 2x copy exists.
        image, width, height = c["image"], c["width"], c["height"]
        if (width < 300 or height < 157) and c["image2x"]:
            image, (width, height) = c["image2x"], size2x[n]
        tags += [("og:image", SITE_URL + image), ("og:image:width", width), ("og:image:height", height), ("og:image:alt", c["title"])]
        card = "summary_large_image" if width >= 300 and height >= 157 else "summary"
    meta = "\n".join(f'  <meta property="{k}" content="{escape(str(v))}">' for k, v in tags)
    target = f"../../index.html#{n}"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{escape(title)} · Notebook</title>
  <meta name="description" content="{escape(description)}">
  <link rel="canonical" href="{url}">
{meta}
  <meta name="twitter:card" content="{card}">
  <script>location.replace({json.dumps(target)})</script>
</head>
<body style="font:16px system-ui,sans-serif;margin:40px">
  <p><a href="{target}">Read {escape(title)}</a> in the notebook, or the <a href="{c['source']}">original on xkcd</a>.</p>
  <p>Comic by Randall Munroe, <a href="https://xkcd.com/license.html">CC BY-NC 2.5</a>.</p>
</body>
</html>
"""


def write_share_pages(comics, size2x):
    for c in comics:
        page, path = share_page(c, size2x), SHARE / str(c["num"]) / "index.html"
        # Rewriting thousands of unchanged files is slow on some filesystems.
        if not path.exists() or path.read_text(encoding="utf-8") != page:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(page, encoding="utf-8")


def build(report):
    from PIL import Image

    comics, size2x = [], {}
    for record in records():
        number = record["num"]
        source = image_path(record)
        width = height = 0
        animated = False
        if source.exists():
            with Image.open(source) as image:
                width, height = image.size
                animated = bool(getattr(image, "is_animated", False))
        image2x = ""
        url2x = hires_url(number)
        if url2x and width and not animated and image_path(record, url2x, IMAGES_2X).exists():
            big = image_path(record, url2x, IMAGES_2X)
            with Image.open(big) as image:
                # Only the same picture at a higher resolution can stand in for the original.
                if image.width >= 1.5 * width and abs(image.width / image.height - width / height) <= 0.02 * width / height:
                    image2x = big.relative_to(ROOT).as_posix()
                    size2x[number] = image.size
                else:
                    print(f"Ignoring #{number} 2x image: {image.width}x{image.height} does not match {width}x{height}", flush=True)
        transcript = clean(record.get("transcript"))
        cache = EXPLAIN / f"{number:04d}.json"
        explained = read_json(cache) if cache.exists() else {}
        explain_text = plain(explained.get("wikitext", ""))
        transcript_note = ""
        if number == 1663:
            transcript = ""
            transcript_note = "The API supplies an unrelated podium transcript for Garden; it is excluded from search."
        comics.append({
            "num": number,
            "title": clean(record.get("title") or record.get("safe_title")),
            "date": date(int(record["year"]), int(record["month"]), int(record["day"])).isoformat(),
            "alt": clean(record.get("alt")), "transcript": transcript, "transcriptNote": transcript_note,
            "explainTranscript": explain_text,
            "explainUrl": WIKI + "index.php/" + quote(explained["page"].replace(" ", "_"), safe=":/") if explain_text else "",
            "image": source.relative_to(ROOT).as_posix() if source.exists() else "", "image2x": image2x,
            "remoteImage": record.get("img", "") if not urlparse(record.get("img", "")).path.endswith("/") else "", "width": width, "height": height,
            "animated": animated, "source": f"https://xkcd.com/{number}/",
            "extraLink": record.get("link", ""),
        })
    data = {
        "title": "xkcd Notebook", "author": "Randall Munroe",
        "license": "CC BY-NC 2.5", "licenseUrl": "https://xkcd.com/license.html",
        "source": "https://xkcd.com/", "siteUrl": SITE_URL, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "archiveCheckedAt": report.get("checkedAt"), "latestAvailable": report.get("latest"),
        "missing": [n for n in report.get("expected", []) if n not in {c['num'] for c in comics}],
        "intentionallyAbsent": [404],
        "counts": {"comics": len(comics), "localImages": sum(bool(c["image"]) for c in comics),
                   "hiresImages": sum(bool(c["image2x"]) for c in comics),
                   "transcripts": sum(bool(c["transcript"]) for c in comics),
                   "explainTranscripts": sum(bool(c["explainTranscript"]) for c in comics)},
        "comics": comics,
    }
    js = "window.XKCD_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    temp = ROOT / "comics.js.tmp"
    temp.write_text(js, encoding="utf-8")
    temp.replace(ROOT / "comics.js")
    write_share_pages(comics, size2x)
    print("Built notebook: " + json.dumps(data["counts"]), flush=True)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Use cached data only; no network requests")
    parser.add_argument("--refresh-transcripts", action="store_true", help="Re-read every explain xkcd transcript, not just new and recent ones")
    parser.add_argument("--workers", type=int, default=6, choices=range(1, 7))
    args = parser.parse_args()
    for folder in (META, IMAGES, HIRES, IMAGES_2X, EXPLAIN):
        folder.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / "data" / "sync-report.json"
    report = read_json(report_path) if report_path.exists() else {}
    if not args.offline:
        latest = get("https://xkcd.com/info.0.json").json()
        archive = get("https://xkcd.com/archive/").text
        (ROOT / "data" / "archive.html").write_text(archive, encoding="utf-8")
        # Numbered API also covers any entries temporarily omitted from the archive page.
        archive_ids = {int(n) for n in re.findall(r'href="/(\d+)/"', archive)}
        expected = sorted((set(range(1, latest["num"] + 1)) | archive_ids) - {404})
        report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "latest": latest["num"],
                  "expected": expected, "archiveCount": len(archive_ids), "downloadErrors": [], "transcriptErrors": []}
        write_json(META / f"{latest['num']:04d}.json", latest)
        write_json(report_path, report)
        print(f"Official archive: {len(expected)} comics through #{latest['num']}; #404 intentionally absent.", flush=True)
        recent = set(expected[-RECENT:])
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            jobs = {pool.submit(download, n, n in recent): n for n in expected}
            for count, future in enumerate(as_completed(jobs), 1):
                try:
                    future.result()
                except Exception as error:
                    report["downloadErrors"].append({"num": jobs[future], "error": str(error)})
                    print(f"Download warning #{jobs[future]}: {error}", flush=True)
                if count % 100 == 0 or count == len(jobs):
                    print(f"Downloaded/cached {count}/{len(jobs)}", flush=True)
        # explain xkcd writes a new comic's transcript over its first hours or days: comics without one, the newest,
        # and those the wiki marks incomplete are asked again.
        wanted = expected if args.refresh_transcripts else sorted(recent | {n for n in expected if not (EXPLAIN / f"{n:04d}.json").exists()
                                                                            or INCOMPLETE.search(read_json(EXPLAIN / f"{n:04d}.json")["wikitext"])})
        try:
            found = fetch_transcripts(wanted)
            print(f"explain xkcd transcripts: {found} of {len(wanted)} checked are available.", flush=True)
        except Exception as error:
            report["transcriptErrors"].append({"error": str(error)})
            print(f"explain xkcd warning: {error}", flush=True)
        write_json(report_path, report)
    data = build(report)
    if data["missing"] or report.get("downloadErrors") or report.get("transcriptErrors"):
        raise SystemExit("Some items need another attempt; see data/sync-report.json. Rerunning resumes safely.")


if __name__ == "__main__":
    main()

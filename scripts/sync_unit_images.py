#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import html
import json
import mimetypes
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

USER_AGENT = "wh40k-unit-image-sync/1.0 (+https://github.com/surin77/wh40k)"
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
GOOGLE_IMAGE_SEARCH = "https://www.google.com/search?tbm=isch&q={query}"
RESOLVER_NAME = "warhammer_page_preview_v3"
SHARED_RESOLVER_NAME = "shared_unit_image_v1"
MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
}
GOOGLE_IMAGE_RESULT_RE = re.compile(
    r'<a href="(/url\?q=[^"]+)".*?<img class="DS1iW" alt="" src="([^"]+)".*?<span class="fYyStc">(.*?)</span>.*?<span class="fYyStc">(.*?)</span>',
    re.IGNORECASE | re.DOTALL,
)


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def canonicalize_search_text(text: str) -> str:
    return (
        str(text or "")
        .replace("’", "'")
        .replace("‘", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("–", "-")
        .replace("—", "-")
    )


def read_pipe_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="|")
        return [{str(k or "").strip(): str(v or "").strip() for k, v in row.items() if k} for row in reader]


def load_units(datasheets_csv: Path, factions_csv: Path) -> list[dict[str, object]]:
    faction_by_id = {row.get("id", ""): row.get("name", "") for row in read_pipe_rows(factions_csv)}
    units_by_key: dict[str, dict[str, object]] = {}

    for row in read_pipe_rows(datasheets_csv):
        unit_id = row.get("id", "").strip()
        unit_name = row.get("name", "").strip()
        faction_id = row.get("faction_id", "").strip()
        if not unit_id or not unit_name:
            continue

        faction_name = faction_by_id.get(faction_id) or faction_id or "Unknown"
        unit_key = f"{normalize(faction_name)}::{normalize(unit_name)}"
        entry = units_by_key.setdefault(
            unit_key,
            {
                "unit_key": unit_key,
                "unit_name": unit_name,
                "faction_name": faction_name,
                "datasheet_ids": [],
            },
        )
        if unit_id not in entry["datasheet_ids"]:
            entry["datasheet_ids"].append(unit_id)

    return sorted(units_by_key.values(), key=lambda item: (str(item["faction_name"]), str(item["unit_name"])))


def load_aliases(path: Path) -> dict[str, dict[str, object]]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    raw_entries = payload.get("entries", payload)
    aliases: dict[str, dict[str, object]] = {}
    if not isinstance(raw_entries, dict):
        return aliases
    for unit_key, config in raw_entries.items():
        if not isinstance(config, dict):
            continue
        aliases[str(unit_key).strip()] = config
    return aliases


def fetch_text(url: str, timeout: int) -> str:
    command = [
        "curl",
        "-A",
        BROWSER_USER_AGENT,
        "-L",
        "-sS",
        "--compressed",
        "--max-time",
        str(max(5, timeout)),
        "-H",
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        "-H",
        "Referer: https://www.warhammer.com/",
        url,
    ]
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=max(5, timeout) + 2,
    )
    return completed.stdout


def fetch_bytes(url: str, timeout: int) -> tuple[bytes, str]:
    host = urllib.parse.urlparse(url).netloc.lower()
    referer = "https://www.google.com/" if host.endswith("gstatic.com") or host.endswith("googleusercontent.com") else "https://www.warhammer.com/"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": BROWSER_USER_AGENT,
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": referer,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), str(response.headers.get("Content-Type", "")).split(";")[0].strip().lower()


def strip_tags(value: str) -> str:
    return re.sub(r"<[^>]+>", "", html.unescape(value or "")).strip()


def decode_search_href(href: str) -> str:
    decoded = html.unescape(href or "").strip()
    if not decoded:
        return ""
    if decoded.startswith("//"):
        decoded = f"https:{decoded}"

    parsed = urllib.parse.urlparse(decoded)
    if parsed.path == "/url":
        target = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
        return urllib.parse.unquote(target)

    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = urllib.parse.parse_qs(parsed.query).get("uddg", [""])[0]
        return urllib.parse.unquote(target)

    if "google." in parsed.netloc and parsed.path == "/url":
        target = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
        return urllib.parse.unquote(target)

    return decoded


def is_official_result(url: str) -> bool:
    if not url:
        return False
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    if not host:
        return False
    return host == "warhammer.com" or host.endswith(".warhammer.com")


def fetch_google_image_search_html(query: str, timeout: int) -> str:
    url = GOOGLE_IMAGE_SEARCH.format(query=urllib.parse.quote_plus(query))
    command = ["curl", "-A", BROWSER_USER_AGENT, "-L", "-sS", "--max-time", str(max(5, timeout)), url]
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=max(5, timeout) + 2,
    )
    return completed.stdout


def parse_google_image_results(page_html: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw_href, raw_image_url, raw_title, raw_domain in GOOGLE_IMAGE_RESULT_RE.findall(page_html):
        page_url = decode_search_href(raw_href)
        image_url = html.unescape(raw_image_url or "").strip()
        title = strip_tags(raw_title)
        source_host = strip_tags(raw_domain).lower()
        if not page_url or not image_url:
            continue
        key = (page_url, image_url)
        if key in seen:
            continue
        seen.add(key)
        results.append(
            {
                "url": page_url,
                "title": title,
                "image_url": image_url,
                "source_host": source_host,
                "engine": "google_images",
            }
        )
    return results


def score_result(result: dict[str, str], unit_name: str, faction_name: str) -> int:
    haystack = normalize(f"{result.get('title', '')} {result.get('url', '')} {result.get('source_host', '')}")
    score = 0

    unit_key = normalize(unit_name)
    faction_key = normalize(faction_name)
    if is_official_result(str(result.get("url", ""))):
        score += 50
    if unit_key and unit_key in haystack:
        score += 8
    if faction_key and faction_key in haystack:
        score += 3

    path = urllib.parse.urlparse(result.get("url", "")).path.lower()
    if "/shop/" in path:
        score += 4
    if "warhammer-40000" in path:
        score += 2
    if any(fragment in path for fragment in ["/search", "/contact-us", "/home"]):
        score -= 3
    return score


def search_candidates_with_queries(
    queries: list[str],
    unit_name: str,
    faction_name: str,
    timeout: int,
) -> list[tuple[str, list[dict[str, str]]]]:
    yielded: list[tuple[str, list[dict[str, str]]]] = []
    for query in queries:
        results: list[dict[str, str]] = []

        try:
            results.extend(parse_google_image_results(fetch_google_image_search_html(query, timeout=timeout)))
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
            pass

        deduped: dict[str, dict[str, str]] = {}
        for result in results:
            url = result.get("url", "")
            if url and url not in deduped:
                deduped[url] = result

        ranked = sorted(
            deduped.values(),
            key=lambda result: score_result(result, unit_name=unit_name, faction_name=faction_name),
            reverse=True,
        )
        yielded.append((query, ranked[:4]))

    return yielded


def search_candidates(unit_name: str, faction_name: str, timeout: int) -> list[tuple[str, list[dict[str, str]]]]:
    unit = {"unit_name": unit_name, "faction_name": faction_name}
    return search_candidates_with_queries(alias_search_queries(unit, None), unit_name, faction_name, timeout)


def extract_meta_content(page_html: str, attr_name: str, attr_value: str) -> str:
    pattern = re.compile(
        rf'<meta[^>]+{attr_name}=["\']{re.escape(attr_value)}["\'][^>]+content=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    match = pattern.search(page_html)
    if match:
        return html.unescape(match.group(1)).strip()

    reverse_pattern = re.compile(
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+{attr_name}=["\']{re.escape(attr_value)}["\']',
        re.IGNORECASE,
    )
    reverse_match = reverse_pattern.search(page_html)
    if reverse_match:
        return html.unescape(reverse_match.group(1)).strip()
    return ""


def is_not_found_page(page_html: str) -> bool:
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page_html)
    if not match:
        return False
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return False
    return str(payload.get("page", "")).strip() == "/404"


def extract_tag_attr(tag_html: str, attr_name: str) -> str:
    match = re.search(rf'{re.escape(attr_name)}="([^"]*)"', tag_html, re.IGNORECASE)
    if not match:
        return ""
    return html.unescape(match.group(1)).strip().replace("\\/", "/")


def extract_page_preview(page_url: str, timeout: int) -> tuple[str, str]:
    page_html = fetch_text(page_url, timeout=timeout)
    if is_not_found_page(page_html):
        return "", ""
    image_url = extract_meta_content(page_html, "property", "og:image") or extract_meta_content(
        page_html, "name", "twitter:image"
    )
    title = extract_meta_content(page_html, "property", "og:title")
    if not title:
        title_match = re.search(r"<title>(.*?)</title>", page_html, re.IGNORECASE | re.DOTALL)
        title = strip_tags(title_match.group(1)) if title_match else ""
    if not image_url:
        carousel_candidates: list[tuple[int, str]] = []
        for tag_html in re.findall(r"<img\b[^>]*>", page_html, re.IGNORECASE):
            lower_tag = tag_html.lower()
            if "image-carousel" not in lower_tag and "product-gallery" not in lower_tag:
                continue
            src = extract_tag_attr(tag_html, "src")
            alt = extract_tag_attr(tag_html, "alt")
            if not src or not alt:
                continue
            base_src = src.split("?", 1)[0]
            if not page_matches_unit(base_src, alt, title):
                continue
            score = 0
            if "image-carousel-desktop-image" in lower_tag:
                score += 10
            if "view 1" in alt.lower():
                score += 6
            if "/920x950/" in base_src.lower():
                score += 5
            carousel_candidates.append((score, base_src))

        if carousel_candidates:
            carousel_candidates.sort(key=lambda item: item[0], reverse=True)
            image_url = carousel_candidates[0][1]

    if not image_url:
        image_candidates: list[tuple[int, str]] = []
        seen: set[str] = set()
        title_key = normalize(title)
        title_tokens = [normalize(token) for token in re.split(r"[^a-zA-Z0-9]+", title) if len(normalize(token)) >= 5]
        for raw_url, raw_label in re.findall(r'"url":"([^"]+)","label":"([^"]+)"', page_html):
            candidate_url = html.unescape(raw_url or "").strip().replace("\\/", "/")
            candidate_label = html.unescape(raw_label or "").strip().lower()
            if not candidate_url or candidate_url in seen:
                continue
            seen.add(candidate_url)
            lower_candidate = candidate_url.lower()
            if "/app/resources/catalog/product/" not in lower_candidate:
                continue
            if "/threesixty/" in lower_candidate:
                continue

            candidate_haystack = normalize(candidate_url)
            matched_tokens = sum(1 for token in title_tokens if token in candidate_haystack)
            if title_key and title_key in candidate_haystack:
                matched_tokens += 3
            if matched_tokens <= 0:
                continue

            score = 0
            if "/920x950/" in lower_candidate:
                score += 8
            if "lead" in lower_candidate:
                score += 12
            if candidate_label == "image":
                score += 4
            score += matched_tokens * 5
            image_candidates.append((score, candidate_url))

        if image_candidates:
            image_candidates.sort(key=lambda item: item[0], reverse=True)
            image_url = image_candidates[0][1]
    if not image_url:
        return "", title
    return urllib.parse.urljoin(page_url, image_url), title


def is_usable_image_url(image_url: str) -> bool:
    lower_image_url = str(image_url or "").strip().lower()
    if not lower_image_url:
        return False
    return not any(fragment in lower_image_url for fragment in ["logo", "favicon", "icon"])


def page_matches_unit(page_url: str, page_title: str, unit_name: str) -> bool:
    return page_matches_any(page_url, page_title, [unit_name])


def page_matches_any(page_url: str, page_title: str, names: list[str]) -> bool:
    haystack = normalize(f"{page_title} {page_url}")
    if not haystack:
        return False

    for name in names:
        unit_key = normalize(name)
        if not unit_key:
            continue
        if unit_key in haystack:
            return True

        tokens = [normalize(token) for token in re.split(r"[^a-zA-Z0-9]+", str(name)) if len(normalize(token)) >= 4]
        if not tokens:
            continue
        matched = sum(1 for token in tokens if token in haystack)
        if len(tokens) == 1 and matched == 1:
            return True
        if len(tokens) > 1 and matched >= max(2, len(tokens) - 1):
            return True
    return False


def alias_match_terms(unit: dict[str, object], alias: dict[str, object] | None) -> list[str]:
    terms = [str(unit.get("unit_name", "")).strip()]
    if not alias:
        return [term for term in terms if term]
    for key in ["match_terms", "title_aliases", "name_aliases"]:
        value = alias.get(key, [])
        if isinstance(value, list):
            for item in value:
                term = str(item or "").strip()
                if term and term not in terms:
                    terms.append(term)
    return terms


def alias_page_urls(alias: dict[str, object] | None) -> list[str]:
    if not alias:
        return []
    urls: list[str] = []
    page_url = str(alias.get("page_url", "")).strip()
    if page_url:
        urls.append(page_url)
    value = alias.get("page_urls", [])
    if isinstance(value, list):
        for item in value:
            url = str(item or "").strip()
            if url and url not in urls:
                urls.append(url)
    return urls


def alias_search_queries(unit: dict[str, object], alias: dict[str, object] | None) -> list[str]:
    unit_name = canonicalize_search_text(str(unit.get("unit_name", "")).strip())
    faction_name = canonicalize_search_text(str(unit.get("faction_name", "")).strip())
    queries: list[str] = []
    if alias:
        value = alias.get("search_queries", [])
        if isinstance(value, list):
            for item in value:
                query = str(item or "").strip()
                if query and query not in queries:
                    queries.append(canonicalize_search_text(query))

    defaults = [
        f"warhammer.com {unit_name}",
        f"warhammer.com {unit_name} {faction_name}",
        f'warhammer.com "{unit_name}" "{faction_name}"',
        f'warhammer.com "{unit_name}" "Warhammer 40000"',
    ]
    for query in defaults:
        query = canonicalize_search_text(query)
        if query and query not in queries:
            queries.append(query)
    return queries


def asset_basename(unit_key: str) -> str:
    return unit_key.replace("::", "__")


def relative_asset_path(path: Path, web_root: Path) -> str:
    return path.relative_to(web_root).as_posix()


def resolve_local_asset(entry: dict[str, object], web_root: Path) -> Path | None:
    local_path = str(entry.get("local_path", "")).strip()
    if not local_path:
        return None
    candidate = web_root / local_path
    if candidate.exists() and candidate.is_file() and candidate.stat().st_size > 0:
        return candidate
    return None


def guess_extension(image_url: str, content_type: str) -> str:
    ext = MIME_TO_EXT.get((content_type or "").lower(), "")
    if ext:
        return ext

    suffix = Path(urllib.parse.urlparse(image_url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}:
        return ".jpg" if suffix == ".jpeg" else suffix

    guessed = mimetypes.guess_extension(content_type or "")
    if guessed in {".jpe", ".jpeg"}:
        return ".jpg"
    if guessed in {".jpg", ".png", ".webp", ".gif", ".avif"}:
        return guessed
    return ".jpg"


def cache_image(image_url: str, unit_key: str, assets_dir: Path, web_root: Path, timeout: int) -> str:
    body, content_type = fetch_bytes(image_url, timeout=timeout)
    if (content_type and not content_type.startswith("image/")) or body[:64].lstrip().startswith(b"<"):
        raise ValueError(f"Unexpected image response content type: {content_type or 'unknown'}")
    ext = guess_extension(image_url, content_type)
    basename = asset_basename(unit_key)

    assets_dir.mkdir(parents=True, exist_ok=True)
    for old_file in assets_dir.glob(f"{basename}.*"):
        if old_file.suffix.lower() != ext:
            old_file.unlink(missing_ok=True)

    target = assets_dir / f"{basename}{ext}"
    target.write_bytes(body)
    return relative_asset_path(target, web_root)


def refresh_existing_official_preview(
    entry: dict[str, object],
    timeout: int,
    match_terms: list[str] | None = None,
) -> dict[str, object] | None:
    page_url = str(entry.get("source_page_url", "")).strip()
    if not is_official_result(page_url):
        return None

    image_url, page_title = extract_page_preview(page_url, timeout=timeout)
    if not is_usable_image_url(image_url):
        return None
    if not page_matches_any(page_url, page_title, match_terms or [str(entry.get("unit_name", ""))]):
        return None

    refreshed = dict(entry)
    refreshed["resolver"] = RESOLVER_NAME
    refreshed["status"] = "ok"
    refreshed["image_url"] = image_url
    refreshed["updated_at_utc"] = utcnow_iso()
    refreshed["error"] = ""
    if page_title:
        refreshed["source_page_title"] = page_title
    return refreshed


def hydrate_entry(entry: dict[str, object], unit: dict[str, object]) -> dict[str, object]:
    hydrated = dict(entry)
    hydrated["unit_key"] = unit["unit_key"]
    hydrated["unit_name"] = unit["unit_name"]
    hydrated["faction_name"] = unit["faction_name"]
    hydrated["datasheet_ids"] = unit["datasheet_ids"]
    return hydrated


def make_placeholder_entry(unit: dict[str, object], status: str = "pending", error: str = "") -> dict[str, object]:
    return {
        "unit_key": unit["unit_key"],
        "unit_name": unit["unit_name"],
        "faction_name": unit["faction_name"],
        "datasheet_ids": unit["datasheet_ids"],
        "resolver": RESOLVER_NAME,
        "status": status,
        "lookup_query": f"warhammer.com {unit['unit_name']}",
        "source_page_url": "",
        "source_page_title": "",
        "image_url": "",
        "local_path": "",
        "updated_at_utc": utcnow_iso() if status != "pending" else "",
        "search_engine": "",
        "error": error,
    }


def cleanup_stale_assets(entries: list[dict[str, object]], assets_dir: Path, web_root: Path) -> None:
    if not assets_dir.exists():
        return
    keep = {
        resolve_local_asset(entry, web_root).name
        for entry in entries
        if entry.get("status") == "ok" and resolve_local_asset(entry, web_root) is not None
    }
    keep.add(".gitkeep")
    for file_path in assets_dir.iterdir():
        if not file_path.is_file():
            continue
        if file_path.name not in keep:
            file_path.unlink(missing_ok=True)


def load_existing_entries(out_path: Path) -> dict[str, dict[str, object]]:
    if not out_path.exists():
        return {}
    try:
        payload = json.loads(out_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    entries: dict[str, dict[str, object]] = {}
    for entry in payload.get("entries", []):
        key = str(entry.get("unit_key", "")).strip()
        if key:
            entries[key] = entry
    return entries


def parse_utc(value: str) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def should_refresh(entry: dict[str, object], refresh_after: timedelta, retry_after: timedelta) -> bool:
    resolver = str(entry.get("resolver", "")).strip()
    if resolver not in {RESOLVER_NAME, SHARED_RESOLVER_NAME}:
        return True
    updated = parse_utc(str(entry.get("updated_at_utc", "")))
    if updated is None:
        return True
    age = datetime.now(timezone.utc) - updated
    if str(entry.get("status", "")) == "ok":
        return age >= refresh_after
    return age >= retry_after


def entry_rank(entry: dict[str, object]) -> tuple[int, int]:
    resolver = str(entry.get("resolver", "")).strip()
    if resolver == RESOLVER_NAME:
        priority = 3
    elif resolver == SHARED_RESOLVER_NAME:
        priority = 2
    elif str(entry.get("status", "")) == "ok":
        priority = 1
    else:
        priority = 0
    updated = parse_utc(str(entry.get("updated_at_utc", "")))
    updated_ts = int(updated.timestamp()) if updated else 0
    return priority, updated_ts


def clone_shared_entry(source: dict[str, object], unit: dict[str, object]) -> dict[str, object]:
    return {
        "unit_key": unit["unit_key"],
        "unit_name": unit["unit_name"],
        "faction_name": unit["faction_name"],
        "datasheet_ids": unit["datasheet_ids"],
        "resolver": SHARED_RESOLVER_NAME,
        "status": "ok",
        "lookup_query": str(source.get("lookup_query", "")).strip(),
        "source_page_url": str(source.get("source_page_url", "")).strip(),
        "source_page_title": str(source.get("source_page_title", "")).strip(),
        "image_url": str(source.get("image_url", "")).strip(),
        "local_path": str(source.get("local_path", "")).strip(),
        "updated_at_utc": utcnow_iso(),
        "search_engine": str(source.get("search_engine", "")).strip(),
        "shared_from_unit_key": str(source.get("unit_key", "")).strip(),
        "error": "",
    }


def find_shared_entry(
    unit: dict[str, object],
    entries_by_key: dict[str, dict[str, object]],
    alias: dict[str, object] | None,
) -> dict[str, object] | None:
    candidate_keys = {normalize(str(unit.get("unit_name", "")))}
    if alias:
        shared_names = alias.get("shared_names", [])
        if isinstance(shared_names, list):
            for item in shared_names:
                normalized = normalize(str(item or ""))
                if normalized:
                    candidate_keys.add(normalized)
        shared_from_keys = alias.get("shared_from_unit_keys", [])
        if isinstance(shared_from_keys, list):
            candidates = [entries_by_key.get(str(item).strip()) for item in shared_from_keys]
            valid = [entry for entry in candidates if entry and entry.get("status") == "ok"]
            if valid:
                return max(valid, key=entry_rank)

    best: dict[str, object] | None = None
    own_key = str(unit.get("unit_key", "")).strip()
    for key, entry in entries_by_key.items():
        if key == own_key or str(entry.get("status", "")) != "ok":
            continue
        if not (str(entry.get("local_path", "")).strip() or str(entry.get("image_url", "")).strip()):
            continue
        if normalize(str(entry.get("unit_name", ""))) not in candidate_keys:
            continue
        if best is None or entry_rank(entry) > entry_rank(best):
            best = entry
    return best


def lookup_unit_image(
    unit: dict[str, object],
    timeout: int,
    delay_seconds: float,
    alias: dict[str, object] | None = None,
) -> tuple[dict[str, object], bool]:
    unit_name = str(unit["unit_name"])
    faction_name = str(unit["faction_name"])
    datasheet_ids = list(unit["datasheet_ids"])
    lookup_query = f"warhammer.com {canonicalize_search_text(unit_name)}"
    last_error = ""
    match_terms = alias_match_terms(unit, alias)

    for page_url in alias_page_urls(alias):
        try:
            image_url, page_title = extract_page_preview(page_url, timeout=timeout)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
            last_error = str(error)
            continue
        if not is_usable_image_url(image_url):
            continue
        if not page_matches_any(page_url, page_title, match_terms):
            continue
        return (
            {
                "unit_key": unit["unit_key"],
                "unit_name": unit_name,
                "faction_name": faction_name,
                "datasheet_ids": datasheet_ids,
                "resolver": RESOLVER_NAME,
                "status": "ok",
                "lookup_query": page_url,
                "source_page_url": page_url,
                "source_page_title": page_title,
                "image_url": image_url,
                "updated_at_utc": utcnow_iso(),
                "search_engine": "alias_page",
            },
            False,
        )

    for query, candidates in search_candidates_with_queries(alias_search_queries(unit, alias), unit_name, faction_name, timeout):
        if query:
            lookup_query = query
        for candidate in candidates:
            page_url = str(candidate.get("url", "")).strip()
            candidate_image_url = str(candidate.get("image_url", "")).strip()
            image_url = ""
            page_title = str(candidate.get("title", "")).strip()

            if is_official_result(page_url):
                try:
                    page_image_url, extracted_title = extract_page_preview(page_url, timeout=timeout)
                    if is_usable_image_url(page_image_url):
                        image_url = page_image_url
                    if extracted_title:
                        page_title = extracted_title
                except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
                    last_error = str(error)

                if not image_url:
                    continue

            if not page_matches_any(page_url, page_title or str(candidate.get("title", "")).strip(), match_terms):
                continue

            if not image_url and is_usable_image_url(candidate_image_url):
                image_url = candidate_image_url

            if not image_url:
                continue

            return (
                {
                    "unit_key": unit["unit_key"],
                    "unit_name": unit_name,
                    "faction_name": faction_name,
                    "datasheet_ids": datasheet_ids,
                    "resolver": RESOLVER_NAME,
                    "status": "ok",
                    "lookup_query": lookup_query,
                    "source_page_url": page_url,
                    "source_page_title": page_title,
                    "image_url": image_url,
                    "updated_at_utc": utcnow_iso(),
                    "search_engine": candidate.get("engine", ""),
                },
                False,
            )

        if delay_seconds > 0:
            time.sleep(delay_seconds)

    return (
        {
            "unit_key": unit["unit_key"],
            "unit_name": unit_name,
            "faction_name": faction_name,
            "datasheet_ids": datasheet_ids,
            "resolver": RESOLVER_NAME,
            "status": "not_found" if not last_error else "error",
            "lookup_query": lookup_query,
            "source_page_url": "",
            "source_page_title": "",
            "image_url": "",
            "updated_at_utc": utcnow_iso(),
            "search_engine": "",
            "error": last_error,
        },
        bool(last_error),
    )


def build_payload(entries: list[dict[str, object]], lookups_performed: int) -> dict[str, object]:
    ok_count = sum(1 for entry in entries if entry.get("status") == "ok")
    cached_count = sum(1 for entry in entries if entry.get("status") == "ok" and entry.get("local_path"))
    return {
        "source": "warhammer.com page preview images discovered via Google Images search",
        "resolver": RESOLVER_NAME,
        "query_template": "warhammer.com {unit_name}",
        "generated_at_utc": utcnow_iso(),
        "entries_with_images": ok_count,
        "entries_with_local_cache": cached_count,
        "lookups_performed": lookups_performed,
        "entries": entries,
    }


def ordered_entries(entries_by_key: dict[str, dict[str, object]], units: list[dict[str, object]]) -> list[dict[str, object]]:
    ordered: list[dict[str, object]] = []
    for unit in units:
        key = str(unit["unit_key"])
        entry = entries_by_key.get(key)
        if entry is not None:
            ordered.append(entry)
    return ordered


def write_state(
    *,
    entries_by_key: dict[str, dict[str, object]],
    units: list[dict[str, object]],
    out_path: Path,
    assets_dir: Path,
    web_root: Path,
    lookups_performed: int,
    cleanup: bool,
) -> list[dict[str, object]]:
    entries = ordered_entries(entries_by_key, units)
    payload = build_payload(entries, lookups_performed=lookups_performed)
    if cleanup:
        cleanup_stale_assets(entries, assets_dir=assets_dir, web_root=web_root)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    return entries


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resolve unit preview images from official warhammer.com pages")
    parser.add_argument("--web-root", default="docs", help="Web root directory used to build relative asset paths")
    parser.add_argument("--datasheets", default="docs/data/Datasheets.csv", help="Path to Datasheets.csv")
    parser.add_argument("--factions", default="docs/data/Factions.csv", help="Path to Factions.csv")
    parser.add_argument("--out", default="docs/data/unit_images.json", help="Output JSON path")
    parser.add_argument(
        "--assets-dir",
        default="docs/assets/unit-previews",
        help="Directory for cached preview images",
    )
    parser.add_argument("--aliases", default="docs/data/unit_image_aliases.json", help="Optional image alias config JSON")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout in seconds")
    parser.add_argument("--max-lookups", type=int, default=60, help="Maximum refreshed/missing lookups per run")
    parser.add_argument("--delay-seconds", type=float, default=0.4, help="Delay between search attempts")
    parser.add_argument(
        "--refresh-days",
        type=int,
        default=90,
        help="Refresh successful image entries after this many days",
    )
    parser.add_argument(
        "--retry-days",
        type=int,
        default=14,
        help="Retry missing/error entries after this many days",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=10,
        help="Write partial manifest after this many lookups (0 disables checkpoints)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    web_root = Path(args.web_root)
    datasheets_path = Path(args.datasheets)
    factions_path = Path(args.factions)
    out_path = Path(args.out)
    assets_dir = Path(args.assets_dir)
    aliases_path = Path(args.aliases)

    units = load_units(datasheets_path, factions_path)
    existing_entries = load_existing_entries(out_path)
    aliases = load_aliases(aliases_path)
    refresh_after = timedelta(days=max(1, args.refresh_days))
    retry_after = timedelta(days=max(1, args.retry_days))

    entries_by_key: dict[str, dict[str, object]] = {}
    lookups_performed = 0

    for unit in units:
        key = str(unit["unit_key"])
        previous = existing_entries.get(key)
        entries_by_key[key] = hydrate_entry(previous, unit) if previous else make_placeholder_entry(unit)

    try:
        for unit in units:
            key = str(unit["unit_key"])
            previous = existing_entries.get(key)
            previous_hydrated = hydrate_entry(previous, unit) if previous else None
            alias = aliases.get(key)
            match_terms = alias_match_terms(unit, alias)
            if previous_hydrated:
                source_title = str(previous_hydrated.get("source_page_title", "")).strip()
                if source_title and source_title not in match_terms:
                    match_terms.append(source_title)

            try:
                has_local_cache = bool(previous_hydrated and resolve_local_asset(previous_hydrated, web_root))
                needs_refresh = previous_hydrated is None or should_refresh(
                    previous_hydrated, refresh_after=refresh_after, retry_after=retry_after
                )
                alias_overrides = bool(
                    alias_page_urls(alias)
                    or (isinstance(alias, dict) and alias.get("search_queries"))
                    or (isinstance(alias, dict) and alias.get("shared_names"))
                    or (isinstance(alias, dict) and alias.get("shared_from_unit_keys"))
                )

                if previous_hydrated is None or previous_hydrated.get("status") != "ok":
                    shared_entry = find_shared_entry(unit, entries_by_key, alias)
                    if shared_entry:
                        entries_by_key[key] = clone_shared_entry(shared_entry, unit)
                        continue

                if previous_hydrated and previous_hydrated.get("status") != "ok" and alias_overrides:
                    needs_refresh = True

                if previous_hydrated and not needs_refresh and (previous_hydrated.get("status") != "ok" or has_local_cache):
                    entries_by_key[key] = previous_hydrated
                    continue

                if previous_hydrated and previous_hydrated.get("status") == "ok" and previous_hydrated.get("image_url") and not has_local_cache:
                    try:
                        previous_hydrated["local_path"] = cache_image(
                            image_url=str(previous_hydrated["image_url"]),
                            unit_key=key,
                            assets_dir=assets_dir,
                            web_root=web_root,
                            timeout=args.timeout,
                        )
                        previous_hydrated["updated_at_utc"] = utcnow_iso()
                        entries_by_key[key] = previous_hydrated
                        continue
                    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
                        pass

                if previous_hydrated and previous_hydrated.get("status") == "ok" and is_official_result(
                    str(previous_hydrated.get("source_page_url", ""))
                ):
                    if lookups_performed >= args.max_lookups:
                        entries_by_key[key] = previous_hydrated
                        continue

                    lookups_performed += 1
                    try:
                        refreshed_entry = refresh_existing_official_preview(
                            previous_hydrated,
                            timeout=args.timeout,
                            match_terms=match_terms,
                        )
                        if refreshed_entry and refreshed_entry.get("image_url"):
                            refreshed_entry["local_path"] = cache_image(
                                image_url=str(refreshed_entry["image_url"]),
                                unit_key=key,
                                assets_dir=assets_dir,
                                web_root=web_root,
                                timeout=args.timeout,
                            )
                            entries_by_key[key] = refreshed_entry
                        else:
                            entries_by_key[key] = previous_hydrated
                        if args.checkpoint_every > 0 and lookups_performed % args.checkpoint_every == 0:
                            write_state(
                                entries_by_key=entries_by_key,
                                units=units,
                                out_path=out_path,
                                assets_dir=assets_dir,
                                web_root=web_root,
                                lookups_performed=lookups_performed,
                                cleanup=False,
                            )
                        continue
                    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
                        entries_by_key[key] = previous_hydrated
                        continue

                if lookups_performed >= args.max_lookups:
                    entries_by_key[key] = previous_hydrated or make_placeholder_entry(unit)
                    continue

                entry, had_error = lookup_unit_image(
                    unit,
                    timeout=args.timeout,
                    delay_seconds=args.delay_seconds,
                    alias=alias,
                )
                lookups_performed += 1

                if had_error and previous_hydrated and previous_hydrated.get("status") == "ok":
                    entries_by_key[key] = previous_hydrated
                    continue

                if entry.get("status") == "ok" and entry.get("image_url"):
                    try:
                        entry["local_path"] = cache_image(
                            image_url=str(entry["image_url"]),
                            unit_key=key,
                            assets_dir=assets_dir,
                            web_root=web_root,
                            timeout=args.timeout,
                        )
                    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
                        entry["status"] = "error"
                        entry["error"] = str(error)
                        entry["local_path"] = ""

                if previous_hydrated and previous_hydrated.get("status") == "ok" and entry.get("status") != "ok":
                    entries_by_key[key] = previous_hydrated
                    continue

                entries_by_key[key] = entry
                if args.checkpoint_every > 0 and lookups_performed % args.checkpoint_every == 0:
                    write_state(
                        entries_by_key=entries_by_key,
                        units=units,
                        out_path=out_path,
                        assets_dir=assets_dir,
                        web_root=web_root,
                        lookups_performed=lookups_performed,
                        cleanup=False,
                    )
            except Exception as error:
                if previous_hydrated:
                    entries_by_key[key] = previous_hydrated
                else:
                    entries_by_key[key] = make_placeholder_entry(unit, status="error", error=str(error))
    except KeyboardInterrupt:
        entries = write_state(
            entries_by_key=entries_by_key,
            units=units,
            out_path=out_path,
            assets_dir=assets_dir,
            web_root=web_root,
            lookups_performed=lookups_performed,
            cleanup=False,
        )
        ok_count = sum(1 for entry in entries if entry.get("status") == "ok")
        cached_count = sum(1 for entry in entries if entry.get("status") == "ok" and entry.get("local_path"))
        print(f"Checkpointed {out_path} with {ok_count} image entries, {cached_count} cached locally ({lookups_performed} lookups)")
        raise

    entries = write_state(
        entries_by_key=entries_by_key,
        units=units,
        out_path=out_path,
        assets_dir=assets_dir,
        web_root=web_root,
        lookups_performed=lookups_performed,
        cleanup=True,
    )

    ok_count = sum(1 for entry in entries if entry.get("status") == "ok")
    cached_count = sum(1 for entry in entries if entry.get("status") == "ok" and entry.get("local_path"))
    print(f"Wrote {out_path} with {ok_count} image entries, {cached_count} cached locally ({lookups_performed} lookups)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

USER_AGENT = "wh40k-unit-image-sync/1.0 (+https://github.com/surin77/wh40k)"
DDG_HTML_SEARCH = "https://html.duckduckgo.com/html/?q={query}"
BING_SEARCH = "https://www.bing.com/search?q={query}"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


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


def fetch_text(url: str, timeout: int) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def strip_tags(value: str) -> str:
    return re.sub(r"<[^>]+>", "", html.unescape(value or "")).strip()


def decode_search_href(href: str) -> str:
    decoded = html.unescape(href or "").strip()
    if not decoded:
        return ""
    if decoded.startswith("//"):
        decoded = f"https:{decoded}"

    parsed = urllib.parse.urlparse(decoded)
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


def parse_ddg_results(page_html: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    pattern = re.compile(
        r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        re.IGNORECASE | re.DOTALL,
    )
    for raw_href, raw_title in pattern.findall(page_html):
        url = decode_search_href(raw_href)
        if not is_official_result(url):
            continue
        results.append({"url": url, "title": strip_tags(raw_title), "engine": "duckduckgo"})
    return results


def parse_bing_results(page_html: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    pattern = re.compile(
        r'<li[^>]+class="[^"]*b_algo[^"]*"[^>]*>.*?<h2><a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        re.IGNORECASE | re.DOTALL,
    )
    for raw_href, raw_title in pattern.findall(page_html):
        url = decode_search_href(raw_href)
        if not is_official_result(url):
            continue
        results.append({"url": url, "title": strip_tags(raw_title), "engine": "bing"})
    return results


def score_result(result: dict[str, str], unit_name: str, faction_name: str) -> int:
    haystack = normalize(f"{result.get('title', '')} {result.get('url', '')}")
    score = 0

    unit_key = normalize(unit_name)
    faction_key = normalize(faction_name)
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


def search_candidates(unit_name: str, faction_name: str, timeout: int) -> list[tuple[str, list[dict[str, str]]]]:
    queries = [
        f'warhammer.com "{unit_name}" "{faction_name}" "Warhammer 40,000"',
        f'warhammer.com "{unit_name}" "Warhammer 40,000"',
        f'site:warhammer.com "{unit_name}" "{faction_name}"',
        f'site:warhammer.com "{unit_name}"',
    ]

    yielded: list[tuple[str, list[dict[str, str]]]] = []
    for query in queries:
        encoded = urllib.parse.quote_plus(query)
        results: list[dict[str, str]] = []

        try:
            results.extend(parse_ddg_results(fetch_text(DDG_HTML_SEARCH.format(query=encoded), timeout=timeout)))
        except urllib.error.URLError:
            pass
        except TimeoutError:
            pass

        if not results:
            try:
                results.extend(parse_bing_results(fetch_text(BING_SEARCH.format(query=encoded), timeout=timeout)))
            except urllib.error.URLError:
                pass
            except TimeoutError:
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


def extract_page_preview(page_url: str, timeout: int) -> tuple[str, str]:
    page_html = fetch_text(page_url, timeout=timeout)
    image_url = extract_meta_content(page_html, "property", "og:image") or extract_meta_content(
        page_html, "name", "twitter:image"
    )
    title = extract_meta_content(page_html, "property", "og:title")
    if not title:
        title_match = re.search(r"<title>(.*?)</title>", page_html, re.IGNORECASE | re.DOTALL)
        title = strip_tags(title_match.group(1)) if title_match else ""
    if not image_url:
        return "", title
    return urllib.parse.urljoin(page_url, image_url), title


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
    updated = parse_utc(str(entry.get("updated_at_utc", "")))
    if updated is None:
        return True
    age = datetime.now(timezone.utc) - updated
    if str(entry.get("status", "")) == "ok":
        return age >= refresh_after
    return age >= retry_after


def lookup_unit_image(
    unit: dict[str, object],
    timeout: int,
    delay_seconds: float,
) -> tuple[dict[str, object], bool]:
    unit_name = str(unit["unit_name"])
    faction_name = str(unit["faction_name"])
    datasheet_ids = list(unit["datasheet_ids"])
    lookup_query = f"warhammer.com {unit_name}"
    last_error = ""

    for query, candidates in search_candidates(unit_name, faction_name, timeout):
        if query:
            lookup_query = query
        for candidate in candidates:
            try:
                image_url, page_title = extract_page_preview(candidate["url"], timeout=timeout)
            except (urllib.error.URLError, TimeoutError, ValueError) as error:
                last_error = str(error)
                continue

            lower_image_url = image_url.lower()
            if not image_url or any(fragment in lower_image_url for fragment in ["logo", "favicon", "icon"]):
                continue

            return (
                {
                    "unit_key": unit["unit_key"],
                    "unit_name": unit_name,
                    "faction_name": faction_name,
                    "datasheet_ids": datasheet_ids,
                    "status": "ok",
                    "lookup_query": lookup_query,
                    "source_page_url": candidate["url"],
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
    return {
        "source": "Official warhammer.com image previews",
        "query_template": "warhammer.com {unit_name}",
        "generated_at_utc": utcnow_iso(),
        "entries_with_images": ok_count,
        "lookups_performed": lookups_performed,
        "entries": entries,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resolve unit preview images from official warhammer.com pages")
    parser.add_argument("--datasheets", default="docs/data/Datasheets.csv", help="Path to Datasheets.csv")
    parser.add_argument("--factions", default="docs/data/Factions.csv", help="Path to Factions.csv")
    parser.add_argument("--out", default="docs/data/unit_images.json", help="Output JSON path")
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
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    datasheets_path = Path(args.datasheets)
    factions_path = Path(args.factions)
    out_path = Path(args.out)

    units = load_units(datasheets_path, factions_path)
    existing_entries = load_existing_entries(out_path)
    refresh_after = timedelta(days=max(1, args.refresh_days))
    retry_after = timedelta(days=max(1, args.retry_days))

    entries: list[dict[str, object]] = []
    lookups_performed = 0

    for unit in units:
        key = str(unit["unit_key"])
        previous = existing_entries.get(key)

        if previous and not should_refresh(previous, refresh_after=refresh_after, retry_after=retry_after):
            carry = dict(previous)
            carry["unit_name"] = unit["unit_name"]
            carry["faction_name"] = unit["faction_name"]
            carry["datasheet_ids"] = unit["datasheet_ids"]
            entries.append(carry)
            continue

        if lookups_performed >= args.max_lookups:
            if previous:
                carry = dict(previous)
                carry["unit_name"] = unit["unit_name"]
                carry["faction_name"] = unit["faction_name"]
                carry["datasheet_ids"] = unit["datasheet_ids"]
                entries.append(carry)
            else:
                entries.append(
                    {
                        "unit_key": unit["unit_key"],
                        "unit_name": unit["unit_name"],
                        "faction_name": unit["faction_name"],
                        "datasheet_ids": unit["datasheet_ids"],
                        "status": "pending",
                        "lookup_query": f"warhammer.com {unit['unit_name']}",
                        "source_page_url": "",
                        "source_page_title": "",
                        "image_url": "",
                        "updated_at_utc": "",
                        "search_engine": "",
                        "error": "",
                    }
                )
            continue

        entry, had_error = lookup_unit_image(unit, timeout=args.timeout, delay_seconds=args.delay_seconds)
        lookups_performed += 1

        if had_error and previous and previous.get("status") == "ok":
            carry = dict(previous)
            carry["unit_name"] = unit["unit_name"]
            carry["faction_name"] = unit["faction_name"]
            carry["datasheet_ids"] = unit["datasheet_ids"]
            entries.append(carry)
            continue

        entries.append(entry)

    payload = build_payload(entries, lookups_performed=lookups_performed)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")

    ok_count = sum(1 for entry in entries if entry.get("status") == "ok")
    print(f"Wrote {out_path} with {ok_count} image entries ({lookups_performed} lookups)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

EXPORT_FILES = {
    "Abilities.csv": "https://wahapedia.ru/wh40k10ed/Abilities.csv",
    "Stratagems.csv": "https://wahapedia.ru/wh40k10ed/Stratagems.csv",
    "Enhancements.csv": "https://wahapedia.ru/wh40k10ed/Enhancements.csv",
    "Secondaries.csv": "https://wahapedia.ru/wh40k10ed/Secondaries.csv",
    "Datasheets_abilities.csv": "https://wahapedia.ru/wh40k10ed/Datasheets_abilities.csv",
    "Datasheets_models.csv": "https://wahapedia.ru/wh40k10ed/Datasheets_models.csv",
    "Datasheets_keywords.csv": "https://wahapedia.ru/wh40k10ed/Datasheets_keywords.csv",
    "Datasheets_wargear.csv": "https://wahapedia.ru/wh40k10ed/Datasheets_wargear.csv",
    "Datasheets_stratagems.csv": "https://wahapedia.ru/wh40k10ed/Datasheets_stratagems.csv",
    "Datasheets_enhancements.csv": "https://wahapedia.ru/wh40k10ed/Datasheets_enhancements.csv",
    "Datasheets_leader.csv": "https://wahapedia.ru/wh40k10ed/Datasheets_leader.csv",
    "Datasheets.csv": "https://wahapedia.ru/wh40k10ed/Datasheets.csv",
    "Detachment_abilities.csv": "https://wahapedia.ru/wh40k10ed/Detachment_abilities.csv",
    "Dataslates.csv": "https://wahapedia.ru/wh40k10ed/Dataslates.csv",
    "Factions.csv": "https://wahapedia.ru/wh40k10ed/Factions.csv",
    "Source.csv": "https://wahapedia.ru/wh40k10ed/Source.csv",
}

CORE_RULES_URL = "https://wahapedia.ru/wh40k10ed/the-rules/core-rules/"


class CoreRulesParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.entries: list[dict[str, str]] = []
        self._capture_tag: str | None = None
        self._buffer: list[str] = []
        self._started = False
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self._skip_depth += 1
            return
        if self._skip_depth > 0:
            return
        if tag in {"h1", "h2", "h3", "h4", "p", "li"}:
            self._capture_tag = tag
            self._buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if self._skip_depth > 0:
            return
        if self._capture_tag != tag:
            return

        raw = html.unescape("".join(self._buffer))
        text = re.sub(r"\s+", " ", raw).strip()
        self._capture_tag = None
        self._buffer = []
        if not text:
            return

        lowered = text.lower()
        if not self._started and "core rules" in lowered:
            self._started = True

        if not self._started:
            return
        if lowered in {"back to top", "contents"}:
            return

        if tag in {"h1", "h2", "h3", "h4"}:
            entry_type = "heading"
        elif tag == "li":
            entry_type = "bullet"
        else:
            entry_type = "paragraph"

        self.entries.append({"type": entry_type, "text": text})

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and self._capture_tag is not None:
            self._buffer.append(data)


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def read_file_hash(path: Path) -> str | None:
    if not path.exists():
        return None
    return sha256_bytes(path.read_bytes())


def fetch_bytes(url: str, timeout: int) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "wahapedia-sync-bot/1.0 (+https://github.com)",
            "Accept": "text/csv,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"Unexpected status {response.status} for {url}")
        return response.read()


def fetch_text(url: str, timeout: int) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "wahapedia-sync-bot/1.0 (+https://github.com)",
            "Accept": "text/html,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"Unexpected status {response.status} for {url}")
        return response.read().decode("utf-8", errors="replace")


def build_core_rules_payload(page_html: str) -> dict[str, object]:
    parser = CoreRulesParser()
    parser.feed(page_html)
    entries = parser.entries
    if not entries:
        raise RuntimeError("Could not parse core rules content from page HTML")

    page_title = entries[0]["text"] if entries and entries[0]["type"] == "heading" else "Core Rules"
    sections: list[dict[str, object]] = []
    current: dict[str, object] = {"title": page_title, "blocks": []}

    for item in entries[1:]:
        if item["type"] == "heading":
            if current["blocks"]:
                sections.append(current)
            current = {"title": item["text"], "blocks": []}
            continue
        current["blocks"].append(item)

    if current["blocks"]:
        sections.append(current)

    return {
        "source": "Wahapedia WH40k 10th Edition Core Rules",
        "source_url": CORE_RULES_URL,
        "updated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "page_title": page_title,
        "sections": sections,
    }


def has_existing_data(output_dir: Path) -> bool:
    for file_name in EXPORT_FILES:
        path = output_dir / file_name
        if path.exists() and path.stat().st_size > 0:
            return True
    return False


def sync_exports(
    output_dir: Path,
    timeout: int,
    retries: int,
    bootstrap_if_empty: bool,
) -> tuple[list[str], dict[str, dict[str, str]], bool, list[str], list[str]]:
    output_dir.mkdir(parents=True, exist_ok=True)

    bootstrap_run = bootstrap_if_empty and not has_existing_data(output_dir)
    changed: list[str] = []
    index: dict[str, dict[str, str]] = {}
    skipped_missing: list[str] = []
    warnings: list[str] = []

    for file_name, url in EXPORT_FILES.items():
        destination = output_dir / file_name
        previous_hash = read_file_hash(destination)

        last_error: Exception | None = None
        body: bytes | None = None

        for attempt in range(1, retries + 1):
            try:
                body = fetch_bytes(url, timeout=timeout)
                break
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    skipped_missing.append(file_name)
                    body = None
                    break
                last_error = error
                if attempt == retries:
                    raise RuntimeError(f"Failed to fetch {url}: {error}") from error
            except (urllib.error.URLError, TimeoutError, RuntimeError) as error:
                last_error = error
                if attempt == retries:
                    raise RuntimeError(f"Failed to fetch {url}: {error}") from error

        if body is None:
            if file_name in skipped_missing:
                # Upstream removed/renamed file: keep sync running for other datasets.
                local_file = output_dir / file_name
                if local_file.exists():
                    local_file.unlink()
                    changed.append(file_name)
                continue
            assert last_error is not None
            raise RuntimeError(f"Failed to fetch {url}: {last_error}")

        new_hash = sha256_bytes(body)
        should_write = bootstrap_run or new_hash != previous_hash
        if should_write:
            destination.write_bytes(body)
            changed.append(file_name)

        index[file_name] = {
            "url": url,
            "sha256": new_hash,
        }

    core_rules_destination = output_dir / "core_rules.json"
    previous_core_hash = read_file_hash(core_rules_destination)
    last_error: Exception | None = None
    core_html: str | None = None

    for attempt in range(1, retries + 1):
        try:
            core_html = fetch_text(CORE_RULES_URL, timeout=timeout)
            break
        except (urllib.error.URLError, TimeoutError, RuntimeError) as error:
            last_error = error
            if attempt == retries:
                warnings.append(f"Core rules sync failed: {error}")

    if core_html:
        core_payload = build_core_rules_payload(core_html)
        core_body = (json.dumps(core_payload, ensure_ascii=True, indent=2) + "\n").encode("utf-8")
        core_hash = sha256_bytes(core_body)
        if core_hash != previous_core_hash:
            core_rules_destination.write_bytes(core_body)
            changed.append("core_rules.json")
        index["core_rules.json"] = {
            "url": CORE_RULES_URL,
            "sha256": core_hash,
        }
    else:
        if previous_core_hash:
            index["core_rules.json"] = {
                "url": CORE_RULES_URL,
                "sha256": previous_core_hash,
            }
        if last_error and not warnings:
            warnings.append(f"Core rules sync failed: {last_error}")

    return changed, index, bootstrap_run, skipped_missing, warnings


def write_index(
    path: Path,
    index: dict[str, dict[str, str]],
    changed: list[str],
    bootstrap_run: bool,
    skipped_missing: list[str],
    warnings: list[str],
) -> None:
    payload = {
        "source": "Wahapedia WH40k 10th Edition Data Export",
        "updated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "bootstrap_run": bootstrap_run,
        "changed_files": changed,
        "skipped_missing_files": skipped_missing,
        "warnings": warnings,
        "files": index,
    }
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync Wahapedia WH40k CSV export files")
    parser.add_argument(
        "--output-dir",
        default="docs/data",
        help="Directory for exported CSV files (default: docs/data)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="HTTP timeout in seconds (default: 30)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Number of attempts per file (default: 3)",
    )
    parser.add_argument(
        "--bootstrap-if-empty",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Force initial full data fill when output directory has no non-empty CSV files (default: true)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)

    changed, index, bootstrap_run, skipped_missing, warnings = sync_exports(
        output_dir=output_dir,
        timeout=args.timeout,
        retries=args.retries,
        bootstrap_if_empty=args.bootstrap_if_empty,
    )
    write_index(
        output_dir / "index.json",
        index=index,
        changed=changed,
        bootstrap_run=bootstrap_run,
        skipped_missing=skipped_missing,
        warnings=warnings,
    )

    if bootstrap_run:
        print("Bootstrap mode: output directory was empty, performed initial full fill.")

    if changed:
        print("Changed files:")
        for name in changed:
            print(f" - {name}")
    else:
        print("No data changes detected.")

    if skipped_missing:
        print("Skipped missing upstream files (404):")
        for name in skipped_missing:
            print(f" - {name}")

    if warnings:
        print("Warnings:")
        for warning in warnings:
            print(f" - {warning}")

    print(f"Data written to: {output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

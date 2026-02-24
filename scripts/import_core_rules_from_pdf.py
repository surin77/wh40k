#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import Quartz


HEADING_RE = re.compile(r"^[A-Z0-9][A-Z0-9 \-–—'\",:+\(\)\[\]\/&\.]+$")
STRIP_PREFIX_RE = re.compile(r"^CORE RULES\s*\|\s*", re.I)
FOOTER_RE = re.compile(r"^\s*CORE RULES\s*\|\s*.+$", re.I)
SKIP_HEADINGS = {
    "CORE CONCEPTS",
    "THE BATTLE ROUND",
    "HINTS AND TIPS",
    "MISSIONS",
    "ARMIES",
    "UNITS",
    "DATASHEETS",
    "KEYWORDS",
    "EXAMPLE DATASHEET (PROFILES AND ABILITIES)",
    "EXAMPLE DATASHEET (WARGEAR AND COMPOSITION)",
    "RANGED WEAPONS RANGE A BS S AP D",
    "MELEE WEAPONS RANGE A WS S AP D",
}

TOOLTIP_RULE_HEADINGS = [
    "ASSAULT",
    "PISTOL",
    "RAPID FIRE",
    "IGNORES COVER",
    "TWIN-LINKED",
    "TORRENT",
    "LETHAL HITS",
    "LANCE",
    "INDIRECT FIRE",
    "PRECISION",
    "BLAST",
    "MELTA",
    "HEAVY",
    "HAZARDOUS",
    "DEVASTATING WOUNDS",
    "SUSTAINED HITS",
    "EXTRA ATTACKS",
    "ANTI",
    "DEADLY DEMISE",
    "PSYCHIC WEAPONS",
    "ONE SHOT",
]


def get_pdf(path: Path):
    path_str = str(path)
    url = Quartz.CFURLCreateFromFileSystemRepresentation(
        None,
        path_str.encode("utf-8"),
        len(path_str),
        False,
    )
    pdf = Quartz.PDFDocument.alloc().initWithURL_(url)
    if pdf is None:
        raise RuntimeError(f"Unable to open PDF: {path}")
    return pdf


def normalize_line(line: str) -> str:
    text = line.replace("\x08", " ").replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_lines_from_selection(selection) -> list[str]:
    text = str(selection.string() or "")
    out: list[str] = []
    for row in text.split("\n"):
        line = normalize_line(row)
        if not line:
            continue
        if re.fullmatch(r"\d+", line):
            continue
        out.append(line)
    return out


def is_heading(text: str) -> bool:
    if not text or len(text) < 3 or len(text) > 80:
        return False
    if text in SKIP_HEADINGS:
        return False
    if re.fullmatch(r"\d+", text):
        return False
    if not HEADING_RE.match(text):
        return False
    if not re.search(r"[A-Z]", text):
        return False
    if text.startswith(("■", "●", "◦", "-", "•")):
        return False
    return True


def clean_heading(text: str) -> str:
    stripped = STRIP_PREFIX_RE.sub("", text).strip()
    if stripped:
        return stripped
    return text


def is_bullet(text: str) -> bool:
    return text.startswith(("■", "●", "◦", "-", "•"))


def clean_bullet(text: str) -> str:
    return re.sub(r"^[■●◦\-•\s]+", "", text).strip()


def normalize_token(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def should_join(prev: str, curr: str) -> bool:
    if not prev or not curr:
        return False
    if prev.endswith((".", "!", "?", ":", ";")):
        return False
    if is_bullet(curr):
        return False
    if re.fullmatch(r"\d+", curr):
        return False
    if curr[0].islower():
        return True
    if curr[0].isdigit():
        return True
    if curr.startswith(("’", "'", '"', "(", "[")):
        return True
    return False


def clean_page_lines(lines: list[str], page_number: int) -> list[str]:
    out: list[str] = []
    for idx, line in enumerate(lines):
        if FOOTER_RE.match(line):
            continue
        if line.upper().startswith("CORE RULES |"):
            continue
        if re.fullmatch(r"\d+", line):
            # Drop footer page-number artifacts near the end of page text.
            if idx >= max(0, len(lines) - 4) and int(line) == page_number:
                continue
        out.append(line)
    return out


def extract_pages(pdf, *, skip_first_pages: int = 2) -> list[dict[str, object]]:
    pages: list[dict[str, object]] = []
    for i in range(pdf.pageCount()):
        if i < max(0, skip_first_pages):
            continue
        page = pdf.pageAtIndex_(i)
        page_rect = page.boundsForBox_(Quartz.kPDFDisplayBoxMediaBox)
        full_sel = page.selectionForRect_(page_rect)
        full_lines = extract_lines_from_selection(full_sel) if full_sel else []
        page_number = i + 1
        page_lines = clean_page_lines(full_lines, page_number)
        pages.append(
            {
                "page_number": page_number,
                "lines": page_lines,
            }
        )
    return pages


def flatten_pages_lines(pages: list[dict[str, object]]) -> list[str]:
    lines: list[str] = []
    for page in pages:
        for line in page.get("lines", []):
            lines.append(str(line))
    return lines


def build_sections(lines: list[str]) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    current_title = "Core Rules"
    current_blocks: list[dict[str, str]] = []
    paragraph_buffer = ""

    def flush_paragraph() -> None:
        nonlocal paragraph_buffer
        if paragraph_buffer:
            current_blocks.append({"type": "paragraph", "text": paragraph_buffer.strip()})
            paragraph_buffer = ""

    def flush_section() -> None:
        if not current_blocks:
            return
        sections.append({"title": current_title, "blocks": list(current_blocks)})
        current_blocks.clear()

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if is_heading(line):
            heading = clean_heading(line)
            if heading in SKIP_HEADINGS:
                continue
            flush_paragraph()
            flush_section()
            current_title = heading
            continue

        if is_bullet(line):
            flush_paragraph()
            bullet = clean_bullet(line)
            if bullet:
                current_blocks.append({"type": "bullet", "text": bullet})
            continue

        if should_join(paragraph_buffer, line):
            paragraph_buffer = f"{paragraph_buffer} {line}".strip()
        else:
            flush_paragraph()
            paragraph_buffer = line

    flush_paragraph()
    flush_section()

    # Keep only sections with meaningful size.
    return [sec for sec in sections if sec.get("title") and sec.get("blocks")]


def build_blocks_from_lines(lines: list[str]) -> list[dict[str, str]]:
    blocks: list[dict[str, str]] = []
    paragraph_buffer = ""

    def flush_paragraph() -> None:
        nonlocal paragraph_buffer
        if paragraph_buffer:
            blocks.append({"type": "paragraph", "text": paragraph_buffer.strip()})
            paragraph_buffer = ""

    for line in lines:
        if not line:
            continue
        if is_bullet(line):
            flush_paragraph()
            bullet = clean_bullet(line)
            if bullet:
                blocks.append({"type": "bullet", "text": bullet})
            continue
        if should_join(paragraph_buffer, line):
            paragraph_buffer = f"{paragraph_buffer} {line}".strip()
        else:
            flush_paragraph()
            paragraph_buffer = line

    flush_paragraph()
    return blocks


def extract_tooltip_sections(lines: list[str]) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    heading_map = {normalize_token(h): h for h in TOOLTIP_RULE_HEADINGS}
    stop_tokens = set(heading_map.keys())

    i = 0
    def line_matches_heading(line: str, heading: str) -> bool:
        upper = line.upper()
        return upper == heading or upper.startswith(f"{heading} ")

    def is_relevant_line(title: str, line: str) -> bool:
        if is_bullet(line):
            return True
        t = title.upper()
        u = line.upper()
        if line_matches_heading(u, t):
            return True
        if f"[{t}" in u:
            return True
        token = t.split()[0].replace("-", " ")
        if token and token in u:
            return True
        if t == "ANTI" and "ANTI-" in u:
            return True
        return False

    while i < len(lines):
        line = lines[i]
        token = normalize_token(line)
        if token not in stop_tokens and not any(line_matches_heading(line.upper(), h) for h in TOOLTIP_RULE_HEADINGS):
            i += 1
            continue

        matched_title = heading_map.get(token)
        if not matched_title:
            matched_title = next((h for h in TOOLTIP_RULE_HEADINGS if line_matches_heading(line.upper(), h)), None)
        if not matched_title:
            i += 1
            continue
        title = matched_title
        i += 1
        buffer: list[str] = []
        while i < len(lines):
            current = lines[i]
            cur_token = normalize_token(current)
            if cur_token in stop_tokens or any(line_matches_heading(current.upper(), h) for h in TOOLTIP_RULE_HEADINGS):
                break
            if is_heading(current):
                break
            if STRIP_PREFIX_RE.match(current):
                i += 1
                continue
            if current in SKIP_HEADINGS:
                i += 1
                continue
            if is_relevant_line(title, current):
                buffer.append(current)
            i += 1

        blocks = build_blocks_from_lines(buffer)
        if blocks:
            sections.append({"title": title, "blocks": blocks})

    # Deduplicate by title, keep first extracted.
    dedup: dict[str, dict[str, object]] = {}
    for sec in sections:
        title = sec["title"]
        if title not in dedup:
            dedup[title] = sec
    return list(dedup.values())


def merge_sections(base: list[dict[str, object]], override: list[dict[str, object]]) -> list[dict[str, object]]:
    by_title = {str(sec.get("title") or ""): sec for sec in base}
    for sec in override:
        title = str(sec.get("title") or "")
        if not title:
            continue
        by_title[title] = sec
    return [sec for sec in by_title.values() if sec.get("title") and sec.get("blocks")]


def section_to_tooltip(section: dict[str, object]) -> dict[str, object]:
    title = str(section.get("title") or "").strip()
    intro = ""
    body_parts: list[str] = []
    points: list[str] = []
    for block in section.get("blocks", []):
        text = str(block.get("text") or "").strip()
        if not text:
            continue
        if block.get("type") == "bullet":
            points.append(text)
            continue
        if not intro:
            intro = text
        else:
            body_parts.append(text)
    return {"title": title, "intro": intro, "body": "\n\n".join(body_parts), "points": points}


def build_tooltip_rules_from_full_text(full_text: str) -> list[dict[str, object]]:
    text = " ".join(full_text.split())
    specs = [
        ("DEADLY DEMISE", "Some models have ‘Deadly Demise x’ listed in their abilities."),
        ("ASSAULT", "Weapons with [ASSAULT] in their profile are known as Assault weapons."),
        ("PISTOL", "Weapons with [PISTOL] in their profile are known as Pistols."),
        ("RAPID FIRE", "Weapons with [RAPID FIRE X] in their profile are known as Rapid Fire weapons."),
        ("IGNORES COVER", "Weapons with [IGNORES COVER] in their profile are known as Ignores Cover weapons."),
        ("TWIN-LINKED", "Weapons with [TWIN-LINKED] in their profile are known as Twin-linked weapons."),
        ("TORRENT", "Weapons with [TORRENT] in their profile are known as Torrent weapons."),
        ("LETHAL HITS", "Weapons with [LETHAL HITS] in their profile are known as Lethal Hits weapons."),
        ("LANCE", "Weapons with [LANCE] in their profile are known as Lance weapons."),
        ("INDIRECT FIRE", "Weapons with [INDIRECT FIRE] in their profile are known as Indirect Fire weapons,"),
        ("PRECISION", "Weapons with [PRECISION] in their profile are known as Precision weapons."),
        ("BLAST", "Weapons with [BLAST] in their profile are known as Blast weapons,"),
        ("MELTA", "Weapons with [MELTA X] in their profile are known as Melta weapons."),
        ("HEAVY", "Weapons with [HEAVY] in their profile are known as Heavy weapons."),
        ("HAZARDOUS", "Weapons with [HAZARDOUS] in their profile are known as Hazardous weapons."),
        ("DEVASTATING WOUNDS", "Weapons with [DEVASTATING WOUNDS] in their profile are known as Devastating Wounds weapons."),
        ("SUSTAINED HITS", "Weapons with [SUSTAINED HITS X] in their profile are known as Sustained Hits weapons."),
        ("EXTRA ATTACKS", "Weapons with [EXTRA ATTACKS] in their profile are known as Extra Attacks weapons."),
        ("ANTI", "Weapons with [ANTI-KEYWORD X+] in their profile are known as Anti weapons."),
        ("PSYCHIC WEAPONS", "PSYCHIC WEAPONS AND ABILITIES Some weapons and abilities can only be used by Psykers."),
    ]
    stop_markers = [
        " ASSAULT ",
        " PISTOL ",
        " RAPID FIRE ",
        " IGNORES COVER ",
        " TWIN-LINKED ",
        " TORRENT ",
        " LETHAL HITS ",
        " LANCE ",
        " INDIRECT FIRE ",
        " PRECISION ",
        " BLAST ",
        " MELTA ",
        " HEAVY ",
        " HAZARDOUS ",
        " DEVASTATING WOUNDS ",
        " SUSTAINED HITS ",
        " EXTRA ATTACKS ",
        " ANTI ",
        " DEADLY DEMISE ",
        " PSYCHIC WEAPONS AND ABILITIES ",
        " CORE RULES | ",
    ]

    tooltips: list[dict[str, object]] = []
    for title, anchor in specs:
        start = text.find(anchor)
        if start < 0:
            continue
        end = min(len(text), start + 1600)
        for marker in stop_markers:
            pos = text.find(marker, start + len(anchor))
            if pos != -1 and pos < end:
                end = pos
        chunk = text[start:end].strip()
        if not chunk:
            continue
        bullets = [m.strip() for m in re.findall(r"■\s*([^■]+)", chunk)]
        body = chunk.split("■", 1)[0].strip()
        tooltips.append(
            {
                "title": title,
                "intro": "",
                "body": body,
                "points": bullets,
            }
        )
    return tooltips


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Core Rules from PDF into core_rules.json")
    parser.add_argument("--pdf", required=True, help="Path to Core Rules PDF file")
    parser.add_argument("--out", default="docs/data/core_rules.json", help="Output JSON path")
    parser.add_argument("--source-url", default="", help="Public URL for this PDF source (optional)")
    parser.add_argument(
        "--skip-first-pages",
        type=int,
        default=2,
        help="Skip this number of first PDF pages (default: 2, cover pages)",
    )
    parser.add_argument(
        "--include-source-file",
        action="store_true",
        help="Include local source file path in output payload",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    out_path = Path(args.out)

    pdf = get_pdf(pdf_path)
    pages = extract_pages(pdf, skip_first_pages=args.skip_first_pages)
    lines = flatten_pages_lines(pages)
    sections = build_sections(lines)
    tooltip_sections = extract_tooltip_sections(lines)
    sections = merge_sections(sections, tooltip_sections)
    full_text = "\n".join(" ".join(page.get("lines", [])) for page in pages)
    tooltip_rules = build_tooltip_rules_from_full_text(full_text)
    if not tooltip_rules:
        tooltip_rules = [section_to_tooltip(sec) for sec in tooltip_sections]
    if not sections:
        raise RuntimeError("No sections parsed from PDF")

    payload: dict[str, object] = {
        "source": "Warhammer 40,000 Core Rules PDF",
        "source_url": args.source_url.strip(),
        "updated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "page_title": "Core Rules",
        "format": "digital_pdf",
        "pages": pages,
        "sections": sections,
        "tooltip_rules": tooltip_rules,
    }
    if args.include_source_file:
        payload["source_file"] = str(pdf_path)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} with {len(sections)} sections")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

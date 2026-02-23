#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import Quartz


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def load_unit_names(datasheets_csv: Path) -> list[str]:
    names: set[str] = set()
    with datasheets_csv.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            name = (row.get("name") or "").strip()
            if name:
                names.add(name)
    return sorted(names)


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


def extract_region_lines(page, selections: list) -> list[str]:
    if not selections:
        return []

    pb = page.boundsForBox_(Quartz.kPDFDisplayBoxMediaBox)
    mid = pb.origin.x + pb.size.width / 2

    all_lines: list[str] = []
    for selection in selections:
        b = selection.boundsForPage_(page)
        is_left = b.origin.x < mid

        if is_left:
            rect = Quartz.CGRectMake(pb.origin.x + 6, max(0, b.origin.y - 58), mid - pb.origin.x - 12, 95)
        else:
            rect = Quartz.CGRectMake(mid + 4, max(0, b.origin.y - 58), pb.size.width - mid - 10, 95)

        reg_sel = page.selectionForRect_(rect)
        if reg_sel is None:
            continue

        txt = str(reg_sel.string() or "").replace("\x08", " ")
        lines = [" ".join(line.split()) for line in txt.split("\n") if line.strip()]
        all_lines.extend(lines)

    return all_lines


def parse_points_from_lines(unit_name: str, lines: list[str]) -> list[int]:
    if not lines:
        return []

    norm_name = normalize(unit_name)
    idx_candidates = [i for i, line in enumerate(lines) if norm_name in normalize(line)]

    if not idx_candidates:
        return []

    point_entries: list[tuple[int, int, str]] = []
    for i, line in enumerate(lines):
        matches = re.findall(r"(\d+)\s*models?.{0,90}?(\d{1,4})\s*pts", line, re.I)
        for _mc, pts in matches:
            point_entries.append((i, int(pts), line))

    if not point_entries:
        return []

    # Prefer first points line that appears after the unit-name line.
    anchor_idx: int | None = None
    for name_idx in idx_candidates:
        after = [entry for entry in point_entries if entry[0] >= name_idx]
        if after:
            candidate_idx = min(after, key=lambda e: e[0] - name_idx)[0]
            if anchor_idx is None or candidate_idx < anchor_idx:
                anchor_idx = candidate_idx

    if anchor_idx is None:
        anchor_idx = point_entries[0][0]

    tiers: list[int] = []
    for point_idx, pts, _line in point_entries:
        if point_idx < anchor_idx:
            continue
        if point_idx > anchor_idx + 1:
            continue
        if pts not in tiers:
            tiers.append(pts)

    if not tiers:
        tiers = [point_entries[0][1]]
    return tiers


def build_cost_map(pdf_path: Path, unit_names: list[str]) -> dict[str, dict[str, object]]:
    pdf = get_pdf(pdf_path)
    costs: dict[str, dict[str, object]] = {}

    for name in unit_names:
        selections = pdf.findString_withOptions_(name, Quartz.NSCaseInsensitiveSearch) or []
        if not selections:
            continue

        # First valid match is usually the cleanest block for that unit in the MFM.
        selection = selections[0]
        pages = selection.pages() or []
        if not pages:
            continue
        page = pages[0]
        lines = extract_region_lines(page, [selection])
        found_points = parse_points_from_lines(name, lines)

        if found_points:
            # Keep reasonable bounds for WH40k points
            filtered = [p for p in found_points if 5 <= p <= 2000]
            if not filtered:
                continue
            uniq = sorted(set(filtered))
            costs[name] = {
                "min": min(uniq),
                "tiers": uniq,
            }

    return costs


def main() -> int:
    parser = argparse.ArgumentParser(description="Import unit costs from Munitorum PDF")
    parser.add_argument("--pdf", required=True, help="Path to Munitorum Field Manual PDF")
    parser.add_argument("--datasheets", default="docs/data/Datasheets.csv", help="Path to Datasheets.csv")
    parser.add_argument("--out", default="docs/data/unit_costs.json", help="Output JSON path")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    datasheets_path = Path(args.datasheets)
    out_path = Path(args.out)

    unit_names = load_unit_names(datasheets_path)
    costs = build_cost_map(pdf_path, unit_names)

    payload = {
        "source": "Munitorum Field Manual PDF",
        "source_file": str(pdf_path),
        "generated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "units_with_costs": len(costs),
        "costs": costs,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} with {len(costs)} unit costs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

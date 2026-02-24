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

# Quartz extraction from two-column PDF can lose the second mechanics paragraph for some rules.
# Use canonical weapon ability wording as deterministic fallback to keep tooltip quality stable.
CANONICAL_TOOLTIP_OVERRIDES: dict[str, dict[str, object]] = {
    "ASSAULT": {
        "intro": "Assault weapons fire so indiscriminately that they can be shot from the hip as warriors dash forward.",
        "body": (
            "Weapons with [ASSAULT] in their profile are known as Assault weapons. "
            "If a unit that Advanced this turn contains any models equipped with Assault weapons, "
            "it is still eligible to shoot in this turn's Shooting phase. "
            "When such a unit is selected to shoot, it can only resolve attacks using Assault weapons its models are equipped with."
        ),
        "points": ["Can be shot even if the bearer's unit Advanced."],
    },
    "PISTOL": {
        "intro": "Pistols can be wielded even at point-blank range.",
        "body": (
            "Weapons with [PISTOL] in their profile are known as Pistols. "
            "If a unit contains any models equipped with Pistols, that unit is eligible to shoot in its controlling player's Shooting phase "
            "even while it is within Engagement Range of one or more enemy units. "
            "When such a unit is selected to shoot, it can only resolve attacks using its Pistols and can only target one of the enemy units it is within Engagement Range of. "
            "If a model is equipped with one or more Pistols, unless it is a MONSTER or VEHICLE model, it can either shoot with its Pistols or with all of its other ranged weapons."
        ),
        "points": [
            "Can be shot even if the bearer's unit is within Engagement Range of enemy units, but must target one of those enemy units.",
            "Cannot be shot alongside any other non-Pistol weapon (except by a MONSTER or VEHICLE).",
        ],
    },
    "RAPID FIRE": {
        "intro": "Rapid fire weapons are capable of long-ranged precision shots or controlled bursts at nearby targets.",
        "body": (
            "Weapons with [RAPID FIRE X] in their profile are known as Rapid Fire weapons. "
            "Each time such a weapon targets a unit within half that weapon's range, "
            "the Attacks characteristic of that weapon is increased by the amount denoted by X."
        ),
        "points": ["[RAPID FIRE X]: Increase the Attacks by X when targeting units within half range."],
    },
    "IGNORES COVER": {
        "intro": "Some weapons are designed to root enemy formations out of entrenched positions.",
        "body": (
            "Weapons with [IGNORES COVER] in their profile are known as Ignores Cover weapons. "
            "Each time an attack is made with such a weapon, the target cannot have the Benefit of Cover against that attack (pg 44)."
        ),
        "points": [],
    },
    "TWIN-LINKED": {
        "intro": "Dual weapons are often grafted to the same targeting system for greater lethality.",
        "body": (
            "Weapons with [TWIN-LINKED] in their profile are known as Twin-linked weapons. "
            "Each time an attack is made with such a weapon, you can re-roll that attack's Wound roll."
        ),
        "points": [],
    },
    "TORRENT": {
        "intro": "Torrent weapons shoot clouds of fire, gas or other lethal substances that few foes can hope to evade.",
        "body": (
            "Weapons with [TORRENT] in their profile are known as Torrent weapons. "
            "Each time an attack is made with such a weapon, that attack automatically hits the target."
        ),
        "points": [],
    },
    "LETHAL HITS": {
        "intro": "Some weapons can inflict fatal injuries on any foe, no matter their resilience.",
        "body": (
            "Weapons with [LETHAL HITS] in their profile are known as Lethal Hits weapons. "
            "Each time an attack is made with such a weapon, a Critical Hit automatically wounds the target."
        ),
        "points": [],
    },
    "LANCE": {
        "intro": "Lance weapons are deadly on the charge.",
        "body": (
            "Weapons with [LANCE] in their profile are known as Lance weapons. "
            "Each time an attack is made with such a weapon, if the bearer made a Charge move this turn, add 1 to that attack's Wound roll."
        ),
        "points": [],
    },
    "INDIRECT FIRE": {
        "intro": "Indirect fire weapons launch munitions over or around intervening obstacles.",
        "body": (
            "Weapons with [INDIRECT FIRE] in their profile are known as Indirect Fire weapons. "
            "Such weapons can target units that are not visible to the attacking model's unit. "
            "If no models in a target unit are visible to the attacking unit when that target is selected, "
            "then each time a model in the attacking unit makes an attack against that target using an Indirect Fire weapon, "
            "subtract 1 from that attack's Hit roll and the target has the Benefit of Cover against that attack."
        ),
        "points": [
            "Can target units that are not visible to the attacking unit.",
            "If no models are visible, attacks are at -1 to Hit and the target has Benefit of Cover.",
        ],
    },
    "PRECISION": {
        "intro": "Precision attacks can pick high-value targets out in a crowd.",
        "body": (
            "Weapons with [PRECISION] in their profile are known as Precision weapons. "
            "Each time an attack made with such a weapon successfully wounds an Attached unit, "
            "if a CHARACTER model in that unit is visible to the attacking model, "
            "the attacking model's player can choose to have that attack allocated to that CHARACTER model instead."
        ),
        "points": [
            "When targeting an Attached unit, the attacking player can allocate to a visible CHARACTER model in that unit.",
        ],
    },
    "BLAST": {
        "intro": "High-explosive weapons can fell several warriors in a single detonation.",
        "body": (
            "Weapons with [BLAST] in their profile are known as Blast weapons. "
            "Each time a Blast weapon targets a unit, add 1 to that weapon's Attacks characteristic for every five models in the target unit (rounding down). "
            "Blast weapons can never be used to make attacks against a unit that is within Engagement Range of one or more units from the attacking model's army."
        ),
        "points": [
            "Add 1 Attack for every five models in the target unit (rounding down).",
            "Cannot be used against targets within Engagement Range of the attacker's army.",
        ],
    },
    "MELTA": {
        "intro": "Melta weapons are powerful heat rays whose fury is magnified at close range.",
        "body": (
            "Weapons with [MELTA X] in their profile are known as Melta weapons. "
            "Each time an attack made with such a weapon targets a unit within half that weapon's range, "
            "that attack's Damage characteristic is increased by the amount denoted by X."
        ),
        "points": ["[MELTA X]: Increase Damage by X when targeting units within half range."],
    },
    "HEAVY": {
        "intro": "Heavy weapons are strongest when braced by stationary firing positions.",
        "body": (
            "Weapons with [HEAVY] in their profile are known as Heavy weapons. "
            "Each time an attack is made with such a weapon, if the attacking model's unit remained stationary this turn, add 1 to that attack's Hit roll."
        ),
        "points": ["Add 1 to Hit rolls if the bearer's unit Remained Stationary this turn."],
    },
    "HAZARDOUS": {
        "intro": "Weapons powered by unstable energy sources pose a risk to the bearer.",
        "body": (
            "Weapons with [HAZARDOUS] in their profile are known as Hazardous weapons. "
            "After a unit shoots or fights, roll one Hazardous test (one D6) for each Hazardous weapon that was used. "
            "For each result of 1, one model in that unit equipped with a Hazardous weapon suffers 3 mortal wounds."
        ),
        "points": [
            "After shooting/fighting, roll one D6 for each used Hazardous weapon.",
            "Each result of 1 inflicts 3 mortal wounds on a model equipped with a Hazardous weapon.",
        ],
    },
    "DEVASTATING WOUNDS": {
        "intro": "Some attacks inflict catastrophic injuries that bypass normal protections.",
        "body": (
            "Weapons with [DEVASTATING WOUNDS] in their profile are known as Devastating Wounds weapons. "
            "Each time an attack made with such a weapon scores a Critical Wound, "
            "that attack inflicts mortal wounds equal to that weapon's Damage characteristic instead of normal damage."
        ),
        "points": ["A Critical Wound inflicts mortal wounds equal to the weapon's Damage characteristic."],
    },
    "SUSTAINED HITS": {
        "intro": "Some weapons strike in a flurry of blows, tearing the foe apart with relentless ferocity.",
        "body": (
            "Weapons with [SUSTAINED HITS X] in their profile are known as Sustained Hits weapons. "
            "Each time an attack is made with such a weapon, a Critical Hit scores a number of additional hits on the target equal to X."
        ),
        "points": ["[SUSTAINED HITS X]: Each Critical Hit scores X additional hits on the target."],
    },
    "EXTRA ATTACKS": {
        "intro": "Some weapons are used for additional strikes beyond a model's primary attacks.",
        "body": (
            "Weapons with [EXTRA ATTACKS] in their profile are known as Extra Attacks weapons. "
            "The bearer can make attacks with such a weapon in addition to the weapons it chooses to fight with."
        ),
        "points": ["The bearer can attack with this weapon in addition to its other selected weapons."],
    },
    "ANTI": {
        "intro": "Certain weapons are the bane of a particular foe.",
        "body": (
            "Weapons with [ANTI-KEYWORD X+] in their profile are known as Anti weapons. "
            "Each time an attack is made with such a weapon against a target with the matching keyword, "
            "an unmodified Wound roll of X+ scores a Critical Wound."
        ),
        "points": ["[ANTI-KEYWORD X+]: An unmodified Wound roll of X+ scores a Critical Wound against a matching keyword."],
    },
    "DEADLY DEMISE": {
        "intro": "Some models are dangerous even in death.",
        "body": (
            "Some models have Deadly Demise X listed in their abilities. "
            "When such a model is destroyed, roll one D6 before removing it from play. "
            "On a 6, each unit within 6\" suffers a number of mortal wounds denoted by X."
        ),
        "points": ["Deadly Demise X: On destruction, roll one D6; on a 6, nearby units suffer X mortal wounds."],
    },
    "PSYCHIC WEAPONS AND ABILITIES": {
        "intro": "Some weapons and abilities can only be used by Psykers.",
        "body": (
            "Such weapons and abilities are tagged with the word Psychic. "
            "If a Psychic weapon or ability causes any unit to suffer one or more wounds, "
            "each of those wounds is considered to have been inflicted by a Psychic Attack."
        ),
        "points": [],
    },
    "ONE SHOT": {
        "intro": "One Shot weapons can only be fired once per battle.",
        "body": (
            "A weapon with [ONE SHOT] can be used only once per battle. "
            "If another rule lets models fire weapons by proxy, [ONE SHOT] weapons are excluded unless that rule explicitly allows them."
        ),
        "points": ["This weapon can be fired once per battle."],
    },
}

CANONICAL_SECTION_OVERRIDES: list[dict[str, object]] = [
    {
        "title": "65 Charging with a Unit",
        "aliases": ["65 CHARGING WITH A UNIT", "CHARGING WITH A UNIT"],
        "paragraphs": [
            "Once you have selected an eligible unit to declare a charge, you must select one or more enemy units within 12\" of it as the targets of that charge. The targets of a charge do not need to be visible to the charging unit.",
            "You then make a Charge roll for the charging unit by rolling 2D6. The result is the maximum number of inches each model in that unit can be moved if a Charge move is possible.",
            "For a Charge move to be possible, the Charge roll must be sufficient to enable the charging unit to end that move within Engagement Range of every unit selected as a target, without moving within Engagement Range of enemy units that were not targets, and in Unit Coherency.",
            "If any of these conditions cannot be met, the charge fails and no models in the charging unit move this phase.",
            "Otherwise, the charge is successful and the models in the charging unit make a Charge move. Move each model a distance in inches up to the result of the Charge roll. Each model must end its Charge move closer to one of the units selected as a target of its charge.",
            "If you can also move a charging model so that it ends its Charge move in base-to-base contact with one or more enemy models while still satisfying all of the conditions above, you must do so. The controlling player chooses the order in which to move their models.",
        ],
        "summary_points": [
            "Within Engagement Range of every unit that you selected as a target of the charge.",
            "Without moving within Engagement Range of any enemy units that were not a target of the charge.",
            "In Unit Coherency.",
            "Charge Roll: 2D6\".",
            "Targets of a charge must be within 12\" but do not need to be visible.",
            "If the distance rolled is insufficient to move within Engagement Range of all targets while maintaining Unit Coherency, the charge fails.",
            "Cannot move within Engagement Range of any unit that was not a target of the charge.",
            "If the charge is successful, each model makes a Charge move less than or equal to the Charge roll, and must move into base-to-base contact with an enemy model if possible.",
        ],
    }
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


def canonical_key(title: str) -> str:
    text = str(title or "").upper().replace("&", "AND")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def apply_tooltip_overrides(tooltips: list[dict[str, object]]) -> list[dict[str, object]]:
    by_key: dict[str, dict[str, object]] = {}
    for tip in tooltips:
        key = canonical_key(str(tip.get("title") or ""))
        if key:
            by_key[key] = tip

    for title, override in CANONICAL_TOOLTIP_OVERRIDES.items():
        key = canonical_key(title)
        entry = {
            "title": title,
            "intro": str(override.get("intro") or "").strip(),
            "body": str(override.get("body") or "").strip(),
            "points": [str(x).strip() for x in (override.get("points") or []) if str(x).strip()],
        }
        if key in by_key:
            # Keep existing canonical title casing from live data if available.
            current_title = str(by_key[key].get("title") or "").strip() or title
            entry["title"] = current_title
            by_key[key] = entry
        else:
            by_key[key] = entry

    # Preserve deterministic order: original list first, then missing canonical entries.
    ordered: list[dict[str, object]] = []
    used: set[str] = set()
    for tip in tooltips:
        key = canonical_key(str(tip.get("title") or ""))
        if key and key in by_key and key not in used:
            ordered.append(by_key[key])
            used.add(key)
    for title in CANONICAL_TOOLTIP_OVERRIDES:
        key = canonical_key(title)
        if key in by_key and key not in used:
            ordered.append(by_key[key])
            used.add(key)

    return ordered


def override_to_section(title: str, override: dict[str, object]) -> dict[str, object]:
    blocks: list[dict[str, str]] = []
    intro = str(override.get("intro") or "").strip()
    body = str(override.get("body") or "").strip()
    points = [str(x).strip() for x in (override.get("points") or []) if str(x).strip()]
    if intro:
        blocks.append({"type": "paragraph", "text": intro})
    if body:
        blocks.append({"type": "paragraph", "text": body})
    for point in points:
        blocks.append({"type": "bullet", "text": point})
    return {"title": title, "blocks": blocks}


def manual_override_to_section(override: dict[str, object]) -> dict[str, object]:
    title = str(override.get("title") or "").strip() or "Section"
    paragraphs = [str(x).strip() for x in (override.get("paragraphs") or []) if str(x).strip()]
    section: dict[str, object] = {
        "title": title,
        "blocks": [{"type": "paragraph", "text": text} for text in paragraphs],
    }
    summary_points = [str(x).strip() for x in (override.get("summary_points") or []) if str(x).strip()]
    if summary_points:
        section["summary_points"] = summary_points
    return section


def apply_manual_section_overrides(sections: list[dict[str, object]]) -> list[dict[str, object]]:
    key_to_index: dict[str, int] = {}
    for i, section in enumerate(sections):
        key = canonical_key(str(section.get("title") or ""))
        if key and key not in key_to_index:
            key_to_index[key] = i

    for override in CANONICAL_SECTION_OVERRIDES:
        aliases = override.get("aliases") or []
        alias_keys = [canonical_key(str(x)) for x in aliases if str(x).strip()]
        if not alias_keys:
            alias_keys = [canonical_key(str(override.get("title") or ""))]
        target_index = next((key_to_index.get(key) for key in alias_keys if key in key_to_index), None)
        replacement = manual_override_to_section(override)

        if target_index is not None:
            sections[target_index] = replacement
            # Refresh index mapping for all aliases to this updated section.
            for key in alias_keys:
                key_to_index[key] = target_index
            key_to_index[canonical_key(str(replacement.get("title") or ""))] = target_index
            continue

        # Insert near charge-phase cluster when possible.
        anchor_keys = {"65 CHARGING WITH A UNIT", "64 CHARGE BONUS", "CHARGE PHASE"}
        anchor = None
        for key in anchor_keys:
            if key in key_to_index:
                anchor = key_to_index[key]
                break
        if anchor is not None:
            insert_at = anchor + 1
            sections.insert(insert_at, replacement)
            key_to_index = {}
            for i, section in enumerate(sections):
                key = canonical_key(str(section.get("title") or ""))
                if key and key not in key_to_index:
                    key_to_index[key] = i
        else:
            sections.append(replacement)
            idx = len(sections) - 1
            key_to_index[canonical_key(str(replacement.get("title") or ""))] = idx

    return sections


def apply_section_overrides(sections: list[dict[str, object]]) -> list[dict[str, object]]:
    sections = apply_manual_section_overrides(sections)
    by_key: dict[str, dict[str, object]] = {}
    for section in sections:
        key = canonical_key(str(section.get("title") or ""))
        if key:
            by_key[key] = section

    weapon_anchor = None
    for i, section in enumerate(sections):
        if canonical_key(str(section.get("title") or "")) == "WEAPON ABILITIES":
            weapon_anchor = i
            break

    for title, override in CANONICAL_TOOLTIP_OVERRIDES.items():
        key = canonical_key(title)
        new_section = override_to_section(title, override)
        if key in by_key:
            # Keep existing title casing if present.
            current_title = str(by_key[key].get("title") or "").strip()
            if current_title:
                new_section["title"] = current_title
            by_key[key] = new_section
        else:
            by_key[key] = new_section
            if weapon_anchor is not None:
                sections.insert(weapon_anchor + 1, new_section)
                weapon_anchor += 1
            else:
                sections.append(new_section)

    # Keep original order, replacing matching titles with overridden content.
    ordered: list[dict[str, object]] = []
    used: set[str] = set()
    for section in sections:
        key = canonical_key(str(section.get("title") or ""))
        if key and key in by_key and key not in used:
            ordered.append(by_key[key])
            used.add(key)
        elif not key:
            ordered.append(section)

    for title in CANONICAL_TOOLTIP_OVERRIDES:
        key = canonical_key(title)
        if key in by_key and key not in used:
            ordered.append(by_key[key])
            used.add(key)

    return ordered


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
    sections = apply_section_overrides(sections)
    full_text = "\n".join(" ".join(page.get("lines", [])) for page in pages)
    tooltip_rules = build_tooltip_rules_from_full_text(full_text)
    if not tooltip_rules:
        tooltip_rules = [section_to_tooltip(sec) for sec in tooltip_sections]
    tooltip_rules = apply_tooltip_overrides(tooltip_rules)
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

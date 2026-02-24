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
    pdf = Quartz.CGPDFDocumentCreateWithURL(url)
    if pdf is None:
        raise RuntimeError(f"Unable to open PDF: {path}")
    return pdf


COLUMN_GAP_THRESHOLD = 130.0
COLUMN_SPLIT_X = 300.0
MIN_COLUMN_LINE_COUNT = 8
MAX_CONTROL_CHARS_PER_LINE = 3

LIGATURE_REPLACEMENTS: list[tuple[str, str]] = [
    ("\x19\x1e", "ly"),
    ("\x1a", "ffi"),
    ("\x1b", "ft"),
    ("\x1c", "ff"),
    ("\x1d", "fi"),
    ("\x1e", "fl"),
    ("\x1f", "th"),
    ("\x14", "fi"),
    ("\x13", "ff"),
    ("\x12", "fl"),
]

SIMPLE_CHAR_REPLACEMENTS: dict[str, str] = {
    "\x91": "'",
    "\x92": "'",
    "\x93": '"',
    "\x94": '"',
    "\x96": "-",
    "\x97": "-",
    "\xad": "",
    "\ufeff": "",
}

WORD_FIXES: dict[str, str] = {
    "battletheld": "battlefield",
    "battlethelds": "battlefields",
    "theld": "field",
    "thelds": "fields",
    "thre": "fire",
    "suftcient": "sufficient",
    "suftciently": "sufficiently",
    "unmodithed": "unmodified",
    "modithed": "modified",
    "infiicted": "inflicted",
    "infiicting": "inflicting",
    "diflerent": "different",
    "afler": "after",
    "affer": "after",
    "suflers": "suffers",
    "specithed": "specified",
    "prothle": "profile",
    "aflected": "affected",
    "ese": "These",
    "fte": "the",
    "ftere": "there",
    "infiict": "inflict",
    "suflering": "suffering",
    "diflerence": "difference",
    "diflerences": "differences",
}

BULLET_PREFIX_RE = re.compile(r'^(?:v|"|•|▪|■|●|◦|\-|—)\s+')
CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b-\x1f]")


def parse_pdf_string(text: str, start: int) -> tuple[str, int]:
    idx = start + 1
    out: list[str] = []
    depth = 1
    while idx < len(text) and depth > 0:
        ch = text[idx]
        if ch == "\\":
            idx += 1
            if idx >= len(text):
                break
            esc = text[idx]
            escaped = {
                "n": "\n",
                "r": "\r",
                "t": "\t",
                "b": "\b",
                "f": "\f",
                "(": "(",
                ")": ")",
                "\\": "\\",
            }
            if esc in escaped:
                out.append(escaped[esc])
                idx += 1
                continue
            if esc in "01234567":
                octal = esc
                idx += 1
                for _ in range(2):
                    if idx < len(text) and text[idx] in "01234567":
                        octal += text[idx]
                        idx += 1
                    else:
                        break
                out.append(chr(int(octal, 8)))
                continue
            out.append(esc)
            idx += 1
            continue
        if ch == "(":
            depth += 1
            out.append(ch)
            idx += 1
            continue
        if ch == ")":
            depth -= 1
            if depth == 0:
                idx += 1
                break
            out.append(ch)
            idx += 1
            continue
        out.append(ch)
        idx += 1
    return "".join(out), idx


def tokenize_pdf_content(content: bytes):
    text = content.decode("latin1", "ignore")
    idx = 0
    while idx < len(text):
        ch = text[idx]
        if ch.isspace():
            idx += 1
            continue
        if ch == "%":
            while idx < len(text) and text[idx] not in "\r\n":
                idx += 1
            continue
        if ch == "(":
            value, idx = parse_pdf_string(text, idx)
            yield ("STRING", value)
            continue
        if ch == "[":
            idx += 1
            yield ("LBRACK", "[")
            continue
        if ch == "]":
            idx += 1
            yield ("RBRACK", "]")
            continue
        if ch == "/":
            end = idx + 1
            while end < len(text) and not text[end].isspace() and text[end] not in "[]()<>/%":
                end += 1
            yield ("NAME", text[idx + 1 : end])
            idx = end
            continue
        if ch == "<" and idx + 1 < len(text) and text[idx + 1] != "<":
            end = idx + 1
            while end < len(text) and text[end] != ">":
                end += 1
            hex_data = text[idx + 1 : end]
            try:
                if len(hex_data) % 2:
                    hex_data = f"{hex_data}0"
                decoded = bytes.fromhex(hex_data).decode("latin1", "ignore")
            except ValueError:
                decoded = ""
            yield ("STRING", decoded)
            idx = end + 1
            continue
        if ch in "+-0123456789.":
            end = idx + 1
            while end < len(text) and text[end] in "0123456789.+-":
                end += 1
            token = text[idx:end]
            try:
                yield ("NUMBER", float(token))
                idx = end
                continue
            except ValueError:
                pass
        end = idx + 1
        while end < len(text) and not text[end].isspace() and text[end] not in "[]()<>/%":
            end += 1
        yield ("OP", text[idx:end])
        idx = end


def extract_page_content_bytes(page) -> bytes:
    page_dict = Quartz.CGPDFPageGetDictionary(page)
    chunks: list[bytes] = []

    ok_stream, stream = Quartz.CGPDFDictionaryGetStream(page_dict, b"Contents", None)
    if ok_stream and stream is not None:
        data, _fmt = Quartz.CGPDFStreamCopyData(stream, None)
        chunks.append(bytes(data))
    else:
        ok_array, arr = Quartz.CGPDFDictionaryGetArray(page_dict, b"Contents", None)
        if ok_array and arr is not None:
            count = Quartz.CGPDFArrayGetCount(arr)
            for idx in range(count):
                ok_item, item_stream = Quartz.CGPDFArrayGetStream(arr, idx, None)
                if not ok_item or item_stream is None:
                    continue
                data, _fmt = Quartz.CGPDFStreamCopyData(item_stream, None)
                chunks.append(bytes(data))

    if not chunks:
        return b""
    return b"\n".join(chunks)


def extract_page_text_items(content: bytes) -> list[tuple[float, float, str]]:
    stack: list[tuple[str, object]] = []
    x = 0.0
    y = 0.0
    out: list[tuple[float, float, str]] = []

    def pop_number(default: float = 0.0) -> float:
        if stack and stack[-1][0] == "NUMBER":
            return float(stack.pop()[1])
        return default

    def pop_string() -> str:
        if stack and stack[-1][0] == "STRING":
            return str(stack.pop()[1])
        return ""

    def pop_array() -> list[tuple[str, object]]:
        if stack and stack[-1][0] == "ARRAY":
            return list(stack.pop()[1])  # type: ignore[arg-type]
        return []

    for kind, value in tokenize_pdf_content(content):
        if kind in ("NUMBER", "STRING", "NAME", "ARRAY"):
            stack.append((kind, value))
            continue
        if kind == "LBRACK":
            stack.append(("ARR_START", value))
            continue
        if kind == "RBRACK":
            arr: list[tuple[str, object]] = []
            while stack and stack[-1][0] != "ARR_START":
                arr.append(stack.pop())
            if stack and stack[-1][0] == "ARR_START":
                stack.pop()
            arr.reverse()
            stack.append(("ARRAY", arr))
            continue
        if kind != "OP":
            continue

        op = str(value)
        if op == "Tm":
            f = pop_number()
            e = pop_number()
            _d = pop_number()
            _c = pop_number()
            _b = pop_number()
            _a = pop_number()
            x, y = e, f
            stack.clear()
            continue
        if op in ("Td", "TD"):
            ty = pop_number()
            tx = pop_number()
            x += tx
            y += ty
            stack.clear()
            continue
        if op == "T*":
            y -= 12.0
            stack.clear()
            continue
        if op == "Tj":
            text = pop_string().strip()
            if text:
                out.append((y, x, text))
            stack.clear()
            continue
        if op == "TJ":
            arr = pop_array()
            text = "".join(str(v) for k, v in arr if k == "STRING").strip()
            if text:
                out.append((y, x, text))
            stack.clear()
            continue
        if op == "'":
            text = pop_string().strip()
            y -= 12.0
            if text:
                out.append((y, x, text))
            stack.clear()
            continue
        if op == '"':
            text = pop_string().strip()
            _char_space = pop_number()
            _word_space = pop_number()
            y -= 12.0
            if text:
                out.append((y, x, text))
            stack.clear()
            continue
        if op in {"BT", "ET", "EMC"}:
            stack.clear()
            continue
    return out


def normalize_line(line: str) -> str:
    if not line:
        return ""

    control_count = len(CONTROL_CHAR_RE.findall(line))
    if control_count > MAX_CONTROL_CHARS_PER_LINE:
        return ""

    text = line.replace("\u00a0", " ")
    for src, dst in LIGATURE_REPLACEMENTS:
        text = text.replace(src, dst)
    for src, dst in SIMPLE_CHAR_REPLACEMENTS.items():
        text = text.replace(src, dst)
    text = CONTROL_CHAR_RE.sub(" ", text)
    for wrong, fixed in WORD_FIXES.items():
        text = re.sub(rf"\b{wrong}\b", fixed, text, flags=re.IGNORECASE)
    text = re.sub(r"\band\s+\d+\s+you\b", "and you", text, flags=re.IGNORECASE)
    text = re.sub(r"\bfirst you can\s+\d+\s+move\b", "First you can move", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    return text


def page_items_to_lines(items: list[tuple[float, float, str]]) -> list[tuple[float, float, str]]:
    if not items:
        return []

    rows: list[dict[str, object]] = []
    for y, x, text in sorted(items, key=lambda item: (-item[0], item[1])):
        merged = False
        for row in rows:
            if abs(float(row["y"]) - y) <= 0.35:
                row["items"].append((x, text))  # type: ignore[index]
                merged = True
                break
        if not merged:
            rows.append({"y": y, "items": [(x, text)]})

    entries: list[tuple[float, float, str]] = []
    for row in rows:
        y = float(row["y"])
        row_items = sorted(row["items"], key=lambda item: item[0])  # type: ignore[index]
        if not row_items:
            continue

        chunks: list[list[tuple[float, str]]] = []
        current: list[tuple[float, str]] = [row_items[0]]
        for x, text in row_items[1:]:
            if x - current[-1][0] > COLUMN_GAP_THRESHOLD:
                chunks.append(current)
                current = [(x, text)]
            else:
                current.append((x, text))
        chunks.append(current)

        for chunk in chunks:
            raw_line = " ".join(text for _, text in chunk)
            text = normalize_line(raw_line)
            if not text:
                continue
            entries.append((y, chunk[0][0], text))

    left = [entry for entry in entries if entry[1] < COLUMN_SPLIT_X]
    right = [entry for entry in entries if entry[1] >= COLUMN_SPLIT_X]
    if len(left) >= MIN_COLUMN_LINE_COUNT and len(right) >= MIN_COLUMN_LINE_COUNT:
        ordered = sorted(left, key=lambda entry: -entry[0]) + sorted(right, key=lambda entry: -entry[0])
    else:
        ordered = sorted(entries, key=lambda entry: (-entry[0], entry[1]))
    return ordered


def is_heading(text: str) -> bool:
    if not text or len(text) < 3 or len(text) > 90:
        return False
    if text in SKIP_HEADINGS:
        return False
    if re.fullmatch(r"\d+", text):
        return False
    if is_bullet(text):
        return False
    if re.match(r"^\d+\s+[A-Z]", text):
        # Skip decorative step labels like "1 COMMAND PHASE" from early pages.
        return False
    if not HEADING_RE.match(text):
        return False
    if not re.search(r"[A-Z]", text):
        return False
    return True


def clean_heading(text: str) -> str:
    stripped = STRIP_PREFIX_RE.sub("", text).strip()
    if stripped:
        return stripped
    return text


def is_bullet(text: str) -> bool:
    return bool(BULLET_PREFIX_RE.match(text))


def clean_bullet(text: str) -> str:
    return BULLET_PREFIX_RE.sub("", text).strip()


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
    for idx, raw_line in enumerate(lines):
        line = normalize_line(raw_line)
        if not line:
            continue
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
    page_count = int(Quartz.CGPDFDocumentGetNumberOfPages(pdf))
    for page_number in range(1, page_count + 1):
        if page_number <= max(0, skip_first_pages):
            continue
        page = Quartz.CGPDFDocumentGetPage(pdf, page_number)
        if page is None:
            continue
        content = extract_page_content_bytes(page)
        items = extract_page_text_items(content)
        line_entries = page_items_to_lines(items)
        full_lines = [entry[2] for entry in line_entries]
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


def strip_numeric_prefix(token: str) -> str:
    return re.sub(r"^\d+", "", token or "")


def heading_matches_reference_title(line: str, title: str) -> bool:
    line_key = normalize_token(line)
    title_key = normalize_token(title)
    if not line_key or not title_key:
        return False
    if line_key == title_key:
        return True

    line_no_num = strip_numeric_prefix(line_key)
    title_no_num = strip_numeric_prefix(title_key)
    if not line_no_num or line_no_num != title_no_num:
        return False

    # Avoid matching decorative labels like "1 COMMAND PHASE" to "COMMAND PHASE".
    if re.match(r"^\d", line.strip()) and not re.match(r"^\d", title.strip()):
        return False
    return True


def load_reference_section_titles(path: Path) -> list[str]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    sections = payload.get("sections")
    if not isinstance(sections, list):
        return []
    titles: list[str] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        title = str(section.get("title") or "").strip()
        if title:
            titles.append(title)
    return titles


def build_sections_from_reference_titles(lines: list[str], reference_titles: list[str]) -> list[dict[str, object]]:
    if not reference_titles:
        return build_sections(lines)

    anchors: list[tuple[str, int]] = []
    cursor = 0
    for title in reference_titles:
        normalized_title = str(title).strip()
        if not normalized_title:
            continue
        if canonical_key(normalized_title) == "INTRODUCTION":
            continue

        match_index = None
        for idx in range(cursor, len(lines)):
            if heading_matches_reference_title(lines[idx], normalized_title):
                match_index = idx
                break
        if match_index is None:
            continue
        anchors.append((normalized_title, match_index))
        cursor = match_index + 1

    if not anchors:
        return build_sections(lines)

    sections: list[dict[str, object]] = []
    intro_title = str(reference_titles[0] if reference_titles else "Introduction").strip() or "Introduction"

    intro_lines = lines[: anchors[0][1]]
    intro_blocks = build_blocks_from_lines(intro_lines)
    if intro_blocks:
        sections.append({"title": intro_title, "blocks": intro_blocks})

    for index, (title, start) in enumerate(anchors):
        end = anchors[index + 1][1] if index + 1 < len(anchors) else len(lines)
        section_lines = list(lines[start + 1 : end])
        while section_lines and heading_matches_reference_title(section_lines[0], title):
            section_lines.pop(0)
        blocks = build_blocks_from_lines(section_lines)
        if blocks:
            sections.append({"title": title, "blocks": blocks})

    return sections


def attach_summary_points(sections: list[dict[str, object]]) -> list[dict[str, object]]:
    for section in sections:
        existing_points = section.get("summary_points")
        if isinstance(existing_points, list) and existing_points:
            cleaned = [str(point).strip() for point in existing_points if str(point).strip()]
            if cleaned:
                section["summary_points"] = cleaned
                continue

        blocks = section.get("blocks")
        if not isinstance(blocks, list):
            continue
        bullets = [str(block.get("text") or "").strip() for block in blocks if isinstance(block, dict) and block.get("type") == "bullet"]
        bullets = [point for point in bullets if point]
        paragraphs = [block for block in blocks if isinstance(block, dict) and block.get("type") != "bullet" and str(block.get("text") or "").strip()]
        if bullets and paragraphs:
            section["summary_points"] = bullets
    return sections


def clean_sections_content(sections: list[dict[str, object]]) -> list[dict[str, object]]:
    phase_titles = {
        "COMMAND PHASE",
        "MOVEMENT PHASE",
        "SHOOTING PHASE",
        "CHARGE PHASE",
        "FIGHT PHASE",
    }
    phase_overview_lines = {
        "Both players muster strategic resources, then you test your units' battle readiness.",
        "Your units manoeuvre across the battlefield and reinforcements enter the fray.",
        "Your units fire their ranged weapons at the foe.",
        "Your units charge forward to battle at close quarters.",
        "Both players' units pile in and attack with melee weapons.",
    }
    continuation_endings = {
        "its",
        "their",
        "the",
        "a",
        "an",
        "and",
        "or",
        "of",
        "to",
        "with",
        "for",
        "from",
        "in",
        "on",
        "by",
        "at",
        "up",
        "core",
        "that",
        "this",
        "those",
        "these",
        "same",
    }

    def is_noisy_paragraph(text: str) -> bool:
        stripped = text.strip()
        if not stripped:
            return True

        words = stripped.split()
        letters = sum(1 for ch in stripped if ch.isalpha())
        digits = sum(1 for ch in stripped if ch.isdigit())

        # Short all-caps labels from diagrams/tables.
        if re.fullmatch(r"[A-Z0-9][A-Z0-9 '\-:()./]{2,80}", stripped) and len(words) <= 6:
            return True

        # Measurement-only snippets like "B 6\"" or "3\" 8\"".
        if re.fullmatch(r"[A-Z]?\s*\d+\"(?:\s+\d+\")*", stripped):
            return True

        # Predominantly symbolic/number snippets are not readable prose.
        if len(stripped) <= 24 and letters < 6 and digits >= 1:
            return True
        if letters and len(stripped) >= 10 and (letters / len(stripped)) < 0.42 and digits >= 2:
            return True

        return False

    all_title_keys = {canonical_key(str(section.get("title") or "")) for section in sections if str(section.get("title") or "").strip()}
    all_title_keys = {key for key in all_title_keys if key}

    for section in sections:
        blocks = section.get("blocks")
        if not isinstance(blocks, list):
            continue

        cleaned_blocks: list[dict[str, object]] = []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            text = str(block.get("text") or "").strip()
            if not text:
                continue
            text = normalize_line(text)
            text = re.sub(r"^e\s+", "The ", text)
            text = re.sub(
                r"(^|[.!?]\s+)the\b",
                lambda match: f"{match.group(1)}The",
                text,
                flags=re.IGNORECASE,
            )
            if not text:
                continue
            if block.get("type") == "paragraph" and re.fullmatch(r"\d+", text):
                continue
            if block.get("type") == "paragraph" and re.fullmatch(r"[A-Z]", text):
                continue
            if block.get("type") == "paragraph" and re.fullmatch(r"Duration Up to \d+ hours", text):
                continue
            cleaned_blocks.append({"type": str(block.get("type") or "paragraph"), "text": text})

        section_key = canonical_key(str(section.get("title") or ""))
        filtered_blocks: list[dict[str, object]] = []
        for block in cleaned_blocks:
            if block.get("type") != "paragraph":
                filtered_blocks.append(block)
                continue
            text = str(block.get("text") or "").strip()
            if not text:
                continue
            if is_noisy_paragraph(text):
                continue
            text_key = canonical_key(text)

            # Remove bleed-through headings from neighboring sections.
            if text_key and text_key in all_title_keys and text_key != section_key:
                continue
            if text_key and text_key == section_key:
                continue

            # Remove short all-caps diagram labels (sequence boxes, map labels).
            if re.fullmatch(r"[A-Z0-9][A-Z0-9 '\-]{2,48}", text):
                words = text.split()
                if len(words) <= 4:
                    continue

            if section_key in phase_titles and "battle round has been completed and the next one begins" in text.lower():
                continue

            filtered_blocks.append({"type": "paragraph", "text": text})

        cleaned_blocks = filtered_blocks

        if section_key in phase_titles and cleaned_blocks:
            duplicate_title_index = next(
                (
                    idx
                    for idx, block in enumerate(cleaned_blocks)
                    if block.get("type") == "paragraph" and canonical_key(str(block.get("text") or "")) == section_key
                ),
                None,
            )
            if duplicate_title_index is not None and duplicate_title_index > 0:
                cleaned_blocks = cleaned_blocks[duplicate_title_index + 1 :]

            other_phase_titles = phase_titles - {section_key}
            cleaned_blocks = [
                block
                for block in cleaned_blocks
                if not (
                    block.get("type") == "paragraph"
                    and canonical_key(str(block.get("text") or "")) in other_phase_titles
                )
            ]
            cleaned_blocks = [
                block
                for block in cleaned_blocks
                if not (
                    block.get("type") == "paragraph"
                    and str(block.get("text") or "").strip() in phase_overview_lines
                )
            ]

        merged_blocks: list[dict[str, object]] = []
        for block in cleaned_blocks:
            if block.get("type") != "paragraph":
                merged_blocks.append(block)
                continue
            text = str(block.get("text") or "").strip()
            if re.match(r"^\d+\s+[a-z]", text):
                text = re.sub(r"^\d+\s+", "", text)
            text = re.sub(r"\band\s+\d+\s+you\b", "and you", text, flags=re.IGNORECASE)
            if not text:
                continue

            if merged_blocks and merged_blocks[-1].get("type") == "bullet":
                prev_bullet = str(merged_blocks[-1].get("text") or "").strip()
                prev_bullet_last = re.findall(r"[A-Za-z']+", prev_bullet.lower())
                prev_bullet_last = prev_bullet_last[-1] if prev_bullet_last else ""
                join_bullet = (
                    prev_bullet
                    and not prev_bullet.endswith((".", "!", "?", ":", ";"))
                    and (
                        bool(re.match(r"^[a-z]", text))
                        or bool(re.match(r"^\d+\s+[a-z]", text))
                        or (prev_bullet_last in continuation_endings)
                        or len(prev_bullet.split()) <= 10
                    )
                )
                if join_bullet:
                    merged_blocks[-1]["text"] = f"{prev_bullet} {re.sub(r'^\d+\s+', '', text)}".strip()
                    continue

            if merged_blocks and merged_blocks[-1].get("type") == "paragraph":
                prev = str(merged_blocks[-1].get("text") or "").strip()
                prev_last_word = re.findall(r"[A-Za-z']+", prev.lower())
                prev_last_word = prev_last_word[-1] if prev_last_word else ""
                join_by_ending = bool(prev_last_word and prev_last_word in continuation_endings)
                join_short_line = bool(prev and not prev.endswith((".", "!", "?", ":", ";")) and len(prev.split()) <= 10)
                if prev and (
                    should_join(prev, text)
                    or re.match(r"^[a-z]", text)
                    or re.match(r"^\d+\s+[a-z]", text)
                    or join_by_ending
                    or join_short_line
                ):
                    merged_blocks[-1]["text"] = f"{prev} {re.sub(r'^\d+\s+', '', text)}".strip()
                    continue
            merged_blocks.append({"type": "paragraph", "text": text})

        section["blocks"] = merged_blocks

    return sections


def rebalance_attack_sequence_sections(sections: list[dict[str, object]]) -> list[dict[str, object]]:
    section_by_title = {str(section.get("title") or ""): section for section in sections}
    hit = section_by_title.get("1. Hit Roll")
    wound = section_by_title.get("2. Wound Roll")
    allocate = section_by_title.get("3. Allocate Attack")
    saving = section_by_title.get("4. Saving Throw")
    if not hit or not wound or not allocate or not saving:
        return sections
    hit_blocks = list(hit.get("blocks") or [])
    wound_blocks = list(wound.get("blocks") or [])
    allocate_blocks = list(allocate.get("blocks") or [])
    if sum(len(blocks) for blocks in (hit_blocks, wound_blocks, allocate_blocks)) >= 8:
        return sections

    source_blocks = list(saving.get("blocks") or [])
    if len(source_blocks) < 12:
        return sections

    buckets: dict[str, list[dict[str, str]]] = {
        "hit": [],
        "wound": [],
        "allocate": [],
        "saving": [],
    }
    state = "hit"

    for raw_block in source_blocks:
        if not isinstance(raw_block, dict):
            continue
        block_type = str(raw_block.get("type") or "paragraph")
        text = normalize_line(str(raw_block.get("text") or ""))
        if not text:
            continue
        upper = text.upper()
        if "EACH TIME AN ATTACK SCORES A HIT AGAINST A TARGET UNIT" in upper:
            state = "wound"
        elif upper.startswith("IF AN ATTACK SUCCESSFULLY WOUNDS THE TARGET UNIT"):
            state = "allocate"
        elif "SAVING THROW" in upper and ("PLAYER CONTROLLING THE TARGET UNIT" in upper or upper.startswith("4. SAVING THROW")):
            state = "saving"
            text = re.sub(r"^\s*4\.\s*SAVING THROW\s*", "", text, flags=re.IGNORECASE).strip()

        if not text or text == "+":
            continue

        if state == "wound" and text.startswith("+ "):
            continue

        buckets[state].append({"type": block_type, "text": text})

    # Keep any fallback content if split failed, to avoid data loss.
    if not buckets["saving"]:
        return sections

    hit["blocks"] = buckets["hit"] or hit.get("blocks") or []
    wound["blocks"] = buckets["wound"] or wound.get("blocks") or []
    allocate["blocks"] = buckets["allocate"] or allocate.get("blocks") or []
    saving["blocks"] = buckets["saving"]
    return sections


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
    parser.add_argument(
        "--reference-sections",
        default="",
        help="Optional JSON file to reuse section title order (defaults to --out if it exists)",
    )
    parser.add_argument("--source-url", default="", help="Public URL for this PDF source (optional)")
    parser.add_argument(
        "--skip-first-pages",
        type=int,
        default=2,
        help="Skip this number of first PDF pages (default: 2, cover pages)",
    )
    parser.add_argument(
        "--include-pages",
        action="store_true",
        help="Include extracted page lines in output payload (debug / diagnostics)",
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
    reference_path: Path | None = None
    if args.reference_sections:
        reference_path = Path(args.reference_sections)
    else:
        default_reference = Path("docs/data/core_rules.json")
        if default_reference.exists():
            reference_path = default_reference
        elif out_path.exists():
            reference_path = out_path
    reference_titles = load_reference_section_titles(reference_path) if reference_path else []
    sections = build_sections_from_reference_titles(lines, reference_titles) if reference_titles else build_sections(lines)
    tooltip_sections = extract_tooltip_sections(lines)
    sections = merge_sections(sections, tooltip_sections)
    sections = apply_section_overrides(sections)
    sections = rebalance_attack_sequence_sections(sections)
    sections = clean_sections_content(sections)
    sections = attach_summary_points(sections)
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
        "sections": sections,
        "tooltip_rules": tooltip_rules,
    }
    if args.include_pages:
        payload["pages"] = pages
    if args.include_source_file:
        payload["source_file"] = str(pdf_path)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} with {len(sections)} sections")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

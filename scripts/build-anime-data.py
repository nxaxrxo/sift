#!/usr/bin/env python3
"""build-anime-data.py - regenerate data/anime-titles.json + functions/_lib/anime-terms.mjs.

Source of truth for the titles is the Daily Beacon's MAL export (his own list, every
entry rated 9 or 10 - he does not finish what he dislikes). Aliases are hand-written
here because the free Jikan API is unreliable from this machine, and a wrong alias is
worse than a missing one: an alias that fires on unrelated headlines puts anime cards
on a gaming board.

Rule for aliases: english title, romaji title, and the short name fans actually use.
Never a generic english word ("Erased", "Elite") unless it is unmistakable.

Run after any change to the list:
    python scripts/build-anime-data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BEACON = ROOT.parent / "daily-beacon" / "config" / "anime.json"
OUT_JSON = ROOT / "data" / "anime-titles.json"
OUT_JS = ROOT / "functions" / "_lib" / "anime-terms.mjs"

# romaji (as it appears in the MAL export) -> extra things it is called
ALIASES: dict[str, list[str]] = {
    "Golden Boy": [],
    "Hellsing Ultimate": ["Hellsing"],
    "Death Note": [],
    "Shingeki no Kyojin": ["Attack on Titan", "Shingeki"],
    "Outbreak Company": [],
    "Tokyo Ghoul": [],
    "Kiseijuu: Sei no Kakuritsu": ["Parasyte"],
    "Overlord": ["Overlord anime"],
    "One Punch Man": ["One-Punch Man", "OnePunch Man"],
    "Kono Subarashii Sekai ni Shukufuku wo!": ["KonoSuba", "Konosuba"],
    "Boku no Hero Academia": ["My Hero Academia", "Hero Academia", "BnHA", "MHA"],
    "Sakamoto desu ga?": ["Sakamoto Days is not this", "Haven't You Heard I'm Sakamoto"],
    "91 Days": [],
    "Saiki Kusuo no Ψ-nan": ["Saiki K", "Disastrous Life of Saiki K"],
    "Boku no Hero Academia 2nd Season": ["My Hero Academia season 2"],
    "Inuyashiki": ["Inuyashiki Last Hero"],
    "Aho Girl": ["Aho-Girl"],
    "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e": ["Classroom of the Elite"],
    "Boku no Hero Academia 3rd Season": ["My Hero Academia season 3"],
    "Goblin Slayer": [],
    "Tensei shitara Slime Datta Ken": [
        "That Time I Got Reincarnated as a Slime", "Slime Isekai", "TenSura",
    ],
    "Dororo": [],
    "Vinland Saga": [],
    "Overlord III": ["Overlord season 3"],
    "Yakusoku no Neverland": ["The Promised Neverland"],
    "Isekai Quartet": [],
    "Shingeki no Kyojin Season 3 Part 2": ["Attack on Titan season 3 part 2"],
    "Shinchou Yuusha: Kono Yuusha ga Ore Tueee Kuse ni Shinchou Sugiru": ["Cautious Hero"],
    "Dr. Stone": ["Doctor Stone"],
    "Hataage! Kemono Michi": ["Kemono Michi"],
    "Mairimashita! Iruma-kun": ["Welcome to Demon School Iruma-kun", "Iruma-kun"],
    "Gleipnir": [],
    "Mushoku Tensei: Isekai Ittara Honki Dasu": ["Mushoku Tensei", "Jobless Reincarnation"],
    "Tensei shitara Slime Datta Ken 2nd Season": ["Slime season 2"],
    "Isekai Quartet 2": ["Isekai Quartet season 2"],
    "Shingeki no Kyojin: The Final Season": ["Attack on Titan final season"],
    "Kimetsu no Yaiba Movie: Mugen Ressha-hen": ["Demon Slayer", "Demon Slayer Mugen Train", "Mugen Train", "Kimetsu no Yaiba"],
    "Dr. Stone: Stone Wars": ["Dr. Stone season 2"],
    "Chainsaw Man": [],
    "Koroshi Ai": ["Love of Kill"],
    "Niehime to Kemono no Ou": ["Sacrificial Princess and the King of Beasts"],
    "Jigokuraku": ["Hell's Paradise", "Hells Paradise"],
    "Kimetsu no Yaiba: Yuukaku-hen": ["Demon Slayer Entertainment District"],
    "Shingeki no Kyojin: The Final Season Part 2": ["Attack on Titan final season part 2"],
    "Blue Lock": [],
    "Migi to Dali": ["Migi and Dali"],
    "Jujutsu Kaisen 2nd Season": ["Jujutsu Kaisen season 2", "JJK season 2"],
    "Mashle": ["Mashle Magic and Muscles"],
    "Ore dake Level Up na Ken": ["Solo Leveling"],
    "Oemojisangjuui": ["Lookism"],
    "Kimi no Koto ga Daidaidaidaidaisuki na 100-nin no Kanojo": ["100 Girlfriends"],
    "Kikansha no Mahou wa Tokubetsu desu": ["A Returner's Magic Should Be Special"],
    "Mashle: Shinkakusha Kouho Senbatsu Shiken-hen": ["Mashle season 2"],
    "Dandadan": ["Dan Da Dan"],
    "Ore dake Level Up na Ken Season 2: Arise from the Shadow": ["Solo Leveling season 2"],
    "Dandadan 2nd Season": ["Dandadan season 2"],
    "Mononoke Hime": ["Princess Mononoke"],
    "Devil May Cry": ["Devil May Cry anime"],
    "Darker than Black: Kuro no Keiyakusha": ["Darker than Black"],
    "Ookami to Koushinryou": ["Spice and Wolf"],
    "Fullmetal Alchemist: Brotherhood": ["Fullmetal Alchemist Brotherhood", "FMAB", "FMA Brotherhood"],
    "Kaichou wa Maid-sama!": ["Maid Sama"],
    "Steins;Gate": ["Steins Gate"],
    "Ao no Exorcist": ["Blue Exorcist"],
    "Mirai Nikki (TV)": ["Future Diary", "Mirai Nikki"],
    "Ookami Kodomo no Ame to Yuki": ["Wolf Children"],
    "Nazo no Kanojo X": ["Mysterious Girlfriend X"],
    "Tonari no Kaibutsu-kun": ["My Little Monster"],
    "Hataraku Maou-sama!": ["The Devil is a Part-Timer", "Devil is a Part Timer"],
    "No Game No Life": ["No Game, No Life"],
    "Noragami": [],
    "Witch Craft Works": [],
    "Barakamon": [],
    "Zankyou no Terror": ["Terror in Resonance"],
    "Shingeki no Kyojin Season 2": ["Attack on Titan season 2"],
    "Tokyo Ghoul √A": ["Tokyo Ghoul Root A"],
    "Shokugeki no Souma": ["Food Wars"],
    "Death Parade": [],
    "Rokka no Yuusha": ["Rokka Braves of the Six Flowers"],
    "Yamada-kun to 7-nin no Majo": ["Yamada-kun and the Seven Witches"],
    "Himouto! Umaru-chan": ["Umaru-chan"],
    "Noragami Aragoto": ["Noragami season 2"],
    "Shingeki no Bahamut: Virgin Soul": ["Rage of Bahamut Virgin Soul"],
    "Boku dake ga Inai Machi": ["Erased anime"],
    "Mob Psycho 100": ["Mob Psycho"],
    "Shokugeki no Souma: Ni no Sara": ["Food Wars season 2"],
    "Kono Subarashii Sekai ni Shukufuku wo! 2": ["KonoSuba season 2"],
    "Masamune-kun no Revenge": ["Masamune-kun's Revenge"],
    "Demi-chan wa Kataritai": ["Interviews with Monster Girls"],
    "One Punch Man 2nd Season": ["One Punch Man season 2"],
    "Made in Abyss": [],
    "Kakegurui": ["Kakegurui Compulsive Gambler"],
    "Overlord II": ["Overlord season 2"],
    "Shingeki no Kyojin Season 3": ["Attack on Titan season 3"],
    "Shokugeki no Souma: San no Sara": ["Food Wars season 3"],
    "Tate no Yuusha no Nariagari": ["The Rising of the Shield Hero", "Shield Hero"],
    "Darling in the FranXX": ["Darling in the Franxx", "DarliFra"],
    "Wotaku ni Koi wa Muzukashii": ["Wotakoi"],
    "Sword Art Online: Alicization": ["Sword Art Online Alicization"],
    "Made in Abyss Movie 3: Fukaki Tamashii no Reimei": ["Made in Abyss Dawn of the Deep Soul"],
}

# Three entries he rated highly but marked dropped - a remake or sequel is not
# automatically good news, and the Beacon's contract already says so.
DROPPED = {"Sakamoto desu ga?", "Fullmetal Alchemist: Brotherhood", "Tonari no Kaibutsu-kun"}


def main() -> int:
    if not BEACON.exists():
        print(f"missing MAL export: {BEACON}", file=sys.stderr)
        return 1

    export = json.loads(BEACON.read_text(encoding="utf-8"))
    rows = []
    missing = []

    for entry in export["titles"]:
        name = entry["title"]
        if name not in ALIASES:
            missing.append(name)
            extra = []
        else:
            extra = ALIASES[name]

        aliases = []
        for value in [name, *extra]:
            value = value.strip()
            if len(value) < 4 or value in aliases:
                continue
            aliases.append(value)

        rows.append({
            "title": name,
            "aliases": aliases,
            "score": entry.get("score"),
            "status": entry.get("status"),
            "type": entry.get("type"),
            "genres": entry.get("genres", []),
            "dropped": name in DROPPED,
        })

    payload = {
        "note": (
            "The owner's MyAnimeList titles, all rated 9-10/10. Sift matches these (and their english "
            "aliases) against headlines to fire the anime boost. An entry with \"dropped\": true was "
            "rated highly but abandoned - still his taste, just not a guaranteed win."
        ),
        "source": "daily-beacon/config/anime.json + hand-written english aliases",
        "count": len(rows),
        "titles": rows,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    # Flat, deduped, lowercase term list for the scorer. Longest first so a match on
    # the full title is preferred over its short form when both are present.
    terms: list[str] = []
    for row in rows:
        for alias in row["aliases"]:
            key = alias.lower()
            if key not in terms:
                terms.append(key)
    terms.sort(key=len, reverse=True)

    body = (
        "// GENERATED by scripts/build-anime-data.py - do not edit by hand.\n"
        "// Every term below comes from the owner's own MAL list (9-10/10 ratings) or a\n"
        "// hand-checked english alias of one of those titles.\n\n"
        f"export const ANIME_TERMS = {json.dumps(terms, ensure_ascii=False, indent=1)};\n"
    )
    OUT_JS.write_text(body, encoding="utf-8")

    print(f"titles={len(rows)} terms={len(terms)}")
    if missing:
        print(f"NO ALIAS ENTRY ({len(missing)}): " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

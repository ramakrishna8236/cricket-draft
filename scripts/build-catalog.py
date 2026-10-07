#!/usr/bin/env python3
"""Build the compact Cricket Draft catalog from Cricsheet's open match archives.

Inputs are downloaded from https://cricsheet.org/downloads/ and
https://cricsheet.org/register/. Run with --data-dir pointing at those files.
The generated output is checked into the app so game clients need no live API.
"""

import argparse
import csv
import json
import math
import re
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path


FORMATS = {"t20": "T20", "odi": "ODI", "test": "Test", "ipl": "IPL"}
INTERNATIONAL = {"t20", "odi", "test"}
TARGETS = {
    "t20": {"runs": 2500, "average": 42, "per_match": 45, "strike": 170, "wickets": 120, "wpm": 1.8, "economy": 6.5, "bowl_average": 16},
    "odi": {"runs": 6500, "average": 58, "per_match": 70, "strike": 125, "wickets": 200, "wpm": 2.1, "economy": 3.6, "bowl_average": 18},
    "test": {"runs": 7000, "average": 58, "per_match": 85, "strike": 100, "wickets": 350, "wpm": 4.0, "economy": 2.2, "bowl_average": 19},
    "ipl": {"runs": 6000, "average": 48, "per_match": 48, "strike": 180, "wickets": 180, "wpm": 1.7, "economy": 6.8, "bowl_average": 17},
}
NO_BOWLER_CREDIT = {"run out", "retired hurt", "retired out", "obstructing the field"}
NAME_OVERRIDES = {
    "ba607b88": "Virat Kohli",
    "462411b3": "Jasprit Bumrah",
    "740742ef": "Rohit Sharma",
    "271f83cd": "Suryakumar Yadav",
    "b4b99816": "Shubman Gill",
    "dbe50b21": "Hardik Pandya",
    "244048f6": "Arshdeep Singh",
    "2f49c897": "Mohammed Siraj",
    "8d2c70ad": "Kuldeep Yadav",
    "ded9240e": "Pat Cummins",
    "30a45b23": "Steve Smith",
    "f19ccfad": "Washington Sundar",
    "b0482a1d": "Tilak Varma",
    "5b7ab5a9": "Varun Chakaravarthy",
    "df064e1a": "Ravi Bishnoi",
    "6c19c6e5": "Yashasvi Jaiswal",
    "45a43fe2": "Ruturaj Gaikwad",
    "aad0c365": "Nitish Kumar Reddy",
    "85e0cf10": "Prasidh Krishna",
    "2cffab74": "Mukesh Kumar",
    "f986ca1a": "Harshal Patel",
    "23eeb873": "Deepak Chahar",
}
ROLE_OVERRIDES = {
    "2e171977": "AR",    # Axar Patel
    "f19ccfad": "AR",    # Washington Sundar
    "a4e37e47": "AR",    # Shivam Dube
    "fa433be6": "BAT",   # Marnus Labuschagne
    "a343262c": "BAT",   # Joe Root
    "50c6bc2b": "AR",    # Liam Livingstone
    "a97c8ec2": "AR",    # Wanindu Hasaranga
    "c5aef772": "AR",    # Romario Shepherd
    "7d5af2ea": "BAT",   # Kraigg Brathwaite
    "d405c0d5": "AR",    # Aaron Hardie
}

# Recent ICC tournament squads supply verified full names for common initials.
# Squad participation is not used as the eligibility rule; match appearances are.
OFFICIAL_ROSTER_NAMES = {
    "India": "Rohit Sharma, Shubman Gill, Virat Kohli, Shreyas Iyer, KL Rahul, Rishabh Pant, Hardik Pandya, Axar Patel, Washington Sundar, Kuldeep Yadav, Harshit Rana, Mohammed Shami, Arshdeep Singh, Ravindra Jadeja, Varun Chakaravarthy, Suryakumar Yadav, Abhishek Sharma, Tilak Varma, Sanju Samson, Shivam Dube, Ishan Kishan, Jasprit Bumrah, Rinku Singh, Yashasvi Jaiswal, Mohammed Siraj",
    "Australia": "Steve Smith, Sean Abbott, Alex Carey, Ben Dwarshuis, Nathan Ellis, Jake Fraser-McGurk, Aaron Hardie, Travis Head, Josh Inglis, Spencer Johnson, Marnus Labuschagne, Glenn Maxwell, Tanveer Sangha, Matthew Short, Adam Zampa, Cooper Connolly, Mitchell Marsh, Xavier Bartlett, Tim David, Cameron Green, Matthew Kuhnemann, Matthew Renshaw, Marcus Stoinis",
    "England": "Jos Buttler, Jofra Archer, Gus Atkinson, Tom Banton, Harry Brook, Rehan Ahmed, Ben Duckett, Jamie Overton, Jamie Smith, Liam Livingstone, Adil Rashid, Joe Root, Saqib Mahmood, Phil Salt, Mark Wood, Jacob Bethell, Sam Curran, Liam Dawson, Will Jacks, Josh Tongue, Luke Wood",
    "South Africa": "Temba Bavuma, Tony de Zorzi, Marco Jansen, Heinrich Klaasen, Keshav Maharaj, Aiden Markram, David Miller, Wiaan Mulder, Lungi Ngidi, Kagiso Rabada, Ryan Rickelton, Tabraiz Shamsi, Tristan Stubbs, Rassie van der Dussen, Corbin Bosch, Dewald Brevis, Quinton de Kock, George Linde, Kwena Maphaka, Anrich Nortje, Jason Smith",
    "New Zealand": "Mitchell Santner, Michael Bracewell, Mark Chapman, Devon Conway, Lockie Ferguson, Matt Henry, Tom Latham, Daryl Mitchell, Will O'Rourke, Glenn Phillips, Rachin Ravindra, Nathan Smith, Kane Williamson, Will Young, Jacob Duffy, Finn Allen, Kyle Jamieson, James Neesham, Tim Seifert, Ish Sodhi, Cole McConchie",
    "Pakistan": "Mohammad Rizwan, Babar Azam, Imam-ul-Haq, Kamran Ghulam, Saud Shakeel, Tayyab Tahir, Faheem Ashraf, Khushdil Shah, Salman Ali Agha, Usman Khan, Abrar Ahmed, Haris Rauf, Mohammad Hasnain, Naseem Shah, Shaheen Shah Afridi, Fakhar Zaman, Khawaja Nafay, Mohammad Nawaz, Salman Mirza, Sahibzada Farhan, Saim Ayub, Shadab Khan, Usman Tariq",
    "West Indies": "Shai Hope, Shimron Hetmyer, Johnson Charles, Roston Chase, Matthew Forde, Jason Holder, Akeal Hosein, Shamar Joseph, Brandon King, Gudakesh Motie, Rovman Powell, Sherfane Rutherford, Quentin Sampson, Jayden Seales, Romario Shepherd",
    "Sri Lanka": "Dasun Shanaka, Pathum Nissanka, Kamil Mishara, Kusal Mendis, Kamindu Mendis, Kusal Perera, Charith Asalanka, Janith Liyanage, Pavan Rathnayake, Dushan Hemantha, Dunith Wellalage, Maheesh Theekshana, Dushmantha Chameera, Matheesha Pathirana, Eshan Malinga",
    "Afghanistan": "Hashmatullah Shahidi, Ibrahim Zadran, Rahmanullah Gurbaz, Sediqullah Atal, Rahmat Shah, Ikram Alikhil, Gulbadin Naib, Azmatullah Omarzai, Mohammad Nabi, Rashid Khan, Nangyal Kharoti, Noor Ahmad, Fazalhaq Farooqi, Farid Malik, Naveed Zadran, Darwish Rasooli, Mujeeb Ur Rahman",
}


def new_stats():
    return {"matches": 0, "runs": 0, "bat_balls": 0, "outs": 0,
            "wickets": 0, "bowl_balls": 0, "conceded": 0}


def load_names(data_dir):
    people = {}
    with (data_dir / "cricket-people.csv").open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            people[row["identifier"]] = row["unique_name"] or row["name"]
    candidates = defaultdict(list)
    with (data_dir / "cricket-names.csv").open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            candidates[row["identifier"]].append(row["name"])
    for player_id, options in candidates.items():
        if player_id not in people:
            continue
        # The register's full unique name is usually more reliable than aliases;
        # e.g. "Sikandar Raza" has an obsolete "SR Butt" alias.
        primary = people[player_id]
        if len(primary.split()) >= 2 and len(primary.split()[0]) > 2:
            continue
        valid = [name for name in options if len(name.split()) >= 2 and not re.search(r"\(\d+\)$", name)]
        if valid:
            people[player_id] = max(valid, key=lambda name: (
                sum(len(part) > 2 for part in name.split()), len(name.split()), len(name)))
    people.update(NAME_OVERRIDES)
    return people


def expanded_name(short_name, country):
    roster = OFFICIAL_ROSTER_NAMES.get(country, "")
    if not roster or not re.search(r"(^|\s)[A-Z][A-Za-z]?\s", short_name):
        return short_name
    surname = re.sub(r"[^a-z]", "", short_name.split()[-1].lower())
    initial = short_name[0].lower()
    matches = [name.strip() for name in roster.split(",") if
               re.sub(r"[^a-z]", "", name.strip().split()[-1].lower()) == surname and
               name.strip()[0].lower() == initial]
    return matches[0] if len(matches) == 1 else short_name


def aggregate_match(match, format_key, stats, recent_countries, all_countries, cutoff, as_of):
    info = match.get("info", {})
    match_date = info.get("dates", [""])[0]
    if match_date < "2010-01-01" or match_date > as_of or info.get("gender") != "male":
        return
    if format_key in INTERNATIONAL and info.get("team_type") != "international":
        return
    registry = info.get("registry", {}).get("people", {})
    participants = info.get("players", {})
    for country, players in participants.items():
        for short_name in players:
            player_id = registry.get(short_name)
            if not player_id:
                continue
            stats[format_key][player_id]["matches"] += 1
            if format_key in INTERNATIONAL:
                all_countries[player_id][country] += 1
                if match_date >= cutoff:
                    recent_countries[player_id][country] += 1
    for innings in match.get("innings", []):
        for over in innings.get("overs", []):
            for ball in over.get("deliveries", []):
                batter = registry.get(ball.get("batter"))
                bowler = registry.get(ball.get("bowler"))
                extras = ball.get("extras", {})
                runs = ball.get("runs", {})
                if batter:
                    batting = stats[format_key][batter]
                    batting["runs"] += runs.get("batter", 0)
                    if "wides" not in extras:
                        batting["bat_balls"] += 1
                if bowler:
                    bowling = stats[format_key][bowler]
                    bowling["conceded"] += runs.get("total", 0) - extras.get("byes", 0) - extras.get("legbyes", 0) - extras.get("penalty", 0)
                    if "wides" not in extras and "noballs" not in extras:
                        bowling["bowl_balls"] += 1
                for wicket in ball.get("wickets", []):
                    dismissed = registry.get(wicket.get("player_out"))
                    if dismissed and wicket.get("kind") != "retired hurt":
                        stats[format_key][dismissed]["outs"] += 1
                    if bowler and wicket.get("kind") not in NO_BOWLER_CREDIT:
                        stats[format_key][bowler]["wickets"] += 1


def cap(value):
    return max(0.0, min(1.0, value))


def format_scores(record, format_key):
    target = TARGETS[format_key]
    matches = max(1, record["matches"])
    runs = record["runs"]
    wickets = record["wickets"]
    batting_average = runs / max(1, record["outs"])
    strike_rate = runs * 100 / max(1, record["bat_balls"])
    runs_per_match = runs / matches
    bowling_average = record["conceded"] / max(1, wickets)
    economy = record["conceded"] * 6 / max(1, record["bowl_balls"])
    wickets_per_match = wickets / matches
    bat = 100 * (
        .18 * cap(math.log1p(runs) / math.log1p(target["runs"]))
        + .32 * cap(batting_average / target["average"])
        + .32 * cap(runs_per_match / target["per_match"])
        + .18 * cap(strike_rate / target["strike"])
    )
    bowl = 100 * (
        .20 * cap(math.log1p(wickets) / math.log1p(target["wickets"]))
        + .32 * cap(wickets_per_match / target["wpm"])
        + .28 * cap(target["bowl_average"] / max(1, bowling_average))
        + .20 * cap(target["economy"] / max(1, economy))
    ) if record["bowl_balls"] >= 6 else 0
    confidence = .68 + .32 * cap(math.sqrt(record["matches"] / 24))
    return {"bat": round(bat * confidence), "bowl": round(bowl * confidence)}


def role_for(records):
    matches = sum(item["matches"] for item in records)
    if matches == 0:
        return "BAT"
    runs = sum(item["runs"] for item in records)
    bowl_balls = sum(item["bowl_balls"] for item in records)
    wickets = sum(item["wickets"] for item in records)
    batting_presence = runs / matches
    bowling_presence = bowl_balls / matches
    if batting_presence >= 22 and wickets / matches < .35:
        return "BAT"
    if batting_presence >= 15 and bowling_presence >= 12 and wickets / matches >= .25:
        return "AR"
    if bowling_presence >= 12 and wickets >= 5:
        return "BOWL"
    return "BAT"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("/private/tmp"))
    parser.add_argument("--output", type=Path, default=Path("src/data/catalog.json"))
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    args = parser.parse_args()
    cutoff = args.as_of.replace(year=args.as_of.year - 5).isoformat()
    names = load_names(args.data_dir)
    stats = {key: defaultdict(new_stats) for key in FORMATS}
    recent_countries = defaultdict(lambda: defaultdict(int))
    all_countries = defaultdict(lambda: defaultdict(int))
    for format_key in FORMATS:
        archive = args.data_dir / f"cricket-{format_key}.zip"
        with zipfile.ZipFile(archive) as source:
            files = [name for name in source.namelist() if name.endswith(".json")]
            for index, filename in enumerate(files, 1):
                with source.open(filename) as item:
                    aggregate_match(json.load(item), format_key, stats, recent_countries, all_countries, cutoff, args.as_of.isoformat())
                if index % 1000 == 0:
                    print(f"{format_key}: {index}/{len(files)} matches")
    countries = defaultdict(list)
    for player_id, recent in recent_countries.items():
        country, recent_count = max(recent.items(), key=lambda item: item[1])
        if recent_count < 2 or all_countries[player_id][country] < 5:
            continue
        records = [stats[key][player_id] for key in FORMATS]
        role = ROLE_OVERRIDES.get(player_id, role_for(records))
        ratings = {}
        appearances = {}
        for format_key in FORMATS:
            record = stats[format_key][player_id]
            if record["matches"] < (3 if format_key == "ipl" else 2):
                continue
            values = format_scores(record, format_key)
            rating = (values["bat"] + values["bowl"]) / 2 if role == "AR" else values["bowl"] if role == "BOWL" else values["bat"]
            ratings[format_key] = max(1, min(100, round(rating)))
            appearances[format_key] = record["matches"]
        if not ratings:
            continue
        name = expanded_name(names.get(player_id, player_id), country)
        countries[country].append({"id": player_id, "name": name, "role": role,
                                   "ratings": ratings, "appearances": appearances,
                                   "recentInternationalMatches": recent_count})
    output_countries = []
    for country, players in sorted(countries.items()):
        players.sort(key=lambda player: (player["recentInternationalMatches"], max(player["ratings"].values())), reverse=True)
        selected = players[:80]
        if len(selected) >= 10:
            output_countries.append({"name": country, "players": selected})
    # Turn the format performance scores into a relative format ranking component.
    # It is a Cricket Draft rank derived from match records, not an ICC rating.
    for format_key in FORMATS:
        ranked = [player for country in output_countries for player in country["players"] if format_key in player["ratings"]]
        ranked.sort(key=lambda player: player["ratings"][format_key], reverse=True)
        span = max(1, len(ranked) - 1)
        for index, player in enumerate(ranked):
            percentile = round(100 * (1 - index / span))
            raw = player["ratings"][format_key]
            player["ratings"][format_key] = max(1, min(100, round(.8 * raw + .2 * percentile)))
    output = {"source": "Cricsheet match data and player register", "asOf": args.as_of.isoformat(),
              "eligibilityStart": cutoff, "countries": output_countries}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"Saved {len(output_countries)} countries and {sum(len(country['players']) for country in output_countries)} players to {args.output}")
    for country in output_countries:
        sizes = {key: sum(key in player["ratings"] for player in country["players"]) // 5 for key in FORMATS}
        print(country["name"], len(country["players"]), sizes)


if __name__ == "__main__":
    main()

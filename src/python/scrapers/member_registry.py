import re
from datetime import datetime
from dateutil.relativedelta import relativedelta

MEMBER_PROTOCOL_SINCE_YEAR = (datetime.now() - relativedelta(years=1)).year
MEMBER_PROTOCOL_SINCE_DATE = (datetime.now() - relativedelta(years=1)).strftime("%Y-%m-%d")

PARTY_NAMES = {
    "הליכוד",
    "יש עתיד",
    "הציונות הדתית",
    "כחול לבן המחנה הממלכתי",
    "הימין הממלכתי",
    'ש"ס',
    "יהדות התורה",
    "ישראל ביתנו",
    'חד"ש - תע"ל',
    'רע"מ',
    "העבודה",
    "עוצמה יהודית",
    "נעם",
}

RAW_MEMBER_LIST = """
הליכוד
בנימין נתניהו
יריב לוין
אלי אליהו כהן
דוד אמסלם
אמיר אוחנה
יואב קיש
ניר ברקת
מירי מרים רגב
מכלוף מיקי זוהר
אבי דיכטר
ישראל כ"ץ
שלמה קרעי
עמיחי שיקלי
עידית סילמן
דוד ביטן
יולי (יואל) אדלשטיין
אליהו רביבו
גלית דיסטל אטבריאן
ניסים ואטורי
שלום דנינו
חיים כץ
טלי גוטליב
חנוך דב מלביצקי
בועז ביסמוט
משה סעדה
אלי דלל
גילה גמליאל
אופיר כץ
מאי גולן
חוה אתי עטיה
דן אליהו יעקב אילוז
עמית הלוי
אריאל קלנר
אושר שקלים
צגה צגנש מלקו
ששון ששי גואטה
קטי קטרין שטרית
משה פסל
אביחי אברהם בוארון
עפיף עבד

יש עתיד
יאיר לפיד
מאיר כהן
קארין אלהרר
מירב כהן
אלעזר שטרן
מיקי לוי
מירב בן-ארי
רם בן ברק
יואב סגלוביץ'
בועז טופורובסקי
שיר מיכל סגמן
יוראי להב הרצנו
ולדימיר בליאק
רון כץ
מטי צרפתי הרכבי
טטיאנה מזרסקי
יסמין סאקס פרידמן
דבורה דבי ביטון
משה טור פז
סימון דוידסון
נאור שירי
שלי טל מירון
ירון לוי
עדי עזוז

הציונות הדתית
בצלאל סמוטריץ'
אופיר סופר
אורית סטרוק
שמחה רוטמן
מיכל מרים וולדיגר
אוהד טל
משה סולומון

כחול לבן המחנה הממלכתי
בני גנץ
פנינה תמנו
חילי טרופר
מיכאל מרדכי ביטון
אורית פרקש הכהן
אלון שוסטר
איתן גינזבורג
יעל רון בן משה

הימין הממלכתי
גדעון סער
זאב אלקין
שרן השכל
מישל בוסקילה

ש"ס
אריה מכלוף דרעי
יעקב מרגי
יואב בן צור
מיכאל מלכיאלי
חיים ביטון
משה ארבל
ינון אזולאי
משה אבוטבול
אוריאל בוסו
יוסף טייב
יונתן מישריקי

יהדות התורה
יצחק גולדקנופף
משה גפני
מאיר פרוש
אורי מקלב
יעקב טסלר
יעקב אשר
ישראל אייכלר

ישראל ביתנו
אביגדור ליברמן
עודד פורר
יבגני סובה
שרון ניר
יוליה מלינובסקי
חמד עמאר

חד"ש - תע"ל
איימן עודה
אחמד טיבי
עאידה תומא סלימאן
עופר כסיף
יוסף עטאונה
סמיר בן סעיד

רע"מ
מנסור עבאס
ווליד טאהא
ואליד אלהואשלה
אימאן ח'טיב יאסין
יאסר חג'יראת

העבודה
מרב מיכאלי
נעמה לזימי
גלעד קריב
אפרת רייטן מרום

עוצמה יהודית
איתמר בן גביר
יצחק שמעון וסרלאוף
אלמוג כהן
עמיחי אליהו
צביקה פוגל
לימור סון הר מלך
יצחק קרויזר

נעם
אבי מעוז
"""

EXTRA_ALIASES = {
    "אלי אליהו כהן": ["אלי כהן"],
    "מירי מרים רגב": ["מירי רגב"],
    "מכלוף מיקי זוהר": ["מיקי זוהר"],
    'ישראל כ"ץ': ["ישראל כץ"],
    "יולי (יואל) אדלשטיין": ["יולי אדלשטיין", "יואל אדלשטיין", "יולי יואל אדלשטיין"],
    "חוה אתי עטיה": ["חוה עטייה", "אתי עטיה", "אתי עטייה", "חוה אתי עטייה", "עטייה חוה אתי", "עטיה חוה אתי"],
    "דן אליהו יעקב אילוז": ["דן אילוז"],
    "קטי קטרין שטרית": ["קטי שטרית", "קתי שטרית", "קטי קתרין שטרית"],
    "שיר מיכל סגמן": ["מיכל שיר", "מיכל שיר סגמן"],
    "יוראי להב הרצנו": ["יוראי להב-הרצנו", "יוראי הרצנו"],
    "יסמין סאקס פרידמן": ["יסמין פרידמן", "יסמין סאקס-פרידמן"],
    "דבורה דבי ביטון": ["דבי ביטון"],
    "משה טור פז": ["משה טור-פז", "משה קינלי טור פז", "משה קינלי טור-פז", "קינלי טור פז", "טור פז משה"],
    "שלי טל מירון": ["שלי מירון", "שלי טל-מירון", "שלי ט ל מירון"],
    "אורית סטרוק": ["אורית מלכה סטרוק"],
    "גלית דיסטל אטבריאן": ["דיסטל אטבריאן גלית"],
    "פנינה תמנו": ["פנינה תמנו שטה", "פנינה תמנו-שטה"],
    "אורית פרקש הכהן": ["אורית פרקש-הכהן", "אורית פרקשה הכהן", "אורית פרקייש הכהן"],
    "שרן השכל": ["השכל שרן מרים", "שרן מרים השכל"],
    "יעל רון בן משה": ["יעל בן משה", "יעל רון-בן משה", "רון בן משה יעל"],
    "אריה מכלוף דרעי": ["אריה דרעי"],
    "יונתן מישריקי": ["יונתן מישרקי", "מישרקי יונתן"],
    "עאידה תומא סלימאן": ["עאידה תומא-סלימאן"],
    "אימאן ח'טיב יאסין": ["אימאן חטיב יאסין", "אימאן ח'טיב-יאסין", "ח'טיב יאסין אימאן"],
    "יאסר חג'יראת": ["יאסר חוג'יראת"],
    "יצחק שמעון וסרלאוף": ["יצחק וסרלאוף"],
    "לימור סון הר מלך": ["סון הר מלך לימור"],
    "אפרת רייטן מרום": ["אפרת רייטן", "אפרת רייטן-מרום"],
    "ירון לוי": ["ירון עמוס לוי"],
    "שרון ניר": ["שרון ביתנו ניר"],
    "סמיר בן סעיד": ["סמיר אל סעיד"],
    "אלעזר שטרן": ["אלעזר שטרן-יועמ\"ש"],
}

EXTRA_MEMBERS = [
    {
        "id": "member-131",
        "name": "צבי ידידיה סוכות",
        "partyName": "הציונות הדתית",
        "aliases": ["סוכות צבי ידידיה", "צבי סוכות", "ידידיה סוכות"],
    },
    {
        "id": "member-132",
        "name": "אכרם חסון",
        "partyName": "הימין הממלכתי",
        "aliases": ["חסון אכרם"],
    },
    {
        "id": "member-133",
        "name": "יצחק זאב פינדרוס",
        "partyName": "יהדות התורה",
        "aliases": ["פינדרוס יצחק זאב", "יצחק פינדרוס"],
    },
]

def slugify_text(value):
    val = str(value or "").strip()
    val = re.sub(r'[^\w\s-]', '', val).strip().lower()
    val = re.sub(r'[-\s]+', '-', val)
    return val

def normalize_name_spacing(value):
    return re.sub(r'\s+', ' ', str(value or "")).strip()

def tokenize_name(value):
    val = str(value or "")
    val = re.sub(r'[\'\"״׳`]', '', val)
    val = re.sub(r'[()]', ' ', val)
    val = re.sub(r'[-‐‑‒–—―־/]+', ' ', val)
    val = re.sub(r'[^\w\s]+', ' ', val)
    return [t for t in normalize_name_spacing(val).split(' ') if t]

def normalize_loose_hebrew_token(token):
    val = str(token or "").lower()
    val = re.sub(r'יי+', 'י', val)
    val = re.sub(r'וו+', 'ו', val)
    val = re.sub(r'[יו](?=$)', '', val)
    return val

def tokenize_loose_member_name(value):
    tokens = tokenize_name(value)
    return [normalize_loose_hebrew_token(t) for t in tokens if t]

def build_token_key(tokens):
    return " ".join(sorted(tokens))

def contains_all_tokens(haystack, needles):
    if not needles:
        return False
    remaining = list(haystack)
    for needle in needles:
        if needle not in remaining:
            return False
        remaining.remove(needle)
    return True

def guess_surname_tokens(tokens):
    compound_prefixes = {"בן", "בר", "אל", "אבו", "אבן"}
    if len(tokens) >= 2 and tokens[-2] in compound_prefixes:
        return tokens[-2:]
    return [tokens[-1]] if tokens else []

def build_derived_aliases(base_name):
    aliases = set()
    tokens = tokenize_name(base_name)
    if len(tokens) >= 2:
        aliases.add(" ".join(tokens))
    if len(tokens) >= 3:
        surname_tokens = guess_surname_tokens(tokens)
        surname = " ".join(surname_tokens)
        given_tokens = tokens[:len(tokens) - len(surname_tokens)]
        for given_name in given_tokens:
            if given_name and surname:
                aliases.add(f"{given_name} {surname}")
        if len(given_tokens) >= 2 and surname:
            aliases.add(f"{given_tokens[0]} {given_tokens[1]} {surname}")
    return aliases

def build_surname_first_aliases(base_name):
    aliases = set()
    tokens = tokenize_name(base_name)
    if len(tokens) < 2:
        return aliases
    for split_index in range(1, len(tokens)):
        given_tokens = tokens[:split_index]
        surname_tokens = tokens[split_index:]
        surname = " ".join(surname_tokens)
        if not surname or not given_tokens:
            continue
        aliases.add(f"{surname} {' '.join(given_tokens)}")
        aliases.add(f"{surname} {given_tokens[0]}")
        if len(given_tokens) > 1:
            aliases.add(f"{surname} {given_tokens[-1]}")
    return aliases

def build_aliases(display_name):
    aliases = {normalize_name_spacing(display_name)}
    parenthetical_match = re.match(r'^(.*)\(([^)]+)\)(.*)$', display_name)
    if parenthetical_match:
        before = normalize_name_spacing(parenthetical_match.group(1))
        inside = normalize_name_spacing(parenthetical_match.group(2))
        after = normalize_name_spacing(parenthetical_match.group(3))
        without_parentheses = normalize_name_spacing(f"{before} {after}")
        inside_variant = normalize_name_spacing(f"{inside} {after}")
        combined_variant = normalize_name_spacing(f"{before} {inside} {after}")
        if without_parentheses: aliases.add(without_parentheses)
        if inside_variant: aliases.add(inside_variant)
        if combined_variant: aliases.add(combined_variant)

    for alias in list(aliases):
        aliases.update(build_derived_aliases(alias))
        aliases.update(build_surname_first_aliases(alias))

    for extra_alias in EXTRA_ALIASES.get(display_name, []):
        aliases.add(normalize_name_spacing(extra_alias))

    final_aliases = []
    for alias in map(normalize_name_spacing, aliases):
        if len(alias.split(" ")) >= 2 and alias not in final_aliases:
            final_aliases.append(alias)
    return final_aliases

def parse_member_registry():
    parties = []
    current_party = None
    member_index = 0
    for line in RAW_MEMBER_LIST.split("\n"):
        value = line.strip()
        if not value:
            continue
        if value in PARTY_NAMES:
            current_party = {
                "name": value,
                "slug": slugify_text(value),
                "members": [],
            }
            parties.append(current_party)
            continue
        if not current_party:
            raise ValueError(f'Member "{value}" appeared before a party heading')
        member_index += 1
        current_party["members"].append({
            "id": f"member-{str(member_index).zfill(3)}",
            "slug": f"{current_party['slug']}--{slugify_text(value)}",
            "name": value,
            "partyName": current_party["name"],
            "partySlug": current_party["slug"],
            "aliases": build_aliases(value),
        })
    return parties

def append_extra_members(parties):
    party_map = {party["name"]: party for party in parties}
    for extra_member in EXTRA_MEMBERS:
        party = party_map.get(extra_member["partyName"])
        if not party:
            raise ValueError(f'Extra member references unknown party "{extra_member["partyName"]}"')
        aliases = list(set(build_aliases(extra_member["name"]) + [normalize_name_spacing(a) for a in extra_member.get("aliases", [])]))
        party["members"].append({
            "id": extra_member["id"],
            "slug": f"{party['slug']}--{slugify_text(extra_member['name'])}",
            "name": extra_member["name"],
            "partyName": party["name"],
            "partySlug": party["slug"],
            "aliases": aliases,
        })
    return parties

parties = append_extra_members(parse_member_registry())
members = []
for party in parties:
    for member in party["members"]:
        member_copy = dict(member)
        member_copy["routeSlug"] = member.get("id") or member.get("slug")
        members.append(member_copy)

for member in members:
    if member["id"] == "member-072":
        member["aliases"] = list(set(member.get("aliases", []) + ["בנימין גנץ", "גנץ בנימין"]))

def normalize_member_lookup_name(value):
    return " ".join([t.lower() for t in tokenize_name(value)])

member_lookup_map = {}
member_alias_entries = []

for member in members:
    lookup_candidates = set([member["name"]] + member.get("aliases", []))
    for alias in lookup_candidates:
        normalized_alias = normalize_member_lookup_name(alias)
        if normalized_alias and normalized_alias not in member_lookup_map:
            member_lookup_map[normalized_alias] = member

    for alias in lookup_candidates:
        loose_tokens = tokenize_loose_member_name(alias)
        if len(loose_tokens) < 2:
            continue
        member_alias_entries.append({
            "member": member,
            "looseTokens": loose_tokens,
            "looseTokenKey": build_token_key(loose_tokens),
        })

def get_member_registry():
    return {
        "parties": parties,
        "members": members,
    }

def resolve_member_by_name(name):
    normalized_name = normalize_member_lookup_name(name)
    if not normalized_name:
        return None
    if normalized_name in member_lookup_map:
        return dict(member_lookup_map[normalized_name])

    loose_tokens = tokenize_loose_member_name(name)
    if len(loose_tokens) < 2:
        return None

    loose_token_key = build_token_key(loose_tokens)
    exact_token_candidates = [entry for entry in member_alias_entries if entry["looseTokenKey"] == loose_token_key]
    unique_exact_members = list(set([entry["member"]["slug"] for entry in exact_token_candidates]))
    
    if len(unique_exact_members) == 1:
        return dict(exact_token_candidates[0]["member"])

    subset_candidates = []
    for entry in member_alias_entries:
        if len(entry["looseTokens"]) >= 2 and contains_all_tokens(loose_tokens, entry["looseTokens"]):
            subset_candidates.append(entry)

    if not subset_candidates:
        return None

    subset_candidates.sort(key=lambda e: (-len(e["looseTokens"]), e["member"]["name"]))

    best_length = len(subset_candidates[0]["looseTokens"])
    best_candidates = [e for e in subset_candidates if len(e["looseTokens"]) == best_length]
    unique_subset_members = list(set([e["member"]["slug"] for e in best_candidates]))

    if len(unique_subset_members) == 1:
        return dict(best_candidates[0]["member"])

    return None

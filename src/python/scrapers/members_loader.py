import os
import re
import json
import uuid
from datetime import datetime
import requests
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
import concurrent.futures
import base64
import sys

# Ensure we can import from the current directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from psycopg2.extras import Json
from member_registry import get_member_registry, resolve_member_by_name

SOURCE_URL = "https://www.knesset.gov.il/WebSiteApi/knessetapi/MkLobby/GetMkLobbyData?lang=he"
WIKIDATA_SEARCH_URL = "https://www.wikidata.org/w/api.php?action=wbsearchentities&language=he&format=json&limit=5"
WIKIDATA_ENTITY_URL_PREFIX = "https://www.wikidata.org/wiki/Special:EntityData/"
ZMANKNESSET_SITEMAP_URL = "https://zmanknesset.co.il/sitemap.xml"
KSHARE_SITEMAP_URL = "https://www.kshare.co.il/sitemap.xml"
KSHARE_MEMBER_ROUTE_PREFIX = "https://www.kshare.co.il/%D7%97%D7%91%D7%A8%D7%99-%D7%9B%D7%A0%D7%A1%D7%AA-%D7%95%D7%A9%D7%A8%D7%99%D7%9D/"

MANUAL_NAME_TO_ROUTE_SLUG = {
    "יצחק גולדקנופ": "member-095"
}

DISPLAY_ORDER = ["email", "phone", "whatsapp", "facebook", "instagram", "threads", "x", "tiktok", "linkedin", "youtube", "website"]

def clean_string(value):
    return str(value or "").strip()

def normalize_url(value):
    raw = clean_string(value)
    if not raw:
        return ""
    if re.match(r'^https?://', raw, re.IGNORECASE):
        return raw
    return f"https://{raw.lstrip('/')}"

def build_tel_href(phone):
    sanitized = re.sub(r'[^\d+#*]', '', clean_string(phone))
    return f"tel:{sanitized}" if sanitized else ""

def build_whatsapp_href(phone):
    digits = re.sub(r'\D+', '', clean_string(phone))
    if not digits:
        return ""
    normalized = digits
    if normalized.startswith("00"):
        normalized = normalized[2:]
    elif normalized.startswith("0"):
        normalized = f"972{normalized[1:]}"
    
    if not re.match(r'^9725\d{8}$', normalized):
        return ""
    return f"https://wa.me/{normalized}"

def detect_platform_from_url(url):
    lower_url = str(url or "").lower()
    if not lower_url: return "website"
    if "facebook.com" in lower_url: return "facebook"
    if "instagram.com" in lower_url: return "instagram"
    if "threads.net" in lower_url: return "threads"
    if "tiktok.com" in lower_url: return "tiktok"
    if "linkedin.com" in lower_url: return "linkedin"
    if "twitter.com" in lower_url or "x.com" in lower_url: return "x"
    if "youtube.com" in lower_url or "youtu.be" in lower_url: return "youtube"
    if "wa.me" in lower_url or "whatsapp.com" in lower_url: return "whatsapp"
    return "website"

def normalize_social_url(url):
    raw = clean_string(url)
    if not raw: return ""
    try:
        parsed = urlparse(raw)
        hostname = parsed.hostname or ""
        qs = parse_qs(parsed.query)
        
        if "twitter.com" in hostname or "x.com" in hostname:
            for k in ["ref_src", "lang", "t", "s"]: qs.pop(k, None)
        if "instagram.com" in hostname:
            for k in ["hl", "igsh"]: qs.pop(k, None)
        if "tiktok.com" in hostname:
            for k in ["_t", "_r", "lang"]: qs.pop(k, None)
            
        new_query = urlencode(qs, doseq=True)
        normalized = urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))
        return normalized.rstrip('/') if parsed.path != "/" else normalized
    except Exception:
        return raw

def is_placeholder_profile_value(value):
    return bool(re.search(r'(^|[/@._-])no[a-z]+profile([/?#._-]|$)', str(value or ""), re.IGNORECASE))

def sort_contacts(contacts):
    def get_index(p):
        try:
            return DISPLAY_ORDER.index(p)
        except ValueError:
            return 999
    return sorted(contacts, key=lambda c: get_index(c.get("platform")))

def build_contact_entry(id_val, type_val, platform, value, href, source_field):
    t_value = clean_string(value)
    t_href = clean_string(href)
    if not t_value or not t_href: return None
    return {
        "id": id_val,
        "type": type_val,
        "platform": platform,
        "label": t_value,
        "value": t_value,
        "href": t_href,
        "sourceField": source_field
    }

def push_unique_contact(contacts, entry):
    if not entry: return
    entry_href_key = normalize_social_url(str(entry.get("href", "")).lower())
    entry_value_key = clean_string(entry.get("value", "")).lower()
    
    for c in contacts:
        c_href = normalize_social_url(str(c.get("href", "")).lower())
        c_val = clean_string(c.get("value", "")).lower()
        if c_href == entry_href_key or (c.get("type") == entry.get("type") and c.get("platform") == entry.get("platform") and c_val == entry_value_key):
            return
    contacts.append(entry)

def split_public_values(value):
    return [clean_string(v) for v in re.split(r'[;,]', clean_string(value)) if clean_string(v)]

def build_contacts_from_mk_record(mk_record):
    contacts = []
    
    for email in split_public_values(mk_record.get("Email", "")):
        push_unique_contact(contacts, build_contact_entry(f"email-{len(contacts)+1}", "email", "email", email, f"mailto:{email}", "Email"))
        
    for phone in split_public_values(mk_record.get("Phone", "")):
        push_unique_contact(contacts, build_contact_entry(f"phone-{len(contacts)+1}", "phone", "phone", phone, build_tel_href(phone), "Phone"))
        whatsapp = build_whatsapp_href(phone)
        if whatsapp:
            push_unique_contact(contacts, build_contact_entry(f"whatsapp-{len(contacts)+1}", "social", "whatsapp", phone, whatsapp, "Phone"))
            
    social_fields = [
        {"field": "Facebook", "platform": "facebook"},
        {"field": "Twitter", "platform": "x"},
        {"field": "Instegram", "platform": "instagram"},
        {"field": "Youtube", "platform": "youtube"},
        {"field": "WebsiteUrl", "platform": None},
    ]
    for sf in social_fields:
        raw = clean_string(mk_record.get(sf["field"]))
        if not raw: continue
        href = normalize_url(raw)
        platform = sf["platform"] or detect_platform_from_url(href)
        push_unique_contact(contacts, build_contact_entry(f"{platform}-{len(contacts)+1}", "social", platform, href, href, sf["field"]))
        
    return sort_contacts(contacts)

def fetch_text_with_retries(url, retries=2):
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0 Codex"}, timeout=15)
            if resp.status_code == 200:
                return resp.text
        except:
            pass
    return ""

def extract_social_links_from_html(html):
    contacts = []
    matches = re.findall(r'https?://(?:www\.)?(?:facebook\.com|twitter\.com|x\.com|instagram\.com|threads\.net|tiktok\.com|linkedin\.com|youtube\.com|youtu\.be)[^"\'<\)\s]+', str(html or ""), re.IGNORECASE)
    for href in matches:
        normalized = normalize_social_url(normalize_url(href))
        if is_placeholder_profile_value(normalized): continue
        platform = detect_platform_from_url(normalized)
        push_unique_contact(contacts, build_contact_entry(f"{platform}-{len(contacts)+1}", "social", platform, normalized, normalized, "HTML_Scrape"))
    return contacts

class MembersLoader:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.directory_path = os.path.join(data_dir, "member-contact-directory.json")
        
    def resolve_local_member(self, official_name, members_by_route_slug):
        manual = MANUAL_NAME_TO_ROUTE_SLUG.get(official_name)
        if manual:
            return members_by_route_slug.get(manual)
        return resolve_member_by_name(official_name)

    def fetch_official_directory(self):
        try:
            resp = requests.get(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0 Codex"}, timeout=30)
            payload = resp.json()
            return payload.get("mks", [])
        except Exception as e:
            print(f"Error fetching official directory: {e}")
            return []

    def scrape_zmanknesset(self, members_by_route_slug):
        sitemap = fetch_text_with_retries(ZMANKNESSET_SITEMAP_URL)
        urls = list(set([m.replace(":443", "") for m in re.findall(r'https://zmanknesset\.co\.il(?::443)?/member/\d+', sitemap)]))
        results = []
        
        def fetch_zk(url):
            html = fetch_text_with_retries(url)
            if not html: return None
            title_match = re.search(r'<title>(.*?)</title>', html, re.IGNORECASE)
            if not title_match: return None
            display_name = title_match.group(1).split('|')[0].strip()
            member = self.resolve_local_member(display_name, members_by_route_slug)
            if not member: return None
            
            socials = extract_social_links_from_html(html)
            if not socials: return None
            
            return {
                "slug": member.get("routeSlug", member.get("slug")),
                "url": url,
                "contacts": socials
            }
            
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            for res in executor.map(fetch_zk, urls):
                if res: results.append(res)
        return results

    def fetch_wikidata_claims(self, entity_id):
        try:
            resp = requests.get(f"{WIKIDATA_ENTITY_URL_PREFIX}{entity_id}.json", headers={"User-Agent": "Mozilla/5.0 Codex"}, timeout=10)
            if resp.status_code == 200:
                payload = resp.json()
                return payload.get("entities", {}).get(entity_id, {}).get("claims", {})
        except:
            pass
        return None

    def search_wikidata_entities(self, term):
        try:
            resp = requests.get(f"{WIKIDATA_SEARCH_URL}&search={requests.utils.quote(term)}", headers={"User-Agent": "Mozilla/5.0 Codex"}, timeout=10)
            if resp.status_code == 200:
                payload = resp.json()
                return payload.get("search", [])
        except:
            pass
        return []

    def find_wikidata_profile(self, member):
        search_terms = [member.get("name")] + member.get("aliases", [])
        for term in filter(None, search_terms):
            results = self.search_wikidata_entities(term)
            candidates = [r for r in results if re.search(r'politician|knesset|minister|political', str(r.get("description", "")), re.IGNORECASE)]
            if not candidates: candidates = results
            for c in candidates:
                claims = self.fetch_wikidata_claims(c.get("id"))
                if not claims: continue
                contacts = []
                mappings = [
                    {"propertyId": "P2013", "platform": "facebook"},
                    {"propertyId": "P2003", "platform": "instagram"},
                    {"propertyId": "P2002", "platform": "x"},
                    {"propertyId": "P7085", "platform": "tiktok"},
                    {"propertyId": "P6634", "platform": "linkedin"},
                    {"propertyId": "P2397", "platform": "youtube"},
                    {"propertyId": "P856", "platform": "website"}
                ]
                for m in mappings:
                    val_obj = claims.get(m["propertyId"], [{}])[0].get("mainsnak", {}).get("datavalue", {}).get("value")
                    if val_obj:
                        href = f"https://www.{m['platform']}.com/{val_obj}" if m["platform"] != "website" else val_obj
                        push_unique_contact(contacts, build_contact_entry(f"{m['platform']}-{len(contacts)+1}", "social", m["platform"], href, href, f"Wikidata:{m['propertyId']}"))
                if contacts:
                    return {
                        "entityId": c.get("id"),
                        "label": c.get("label", ""),
                        "description": c.get("description", ""),
                        "contacts": sort_contacts(contacts)
                    }
        return None

    def build_directory(self, conn):
        print("Starting Members Directory sync...")
        registry = get_member_registry().get("members", [])
        members_by_route_slug = {m.get("routeSlug", m.get("slug")): m for m in registry}
        official_mks = self.fetch_official_directory()
        members = {}
        
        for member in registry:
            route_slug = member.get("routeSlug", member.get("slug"))
            members[route_slug] = {
                "slug": route_slug,
                "name": member.get("name"),
                "partyName": member.get("partyName"),
                "lookupStatus": "not_found_in_current_knesset_api",
                "contacts": [],
                "aliases": member.get("aliases", [])
            }
            
        unmatched_official = []
        for mk in official_mks:
            official_name = clean_string(f"{clean_string(mk.get('Firstname'))} {clean_string(mk.get('Lastname'))}")
            local_member = self.resolve_local_member(official_name, members_by_route_slug)
            if not local_member:
                unmatched_official.append(official_name)
                continue
                
            route_slug = local_member.get("routeSlug", local_member.get("slug"))
            contacts = build_contacts_from_mk_record(mk)
            members[route_slug]["lookupStatus"] = "official_current_knesset_api" if contacts else "official_current_knesset_api_without_contacts"
            members[route_slug]["contacts"] = contacts
            members[route_slug]["updatedFromSourceAt"] = datetime.utcnow().isoformat() + "Z"

        # ZmanKnesset
        zk_results = self.scrape_zmanknesset(members_by_route_slug)
        for res in zk_results:
            entry = members.get(res["slug"])
            if not entry: continue
            prev_len = len(entry["contacts"])
            for c in res["contacts"]:
                push_unique_contact(entry["contacts"], c)
            entry["contacts"] = sort_contacts(entry["contacts"])
            if len(entry["contacts"]) > prev_len:
                entry["updatedFromSourceAt"] = datetime.utcnow().isoformat() + "Z"
                
        # Wikidata
        targets = [m for m in members.values() if len([c for c in m["contacts"] if c["platform"] not in ("email", "phone", "whatsapp")]) < 2]
        
        def process_wikidata(member):
            profile = self.find_wikidata_profile(member)
            return member["slug"], profile
            
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            for slug, profile in executor.map(process_wikidata, targets):
                if profile:
                    entry = members[slug]
                    prev_len = len(entry["contacts"])
                    for c in profile["contacts"]:
                        push_unique_contact(entry["contacts"], c)
                    entry["contacts"] = sort_contacts(entry["contacts"])
                    if len(entry["contacts"]) > prev_len:
                        entry["updatedFromSourceAt"] = datetime.utcnow().isoformat() + "Z"

        for member in members.values():
            member.pop("aliases", None)

        print(f"Syncing {len(members)} members to PostgreSQL...")
        try:
            with conn.cursor() as cur:
                # Sync parties first
                parties = set()
                for m in members.values():
                    if m.get("partyName"):
                        parties.add(m.get("partyName").strip())
                
                party_id_map = {}
                for p in parties:
                    cur.execute("""
                        INSERT INTO party (name)
                        VALUES (%s)
                        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                        RETURNING id
                    """, (p,))
                    party_id_map[p] = cur.fetchone()[0]

                # Sync members
                for slug, m in members.items():
                    party_id = party_id_map.get(m.get("partyName", "").strip())
                    contacts = m.get("contacts", [])
                    cur.execute("""
                        INSERT INTO member (slug, name, party_id, contacts)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (slug) DO UPDATE SET 
                            name = EXCLUDED.name,
                            party_id = EXCLUDED.party_id,
                            contacts = EXCLUDED.contacts,
                            updated_at = CURRENT_TIMESTAMP
                    """, (slug, m.get("name"), party_id, Json(contacts)))
            conn.commit()
            print("Successfully saved Members Directory to database.")
        except Exception as e:
            print(f"Database error while saving members: {e}")

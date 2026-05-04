import sys, json, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
BASE = "http://localhost:3000"

def get(url):
    with urllib.request.urlopen(url, timeout=8) as r:
        return json.loads(r.read())

# Test /api/members
d = get(f"{BASE}/api/members")
party = d['parties'][0]
member = party['members'][0]
print("=== /api/members ===")
print(f"  memberCount={d['memberCount']}, parties={len(d['parties'])}")
print(f"  first member keys: {list(member.keys())}")
print(f"  routeSlug present: {'routeSlug' in member}")
print(f"  utteranceFilesBulkStatus: {d.get('utteranceFilesBulkStatus')}")
print(f"  analysisBulkStatus configured: {d.get('analysisBulkStatus',{}).get('configured')}")

# Pick a member with utterances
conn_slug = None
for p in d['parties']:
    for m in p['members']:
        if m.get('protocolCount', 0) > 0:
            conn_slug = m['slug']
            break
    if conn_slug:
        break

print(f"\n=== /api/members/{conn_slug} ===")
d2 = get(f"{BASE}/api/members/{conn_slug}")
print(f"  keys: {list(d2.keys())}")
print(f"  member.routeSlug: {d2['member'].get('routeSlug')}")
print(f"  stats: {d2['stats']}")
print(f"  contact.hasContacts: {d2.get('contact',{}).get('hasContacts')}")
print(f"  utteranceFile: {d2.get('utteranceFile')}")
print(f"  status.processedProtocols: {d2.get('status',{}).get('processedProtocols')}")
print(f"  protocols count: {len(d2.get('protocols',[]))}")
if d2['protocols']:
    print(f"  first protocol keys: {list(d2['protocols'][0].keys())}")
    print(f"  first protocol readerUrl: {d2['protocols'][0].get('readerUrl')}")
    print(f"  first protocol shortDateLabel: {d2['protocols'][0].get('shortDateLabel')}")

import sys, json, urllib.request
sys.stdout.reconfigure(encoding='utf-8')

BASE = "http://localhost:3001"  # Python server only

def test(label, url):
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read())
            keys = list(data.keys())[:6]
            print(f"  OK  {label}: keys={keys}")
            return data
    except Exception as e:
        print(f"  ERR {label}: {e}")
        return None

print("=== Python server smoke test (port 3001) ===")
test("health",          f"{BASE}/api/health")
d = test("members",     f"{BASE}/api/members")
if d: print(f"       memberCount={d.get('memberCount')}, parties={len(d.get('parties',[]))}")
d = test("member-001",  f"{BASE}/api/members/member-001")
if d: print(f"       name={d.get('member',{}).get('name')}, protocols={d.get('stats',{}).get('totalProtocols')}")
d = test("laws",        f"{BASE}/api/laws")
if d: print(f"       total={d.get('total')}, items={len(d.get('items',[]))}")
d = test("law detail",  f"{BASE}/api/laws/1043724")
if d: print(f"       billId={d.get('law',{}).get('billId')}")
test("law analysis",    f"{BASE}/api/laws/1043724/analysis")
test("law votes",       f"{BASE}/api/laws/1043724/votes")
d = test("protocols",   f"{BASE}/api/protocols?page=1")
if d: print(f"       total={d.get('total')}")
test("protocol-detail", f"{BASE}/api/protocols/12208281")
d = test("committee",   f"{BASE}/api/committee-protocols?page=1")
if d: print(f"       total={d.get('total')}")
test("contacts",        f"{BASE}/api/member-contact-directory")
test("utterances",      f"{BASE}/api/members/member-001/utterance-file/text")

import sys, json, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
BASE = "http://localhost:3001"

def test(label, url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read())
            keys = list(data.keys())[:7]
            print(f"  OK  {label}: keys={keys}")
            return data
    except Exception as e:
        print(f"  ERR {label}: {e}")
        return None

print("=== Phase 2 smoke test ===")

d = test("landing", f"{BASE}/api/landing")
if d:
    ov = d.get('overview', {})
    print(f"       plenum={ov.get('plenumCount')} committee={ov.get('committeeCount')} laws={ov.get('lawCount')} surprising={ov.get('surprisingLawCount')}")
    print(f"       categories={len(d.get('categories',[]))} newsline={len(d.get('newsline',{}).get('items',[]))} quotes={d.get('quoteFeed',{}).get('count')}")

d = test("spotlight", f"{BASE}/api/landing/spotlight")
if d:
    print(f"       status={d.get('status')} member={d.get('member',{}).get('name')} axes={len(d.get('axes',[]))}")
    print(f"       hasQuote={d.get('highlightedQuote') is not None}")

d = test("know-your-mk", f"{BASE}/api/landing/know-your-mk")
if d:
    print(f"       available={d.get('summary',{}).get('availableMembers')} parties={len(d.get('filters',{}).get('parties',[]))}")

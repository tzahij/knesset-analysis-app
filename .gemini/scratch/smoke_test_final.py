import sys, json, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
BASE = "http://localhost:3000"

PASS = []
FAIL = []

def test(label, url, method="GET", expect_keys=None):
    try:
        req = urllib.request.Request(url, method=method)
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read())
            keys = list(data.keys())[:5]
            print(f"  OK  {label}: keys={keys}")
            PASS.append(label)
            return data
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:80]
        print(f"  ERR {label}: HTTP {e.code} — {body}")
        FAIL.append(label)
    except Exception as e:
        print(f"  ERR {label}: {e}")
        FAIL.append(label)
    return None

print("=== Final smoke test — Python server on :3000 ===\n")

print("--- Core ---")
test("health",          f"{BASE}/api/health")
d = test("members",     f"{BASE}/api/members")
if d: print(f"       memberCount={d.get('memberCount')}")
d = test("member-001",  f"{BASE}/api/members/member-001")
if d: print(f"       name={d.get('member',{}).get('name')}")
d = test("laws",        f"{BASE}/api/laws")
if d: print(f"       total={d.get('total')}")
test("law-detail",      f"{BASE}/api/laws/1043724")
test("law-analysis",    f"{BASE}/api/laws/1043724/analysis")
test("law-votes",       f"{BASE}/api/laws/1043724/votes")

print("\n--- Protocols ---")
d = test("protocols",   f"{BASE}/api/protocols?page=1")
if d: print(f"       total={d.get('total')}")
test("protocol-detail", f"{BASE}/api/protocols/12208281")
d = test("committee",   f"{BASE}/api/committee-protocols?page=1")
if d: print(f"       total={d.get('total')}")

print("\n--- Landing ---")
d = test("landing",     f"{BASE}/api/landing")
if d:
    ov = d.get('overview', {})
    print(f"       plenum={ov.get('plenumCount')} laws={ov.get('lawCount')}")
d = test("spotlight",   f"{BASE}/api/landing/spotlight")
if d: print(f"       member={d.get('member',{}).get('name')}")
d = test("know-your-mk",f"{BASE}/api/landing/know-your-mk")
if d: print(f"       available={d.get('summary',{}).get('availableMembers')}")

print("\n--- Contacts & Stubs ---")
test("contacts",        f"{BASE}/api/member-contact-directory")
test("auth-session",    f"{BASE}/api/auth/session")
test("admin-stub",      f"{BASE}/api/admin/protocol-updates/pending")
test("laws-refresh",    f"{BASE}/api/laws/refresh-status")
test("analysis-status", f"{BASE}/api/laws/analysis/status")

print(f"\n=== {len(PASS)} passed, {len(FAIL)} failed ===")
if FAIL:
    print("FAILED:", FAIL)

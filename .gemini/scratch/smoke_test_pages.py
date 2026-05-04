import sys, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
BASE = "http://localhost:3000"

def test_html(label, url):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            body = r.read().decode('utf-8')[:60]
            if '<!DOCTYPE html' in body or '<html' in body:
                print(f"  OK  {label}: returns HTML")
            else:
                print(f"  WARN {label}: unexpected response: {body}")
    except Exception as e:
        print(f"  ERR {label}: {e}")

print("=== Page routing test ===")
test_html("home /",           f"{BASE}/")
test_html("members",          f"{BASE}/members")
test_html("member detail",    f"{BASE}/members/member-001")
test_html("plenum",           f"{BASE}/plenum")
test_html("committees",       f"{BASE}/committees")
test_html("laws page",        f"{BASE}/laws")
test_html("surprising-votes", f"{BASE}/surprising-votes")
test_html("protocol",         f"{BASE}/protocol/12208281")
test_html("committee-proto",  f"{BASE}/committee-protocol/12345678")
test_html("law page",         f"{BASE}/law/1043724")
test_html("know-your-mk",     f"{BASE}/know-your-mk")
test_html("how-we-know",      f"{BASE}/how-we-know")
test_html("comparisons",      f"{BASE}/comparisons")
test_html("talk-to-reps",     f"{BASE}/talk-to-your-representatives")
test_html("api health",       f"{BASE}/api/health")  # should still be JSON

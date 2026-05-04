import os, json, sys
sys.stdout.reconfigure(encoding='utf-8')
d = 'data/member-analyses'
files = [f for f in os.listdir(d) if f.endswith('.json')]
for f in files[:5]:
    with open(os.path.join(d, f), encoding='utf-8') as fp:
        data = json.load(fp)
    print(f"file: {f}")
    print(f"  memberSlug: {data.get('memberSlug')}")
    print(f"  model: {data.get('model')}")
    print(f"  top-level keys: {list(data.keys())[:10]}")
    print()

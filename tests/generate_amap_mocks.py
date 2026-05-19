import os
import json
import requests
import sys

def fetch_and_save(url, filename):
    print(f'Fetching {url}')
    headers = {'Accept': 'application/json'}
    res = requests.get(url, headers=headers)
    if res.status_code == 200:
        try:
            data = res.json()
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f'Successfully saved {filename}')
        except Exception as e:
            print(f'Failed to decode JSON from {url}: {e}')
            print('Raw response:')
            print(res.text[:500])
    else:
        print(f'Failed to fetch: HTTP {res.status_code}')
        print(res.text[:500])

def main():
    os.makedirs('tests/mocks/amap_test', exist_ok=True)

    # Law: 2229878
    law_url = 'http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_Bill?$filter=BillID eq 2229878&$expand=KNS_Status,KNS_DocumentBills&$format=json'
    fetch_and_save(law_url, 'tests/mocks/amap_test/mock_laws_odata.json')

    # Plenum: 10938330
    plenum_url = 'http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_DocumentPlenumSession?$filter=DocumentPlenumSessionID eq 10938330&$expand=KNS_PlenumSession&$format=json'
    fetch_and_save(plenum_url, 'tests/mocks/amap_test/mock_plenum_odata.json')

    # Empty Committee
    with open('tests/mocks/amap_test/mock_committee_odata.json', 'w', encoding='utf-8') as f:
        json.dump({'value': []}, f)
    print('Successfully saved tests/mocks/amap_test/mock_committee_odata.json')

    # Vote events: 45093
    print('Fetching vote headers...')
    headers_url = 'https://knesset.gov.il/WebSiteApi/knessetapi/Votes/GetVotesHeaders'
    body = {"SearchType": 2, "FromDate": "2026-01-01", "ToDate": "2026-01-31"}
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
    res = requests.post(headers_url, json=body, headers=headers)
    if res.status_code == 200:
        data = res.json()
        with open('tests/mocks/amap_test/mock_votes_headers.json', 'w', encoding='utf-8') as f:
            json.dump(data.get("Table", []), f, ensure_ascii=False, indent=2)
        print('Successfully saved tests/mocks/amap_test/mock_votes_headers.json')
    else:
        print(f'Failed to fetch headers: HTTP {res.status_code}')

    # Vote details: 45093
    vote_details_url = 'https://knesset.gov.il/WebSiteApi/knessetapi/Votes/GetVoteDetails/45093'
    fetch_and_save(vote_details_url, 'tests/mocks/amap_test/mock_vote_details_45093.json')

if __name__ == '__main__':
    main()

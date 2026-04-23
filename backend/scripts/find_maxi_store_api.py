"""Query Maxi's public pickup-locations API to find the store near a postal code.

The API returns all Maxi stores with their address + storeId. We grep for
"Fleur-de-Lys" (or match on postal-code proximity) and print the storeId
to paste into `.env::MAXI_STORE_ID`.
"""
import json
import urllib.request


URL = "https://api.pcexpress.ca/pcx-bff/api/v1/pickup-locations?bannerIds=maxi"


def main():
    req = urllib.request.Request(
        URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "application/json",
            "site-banner": "maxi",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    if not isinstance(data, list):
        print(f"Unexpected response: {json.dumps(data)[:400]}")
        return

    print(f"Total Maxi pickup locations: {len(data)}\n")

    # Filter Quebec City area
    hits = [
        s for s in data
        if "fleur" in (s.get("name", "") + s.get("locationDescription", "")).lower()
        or (s.get("address", {}).get("postalCode", "") or "").upper().startswith("G1M")
    ]

    if not hits:
        print("Direct match failed — dumping all Quebec City stores (G1*, G2*):")
        hits = [
            s for s in data
            if (s.get("address", {}).get("postalCode", "") or "").upper().startswith(("G1", "G2"))
        ]

    for s in hits:
        addr = s.get("address", {})
        print(f"storeId={s.get('storeId')} | {s.get('name')}")
        print(f"  {addr.get('addressLine1')}, {addr.get('town')}, {addr.get('region')} {addr.get('postalCode')}")
        print()


if __name__ == "__main__":
    main()

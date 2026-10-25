"""Download one dated Starlink GP and SATCAT snapshot from CelesTrak.

Respect CelesTrak's update cadence: run this only when a new snapshot is needed.
The raw responses are preserved and never overwritten.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "starlink"
URLS = {
    "gp": "https://celestrak.org/NORAD/elements/gp.php?GROUP=STARLINK&FORMAT=JSON",
    "satcat": "https://celestrak.org/satcat/records.php?GROUP=STARLINK&FORMAT=JSON",
}


def main():
    OUT.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    manifest = {"retrieved_utc": stamp, "source": "CelesTrak", "datasets": {}}
    for kind, url in URLS.items():
        response = requests.get(url, timeout=100, headers={"User-Agent": "ESPL-coverage-research/1.0", "Accept": "application/json"})
        response.raise_for_status()
        raw = response.content
        records = json.loads(raw)
        if not isinstance(records, list) or not records:
            raise ValueError(f"{kind}: expected nonempty JSON array")
        path = OUT / f"{stamp}-{kind}.json"
        with path.open("xb") as stream:
            stream.write(raw)
        manifest["datasets"][kind] = {"url": url, "file": path.name, "count": len(records), "sha256": sha256(raw).hexdigest(), "http_date": response.headers.get("Date")}
        print(kind, len(records), path, flush=True)
    (OUT / f"{stamp}-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()

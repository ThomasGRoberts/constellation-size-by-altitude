"""Build complete service-region grids with inclination selected by the search."""
from __future__ import annotations

import hashlib
import json
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from coverage import ALTITUDES_KM, ELEVATION_DEG, FOLD_REQUIREMENTS
from service_optimizer import INCLINATIONS, SERVICE_LATITUDES, optimize_altitude

ROOT = Path(__file__).parent
GRID_DIR = ROOT / 'data' / 'service_grids'
ROW_CACHE = Path('/tmp/espl-service-grid-rows-20261025')


def compute_row(altitude: int) -> tuple[int, dict]:
    return altitude, optimize_altitude(altitude)


def main() -> None:
    ROW_CACHE.mkdir(exist_ok=True)
    GRID_DIR.mkdir(exist_ok=True)
    rows = {}
    for altitude in ALTITUDES_KM:
        cached = ROW_CACHE / f'alt-{altitude}.json'
        if cached.exists():
            rows[altitude] = json.loads(cached.read_text())
    missing = [altitude for altitude in ALTITUDES_KM if altitude not in rows]
    print(f'{len(rows)} cached rows; {len(missing)} remaining', flush=True)
    with ProcessPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(compute_row, altitude) for altitude in missing]
        for future in as_completed(futures):
            altitude, result = future.result()
            rows[altitude] = result
            cached = ROW_CACHE / f'alt-{altitude}.json'
            temporary = cached.with_suffix('.tmp')
            temporary.write_text(json.dumps(result, separators=(',', ':')))
            os.replace(temporary, cached)
            print(f'{len(rows)}/{len(ALTITUDES_KM)} altitudes; {altitude} km complete', flush=True)

    files = {}
    for latitude in SERVICE_LATITUDES:
        payload = {
            'method': 'sampled Walker delta search across 30–90 degree inclinations',
            'serviceLatitudeDeg': latitude,
            'elevationDeg': ELEVATION_DEG,
            'candidateInclinationsDeg': list(INCLINATIONS),
            'altitudesKm': ALTITUDES_KM,
            'folds': FOLD_REQUIREMENTS,
            'results': {str(altitude): rows[altitude][str(latitude)] for altitude in ALTITUDES_KM},
        }
        raw = json.dumps(payload, separators=(',', ':')).encode()
        target = GRID_DIR / f'lat-{latitude}.json'
        temporary = target.with_suffix('.tmp')
        temporary.write_bytes(raw)
        os.replace(temporary, target)
        files[str(latitude)] = {'path': target.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    manifest = {
        'version': 1,
        'serviceLatitudesDeg': list(SERVICE_LATITUDES),
        'candidateInclinationsDeg': list(INCLINATIONS),
        'elevationDeg': ELEVATION_DEG,
        'altitudesKm': ALTITUDES_KM,
        'folds': FOLD_REQUIREMENTS,
        'objectives': ['satelliteMinimum', 'planeTradeoff'],
        'files': files,
    }
    (GRID_DIR / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Complete: ' + str(GRID_DIR / 'manifest.json'), flush=True)


if __name__ == '__main__':
    main()

"""Persist complete, validated Walker grids for the finite UI inclination set."""
from __future__ import annotations

import hashlib
import json
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from coverage import ALTITUDES_KM, FOLD_REQUIREMENTS, search

ROOT = Path(__file__).parent
GRID_DIR = ROOT / 'data' / 'grids'
INCLINATIONS_DEG = tuple(range(30, 91, 5))
ELEVATION_DEG = 10


def compute_row(inclination: int, altitude: int) -> tuple[int, int, dict]:
    return inclination, altitude, search(altitude, inclination, ELEVATION_DEG)['solutions']


def write_grid(inclination: int, rows: dict[str, dict]) -> dict:
    payload = {
        'method': 'sampled Walker delta candidate generation, grid evaluation, and constrained Pareto selection',
        'inclinationDeg': inclination,
        'elevationDeg': ELEVATION_DEG,
        'serviceLatitudeDeg': 40,
        'altitudesKm': ALTITUDES_KM,
        'folds': FOLD_REQUIREMENTS,
        'results': {str(alt): rows[str(alt)] for alt in ALTITUDES_KM},
    }
    raw = json.dumps(payload, separators=(',', ':')).encode()
    target = GRID_DIR / f'inc-{inclination}.json'
    temp = target.with_suffix('.json.tmp')
    temp.write_bytes(raw)
    os.replace(temp, target)
    return {'path': f'grids/{target.name}', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}


def main() -> None:
    GRID_DIR.mkdir(exist_ok=True)
    base = json.loads((ROOT / 'data' / 'solutions.json').read_text())
    if base['altitudesKm'] != ALTITUDES_KM or base['folds'] != FOLD_REQUIREMENTS:
        raise ValueError('default solution grid does not match current finite grid')
    rows = {55: base['results']}
    for inc in INCLINATIONS_DEG:
        if inc == 55:
            continue
        path = GRID_DIR / f'inc-{inc}.json'
        if path.exists():
            grid = json.loads(path.read_text())
            if (grid.get('inclinationDeg') == inc and grid.get('elevationDeg') == ELEVATION_DEG
                    and grid.get('altitudesKm') == ALTITUDES_KM and grid.get('folds') == FOLD_REQUIREMENTS
                    and all(set(grid['results'][str(alt)]) == {str(n) for n in FOLD_REQUIREMENTS}
                            for alt in ALTITUDES_KM)):
                rows[inc] = grid['results']
    jobs = [(inc, alt) for inc in INCLINATIONS_DEG if inc not in rows for alt in ALTITUDES_KM]
    completed = 0
    with ProcessPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(compute_row, inc, alt) for inc, alt in jobs]
        for future in as_completed(futures):
            inc, alt, solutions = future.result()
            rows.setdefault(inc, {})[str(alt)] = solutions
            completed += 1
            print(f'{completed}/{len(jobs)} inclination {inc}°, altitude {alt} km', flush=True)
    files = {str(inc): write_grid(inc, rows[inc]) for inc in INCLINATIONS_DEG}
    manifest = {
        'version': 1,
        'inclinationsDeg': list(INCLINATIONS_DEG),
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

"""Check the finite grids used for atomic browser updates."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GRID_DIR = ROOT / 'data' / 'grids'


class GridTests(unittest.TestCase):
    def test_manifest_integrity_and_complete_lookup(self):
        manifest = json.loads((GRID_DIR / 'manifest.json').read_text())
        self.assertEqual(manifest['inclinationsDeg'], list(range(30, 91, 5)))
        self.assertEqual(manifest['elevationDeg'], 10)
        self.assertEqual(manifest['altitudesKm'], list(range(350, 2001, 50)))
        self.assertEqual(manifest['folds'], list(range(1, 101)))
        for inc in manifest['inclinationsDeg']:
            entry = manifest['files'][str(inc)]
            raw = (GRID_DIR.parent / entry['path']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), entry['sha256'])
            grid = json.loads(raw)
            self.assertEqual((grid['inclinationDeg'], grid['elevationDeg']), (inc, 10))
            self.assertEqual(grid['altitudesKm'], manifest['altitudesKm'])
            for alt in manifest['altitudesKm']:
                row = grid['results'][str(alt)]
                self.assertEqual(set(row), {str(n) for n in manifest['folds']})
                for n in manifest['folds']:
                    pair = row[str(n)]
                    if pair is None:
                        continue
                    self.assertEqual(set(pair), set(manifest['objectives']))
                    for objective in manifest['objectives']:
                        design = pair[objective]
                        self.assertEqual(design['satellites'], design['planes'] * design['perPlane'])
                        self.assertGreaterEqual(design['minimum'], n)

    def test_default_grid_matches_previous_baseline(self):
        baseline = json.loads((ROOT / 'data' / 'solutions.json').read_text())
        grid = json.loads((GRID_DIR / 'inc-55.json').read_text())
        self.assertEqual(grid['results'], baseline['results'])


if __name__ == '__main__':
    unittest.main()

import hashlib
import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from coverage import sampled_minimum
from service_optimizer import FINE_MASKS, FINE_SITES, SERVICE_LATITUDES


ROOT = Path(__file__).resolve().parents[1]
GRID_DIR = ROOT / 'data' / 'service_grids'


class ServiceGridTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((GRID_DIR / 'manifest.json').read_text())
        cls.grids = {latitude: json.loads((GRID_DIR / f'lat-{latitude}.json').read_text())
                     for latitude in SERVICE_LATITUDES}

    def test_complete_grids_and_manifest_hashes(self):
        self.assertEqual(self.manifest['serviceLatitudesDeg'], list(SERVICE_LATITUDES))
        for latitude, grid in self.grids.items():
            path = GRID_DIR / f'lat-{latitude}.json'
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),
                             self.manifest['files'][str(latitude)]['sha256'])
            self.assertEqual(grid['serviceLatitudeDeg'], latitude)
            self.assertEqual(grid['altitudesKm'], list(range(350, 2001, 50)))
            self.assertEqual(grid['folds'], list(range(1, 101)))
            for altitude in grid['altitudesKm']:
                self.assertEqual(len(grid['results'][str(altitude)]), 100)

    def test_objective_and_inclination_constraints(self):
        for latitude, grid in self.grids.items():
            for altitude in grid['altitudesKm']:
                for fold, result in grid['results'][str(altitude)].items():
                    if result is None:
                        continue
                    fleet = result['satelliteMinimum']
                    planes = result['planeTradeoff']
                    for design in (fleet, planes):
                        self.assertIn(design['inclinationDeg'], range(30, 91, 5))
                        self.assertEqual(design['satellites'], design['planes'] * design['perPlane'])
                        self.assertGreaterEqual(design['minimum'], int(fold))
                    self.assertLessEqual(planes['satellites'], math.ceil(1.25 * fleet['satellites']))
                    self.assertLessEqual(planes['planes'], fleet['planes'])

    def test_selected_minima_recalculate_on_validation_sites(self):
        for latitude, altitude, fold in ((40, 550, 83), (60, 1000, 50), (90, 550, 83)):
            region = SERVICE_LATITUDES.index(latitude)
            sites = FINE_SITES.reshape(37, 24, 3)[FINE_MASKS[region]].reshape(-1, 3)
            pair = self.grids[latitude]['results'][str(altitude)][str(fold)]
            self.assertIsNotNone(pair)
            for design in pair.values():
                achieved = sampled_minimum(design['planes'], design['perPlane'], altitude, sites,
                                           list(range(0, 25, 2)), 10, design['phase'],
                                           design['inclinationDeg'])
                self.assertEqual(achieved, design['minimum'])

    def test_default_region_fleet_matches_archived_inclination_searches(self):
        archived = {inclination: json.loads((ROOT / 'data' / 'grids' / f'inc-{inclination}.json').read_text())
                    for inclination in range(30, 91, 5)}
        current = self.grids[40]
        for altitude in current['altitudesKm']:
            for fold in current['folds']:
                candidates = [grid['results'][str(altitude)][str(fold)]['satelliteMinimum']['satellites']
                              for grid in archived.values()
                              if grid['results'][str(altitude)][str(fold)] is not None]
                expected = min(candidates) if candidates else None
                result = current['results'][str(altitude)][str(fold)]
                actual = result['satelliteMinimum']['satellites'] if result else None
                self.assertEqual(actual, expected, (altitude, fold))


if __name__ == '__main__':
    unittest.main()

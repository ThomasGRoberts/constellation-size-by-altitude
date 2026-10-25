import math
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from coverage import footprint_half_angle, sampled_minimum, satellite_vectors, site_vectors, search


class GeometryTests(unittest.TestCase):
    def test_footprint_grows_with_altitude(self):
        self.assertLess(footprint_half_angle(350), footprint_half_angle(2000))

    def test_elevation_reduces_footprint(self):
        self.assertGreater(footprint_half_angle(550, 0), footprint_half_angle(550, 20))

    def test_horizon_formula(self):
        expected = math.acos(6371 / (6371 + 550))
        self.assertAlmostEqual(footprint_half_angle(550, 0), expected)

    def test_unit_orbit_vectors(self):
        import numpy as np
        vectors = satellite_vectors(6, 12, 550, 4.3)
        np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-6)

    def test_more_elevation_cannot_increase_coverage(self):
        sites = site_vectors(20, 60)
        times = [0, 1.7, 4.3]
        self.assertGreaterEqual(sampled_minimum(6, 12, 550, sites, times, 0), sampled_minimum(6, 12, 550, sites, times, 20))

    def test_count_bounds(self):
        count = sampled_minimum(4, 8, 800, site_vectors(20, 60), [0, 2, 7])
        self.assertGreaterEqual(count, 0)
        self.assertLessEqual(count, 32)

    def test_precomputed_grid_and_representative_high_fold_solutions(self):
        root = Path(__file__).resolve().parents[1]
        data = json.loads((root / "data/solutions.json").read_text())
        self.assertEqual(data["altitudesKm"], list(range(350, 2001, 50)))
        self.assertEqual(data["folds"], list(range(1, 101)))
        self.assertTrue(all(value is not None for row in data["results"].values() for value in row.values()))
        sites = site_vectors(5, 15)
        for fold in (83, 100):
            selected = data["results"]["550"][str(fold)]["satelliteMinimum"]
            self.assertEqual(selected["satellites"], selected["planes"] * selected["perPlane"])
            self.assertEqual(selected["minimum"], sampled_minimum(selected["planes"], selected["perPlane"], 550, sites, list(range(0, 25, 2)), phase=selected["phase"]))
            self.assertGreaterEqual(sampled_minimum(selected["planes"], selected["perPlane"], 550, sites, [i*.5 for i in range(49)], phase=selected["phase"]), fold)

    def test_1250_km_walker_phasing_and_both_objectives(self):
        root = Path(__file__).resolve().parents[1]
        data = json.loads((root / "data/solutions.json").read_text())
        sites = site_vectors(5, 15)
        for fold in (2, 10, 40, 83, 100):
            pair = data["results"]["1250"][str(fold)]
            for objective in ("satelliteMinimum", "planeTradeoff"):
                design = pair[objective]
                self.assertEqual(design["satellites"], design["planes"] * design["perPlane"])
                self.assertGreaterEqual(sampled_minimum(design["planes"], design["perPlane"], 1250, sites, list(range(0, 25, 2)), phase=design["phase"]), fold)
            self.assertLessEqual(pair["planeTradeoff"]["satellites"], 1.25 * pair["satelliteMinimum"]["satellites"])
        self.assertEqual(data["results"]["1250"]["83"]["satelliteMinimum"]["phase"], 1)

    def test_parameterized_inclination_and_elevation(self):
        sites = site_vectors(5, 15)
        result = search(550, 60, 15)["solutions"]
        for fold in (1, 25, 83, 100):
            pair = result[str(fold)]
            for objective in ("satelliteMinimum", "planeTradeoff"):
                design = pair[objective]
                achieved = sampled_minimum(design["planes"], design["perPlane"], 550, sites, list(range(0, 25, 2)), 15, design["phase"], 60)
                self.assertEqual(achieved, design["minimum"])
                self.assertGreaterEqual(achieved, fold)
            self.assertLessEqual(pair["planeTradeoff"]["satellites"], 1.25 * pair["satelliteMinimum"]["satellites"])

    def test_geometrically_impossible_service_edge(self):
        result = search(350, 30, 30)
        self.assertTrue(result["impossible"])
        self.assertTrue(all(value is None for value in result["solutions"].values()))


if __name__ == "__main__":
    unittest.main()

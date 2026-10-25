"""Sampled Walker-delta coverage search for the ESPL teaching model.

Coordinates use a spherical Earth. The search evaluates each candidate on a
fixed geographic/time grid, then verifies shortlisted solutions on a denser grid.
Neither sampled grid proves continuous coverage between sample points/times.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

EARTH_KM = 6371.0
MU_KM3_S2 = 398600.4418
EARTH_ROTATION_RAD_S = 7.2921159e-5
INCLINATION_DEG = 55.0
ELEVATION_DEG = 10.0
SERVICE_LAT_DEG = 40.0
ALTITUDES_KM = list(range(350, 2001, 50))
FOLD_REQUIREMENTS = list(range(1, 101))
PLANE_OPTIONS = (1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96)


def footprint_half_angle(altitude_km: float, elevation_deg: float = ELEVATION_DEG) -> float:
    """Maximum geocentric separation in radians at minimum elevation."""
    if altitude_km <= 0 or not 0 <= elevation_deg < 90:
        raise ValueError("altitude must be positive and elevation in [0, 90)")
    elevation = math.radians(elevation_deg)
    return math.acos(EARTH_KM * math.cos(elevation) / (EARTH_KM + altitude_km)) - elevation


def site_vectors(latitude_step: int, longitude_step: int) -> np.ndarray:
    lats = np.arange(-SERVICE_LAT_DEG, SERVICE_LAT_DEG + .01, latitude_step)
    lons = np.arange(0, 360, longitude_step)
    lat, lon = np.meshgrid(np.deg2rad(lats), np.deg2rad(lons), indexing="ij")
    return np.stack((np.cos(lat) * np.cos(lon), np.sin(lat), -np.cos(lat) * np.sin(lon)), axis=-1).reshape(-1, 3).astype(np.float32)


def satellite_vectors(planes: int, per_plane: int, altitude_km: float, t_hours: float, inclination_deg: float = INCLINATION_DEG, phase: int = 1) -> np.ndarray:
    j = np.repeat(np.arange(planes), per_plane)
    k = np.tile(np.arange(per_plane), planes)
    raan = 2 * np.pi * j / planes
    inclination = np.deg2rad(inclination_deg)
    mean_motion = math.sqrt(MU_KM3_S2 / (EARTH_KM + altitude_km) ** 3)
    u = 2 * np.pi * (k / per_plane + phase * j / (planes * per_plane)) + mean_motion * t_hours * 3600
    x = np.cos(raan) * np.cos(u) - np.sin(raan) * np.sin(u) * np.cos(inclination)
    y = np.sin(u) * np.sin(inclination)
    z = -(np.sin(raan) * np.cos(u) + np.cos(raan) * np.sin(u) * np.cos(inclination))
    earth_angle = EARTH_ROTATION_RAD_S * t_hours * 3600
    # Coordinate convention is x = cos(lat)cos(lon), z = -cos(lat)sin(lon).
    xe = x * np.cos(earth_angle) - z * np.sin(earth_angle)
    ze = x * np.sin(earth_angle) + z * np.cos(earth_angle)
    return np.stack((xe, y, ze), axis=-1).astype(np.float32)


def sampled_minimum(planes: int, per_plane: int, altitude_km: float, sites: np.ndarray, times_hours: list[float], elevation_deg: float = ELEVATION_DEG, phase: int = 1, inclination_deg: float = INCLINATION_DEG) -> int:
    threshold = math.cos(footprint_half_angle(altitude_km, elevation_deg))
    minimum = planes * per_plane
    for t in times_hours:
        satellites = satellite_vectors(planes, per_plane, altitude_km, t, inclination_deg=inclination_deg, phase=phase)
        visible = (sites @ satellites.T >= threshold).sum(axis=1)
        minimum = min(minimum, int(visible.min()))
        if minimum == 0:
            break
    return minimum


def search(altitude_km: float, inclination_deg: float = INCLINATION_DEG, elevation_deg: float = ELEVATION_DEG) -> dict:
    if not 0 <= inclination_deg <= 90 or not 0 <= elevation_deg < 90:
        raise ValueError('inclination and elevation must be valid degrees')
    # The highest subsatellite latitude is the inclination. A ground site
    # beyond inclination + footprint half-angle cannot see any satellite.
    if inclination_deg + math.degrees(footprint_half_angle(altitude_km, elevation_deg)) < SERVICE_LAT_DEG:
        return {"solutions": {str(n): None for n in FOLD_REQUIREMENTS}, "candidates": 0, "verified": 0, "impossible": True}
    coarse_sites = site_vectors(10, 30)
    fine_sites = site_vectors(5, 15)
    coarse_times = [0, 4, 8, 12, 16, 20, 24]
    fine_times = [i * 2 for i in range(13)]
    candidates = []
    seen = set()
    fleet_targets = [int(round(20 * 1.14 ** i)) for i in range(54)]
    for target in fleet_targets:
        for planes in PLANE_OPTIONS:
            per_plane = max(4, 2 * round(target / planes / 2))
            if per_plane > 256 or planes * per_plane > 24000:
                continue
            for phase in sorted({0, 1 % planes, planes // 2}):
                key = (planes, per_plane, phase)
                if key in seen:
                    continue
                seen.add(key)
                minimum = sampled_minimum(planes, per_plane, altitude_km, coarse_sites, coarse_times, elevation_deg=elevation_deg, phase=phase, inclination_deg=inclination_deg)
                if minimum:
                    candidates.append((planes * per_plane, planes, per_plane, phase, minimum))
    # Equal T/P designs prefer the staggered F=1 Walker pattern when feasible.
    # F=0 is still retained and selected when its sampled coverage is better.
    candidates.sort(key=lambda c: (c[0], c[1], c[3] != 1, c[3]))
    fine_cache = {}

    def verified(candidate):
        _, planes, per_plane, phase, _ = candidate
        key = (planes, per_plane, phase)
        if key not in fine_cache:
            fine_cache[key] = sampled_minimum(planes, per_plane, altitude_km, fine_sites, fine_times, elevation_deg=elevation_deg, phase=phase, inclination_deg=inclination_deg)
        return fine_cache[key]

    results = {}
    for n in FOLD_REQUIREMENTS:
        eligible = [c for c in candidates if c[4] >= n]
        eligible.sort(key=lambda c: (c[0], c[1], c[3] != 1, c[3]))
        minimum = next((c for c in eligible if verified(c) >= n), None)
        if minimum is None:
            results[str(n)] = None
            continue
        ceiling = math.ceil(minimum[0] * 1.25)
        plane_choices = [c for c in eligible if c[0] <= ceiling]
        plane_choices.sort(key=lambda c: (c[1], c[0], c[3] != 1, c[3]))
        plane_min = next((c for c in plane_choices if verified(c) >= n), minimum)

        def record(c):
            return {"satellites": c[0], "planes": c[1], "perPlane": c[2], "phase": c[3], "minimum": verified(c)}

        results[str(n)] = {"satelliteMinimum": record(minimum), "planeTradeoff": record(plane_min)}
    return {"solutions": results, "candidates": len(candidates), "verified": len(fine_cache)}


def main():
    output = {"method": "sampled Walker delta candidate generation, grid evaluation, and constrained Pareto selection", "earthKm": EARTH_KM, "inclinationDeg": INCLINATION_DEG, "elevationDeg": ELEVATION_DEG, "serviceLatitudeDeg": SERVICE_LAT_DEG, "altitudesKm": ALTITUDES_KM, "folds": FOLD_REQUIREMENTS, "results": {}, "search": {"planeOptions": PLANE_OPTIONS, "perPlaneMaximum": 256, "fleetMaximum": 24000, "planeFleetPremium": 1.25, "tiePhasePreference": 1, "coarseGridDeg": [10,30], "fineGridDeg": [5,15], "coarseTimesHours": [0,4,8,12,16,20,24], "fineTimeStepHours": 2}}
    for altitude in ALTITUDES_KM:
        result = search(altitude)
        output["results"][str(altitude)] = result["solutions"]
        print(f"{altitude} km complete; {result['candidates']} candidates; {result['verified']} fine evaluations", flush=True)
    path = Path(__file__).parent / "data" / "solutions.json"
    path.write_text(json.dumps(output, separators=(",", ":")))
    print(path)


if __name__ == "__main__":
    main()

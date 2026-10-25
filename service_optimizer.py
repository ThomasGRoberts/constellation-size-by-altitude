"""Search Walker architectures and inclinations for several service latitude bands at once.

All bands share orbital propagation. Each candidate is screened and validated on
the same latitude/time grid, then the least costly valid design is chosen for
each coverage requirement in each band.
"""
from __future__ import annotations

import math

import numpy as np

from coverage import (
    ALTITUDES_KM, ELEVATION_DEG, FOLD_REQUIREMENTS, PLANE_OPTIONS,
    footprint_half_angle, satellite_vectors,
)

SERVICE_LATITUDES = tuple(range(30, 91, 5))
INCLINATIONS = tuple(range(30, 91, 5))
LATITUDES = np.arange(-90, 91, 5)


def _sites(longitude_step: int) -> np.ndarray:
    longitudes = np.arange(0, 360, longitude_step)
    latitude, longitude = np.meshgrid(np.deg2rad(LATITUDES), np.deg2rad(longitudes), indexing='ij')
    return np.stack((np.cos(latitude) * np.cos(longitude), np.sin(latitude),
                     -np.cos(latitude) * np.sin(longitude)), axis=-1).reshape(-1, 3).astype(np.float32)


COARSE_SITES = _sites(30)
FINE_SITES = _sites(15)
COARSE_MASKS = tuple((np.abs(LATITUDES) <= limit) & (((LATITUDES + limit) % 10) == 0)
                     for limit in SERVICE_LATITUDES)
FINE_MASKS = tuple(np.abs(LATITUDES) <= limit for limit in SERVICE_LATITUDES)


def _regional_minima(planes: int, per_plane: int, phase: int, altitude: int,
                     inclination: int, sites: np.ndarray, longitude_count: int,
                     times: range, masks: tuple[np.ndarray, ...]) -> np.ndarray:
    threshold = math.cos(footprint_half_angle(altitude, ELEVATION_DEG))
    minimum = np.full(len(SERVICE_LATITUDES), planes * per_plane, dtype=np.int32)
    for hour in times:
        satellites = satellite_vectors(planes, per_plane, altitude, hour, inclination, phase)
        by_latitude = (sites @ satellites.T >= threshold).sum(axis=1).reshape(len(LATITUDES), longitude_count).min(axis=1)
        for index, mask in enumerate(masks):
            minimum[index] = min(minimum[index], int(by_latitude[mask].min()))
        if not minimum.any():
            break
    return minimum


def optimize_altitude(altitude: int) -> dict[str, dict]:
    if altitude not in ALTITUDES_KM:
        raise ValueError('unsupported altitude')
    candidates = []
    fleet_targets = [int(round(20 * 1.14 ** i)) for i in range(54)]
    footprint_deg = math.degrees(footprint_half_angle(altitude, ELEVATION_DEG))
    for inclination in INCLINATIONS:
        if inclination + footprint_deg < min(SERVICE_LATITUDES):
            continue
        seen = set()
        for target in fleet_targets:
            for planes in PLANE_OPTIONS:
                per_plane = max(4, 2 * round(target / planes / 2))
                satellites = planes * per_plane
                if per_plane > 256 or satellites > 24000:
                    continue
                for phase in sorted({0, 1 % planes, planes // 2}):
                    key = (planes, per_plane, phase)
                    if key in seen:
                        continue
                    seen.add(key)
                    coarse = _regional_minima(planes, per_plane, phase, altitude, inclination,
                                              COARSE_SITES, 12, range(0, 25, 4), COARSE_MASKS)
                    if coarse.any():
                        candidates.append({'satellites': satellites, 'planes': planes,
                                           'perPlane': per_plane, 'phase': phase,
                                           'inclinationDeg': inclination, 'coarse': coarse,
                                           'fine': None})

    def fine(candidate):
        if candidate['fine'] is None:
            candidate['fine'] = _regional_minima(candidate['planes'], candidate['perPlane'],
                                                  candidate['phase'], altitude,
                                                  candidate['inclinationDeg'], FINE_SITES, 24,
                                                  range(0, 25, 2), FINE_MASKS)
        return candidate['fine']

    fleet_choices = [[None for _ in FOLD_REQUIREMENTS] for _ in SERVICE_LATITUDES]
    plane_choices = [[None for _ in FOLD_REQUIREMENTS] for _ in SERVICE_LATITUDES]
    by_fleet = sorted(candidates, key=lambda c: (c['satellites'], c['planes'],
                                                  c['inclinationDeg'], c['phase'] != 1, c['phase']))
    remaining = sum(len(FOLD_REQUIREMENTS) for _ in SERVICE_LATITUDES)
    for candidate in by_fleet:
        if not remaining:
            break
        useful = any(any(fleet_choices[region][fold-1] is None
                         for fold in range(1, min(100, int(candidate['coarse'][region])) + 1))
                     for region in range(len(SERVICE_LATITUDES)))
        if not useful:
            continue
        capacity = np.minimum(candidate['coarse'], fine(candidate))
        for region, maximum in enumerate(capacity):
            for fold in range(1, min(100, int(maximum)) + 1):
                if fleet_choices[region][fold-1] is None:
                    fleet_choices[region][fold-1] = candidate
                    remaining -= 1

    by_planes = sorted(candidates, key=lambda c: (c['planes'], c['satellites'],
                                                   c['inclinationDeg'], c['phase'] != 1, c['phase']))
    remaining = sum(choice is not None for row in fleet_choices for choice in row)
    for candidate in by_planes:
        if not remaining:
            break
        useful = any(any(plane_choices[region][fold-1] is None
                         and fleet_choices[region][fold-1] is not None
                         and candidate['satellites'] <= math.ceil(fleet_choices[region][fold-1]['satellites'] * 1.25)
                         for fold in range(1, min(100, int(candidate['coarse'][region])) + 1))
                     for region in range(len(SERVICE_LATITUDES)))
        if not useful:
            continue
        capacity = np.minimum(candidate['coarse'], fine(candidate))
        for region, maximum in enumerate(capacity):
            for fold in range(1, min(100, int(maximum)) + 1):
                minimum = fleet_choices[region][fold-1]
                if minimum is not None and plane_choices[region][fold-1] is None \
                        and candidate['satellites'] <= math.ceil(minimum['satellites'] * 1.25):
                    plane_choices[region][fold-1] = candidate
                    remaining -= 1

    def record(candidate, region):
        if candidate is None:
            return None
        return {key: candidate[key] for key in ('satellites', 'planes', 'perPlane', 'phase', 'inclinationDeg')} | {
            'minimum': int(candidate['fine'][region])}

    results = {}
    for region, latitude in enumerate(SERVICE_LATITUDES):
        results[str(latitude)] = {}
        for fold in FOLD_REQUIREMENTS:
            minimum = fleet_choices[region][fold-1]
            results[str(latitude)][str(fold)] = None if minimum is None else {
                'satelliteMinimum': record(minimum, region),
                'planeTradeoff': record(plane_choices[region][fold-1], region),
            }
    return results

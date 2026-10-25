"""Reproduce the archived CelesTrak Starlink visibility estimate.

Requires numpy and sgp4. Uses SGP4/TEME, a GMST rotation, a spherical ground
grid, and topocentric minimum elevation. This is a sampled estimate.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from sgp4.api import Satrec, SatrecArray, jday
from sgp4.omm import initialize
from sgp4.propagation import gstime

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = "20261023T182356Z"
START = datetime(2026, 10, 23, 18, tzinfo=timezone.utc)
EARTH_KM = 6378.137


def ground_grid(lat_step=10, lon_step=30):
    lats = np.arange(-80, 81, lat_step)
    lons = np.arange(-180, 180, lon_step)
    lat, lon = np.meshgrid(lats, lons, indexing="ij")
    a, b = np.deg2rad(lat.ravel()), np.deg2rad(lon.ravel())
    xyz = np.stack((np.cos(a)*np.cos(b), np.cos(a)*np.sin(b), np.sin(a)), axis=1)
    return lat.ravel(), lon.ravel(), xyz.astype(np.float32)


def percentile_summary(values):
    return {"minimum": int(np.min(values)), "p10": float(np.percentile(values, 10)),
            "p25": float(np.percentile(values, 25)), "median": float(np.median(values)),
            "p75": float(np.percentile(values, 75)), "p90": float(np.percentile(values, 90)),
            "maximum": int(np.max(values))}


def analyze(elevation=10, lat_step=10, lon_step=30, hours=range(25), statuses=("+",)):
    gp = json.loads((ROOT / "data/starlink" / f"{ARCHIVE}-gp.json").read_text())
    catalog = json.loads((ROOT / "data/starlink" / f"{ARCHIVE}-satcat.json").read_text())
    status = {int(item["NORAD_CAT_ID"]): item for item in catalog}
    selected = []
    reject = Counter()
    for row in gp:
        item = status.get(int(row["NORAD_CAT_ID"]))
        if not item or item.get("OBJECT_TYPE") != "PAY" or item.get("OPS_STATUS_CODE") not in statuses:
            reject["status"] += 1
            continue
        epoch = datetime.fromisoformat(row["EPOCH"]).replace(tzinfo=timezone.utc)
        if abs((START - epoch).total_seconds()) > 4*86400:
            reject["old elements"] += 1
            continue
        sat = Satrec()
        try:
            initialize(sat, row)
        except (ValueError, KeyError):
            reject["invalid elements"] += 1
            continue
        selected.append(sat)
    sats = SatrecArray(selected)
    lats, lons, sites = ground_grid(lat_step, lon_step)
    counts = []
    errors = Counter()
    e = np.deg2rad(elevation)
    for hour in hours:
        instant = START + timedelta(hours=float(hour))
        jd, fr = jday(instant.year, instant.month, instant.day, instant.hour, instant.minute, instant.second)
        code, position, _ = sats.sgp4(np.array([jd]), np.array([fr]))
        errors.update(map(int, code[:, 0]))
        position = position[:, 0, :]
        valid = (code[:, 0] == 0) & np.all(np.isfinite(position), axis=1)
        angle = gstime(jd+fr)
        c, s = np.cos(angle), np.sin(angle)
        p = position[valid]
        ecef = np.stack((c*p[:, 0]+s*p[:, 1], -s*p[:, 0]+c*p[:, 1], p[:, 2]), axis=1)
        radii = np.linalg.norm(ecef, axis=1)
        threshold = np.cos(np.arccos(np.clip(EARTH_KM*np.cos(e)/radii, -1, 1))-e)
        unit = (ecef / radii[:, None]).astype(np.float32)
        visible = sites @ unit.T >= threshold.astype(np.float32)
        counts.append(visible.sum(axis=1).astype(np.int16))
    counts = np.stack(counts)
    region = np.abs(lats) <= 40
    bands = {}
    for name, mask in [("service_40", region), ("equatorial_20", np.abs(lats) <= 20),
                       ("mid_20_40", (np.abs(lats) > 20) & region), ("outside_40", ~region)]:
        bands[name] = percentile_summary(counts[:, mask].ravel())
    return {"source": "CelesTrak GP and SATCAT Starlink JSON", "archive": ARCHIVE,
            "analysisStartUtc": START.isoformat(), "durationHours": float(max(hours)),
            "timeStepHours": float(hours[1]-hours[0]), "minimumElevationDeg": elevation,
            "latitudeStepDeg": lat_step, "longitudeStepDeg": lon_step,
            "statuses": list(statuses), "satellites": len(selected),
            "excluded": dict(reject), "propagationErrors": dict(errors),
            "locations": len(lats), "regionLocations": int(region.sum()), "bands": bands,
            "regionTimeMinima": [int(x) for x in counts[:, region].min(axis=1)],
            "serviceLocationsUnder24": int(np.count_nonzero(counts[:, region] < 24))}


if __name__ == "__main__":
    baseline = analyze()
    print("baseline", baseline["satellites"], baseline["bands"], flush=True)
    sensitive = {
        "elevation25": analyze(elevation=25),
        "fineGeography": analyze(lat_step=5, lon_step=15),
        "twoHourTimeStep": analyze(hours=range(0, 25, 2)),
        "plusPartial": analyze(statuses=("+", "P")),
    }
    output = {"baseline": baseline, "sensitivity": sensitive}
    path = ROOT / "data/starlink" / f"{ARCHIVE}-coverage.json"
    path.write_text(json.dumps(output, indent=2)+"\n")
    print(path, flush=True)

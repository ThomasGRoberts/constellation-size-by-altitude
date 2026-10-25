# Higher Orbits, Fewer Satellites

An ESPL teaching model for sampled n-fold coverage by idealized circular Walker delta constellations. One floating control panel sits over a full-browser 3D globe or SBI-style Mollweide map. The model imports an unchanged copy of SBI's stylesheet and adapts its satellite texture, geography, camera controls, map renderer, and logo.

## Run

The preview uses a local Python server for the application and precomputed result grids:

```bash
OPENBLAS_NUM_THREADS=1 python3 server.py
```

It serves `http://127.0.0.1:8765/`. Python 3 and NumPy are required. The browser needs WebGL and makes no external network requests. All 13 selectable service latitude regions have complete 34-altitude × 100-fold grids in `data/service_grids/`; the minimum elevation is fixed at 10°. The default ±40° grid loads first, while the others preload in the background. The server sends `Cache-Control: no-store` for preview assets so VS Code does not retain an older animation script.

The regional precomputation evaluates 34 altitudes across 13 symmetric service regions (±30° through ±90° in 5° steps) and tests orbital inclinations from 30° through 90° at each altitude. The browser displays complete stored grids rather than approximating between slider values. An unsupported URL value is rejected with a panel message.

When this project is opened as a VS Code folder, the **Run and Debug** selector has a clickable **Preview Higher Orbits, Fewer Satellites** launch configuration. It starts the local server if needed and opens the 3D globe in VS Code's integrated browser. The ESPL workspace also has a preview configuration.

To regenerate the regional grids and their SHA-256 manifest, run `OPENBLAS_NUM_THREADS=1 python3 precompute_service.py`. The earlier fixed-40°/fixed-inclination grids remain archived in `data/grids/`. Numerical and grid-integrity tests: `OPENBLAS_NUM_THREADS=1 python3 -m unittest discover -s tests -v`.

## Explore

- Altitude: 350–2,000 km in 50 km steps; required coverage: 1–100. N-fold means at least n satellites simultaneously above the fixed 10° minimum elevation angle at each sampled service-region site.
- Service latitude region: ±30°–±90° in 5° steps. The search chooses the inclination, from 30°–90°, that meets the selected regional requirement with the fewest satellites or planes. The chosen inclination appears beneath the two main results.
- The objective switch chooses either the fewest satellites among searched, validated candidates or the fewest planes with a 25% fleet-size cap. The chart follows that objective and highlights the exact chosen n alongside fixed 1-, 10-, 50-, and 100-fold comparison curves.
- **Download CSV** saves the complete validated grid for the selected service region: every altitude and coverage requirement, both optimization choices, and each design's selected inclination, satellites, planes, satellites per plane, phase, and sampled minimum. Rows without a valid design have `solution_found=0` and blank design fields. The 3D view shows gray satellites and orbital paths without a footprint overlay; the camera remains under user control. The 2D map computes instantaneous counts in a Web Worker, pauses hidden 3D updates, and shows the whole Earth; its compact numeric legend distinguishes no coverage from positive counts. The service-band and sampling limits are explained in Methods & limits.

`METHODOLOGY.md` documents search bounds, the empirical Starlink reference, and scientific limits. `DESIGN_IMPLEMENTATION.md` maps the visual choices to SBI and the central ESPL style library. The project uses local Three.js, D3, TopoJSON, world boundaries, and ESPL assets.

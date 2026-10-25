"""Start the local model server if it is not already serving this project."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent
URL = 'http://127.0.0.1:8765/'


def model_is_ready() -> bool:
    try:
        with urlopen(URL, timeout=0.5) as response:
            return response.status == 200 and b'Higher Orbits, Fewer Satellites' in response.read(1024)
    except OSError:
        return False


if __name__ == '__main__':
    if not model_is_ready():
        environment = os.environ.copy()
        environment['OPENBLAS_NUM_THREADS'] = '1'
        process = subprocess.Popen(
            [sys.executable, str(ROOT / 'server.py')],
            cwd=ROOT,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        for _ in range(40):
            if model_is_ready():
                break
            if process.poll() is not None:
                raise SystemExit('Could not start the model server on port 8765.')
            time.sleep(0.25)
        else:
            raise SystemExit('Timed out waiting for the model server on port 8765.')
    print(f'Constellation preview ready at {URL}', flush=True)

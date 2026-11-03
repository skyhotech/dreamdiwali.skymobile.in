"""Live figures about the machine, read from /proc (Linux) with portable
fallbacks, so the admin can watch the VPS without extra software."""

import os
import shutil
import time
from pathlib import Path

PROC = Path("/proc")


def _read(name):
    try:
        return (PROC / name).read_text()
    except OSError:
        return ""


def _cpu_times():
    line = _read("stat").splitlines()[:1]
    if not line:
        return None
    values = [int(v) for v in line[0].split()[1:]]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return sum(values), idle


def cpu_percent(sample=0.25):
    """Busy share of all cores over a short sample; None if unknown."""
    first = _cpu_times()
    if first is None:
        return None
    time.sleep(sample)
    second = _cpu_times()
    total, idle = second[0] - first[0], second[1] - first[1]
    return round(100 * (1 - idle / total), 1) if total else 0.0


def memory():
    info = {}
    for line in _read("meminfo").splitlines():
        key, _, rest = line.partition(":")
        info[key] = int(rest.split()[0]) * 1024 if rest.strip() else 0
    if not info:
        return None
    total, available = info.get("MemTotal", 0), info.get("MemAvailable", 0)
    return {"total": total, "available": available, "used": total - available}


def network():
    """Bytes received and sent since boot, all interfaces but loopback."""
    rx = tx = 0
    for line in _read("net/dev").splitlines()[2:]:
        name, _, data = line.partition(":")
        if name.strip() == "lo" or not data:
            continue
        fields = data.split()
        rx, tx = rx + int(fields[0]), tx + int(fields[8])
    return {"received": rx, "sent": tx}


def snapshot():
    disk = shutil.disk_usage("/")
    uptime = _read("uptime").split()
    load = os.getloadavg() if hasattr(os, "getloadavg") else (0, 0, 0)
    return {
        "cpu": {"percent": cpu_percent(), "cores": os.cpu_count(), "load": [round(v, 2) for v in load]},
        "memory": memory(),
        "disk": {"total": disk.total, "used": disk.used, "free": disk.free},
        "network": network(),
        "uptime": float(uptime[0]) if uptime else None,
        "time": time.time(),
    }

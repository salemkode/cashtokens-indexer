#!/usr/bin/env python3
"""Read-only Linux inventory and bounded HTTP load checks. Never starts services."""
import argparse
import concurrent.futures
import json
import math
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import threading
import time
import urllib.parse
import urllib.request

GIB = 1024 ** 3


def capacity_plan(total, free, memory, available, cores):
    if min(total, free, memory, available, cores) < 0 or free > total or available > memory or cores < 1:
        raise ValueError('Invalid capacity observation')
    enough = free >= 600_000_000_000 and memory >= 8 * GIB and available >= 3 * GIB and cores >= 2
    # A nominal 16 GB machine reports slightly less usable RAM in /proc/meminfo.
    cache = 4096 if memory >= 15 * GIB else 1024
    return {
        'status': 'ready_for_staged_setup' if enough else 'insufficient_initial_resources',
        'disk_total_bytes': total, 'disk_free_bytes': free,
        'memory_total_bytes': memory, 'memory_available_bytes': available, 'usable_cpu_count': cores,
        'initial_budget_bytes': 600_000_000_000,
        'recommended_ingestion_floor_bytes': max(64 * GIB, total // 10),
        'disk_alert_below_free_bytes': total // 5,
        'mainnet_dbcache_mib': cache, 'chipnet_dbcache_mib': 256,
        'mainnet_verification_threads': max(1, min(4, cores - 2)),
        'indexer_memory_limit': '2g', 'indexer_heap_mib': 1024,
        'indexer_cpu_limit': max(1, min(2, cores // 3)),
        'maximum_daily_session_hours': 12, 'schedule_graceful_stop_after_hours': 11.5,
        'notes': ['Total disk size is not free space.', 'Stage initial node sync and index backfill; keep progress between days.',
                  'Recommendations are starting settings, not a benchmark or whole-host memory guarantee.',
                  'GPU is not used. SSD/NVMe and network speed matter. No services were started.'],
    }


def inspect_storage(path):
    if platform.system() != 'Linux':
        raise ValueError('Run inventory on the assigned Linux server, not the Mac')
    root = Path(path)
    if not root.is_absolute() or not root.is_dir():
        raise ValueError('Storage path must be an existing absolute directory on the intended disk')
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        memory[key] = int(value.split()[0]) * 1024
    disk = shutil.disk_usage(root)
    cores = len(os.sched_getaffinity(0))
    result = capacity_plan(disk.total, disk.free, memory['MemTotal'], memory['MemAvailable'], cores)
    result.update({'storage_path': str(root.resolve()), 'platform': platform.platform(),
                   'swap_total_bytes': memory['SwapTotal'], 'swap_free_bytes': memory['SwapFree']})
    try:
        mount = subprocess.run(['findmnt', '-T', str(root), '-n', '-o', 'SOURCE,FSTYPE,TARGET'],
                               capture_output=True, text=True, timeout=5, check=True)
        result['filesystem'] = mount.stdout.strip()
        media = subprocess.run(['lsblk', '-d', '-o', 'NAME,ROTA,TRAN,MODEL'], capture_output=True,
                               text=True, timeout=5, check=True)
        result['disk_inventory'] = media.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        result['disk_inventory'] = 'unavailable; inspect media manually'
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect refused')


def validate_origin(origin):
    parsed = urllib.parse.urlsplit(origin)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('Use a credential-free HTTP(S) origin without a path, query or fragment')
    return origin.rstrip('/')


def read_json(origin, path, timeout):
    # Ignore proxy environment variables so a loopback probe cannot leak through a proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(origin + path, headers={'Accept': 'application/json'})
    with opener.open(request, timeout=timeout) as response:
        if response.status != 200:
            raise ValueError('Expected HTTP 200')
        data = response.read(2_097_153)
        if len(data) > 2_097_152:
            raise ValueError('Probe response budget exceeded')
        return json.loads(data)


def check_response(path, body, network):
    if not isinstance(body, dict) or body.get('network') != network:
        raise ValueError('Wrong API network or malformed response')
    if path == '/readyz':
        if (body.get('state') != 'synced' or body.get('node_ready') is not True
                or not isinstance(body.get('tip'), dict) or body['tip'].get('height') != body.get('source_height')):
            raise ValueError('API is not synchronized')


def probe(origin, network, duration, concurrency, p95_limit):
    origin = validate_origin(origin)
    if network not in ('mainnet', 'chipnet') or not 5 <= duration <= 600 or not 1 <= concurrency <= 8 or p95_limit <= 0:
        raise ValueError('Probe bounds: 5–600 seconds, 1–8 workers, positive p95 target, explicit network')
    check_response('/readyz', read_json(origin, '/readyz', 5), network)
    stop = threading.Event()
    deadline = time.monotonic() + duration
    routes = ('/readyz', '/v1/status', '/v1/activity?limit=9')

    def worker():
        rows = []
        failures = []
        position = 0
        while not stop.is_set() and time.monotonic() < deadline:
            path = routes[position % len(routes)]
            position += 1
            started = time.monotonic()
            try:
                body = read_json(origin, path, max(0.1, min(5, deadline - started)))
                check_response(path, body, network)
                rows.append({'path': path, 'latency_ms': (time.monotonic() - started) * 1000})
            except Exception:
                # Never print upstream response bodies, URLs or arbitrary exception text.
                failures.append({'path': path, 'reason': 'HTTP/JSON/network/readiness check failed'})
                stop.set()
            stop.wait(0.5)  # At most two requests per worker per second.
        return rows, failures

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        results = list(pool.map(lambda _: worker(), range(concurrency)))
    rows = [row for result in results for row in result[0]]
    failures = [failure for result in results for failure in result[1]]
    latencies = sorted(row['latency_ms'] for row in rows)
    p95 = latencies[max(0, math.ceil(len(latencies) * 0.95) - 1)] if latencies else None
    covered = set(row['path'] for row in rows)
    passed = not failures and covered == set(routes) and p95 is not None and p95 <= p95_limit
    return {'status': 'passed' if passed else 'failed', 'network': network, 'duration_seconds': duration,
            'concurrency': concurrency, 'max_requests_per_second': concurrency * 2,
            'successful_requests': len(rows), 'failures': failures,
            'latency_ms': {'p50': statistics.median(latencies) if latencies else None, 'p95': p95,
                           'max': max(latencies) if latencies else None},
            'p95_target_ms': p95_limit, 'routes_covered': sorted(covered),
            'scope': 'Bounded warm read-only API probe; not full capacity, durability or user-journey acceptance'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    inspect = commands.add_parser('inspect')
    inspect.add_argument('--storage-path', required=True)
    load = commands.add_parser('probe')
    load.add_argument('--url', required=True)
    load.add_argument('--network', choices=['mainnet', 'chipnet'], required=True)
    load.add_argument('--duration', type=int, default=60)
    load.add_argument('--concurrency', type=int, default=2)
    load.add_argument('--p95-ms', type=float, default=1000)
    for command in (inspect, load):
        command.add_argument('--report', required=True, help='New private JSON file; never overwrite')
    args = parser.parse_args()
    result = inspect_storage(args.storage_path) if args.command == 'inspect' else probe(
        args.url, args.network, args.duration, args.concurrency, args.p95_ms)
    path = Path(args.report)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(result, output, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    print(json.dumps(result, indent=2))
    return 0 if result['status'] in ('passed', 'ready_for_staged_setup') else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('Server check failed. Verify arguments, server resources, readiness and an unused report path; no services were started.')
        raise SystemExit(1)

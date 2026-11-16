"""Owner-only, fail-closed BCHN diagnostic supervisor. No automatic restart/kill/cleanup.

This operator tool is separate from the read-only indexer and requires macOS's
existing ps/lsof/sysctl tools. Resource polling is NOT an atomic allocation quota.
The measurement launcher refuses P2P while strict byte/allocation control is absent.
"""
import argparse
import base64
import concurrent.futures
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

GIB = 2**30
CHIP_GENESIS = '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b'
CHECKPOINT = '00000000040ba9641ba98a37b2e5ceead38e4e2930ac8f145c8094f94c708727'
REG_GENESIS = '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'
if __name__ == '__main__':
    sys.modules['owned_node'] = sys.modules[__name__]

PREVIEW_HASH = 'b5b4cccd53e9a2a964b5f3f15907994856a13e25789356f075cc9e39c825e237'


class GuardError(Exception):
    pass


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def private_directory(path):
    path = Path(path).absolute()
    stat = path.lstat()
    if path.is_symlink() or not path.is_dir() or path.resolve() != path or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise GuardError('Directory is not an exclusive private owner directory')
    return path


def save_new(path, data):
    path = Path(path)
    with open(path, 'x', opener=lambda name, flags: os.open(name, flags, 0o600)) as file:
        json.dump(data, file, indent=2)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())


def load_private(path):
    path = Path(path)
    stat = path.lstat()
    if path.is_symlink() or not path.is_file() or stat.st_uid != os.getuid() or stat.st_mode & 0o077 or stat.st_size > 262144:
        raise GuardError('Private owner document has unsafe ownership/mode/size')
    return json.loads(path.read_text())


def command(args, timeout=0.8):
    return subprocess.check_output(args, text=True, timeout=timeout, stderr=subprocess.DEVNULL,
                                   env={**os.environ, 'LC_ALL': 'C'}).strip()


def inspect_process(pid):
    if sys.platform != 'darwin':
        raise GuardError('This host-specific ownership probe is only verified on macOS')
    try:
        value = command(['/bin/ps', '-p', str(pid), '-o', 'uid=', '-o', 'lstart=', '-o', 'args='])
    except subprocess.CalledProcessError as error:
        if error.returncode == 1:
            return {'state': 'absent'}
        raise GuardError('Process inspection failed') from error
    match = re.fullmatch(r'\s*(\d+)\s+([A-Za-z]{3} [A-Za-z]{3}\s+\d+ \d\d:\d\d:\d\d \d{4})\s+(.+)', value)
    if not match:
        raise GuardError('Unrecognized process birth/argv record')
    try:
        texts = command(['/usr/sbin/lsof', '-nP', '-a', '-p', str(pid), '-d', 'txt', '-Fn']).splitlines()
    except subprocess.CalledProcessError:
        try:
            command(['/bin/ps', '-p', str(pid), '-o', 'pid='])
        except subprocess.CalledProcessError as error:
            if error.returncode == 1:
                return {'state': 'absent'}
        raise GuardError('Executable inspection raced exit or is unavailable')
    executable = next((line[1:] for line in texts if line.startswith('n')), None)
    if executable is None:
        try:
            command(['/bin/ps', '-p', str(pid), '-o', 'pid='])
        except subprocess.CalledProcessError as error:
            if error.returncode == 1:
                return {'state': 'absent'}
        raise GuardError('Kernel executable mapping unavailable')
    return {'state': 'present', 'pid': pid, 'uid': int(match[1]), 'birth': match[2],
            'command': match[3], 'executable': str(Path(executable).resolve())}



def capture_child_identity(child, seconds=2):
    """Bounded startup observation only; no signals or retries of mutations."""
    until = time.monotonic() + seconds
    while child.poll() is None and time.monotonic() < until:
        try:
            identity = inspect_process(child.pid)
            if identity['state'] == 'present': return identity
        except (GuardError, subprocess.SubprocessError):
            pass
        time.sleep(0.02)
    raise GuardError('Owned child exited early or executable identity unavailable')



def watchdog_progress(run, previous=None, now=None, filename='counters.jsonl'):
    """Parent-side monotonic heartbeat, independent of guardian RPC/probe workers."""
    now = time.monotonic() if now is None else now
    path = Path(run) / filename
    try:
        stat = path.stat()
        marker = (stat.st_size, stat.st_mtime_ns)
    except FileNotFoundError:
        marker = None
    if previous is None or previous['marker'] != marker:
        return {'marker': marker, 'changed_at': now, 'stale': False}
    return dict(previous, stale=now - previous['changed_at'] > 2)


def identity_matches(expected, actual):
    return actual.get('state') == 'present' and all(actual.get(key) == expected.get(key)
        for key in ['pid', 'uid', 'birth', 'command', 'executable'])


def validate_ledger(ledger, run):
    if ledger.get('schema') != 1 or ledger.get('hostname') != socket.gethostname():
        raise GuardError('Owner schema/host mismatch')
    if not isinstance(ledger.get('pid'), int) or ledger['pid'] <= 1 or ledger.get('uid') != os.getuid():
        raise GuardError('Owner PID/UID invalid')
    if ledger['identity'].get('pid') != ledger['pid'] or ledger['identity'].get('uid') != ledger['uid']:
        raise GuardError('Owner identity PID/UID mismatch')
    if ledger.get('control_run', str(run)) != str(run):
        raise GuardError('Control run ownership mismatch')
    directory = private_directory(ledger['datadir'])
    expected_parent = Path(ledger['storage']['mountpoint']) if ledger.get('storage') else run
    if ledger.get('storage'):
        from bounded_store import image_binding
        image_binding(run, ledger['storage'])
    if directory.parent != expected_parent or str(directory) not in ledger['identity']['command']:
        raise GuardError('Datadir is outside this exclusive run or absent from argv')
    if f'-datadir={directory}' not in ledger['identity']['command'].split():
        raise GuardError('Exact datadir argument missing')
    if str(Path(ledger['executable']).resolve()) != ledger['identity']['executable']:
        raise GuardError('Executable identity mismatch')
    if not isinstance(ledger.get('rpc_port'), int) or not 1024 <= ledger['rpc_port'] <= 65535:
        raise GuardError('RPC port invalid')
    if ledger.get('role') == 'consumer' and (ledger.get('network') != 'regtest' or ledger.get('profile') != 'bounded_consumer_regtest_v1' or not ledger.get('storage')):
        raise GuardError('Consumer stop role outside bounded owned regtest')
    if ledger.get('network') not in ['regtest', 'chipnet']:
        raise GuardError('Mainnet/unknown network forbidden')
    if ledger['network'] == 'chipnet':
        tokens = ledger['identity']['command'].split()
        required = {'-chipnet','-connect=0','-dnsseed=0','-listen=0','-discover=0','-upnp=0','-natpmp=0','-disablewallet=1','-prune=0','-txindex=1','-stopatheight=115252'}
        if not required.issubset(tokens) or not ledger.get('storage') or not ledger.get('peer_routes'):
            raise GuardError('Chipnet guard requires a fixed store and exclusively gated peer routes')
        options = [token.lstrip('-').split('=',1)[0] for token in tokens[1:]]
        if len(options) != len(set(options)):
            raise GuardError('Duplicate runtime options forbidden')
        if any(option in ['expire','expirerpc'] or option.startswith('upgrade') for option in options):
            raise GuardError('Expiry/activation overrides forbidden')
    cookie = Path(ledger['cookie'])
    if cookie.name != '.cookie' or cookie.parent != directory / ('regtest' if ledger['network'] == 'regtest' else 'chipnet'):
        raise GuardError('Cookie not in exact owned network datadir')
    return ledger


def rpc(ledger, method, params=(), timeout=0.4):
    if method not in ['getblockchaininfo', 'getblockhash', 'getnetworkinfo', 'getnettotals', 'getindexinfo', 'stop', 'addnode']:
        raise GuardError('Owner monitor RPC method forbidden')
    if method == 'addnode':
        if ledger['network'] != 'chipnet' or len(params) != 2 or params[1] != 'onetry' or not ledger.get('storage'):
            raise GuardError('Peer activation outside bounded Chipnet mode')
        run = Path(ledger.get('control_run', Path(ledger['storage']['image']).parent))
        armed = load_private(run / 'armed.json'); gates = load_private(run / 'peer-gate.json')
        watcher = load_private(run / 'watchdog-owner.json')
        if watcher['pid'] != gates['pid'] or not identity_matches(watcher['identity'], inspect_process(watcher['pid'])):
            raise GuardError('Owned relay guardian is not alive with exact identity')
        if armed['watchdog_pid'] != gates['pid'] or params[0] not in [f'127.0.0.1:{port}' for port in gates['ports']]:
            raise GuardError('Only exact owned armed relay ports may be activated')
        relay_port = int(params[0].split(':')[-1])
        listening = command(['/usr/sbin/lsof','-nP','-a','-p',str(gates['pid']),f'-iTCP:{relay_port}','-sTCP:LISTEN','-Fn'])
        if f'n127.0.0.1:{relay_port}' not in listening.splitlines():
            raise GuardError('Exact owned relay listener unavailable')
        save_new(run / ('activation-' + str(params[0].split(':')[-1]) + '.json'), {'at': utc(), 'target': params[0], 'one_attempt': True})
    cookie = Path(ledger['cookie']); private_directory(cookie.parent); stat = cookie.lstat()
    if cookie.is_symlink() or stat.st_uid != ledger['uid'] or stat.st_mode & 0o077 or stat.st_size > 1024:
        raise GuardError('Cookie ownership/mode invalid')
    # Require the exact owned process to hold this loopback listener before using its credential.
    listener = command(['/usr/sbin/lsof', '-nP', '-a', '-p', str(ledger['pid']), f'-iTCP:{ledger["rpc_port"]}', '-sTCP:LISTEN', '-Fn'])
    if f'n127.0.0.1:{ledger["rpc_port"]}' not in listener.splitlines():
        raise GuardError('Owned loopback RPC listener not verified')
    auth = base64.b64encode(cookie.read_bytes().strip()).decode()
    req = urllib.request.Request(f'http://127.0.0.1:{ledger["rpc_port"]}',
        data=json.dumps({'id': 'owner-guard', 'method': method, 'params': list(params)}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Basic ' + auth})
    # Owner endpoint is loopback-only; prohibit redirects before any credentials can be forwarded.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            raise GuardError('Owner RPC redirect refused')
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=timeout) as response:
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise GuardError('Owner RPC response exceeds limit')
            body = json.loads(raw)
    except urllib.error.HTTPError as error:
        # BCHN uses HTTP500 during warmup/expiry. Do not include body/credentials in errors.
        try:
            body = json.loads(error.read(1048576))
        except (ValueError, OSError):
            raise GuardError('Owner RPC HTTP failure') from None
    if not isinstance(body, dict) or 'result' not in body or 'error' not in body:
        raise GuardError('Invalid owner RPC envelope')
    failure = body.get('error')
    if failure is not None:
        raise GuardError('Owner RPC code ' + str(failure.get('code')))
    return body['result']


def allocated_bytes(directory, max_entries=10000, excluded=None):
    total = 0; seen = 0; stack = [(Path(directory), 0)]
    while stack:
        path, depth = stack.pop()
        if depth > 16:
            raise GuardError('Owned allocation tree depth exceeded')
        for entry in path.iterdir():
            if excluded is not None and entry == excluded:
                continue
            seen += 1
            if seen > max_entries:
                raise GuardError('Owned allocation census exceeded bound')
            try:
                stat = entry.lstat()
            except FileNotFoundError:
                continue  # LevelDB may retire a file during this owned-only census.
            if entry.is_symlink():
                raise GuardError('Unexpected symlink in owned data tree')
            if entry.is_dir():
                stack.append((entry, depth + 1))
            elif entry.is_file():
                total += stat.st_blocks * 512
            else:
                raise GuardError('Unexpected nonregular owned file')
    return total


def cold_allocation(store):
    from cold_restore import private_file
    return sum(private_file(path).stat().st_blocks * 512 for path in store.get('cold_archive_files', []))


def owned_allocation(run, ledger):
    if ledger.get('storage'):
        from bounded_store import image_binding
        image_binding(run, ledger['storage'])
        # Count backing image once, rather than double-counting inner filesystem files.
        total = allocated_bytes(run, excluded=Path(ledger['storage']['mountpoint']))
        if ledger['storage'].get('origin_run'):
            total += allocated_bytes(ledger['storage']['origin_run'], excluded=Path(ledger['storage']['mountpoint']))
        return total + cold_allocation(ledger['storage'])
    return allocated_bytes(run)


def host_sample(directory):
    fs = os.statvfs(directory)
    swap = command(['/usr/sbin/sysctl', '-n', 'vm.swapusage'])
    match = re.search(r'used = ([0-9.]+)M', swap)
    if not match:
        raise GuardError('Swap measurement unavailable')
    pressure = int(command(['/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level']))
    vm = command(['/usr/bin/vm_stat'])
    page = int(re.search(r'page size of (\d+) bytes', vm)[1])
    pages = {m[1].strip(): int(m[2]) for m in re.finditer(r'([^\n:]+):\s+(\d+)\.', vm)}
    reclaimable = sum(pages.get(key, 0) for key in ['Pages free', 'Pages inactive', 'Pages speculative']) * page
    rows = command(['/bin/ps', '-axo', 'pid=,pcpu=,comm=']).splitlines()
    builds = []
    for row in rows:
        fields = row.strip().split(None, 2)
        if len(fields) != 3:
            continue
        pid, cpu, exe = fields
        name = Path(exe).name.strip('()')
        if re.fullmatch(r'(clang(?:\+\+)?|swift-frontend|swiftc|xcodebuild|SWBBuildService|ninja|javac|ld)', name) and float(cpu) >= 5:
            builds.append({'pid': int(pid), 'cpu_percent': float(cpu), 'name': name})
    return {'at': utc(), 'free_bytes': fs.f_bavail * fs.f_frsize, 'swap_bytes': int(float(match[1]) * 2**20),
            'pressure': pressure, 'reclaimable_page_estimate_bytes': reclaimable, 'heavy_builds': builds,
            'load_averages': os.getloadavg()}


def preflight(first, second, strict_control=False):
    reasons = []
    if second['free_bytes'] < 12 * GIB:
        reasons.append('free_space_below_12GiB')
    if first['pressure'] != 1 or second['pressure'] != 1:
        reasons.append('memory_pressure_not_normal')
    if first['heavy_builds'] or second['heavy_builds']:
        reasons.append('concurrent_heavy_build')
    if min(first['reclaimable_page_estimate_bytes'], second['reclaimable_page_estimate_bytes']) < 4 * GIB:
        reasons.append('less_than_4GiB_reclaimable_page_estimate')
    if second['swap_bytes'] > first['swap_bytes']:
        reasons.append('swap_rising_during_preflight')
    if not strict_control:
        reasons.append('strict_disk_receive_ceiling_not_established_by_polling')
    return reasons


def limits_reason(sample, limits, now, progress):
    if now >= limits['deadline']:
        return 'deadline'
    if sample['free_bytes'] < limits['free_stop_bytes']:
        return 'free_space'
    if sample['allocated_bytes'] >= limits['allocated_stop_bytes']:
        return 'owned_allocation'
    if sample['rss_bytes'] > limits['rss_stop_bytes']:
        return 'rss'
    if sample['swap_bytes'] - limits['initial_swap_bytes'] > limits['swap_growth_stop_bytes']:
        return 'swap_growth'
    if sample['pressure'] != 1:
        return 'memory_pressure'
    if sample.get('log_limit'):
        return 'log_limit'
    if sample.get('received_bytes', 0) < progress['received_bytes']:
        return 'receive_counter_regression'
    if sample.get('received_bytes', 0) >= limits['receive_stop_bytes']:
        return 'receive_budget'
    if sample.get('connections', 0) > 2:
        return 'connection_budget'
    if sample.get('warnings'):
        return 'node_warning'
    if sample.get('software_expiration_time', now + 1) <= now:
        return 'software_expiry'
    if sample.get('blocks', 0) >= limits['checkpoint_height']:
        return 'checkpoint'
    if now - progress['last_progress_at'] >= limits['no_progress_seconds']:
        return 'no_progress'
    return None


def stop_owned(ledger, run, reason, graceful_seconds=10, term_seconds=5):
    run = private_directory(run)
    prefix = 'consumer-' if ledger.get('role') == 'consumer' else ''
    try:
        validate_ledger(ledger, run)
    except (GuardError, OSError, ValueError):
        receipt = {'reason': reason, 'pid': ledger.get('pid'), 'outcome': 'ownership_refused', 'rpc_stop_attempted': False, 'sigterm_sent': False, 'sigkill_or_restart': False, 'validation': 'ledger_or_datadir_mismatch'}
        save_new(run / (prefix + 'stop-receipt.json'), receipt)
        return receipt
    try:
        save_new(Path(run) / (prefix + 'stop-claim.json'), {'at': utc(), 'requester_pid': os.getpid(), 'target_pid': ledger['pid']})
    except FileExistsError:
        return {'reason': reason, 'pid': ledger['pid'], 'outcome': 'stop_already_claimed', 'rpc_stop_attempted': False, 'sigterm_sent': False, 'sigkill_or_restart': False}
    receipt = {'reason': reason, 'requested_at': utc(), 'pid': ledger['pid'], 'rpc_stop_attempted': False,
               'sigterm_sent': False, 'sigkill_or_restart': False, 'ownership_probes': []}
    def probe():
        try:
            actual = inspect_process(ledger['pid'])
        except (GuardError, OSError, subprocess.SubprocessError):
            actual = {'state': 'unknown'}
        receipt['ownership_probes'].append({'at': utc(), 'state': actual['state'], 'matches': identity_matches(ledger['identity'], actual)})
        return actual
    actual = probe()
    if actual['state'] == 'absent':
        receipt['outcome'] = 'already_exited'
    elif not identity_matches(ledger['identity'], actual):
        receipt['outcome'] = 'ownership_refused'
    else:
        if ledger.get('role') != 'consumer':
            receipt['rpc_stop_attempted'] = True
            try:
                receipt['rpc_stop_result'] = rpc(ledger, 'stop')
            except (GuardError, OSError, ValueError, subprocess.SubprocessError):
                receipt['rpc_stop_result'] = 'unavailable_or_ambiguous_no_retry'
        else:
            graceful_seconds = 0  # This REST process has no native RPC stop surface or shared credential use.
        until = time.monotonic() + graceful_seconds
        while time.monotonic() < until:
            actual = probe()
            if actual['state'] == 'absent' or (actual['state'] == 'present' and not identity_matches(ledger['identity'], actual)):
                break
            time.sleep(0.05)
        if actual['state'] == 'absent':
            receipt['outcome'] = 'rpc_stop_exited'
        elif not identity_matches(ledger['identity'], actual):
            receipt['outcome'] = 'ownership_lost_no_signal'
        else:
            # Fresh birth/UID/kernel-executable/complete-argv match immediately before signal.
            actual = probe()
            if identity_matches(ledger['identity'], actual):
                os.kill(ledger['pid'], signal.SIGTERM)
                receipt['sigterm_sent'] = True
            until = time.monotonic() + term_seconds
            while time.monotonic() < until:
                actual = probe()
                if actual['state'] == 'absent' or (actual['state'] == 'present' and not identity_matches(ledger['identity'], actual)):
                    break
                time.sleep(0.05)
            receipt['outcome'] = 'sigterm_exited' if actual['state'] == 'absent' else 'ambiguous_no_force'
    receipt['finished_at'] = utc()
    save_new(Path(run) / (prefix + 'stop-receipt.json'), receipt)
    return receipt


def validate_limits(limits):
    required = ['deadline', 'free_stop_bytes', 'allocated_stop_bytes', 'rss_stop_bytes',
                'initial_swap_bytes', 'swap_growth_stop_bytes', 'receive_stop_bytes',
                'checkpoint_height', 'no_progress_seconds', 'startup_grace_seconds',
                'poll_seconds', 'graceful_stop_seconds', 'term_stop_seconds']
    if any(not isinstance(limits.get(key), (float, int)) or not math.isfinite(limits[key]) or limits[key] < 0 for key in required):
        raise GuardError('Invalid guard limits')
    if not 0.05 <= limits['poll_seconds'] <= 2 or limits['graceful_stop_seconds'] > 60 or limits['term_stop_seconds'] > 60:
        raise GuardError('Guard polling/stop deadline out of bounds')
    if limits['allocated_stop_bytes'] > 2*GIB-256*2**20 or limits['receive_stop_bytes'] > 2*GIB-64*2**20 or limits['rss_stop_bytes'] > 2*GIB:
        raise GuardError('Stage1 thresholds must retain allocation/receive stopping headroom')
    if limits['checkpoint_height'] > 115252 or limits['swap_growth_stop_bytes'] > 512*2**20 or limits['free_stop_bytes'] < 9*GIB:
        raise GuardError('Stage1 checkpoint/swap/free-space authorization exceeded')
    if limits['startup_grace_seconds'] > 30 or limits['deadline'] > time.time() + 1800-limits['graceful_stop_seconds']-limits['term_stop_seconds']-10 or limits['no_progress_seconds'] > 600:
        raise GuardError('Stage1 time limits exceed authorization')


def watch(run):
    run = private_directory(run)
    save_new(run / 'watchdog-owner.json', {'pid': os.getpid(), 'identity': inspect_process(os.getpid()), 'at': utc()})
    ledger = validate_ledger(load_private(run / 'owner.json'), run)
    limits = load_private(run / 'limits.json'); start = time.monotonic()
    validate_limits(limits)
    monotonic_budget = max(0, limits['deadline'] - time.time())
    progress = {'received_bytes': 0, 'blocks': -1, 'last_progress_at': time.time()}
    observations = []; peak = {'allocated_bytes': None, 'rss_bytes': None, 'received_bytes': None}; reason = None
    counters = open(run / 'counters.jsonl', 'x', opener=lambda name, flags: os.open(name, flags, 0o600))
    def observe(sample):
        for key in peak:
            if key in sample:
                peak[key] = max(peak[key] or 0, sample[key])
        observations.append(dict(sample))
        if len(observations) > 16: observations.pop(0)
        row = {key: sample[key] for key in ['at', 'free_bytes', 'swap_bytes', 'pressure', 'allocated_bytes', 'rss_bytes', 'received_bytes', 'blocks', 'hash'] if key in sample}
        encoded = json.dumps(row) + '\n'
        if counters.tell() + len(encoded.encode()) > 1048576:
            raise GuardError('Private counter journal limit reached')
        counters.write(encoded); counters.flush(); os.fsync(counters.fileno())
    gate = None
    bounded = ledger.get('profile') == 'bounded_consumer_regtest_v1'
    heartbeat = None
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=8)
    try:
        while reason is None:
            tick = time.monotonic()
            if bounded:
                from bounded_regtest import validate_running, consumer_health
                validate_running(ledger, limits, run)
                if not (run / 'parent-heartbeat.jsonl').exists():
                    reason = 'parent_heartbeat_missing'; break
                heartbeat = watchdog_progress(run, heartbeat, filename='parent-heartbeat.jsonl')
                if heartbeat['stale']:
                    reason = 'parent_heartbeat_expired'; break
                consumer_health(run, ledger)
            if tick - start >= monotonic_budget:
                reason = 'deadline'; break
            jobs = {'identity': pool.submit(inspect_process, ledger['pid']),
                    'parent': pool.submit(inspect_process, ledger['parent_identity']['pid']),
                    'host': pool.submit(host_sample, run), 'allocation': pool.submit(owned_allocation, run, ledger),
                    'rss': pool.submit(command, ['/bin/ps', '-p', str(ledger['pid']), '-o', 'rss='])}
            # One total probe deadline, not a fresh timeout for each sequential result.
            probe_end = tick + 0.9
            try:
                readings = {key: future.result(timeout=max(0, probe_end-time.monotonic())) for key, future in jobs.items()}
            except concurrent.futures.TimeoutError:
                reason = 'guard_probe_deadline'; break
            actual = readings['identity']
            if actual['state'] == 'absent':
                reason = 'node_exited'; break
            if not identity_matches(ledger['identity'], actual):
                reason = 'ownership_mismatch'; break
            if not identity_matches(ledger['parent_identity'], readings['parent']):
                reason = 'launcher_lost'; break
            sample = {**readings['host'], 'allocated_bytes': readings['allocation'],
                      'rss_bytes': int(readings['rss']) * 1024,
                      'log_limit': (run / 'log-limit.json').exists()}
            observe(sample)
            # Resource/deadline checks run before RPC, so an unresponsive node cannot defer them.
            reason = limits_reason(sample, limits, time.time(), progress)
            if reason: break
            request = run / 'stop-request.json'
            if request.exists():
                reason = load_private(request)['reason']; break
            futures = {method: pool.submit(rpc, ledger, method) for method in ['getblockchaininfo', 'getnetworkinfo', 'getnettotals']}
            futures['genesis'] = pool.submit(rpc, ledger, 'getblockhash', [0])
            try:
                rpc_end = tick + 1.8
                results = {method: future.result(timeout=max(0, rpc_end-time.monotonic())) for method, future in futures.items()}
                chain = results['getblockchaininfo']; network = results['getnetworkinfo']; traffic = results['getnettotals']
                if bounded and (network['connections'] != 0 or traffic['totalbytesrecv'] != 0 or traffic.get('totalbytessent') != 0):
                    raise GuardError('Bounded regtest external peer/traffic observed')
                expected_chain = 'chip' if ledger['network'] == 'chipnet' else 'regtest'
                genesis = results['genesis']
                expected_genesis = CHIP_GENESIS if ledger['network'] == 'chipnet' else REG_GENESIS
                if chain['chain'] != expected_chain or genesis != expected_genesis or network['version'] != 29020100:
                    raise GuardError('Native network/genesis/version identity mismatch')
                warning = chain.get('warnings', '') or network.get('warnings', '')
                allowed_preview = 'This is a pre-release test build - use at your own risk - do not use for mining or merchant applications'
                if warning == allowed_preview: warning = ''
                sample.update({'blocks': chain['blocks'], 'hash': chain['bestblockhash'], 'received_bytes': traffic['totalbytesrecv'] + ledger.get('prior_received_bytes', 0),
                               'connections': network['connections'], 'warnings': warning[:200],
                               'software_expiration_time': chain.get('upgrade_status', {}).get('software_expiration_time')})
                if sample['software_expiration_time'] is None:
                    raise GuardError('Native expiry guard time unavailable')
                if ledger['network'] == 'chipnet' and sample['blocks'] >= 115252 and rpc(ledger, 'getblockhash', [115252]) != CHECKPOINT:
                    raise GuardError('Chipnet fork checkpoint mismatch')
                if ledger['network'] == 'chipnet' and (chain.get('pruned') is not False or sample['software_expiration_time'] != 1826280000):
                    raise GuardError('Native retained-history/expiry guard identity mismatch')
                if ledger['network'] == 'chipnet' and gate is None:
                    from peer_byte_gate import PeerByteGate
                    def gated_stop(reason):
                        try: save_new(run / 'stop-request.json', {'reason': 'peer_gate_' + reason})
                        except FileExistsError: pass
                    gate = PeerByteGate([(route['ip'],route['port']) for route in ledger['peer_routes']], min(limits['receive_stop_bytes'],1792*2**20) - ledger.get('prior_received_bytes',0),64*2**20 - ledger.get('prior_uploaded_bytes',0),gated_stop)
                    ports = gate.start()
                    save_new(run / 'peer-gate.json', {'pid': os.getpid(), 'ports': ports, 'routes': ledger['peer_routes'], 'receive_limit': gate.receive_limit})
                if not (run / 'armed.json').exists():
                    save_new(run / 'armed.json', {'at': utc(), 'watchdog_pid': os.getpid(), 'native_genesis': genesis,
                                                 'network': ledger['network'], 'expiry': sample['software_expiration_time']})
                reason = limits_reason(sample, limits, time.time(), progress)
                if sample['blocks'] > progress['blocks']:
                    progress['last_progress_at'] = time.time()
                progress['blocks'] = sample['blocks']; progress['received_bytes'] = sample['received_bytes']
            except (GuardError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, concurrent.futures.TimeoutError) as error:
                failure = str(error) if isinstance(error, GuardError) else type(error).__name__
                if 'external peer/traffic' in failure:
                    reason = 'bounded_external_peer_traffic'
                elif '-100' in failure or 'identity mismatch' in failure or 'checkpoint mismatch' in failure or 'expiry guard' in failure:
                    reason = 'native_identity_or_expiry_failure'
                elif time.monotonic() - start > limits['startup_grace_seconds']:
                    reason = 'rpc_unavailable'
                sample['rpc_failure'] = failure
            observe(sample)
            if reason is None and time.monotonic() - tick > 2:
                reason = 'guard_poll_overrun'
            if reason is None:
                time.sleep(max(0, limits['poll_seconds'] - (time.monotonic() - tick)))
    except (GuardError, OSError, ValueError, KeyError, subprocess.SubprocessError, concurrent.futures.TimeoutError) as error:
        reason = 'guard_inspection_unavailable'
        observations.append({'guard_failure_type': type(error).__name__})
    finally:
        # Worker RPC timeouts are bounded; stop path uses an independent fresh ownership probe.
        pool.shutdown(wait=False, cancel_futures=True)
        if gate is not None:
            gate.close()
            save_new(run / 'peer-gate-receipt.json', gate.snapshot())
        counters.close()
    if bounded and (run / 'consumer-owner.json').exists():
        from bounded_regtest import stop_consumer
        stop_consumer(run, ledger, reason)
    receipt = stop_owned(ledger, run, reason, limits['graceful_stop_seconds'], limits['term_stop_seconds'])
    save_new(run / 'guard-report.json', {'reason': reason, 'peak_observed': peak, 'last_observations': observations,
        'stop_receipt': receipt, 'poll_seconds': limits['poll_seconds'], 'strict_allocation_or_receive_quota': bool(ledger.get('storage') and ledger.get('peer_routes')),
        'fixed_store': ledger.get('storage'), 'fixed_allocation_bound': bool(ledger.get('storage')),
        'gated_delivered_receive_bound': gate is not None, 'peer_gate': gate.snapshot() if gate else None,
        'overshoot_limit': 'Sampling thresholds can overshoot; configured fixed filesystem bounds retained bytes and gated peer routes bound delivered P2P bytes. TCP/IP overhead is outside application counters. Without these boundaries no hard byte quota is claimed.',
        'automatic_resume': False})
    return 0 if receipt['outcome'] in ['already_exited', 'rpc_stop_exited', 'sigterm_exited'] else 2


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['watch', 'preflight']); parser.add_argument('--run', required=True)
    args = parser.parse_args()
    if args.action == 'watch':
        return watch(args.run)
    first = host_sample(args.run); time.sleep(2); second = host_sample(args.run)
    report = {'at': utc(), 'hostname': socket.gethostname(), 'first': first, 'second': second,
              'reasons': preflight(first, second, strict_control=False), 'p2p_authorized_by_this_tool': False,
              'note': 'No daemon is started by preflight. Strict allocation/receive caps require a separate proven enforcement boundary before P2P.'}
    print(json.dumps(report, indent=2)); return 0 if not report['reasons'] else 3


if __name__ == '__main__':
    try: sys.exit(main())
    except (GuardError, OSError, ValueError) as error:
        print(json.dumps({'error_type': type(error).__name__, 'no_force_or_restart': True}), file=sys.stderr); sys.exit(2)

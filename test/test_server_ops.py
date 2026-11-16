import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('server_ops', Path(__file__).resolve().parents[1] / 'deploy/server/ops.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class ServerOperationsTests(unittest.TestCase):
    def simulated_probe(self, latency=0.05, fail=False, p95=1000):
        clock = {'now': 0.0, 'reads': 0}

        class Event:
            stopped = False
            def is_set(self):
                return self.stopped
            def set(self):
                self.stopped = True
            def wait(self, duration):
                clock['now'] += duration

        class Pool:
            def __init__(self, **kwargs):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def map(self, callback, values):
                return [callback(value) for value in values]

        def read(origin, path, timeout):
            clock['now'] += latency
            clock['reads'] += 1
            if fail and clock['reads'] == 3:
                raise ValueError('private-token-must-not-appear')
            return {'network': 'mainnet', 'state': 'synced', 'node_ready': True,
                    'tip': {'height': 10}, 'source_height': 10}

        with patch.object(ops, 'read_json', side_effect=read), \
                patch.object(ops.time, 'monotonic', side_effect=lambda: clock['now']), \
                patch.object(ops.threading, 'Event', Event), \
                patch.object(ops.concurrent.futures, 'ThreadPoolExecutor', Pool):
            return ops.probe('http://localhost', 'mainnet', 5, 1, p95)

    def test_probe_success_covers_all_routes_and_checks_latency_target(self):
        report = self.simulated_probe()
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(len(report['routes_covered']), 3)
        self.assertAlmostEqual(report['latency_ms']['p95'], 50)
        self.assertLessEqual(report['successful_requests'], 10)
        self.assertEqual(self.simulated_probe(p95=10)['status'], 'failed')

    def test_probe_aborts_after_failure_without_leaking_exception(self):
        report = self.simulated_probe(fail=True)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(len(report['failures']), 1)
        self.assertNotIn('private-token', json.dumps(report))

    def test_900gb_is_capacity_not_available_space(self):
        plan = ops.capacity_plan(900_000_000_000, 100_000_000_000, 16 * ops.GIB, 12 * ops.GIB, 6)
        self.assertEqual(plan['status'], 'insufficient_initial_resources')
        self.assertEqual(plan['recommended_ingestion_floor_bytes'], 90_000_000_000)

    def test_user_hardware_has_bounded_tuning_and_daily_shutdown_margin(self):
        plan = ops.capacity_plan(900_000_000_000, 800_000_000_000, 16 * ops.GIB, 12 * ops.GIB, 6)
        self.assertEqual(plan['status'], 'ready_for_staged_setup')
        self.assertEqual(plan['mainnet_dbcache_mib'], 4096)
        self.assertEqual(plan['mainnet_verification_threads'], 4)
        self.assertEqual(plan['indexer_cpu_limit'], 2)
        self.assertLess(plan['schedule_graceful_stop_after_hours'], plan['maximum_daily_session_hours'])
        nominal = ops.capacity_plan(900_000_000_000, 800_000_000_000, 15 * ops.GIB, 12 * ops.GIB, 6)
        self.assertEqual(nominal['mainnet_dbcache_mib'], 4096)

    def test_insufficient_or_inconsistent_memory_is_not_admitted(self):
        for memory, available in [(4 * ops.GIB, 3 * ops.GIB), (16 * ops.GIB, ops.GIB)]:
            self.assertEqual(ops.capacity_plan(900_000_000_000, 800_000_000_000, memory, available, 6)['status'],
                             'insufficient_initial_resources')
        with self.assertRaises(ValueError):
            ops.capacity_plan(100, 200, 16 * ops.GIB, 12 * ops.GIB, 6)

    def test_inventory_refuses_macos(self):
        with patch.object(ops.platform, 'system', return_value='Darwin'):
            with self.assertRaises(ValueError):
                ops.inspect_storage('/')

    def test_probe_refuses_credentials_paths_and_non_http_targets(self):
        for origin in ['file:///etc/passwd', 'http://user:secret@localhost:3001', 'http://localhost/x',
                       'http://localhost/?secret=value', 'http://localhost/#secret', 'https://']:
            with self.assertRaises(ValueError):
                ops.validate_origin(origin)
        self.assertEqual(ops.validate_origin('http://127.0.0.1:3001/'), 'http://127.0.0.1:3001')

    def test_probe_bounds_are_checked_before_requests(self):
        with patch.object(ops, 'read_json') as read:
            for duration, concurrency in [(0, 1), (601, 1), (60, 0), (60, 9)]:
                with self.assertRaises(ValueError):
                    ops.probe('http://localhost', 'mainnet', duration, concurrency, 1000)
            read.assert_not_called()

    def test_wrong_network_and_unready_response_fail(self):
        for body in [{}, {'network': 'chipnet'}, {'network': 'mainnet', 'state': 'syncing'},
                     {'network': 'mainnet', 'state': 'synced', 'node_ready': True, 'tip': {'height': 10}, 'source_height': 11}]:
            with self.assertRaises(ValueError):
                ops.check_response('/readyz', body, 'mainnet')

    def test_probe_does_not_redirect(self):
        with self.assertRaises(ValueError):
            ops.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://elsewhere')

    def test_probe_refuses_unready_target_before_worker_start(self):
        with patch.object(ops, 'read_json', return_value={'network': 'mainnet', 'state': 'syncing'}), \
                patch.object(ops.concurrent.futures, 'ThreadPoolExecutor') as pool:
            with self.assertRaises(ValueError):
                ops.probe('http://localhost', 'mainnet', 5, 1, 1000)
            pool.assert_not_called()


class SessionStopTests(unittest.TestCase):
    def simulate(self, foreign_container=False, foreign_unit=False, ambiguous_signal=False,
                 foreign_command=False, dropin=False, late_unit=False, late_container=False, ambiguous_update=False):
        source = Path(__file__).resolve().parents[1] / 'deploy/server'
        with tempfile.TemporaryDirectory(prefix='blaze-stop-test-') as directory:
            root = Path(directory)
            for name in ['session-stop', 'blaze-bchn@.service']:
                shutil.copyfile(source / name, root / name)
            installed = root / 'installed.service'
            installed.write_text('foreign unit' if foreign_unit else (root / 'blaze-bchn@.service').read_text())
            executable = root / 'stub'
            executable.write_text('#!' + sys.executable + '\n' + '''
import json, os, pathlib, sys
root=pathlib.Path(os.environ['TEST_BLAZE_DIR'])
name=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
with (root/'calls.jsonl').open('a') as output: output.write(json.dumps([name,*args])+'\\n')
if name=='uname': print('Linux')
elif name=='blaze':
    if not (root/'container-exited').exists() or os.environ.get('TEST_LATE_CONTAINER')=='1': print('abc123')
elif name=='docker':
    if args[0]=='update':
        if os.environ.get('TEST_AMBIGUOUS_UPDATE')=='1': sys.exit(1)
    elif args[0]=='kill':
        if os.environ.get('TEST_AMBIGUOUS')=='1': sys.exit(1)
        (root/'container-exited').touch()
    elif '.State.Running' in args[2]: print('false' if (root/'container-exited').exists() else 'true')
    else: print('foreign|mainnet|other' if os.environ.get('TEST_FOREIGN_CONTAINER')=='1' else 'blaze-server|mainnet|'+str(root/'compose.yaml'))
elif name=='systemctl':
    if args[0]=='is-active':
        if os.environ.get('TEST_LATE_UNIT')=='1' and not (root/'container-exited').exists(): sys.exit(1)
        sys.exit(1 if (root/('stopped-'+args[-1])).exists() else 0)
    elif args[0]=='stop': (root/('stopped-'+args[-1])).touch()
    elif 'FragmentPath' in args[1]: print(root/'installed.service')
    elif 'DropInPaths' in args[1]: print('/foreign/dropin.conf' if os.environ.get('TEST_DROPIN')=='1' else '')
    elif 'ExecStart' in args[1]:
        network=args[-1].split('@')[1].split('.')[0]
        command=next(line.split('=',1)[1] for line in (root/'blaze-bchn@.service').read_text().splitlines() if line.startswith('ExecStart='))
        print('{ argv[]='+('foreign-command' if os.environ.get('TEST_FOREIGN_COMMAND')=='1' else command.replace('%i',network))+' ; ignore_errors=no ; }')
    elif 'MainPID' in args[1]: print('0' if (root/('stopped-'+args[-1])).exists() else '123')
''')
            executable.chmod(0o755)
            for name in ['uname', 'blaze', 'docker', 'systemctl']:
                (root / name).symlink_to(executable)
            env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'], TEST_BLAZE_DIR=str(root),
                       TEST_FOREIGN_CONTAINER=str(int(foreign_container)), TEST_AMBIGUOUS=str(int(ambiguous_signal)),
                       TEST_FOREIGN_COMMAND=str(int(foreign_command)), TEST_DROPIN=str(int(dropin)),
                       TEST_LATE_UNIT=str(int(late_unit)), TEST_LATE_CONTAINER=str(int(late_container)),
                       TEST_AMBIGUOUS_UPDATE=str(int(ambiguous_update)))
            result = subprocess.run(['/bin/sh', str(root / 'session-stop')], env=env, text=True,
                                    capture_output=True, timeout=10)
            calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()]
            return result, calls

    def test_stop_targets_only_owned_containers_and_matching_units(self):
        result, calls = self.simulate()
        self.assertEqual(result.returncode, 0, result.stderr)
        signals = [call for call in calls if call[:2] == ['docker', 'kill']]
        self.assertEqual(signals, [['docker', 'kill', '--signal', 'SIGTERM', 'abc123']])
        update = ['docker', 'update', '--restart=no', 'abc123']
        self.assertIn(update, calls)
        self.assertLess(calls.index(update), calls.index(signals[0]))
        units = [call[-1] for call in calls if call[:2] == ['systemctl', 'stop']]
        self.assertEqual(units, ['blaze-bchn@mainnet.service', 'blaze-bchn@chipnet.service'])
        self.assertIn('host was not powered off', result.stdout)

    def test_foreign_container_or_unit_is_refused_before_any_stop(self):
        for options in [{'foreign_container': True}, {'foreign_unit': True}, {'foreign_command': True}, {'dropin': True}]:
            result, calls = self.simulate(**options)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(any(call[:2] in [['docker', 'update'], ['docker', 'kill'], ['systemctl', 'stop']] for call in calls))

    def test_ambiguous_signal_is_not_retried_or_escalated(self):
        result, calls = self.simulate(ambiguous_signal=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len([call for call in calls if call[:2] == ['docker', 'kill']]), 1)
        self.assertFalse(any(call[:2] == ['systemctl', 'stop'] for call in calls))

    def test_late_unit_is_not_stopped_without_prior_ownership_validation(self):
        result, calls = self.simulate(late_unit=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[:2] == ['systemctl', 'stop'] for call in calls))
        self.assertIn('process remains', result.stderr)

    def test_reappearing_indexer_is_reported_without_repeated_signal(self):
        result, calls = self.simulate(late_container=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len([call for call in calls if call[:2] == ['docker', 'kill']]), 1)
        self.assertIn('running again', result.stderr)

    def test_ambiguous_restart_policy_update_is_not_retried(self):
        result, calls = self.simulate(ambiguous_update=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len([call for call in calls if call[:2] == ['docker', 'update']]), 1)
        self.assertFalse(any(call[:2] in [['docker', 'kill'], ['systemctl', 'stop']] for call in calls))


if __name__ == '__main__':
    unittest.main()

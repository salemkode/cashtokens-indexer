"""Separate finite REGTEST consumer runner. CLI is execution: never called by its unit tests.
Reuses the native owner guardian, fixed storage and exact-owner stop path.
"""
import sys
sys.dont_write_bytecode=True
import argparse,hashlib,json,math,os,resource,signal,socket,subprocess,tarfile,threading,time,uuid
from pathlib import Path
import owned_node as guard
import bounded_store
from atomic_handoff import publish_handoff
from prestart_diagnostics import Diagnostic, PrestartRefused

PROFILE='bounded_consumer_regtest_v1'
ROOT=Path(__file__).resolve().parent.parent
BASE=ROOT/'.build/runtime'
WORKER=ROOT/'scripts/bounded-regtest-worker.mjs'


def validate_spec(lease,base):
    if type(lease) is not int or not 60<=lease<=1200:raise guard.GuardError('Lease must be finite60..1200 seconds including setup/stop margin')
    if Path(base).absolute()!=BASE or Path(base).resolve()!=BASE:raise guard.GuardError('Unbounded/foreign datadir root refused')


def admit(lease,base,first,second,parent,existing_node=False):
    validate_spec(lease,base)
    reasons=guard.preflight(first,second,True)
    if existing_node:reasons.append('existing_native_node')
    if parent.get('state')!='present' or parent.get('uid')!=os.getuid() or not parent.get('birth') or not parent.get('command') or not parent.get('executable'):reasons.append('missing_parent_identity')
    if reasons:raise guard.GuardError('No startup: '+','.join(reasons))


def validate_running(owner,limits,run):
    if owner.get('profile')!=PROFILE or owner.get('network')!='regtest' or not owner.get('storage') or owner.get('peer_routes'):
        raise guard.GuardError('Bounded regtest requires fixed storage and zero external peer routes')
    expiry=owner.get('lease_expires_at')
    if not isinstance(expiry,(int,float)) or not math.isfinite(expiry) or not time.time()<expiry<=time.time()+1200:
        raise guard.GuardError('Expired/unbounded lease')
    if limits['deadline']>expiry-20 or limits['free_stop_bytes']<9*guard.GIB or limits['allocated_stop_bytes']>120*2**20 or limits['rss_stop_bytes']>256*2**20:
        raise guard.GuardError('Bounded regtest stop margins exceeded')
    required={'-regtest','-connect=0','-dnsseed=0','-listen=0','-discover=0','-upnp=0','-natpmp=0','-maxconnections=0','-txindex=1','-prune=0'}
    if not required.issubset(owner['identity']['command'].split()):raise guard.GuardError('No-peer/retention flags missing')
    options=[token.lstrip('-').split('=',1)[0] for token in owner['identity']['command'].split()[1:]]
    if len(options)!=len(set(options)) or any(option in ['expire','expirerpc','chipnet','testnet','chain'] or option.startswith('upgrade') for option in options):raise guard.GuardError('Duplicate/network/expiry override refused')
    if owner['storage']['image_bytes']!=96*2**20:raise guard.GuardError('Expected owned96MiB fixed image')
    guard.validate_ledger(owner,run)


def consumer_owner(run,native):
    child=guard.load_private(Path(run)/'consumer-owner.json')
    if child.get('role')!='consumer' or child.get('profile')!=PROFILE or child.get('network')!='regtest' or child.get('parent_identity')!=native['parent_identity'] or child.get('datadir')!=native['datadir'] or child.get('storage')!=native['storage'] or str(WORKER) not in child['identity']['command'].split():
        raise guard.GuardError('Consumer identity/datadir/parent binding mismatch')
    guard.validate_ledger(child,run)
    return child


def consumer_health(run,native):
    path=Path(run)/'consumer-owner.json'
    if not path.exists():return
    child=consumer_owner(run,native)
    if not guard.identity_matches(child['identity'],guard.inspect_process(child['pid'])):raise guard.GuardError('Owned consumer exited or identity changed')
    if int(guard.command(['/bin/ps','-p',str(child['pid']),'-o','rss=']))*1024>256*2**20:raise guard.GuardError('Consumer RSS cap')


def stop_consumer(run,native,reason):
    try:child=consumer_owner(run,native)
    except (guard.GuardError,OSError,ValueError):
        result={'outcome':'ownership_refused','foreign_signal_or_cleanup':False}
        try:guard.save_new(Path(run)/'consumer-validation-refused.json',result)
        except FileExistsError:pass
        return result
    return guard.stop_owned(child,run,reason,0,5)


def request_stop(run,reason):
    try:guard.save_new(Path(run)/'stop-request.json',{'reason':reason})
    except FileExistsError:pass


def capture(process,run,name):
    def drain():
        count=0
        with open(run/name,'xb',opener=lambda name,flags:os.open(name,flags,0o600)) as file:
            while True:
                chunk=process.stdout.read(4096)
                if not chunk:break
                file.write(chunk[:max(0,4*2**20-count)]);count+=len(chunk)
                if count>=4*2**20:request_stop(run,'bounded_log_limit')
    thread=threading.Thread(target=drain,daemon=True);thread.start();return thread


def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]


def check_runtime():
    report=json.loads((ROOT/'.build/reports/clean-install.json').read_text());source=hashlib.sha256()
    for p in sorted((ROOT/'src').iterdir()):
        if p.suffix in ['.ts','.json']:source.update(p.name.encode());source.update(p.read_bytes())
    if source.hexdigest()!=report['runtime_source_sha256']:raise guard.GuardError('Source differs from intended compiled release; review before JS compile')
    artifact=Path(report['artifact'])
    if hashlib.sha256(artifact.read_bytes()).hexdigest()!=report['sha256']:raise guard.GuardError('Immutable runtime artifact changed')
    with tarfile.open(artifact,'r:gz') as archive:
        for member in archive:
            if member.isfile() and member.name.startswith('dist/src/') and not Path(member.name).name.startswith('._'):
                path=ROOT/member.name
                if not path.is_file() or path.read_bytes()!=archive.extractfile(member).read():raise guard.GuardError('Compiled API differs; no automatic rebuild')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);parser.add_argument('--node',required=True);parser.add_argument('--lease-seconds',type=int,default=600);args=parser.parse_args()
    # Diagnostic namespace is outside the native datadir; no gate/threshold/order changes.
    with Diagnostic(ROOT/'.build/diagnostics') as diagnostic:
        diagnostic.stage='specification';validate_spec(args.lease_seconds,BASE)
        diagnostic.stage='sample_first';first=guard.host_sample(BASE);diagnostic.sample(first)
        time.sleep(2)
        diagnostic.stage='sample_second';second=guard.host_sample(BASE);diagnostic.sample(second)
        diagnostic.stage='node_inventory';rows=guard.command(['/bin/ps','-axo','comm=']).splitlines()
        diagnostic.stage='parent_identity';parent=guard.inspect_process(os.getpid());diagnostic.parent_facts(parent)
        diagnostic.stage='resource_admission';admit(args.lease_seconds,BASE,first,second,parent,any(Path(x).name in ['bitcoind','bitcoin-qt'] for x in rows))
        diagnostic.stage='native_hash';binary=Path(args.binary).resolve();node=Path(args.node).resolve()
        if hashlib.sha256(binary.read_bytes()).hexdigest()!=guard.PREVIEW_HASH:raise guard.GuardError('Pinned native runtime changed')
        diagnostic.stage='node_version'
        if not subprocess.check_output([str(node),'--version'],text=True,timeout=3,stderr=subprocess.DEVNULL).strip().startswith('v24.'):raise guard.GuardError('Verified Node24 required')
        diagnostic.stage='compiled_runtime';check_runtime()
        diagnostic.stage='admitted'
    run=BASE/('bounded-regtest-'+uuid.uuid4().hex[:8]);run.mkdir(mode=0o700)
    guard.save_new(run/'resource-gate.json',{'passed':True,'normal_pressure':True,'measured_at':guard.utc(),'samples':[first,second]})
    started=time.monotonic();expiry=time.time()+args.lease_seconds
    native=None;watcher=None;consumer=None;owner=None;storage=None;heartbeat=None
    result={'network':'regtest','is_chipnet':False,'run':str(run),'expires_at_epoch':expiry,'endpoint_advertised':False,'no_restart_or_foreign_cleanup':True}
    signal.signal(signal.SIGTERM,lambda *args:request_stop(run,'operator_stop'))
    signal.signal(signal.SIGINT,lambda *args:request_stop(run,'operator_stop'))
    try:
        storage=bounded_store.create_store(run,96)
        if (run/'stop-request.json').exists():raise guard.GuardError('Operator stopped before native creation')
        data=Path(storage['mountpoint'])/'data';data.mkdir(mode=0o700);(data/'regtest').mkdir(mode=0o700);(data/'tmp').mkdir(mode=0o700)
        conf=run/'empty.conf';conf.touch(mode=0o600);rpc_port=port()
        argv=[str(binary),'-regtest',f'-datadir={data}',f'-conf={conf}','-server=1','-daemon=0','-listen=0','-connect=0','-dnsseed=0','-discover=0','-upnp=0','-natpmp=0','-maxconnections=0','-txindex=1','-prune=0','-maxmempool=5','-dbcache=64','-par=1','-persistmempool=0','-fallbackfee=0.00001','-rpcbind=127.0.0.1',f'-rpcport={rpc_port}','-debuglogfile=0','-printtoconsole=1']
        native=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env={**os.environ,'TMPDIR':str(data/'tmp')},preexec_fn=lambda:resource.setrlimit(resource.RLIMIT_CORE,(0,0)))
        threading.Thread(target=native.wait,daemon=True).start();capture(native,run,'native.log')
        owner={'schema':1,'profile':PROFILE,'lease_expires_at':expiry,'hostname':socket.gethostname(),'pid':native.pid,'uid':os.getuid(),'identity':guard.capture_child_identity(native),'parent_identity':parent,'executable':str(binary),'datadir':str(data),'cookie':str(data/'regtest/.cookie'),'rpc_port':rpc_port,'network':'regtest','storage':storage}
        guard.save_new(run/'owner.json',owner)
        limits={'deadline':expiry-30,'free_stop_bytes':9*guard.GIB,'allocated_stop_bytes':120*2**20,'rss_stop_bytes':256*2**20,'initial_swap_bytes':second['swap_bytes'],'swap_growth_stop_bytes':512*2**20,'receive_stop_bytes':1,'checkpoint_height':115252,'no_progress_seconds':600,'startup_grace_seconds':15,'poll_seconds':1,'graceful_stop_seconds':5,'term_stop_seconds':5}
        validate_running(owner,limits,run);guard.save_new(run/'limits.json',limits)
        heartbeat=open(run/'parent-heartbeat.jsonl','x',opener=lambda name,flags:os.open(name,flags,0o600))
        def pulse():
            if heartbeat.tell()>128*2**10:raise guard.GuardError('Parent heartbeat bound')
            heartbeat.write(str(time.monotonic())+'\n');heartbeat.flush();os.fsync(heartbeat.fileno())
        pulse()
        watcher=subprocess.Popen([sys.executable,'-B',str(Path(guard.__file__).resolve()),'watch','--run',str(run)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        guard.save_new(run/'supervisor.json',{'pid':watcher.pid,'identity':guard.capture_child_identity(watcher)})
        deadline=time.monotonic()+20
        while not (run/'armed.json').exists() and watcher.poll() is None and native.poll() is None and time.monotonic()<deadline:pulse();time.sleep(0.25)
        if not (run/'armed.json').exists():raise guard.GuardError('Owner guardian failed to arm; no consumer')
        fresh=guard.host_sample(run);admit(args.lease_seconds,BASE,second,fresh,parent)
        guard.save_new(run/'consumer-resource-gate.json',{'passed':True,'normal_pressure':True,'measured_at':guard.utc(),'sample':fresh})
        worker_input={'run':str(run),'data':str(data),'rpc_port':rpc_port,'cookie':owner['cookie'],'expires_at_epoch':expiry-30,'genesis':guard.REG_GENESIS,'source_commit':'3e6827e95c7a17497e09ac15556debd116dea1d0'}
        guard.save_new(run/'worker-input.json',worker_input)
        consumer=subprocess.Popen([str(node),str(WORKER),'--run',str(run),f'-datadir={data}'],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        threading.Thread(target=consumer.wait,daemon=True).start();capture(consumer,run,'consumer.log')
        child=dict(owner,role='consumer',pid=consumer.pid,identity=guard.capture_child_identity(consumer),executable=guard.inspect_process(consumer.pid)['executable'])
        publish_handoff(run,'consumer-owner.json',child)
        # Consumer does not serve until this exact-identity record exists.
        progress=guard.watchdog_progress(run);advertised=False
        while time.time()<expiry-25 and native.poll() is None and watcher.poll() is None and consumer.poll() is None:
            pulse();progress=guard.watchdog_progress(run,progress)
            if progress['stale']:raise guard.GuardError('Guardian heartbeat expired')
            if (run/'consumer-done.json').exists():break
            if not advertised and (run/'connection.json').exists():
                connection=guard.load_private(run/'connection.json')
                if connection.get('status')!='verified' or connection.get('network')!='regtest' or not connection.get('acceptance_complete'):raise guard.GuardError('Consumer contract not verified')
                print(json.dumps({'event':'bounded_regtest_ready','contract':str(run/'connection.json'),'rest_url':connection['rest_url'],'expires_at_epoch':expiry-30}),flush=True);advertised=True;result['endpoint_advertised']=True
            time.sleep(0.5)
        request_stop(run,'consumer_done_or_finite_lease')
    except (guard.GuardError,OSError,ValueError,subprocess.SubprocessError):
        result['failure']='bounded_regtest_setup_or_lifecycle_failure_no_retry';request_stop(run,'owner_setup_or_lifecycle_failure')
    finally:
        if owner is not None:
            if (watcher is None or watcher.poll() is not None or result.get('failure')):
                if (run/'consumer-owner.json').exists() and not (run/'consumer-stop-claim.json').exists():stop_consumer(run,owner,'owner_independent_backstop')
                if not (run/'stop-claim.json').exists():guard.stop_owned(owner,run,'owner_independent_backstop',5,5)
        for name,process in [('native',native),('consumer',consumer),('guardian',watcher)]:
            if process is not None:
                try:result[name+'_exit_code']=process.wait(timeout=15)
                except subprocess.TimeoutExpired:result[name+'_exit_code']=None
        if heartbeat:heartbeat.close()
        result['all_process_exits_confirmed']=all(process is None or result.get(name+'_exit_code') is not None for name,process in [('native',native),('consumer',consumer),('guardian',watcher)])
        if storage and result['all_process_exits_confirmed']:
            try:result['detach']=bounded_store.detach_store(run,storage)
            except (guard.GuardError,OSError,subprocess.SubprocessError):result['detach']={'status':'ambiguous_no_force_no_retry'}
        result['actual_storage_binding_known']=storage is not None
        result['elapsed_seconds']=time.monotonic()-started;guard.save_new(run/'lifecycle-receipt.json',result)
        print(json.dumps({'event':'bounded_regtest_stopped_or_blocked','receipt':str(run/'lifecycle-receipt.json'),'all_process_exits_confirmed':result['all_process_exits_confirmed']}),flush=True)
    return 0 if result['all_process_exits_confirmed'] else 2


if __name__=='__main__':
    try:sys.exit(main())
    except PrestartRefused as error:
        print(json.dumps({'status':'prestart_refused','stage':error.stage,'reason_codes':error.codes,'diagnostic':str(error.path),'endpoint':None}),file=sys.stderr);sys.exit(2)
    except (guard.GuardError,OSError,ValueError,subprocess.SubprocessError):print('Bounded REGTEST refused before startup; no endpoint advertised.',file=sys.stderr);sys.exit(2)

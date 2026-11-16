"""One conditional bounded Chipnet prefix measurement. Never a full-sync launcher."""
import sys
sys.dont_write_bytecode=True
import argparse,hashlib,json,os,resource,signal,socket,subprocess,threading,time,uuid
from pathlib import Path
import owned_node as guard
import bounded_store
import chipnet_resume


def request_stop(run,reason):
    try:guard.save_new(run/'stop-request.json',{'reason':reason})
    except FileExistsError:pass


def peers_from_official_seeds():
    # Source: inspected, pinned3e6827e95 chainparams CChipNetParams. No Electrum endpoint is substituted.
    result=[];errors=[]
    def resolve():
        try:
            for seed in ['chipnet.bitjson.com','seed.cbch.loping.net']:
                for value in socket.getaddrinfo(seed,48333,socket.AF_INET,socket.SOCK_STREAM):
                    ip=value[4][0]
                    if not any(x['ip']==ip for x in result):result.append({'ip':ip,'port':48333,'seed':seed})
                    if len(result)==2:return
        except OSError as error:errors.append(type(error).__name__)
    worker=threading.Thread(target=resolve,daemon=True);worker.start();worker.join(timeout=5)
    if worker.is_alive() or not result:raise guard.GuardError('Bounded official seed resolution unavailable; no retry')
    return result[:2]


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);parser.add_argument('--resume-from');args=parser.parse_args()
    binary=Path(args.binary).resolve();base=Path('.build/runtime').resolve()
    if hashlib.sha256(binary.read_bytes()).hexdigest()!=guard.PREVIEW_HASH:raise guard.GuardError('Accepted preview runtime changed')
    expected=json.loads(Path('docs/chipnet-hosting-feasibility.json').read_text())['owner']['host']
    if socket.gethostname()!=expected:raise guard.GuardError('Host assignment changed')
    if args.resume_from and Path(args.resume_from).absolute()!=base/'chipnet-stage1-1649e90f':
        raise guard.GuardError('Resume origin outside the explicitly reviewed stage')
    plan=chipnet_resume.resume_plan(args.resume_from) if args.resume_from else None
    samples=[];quiet_started=time.monotonic()
    while True:
        samples.append(guard.host_sample(base))
        if time.monotonic()-quiet_started>=60:break
        time.sleep(min(2,max(0,60-(time.monotonic()-quiet_started))))
    first=samples[0];second=samples[-1]
    reasons=chipnet_resume.quiet_reasons(samples,time.monotonic()-quiet_started)
    processes=guard.command(['/bin/ps','-axo','pid=,comm=']).splitlines()
    if any(Path(row.split(None,1)[-1]).name in ['bitcoind','bitcoin-qt'] for row in processes):reasons.append('existing_native_node_process')
    attempt=base/('chipnet-stage2-authorization-20261115.json' if plan else 'chipnet-stage1-authorization-20261115.json')
    if attempt.exists():reasons.append('single_attempt_already_claimed_no_resume')
    preflight={'quiet_samples':samples,'quiet_elapsed_seconds':time.monotonic()-quiet_started,'at':guard.utc(),'hostname':socket.gethostname(),'first':first,'second':second,'reasons':reasons,'strict_controls':'Fixed1536 MiB image + at-most1792 MiB gated remote application bytes + bounded outer logs/counters; native stopatheight115252','stage1_started':False}
    path=base/('chipnet-preflight-'+uuid.uuid4().hex[:8]+'.json');guard.save_new(path,preflight)
    if reasons:
        print(json.dumps({'status':'blocked_before_stage1','report':str(path),'reasons':reasons,'free_gib':second['free_bytes']/guard.GIB,'pressure':second['pressure'],'no_peer_or_chain_download':True},indent=2));return 3
    # This exclusive durable claim makes the authorization one-use, including failed setup. No automatic retry.
    guard.save_new(attempt,{'at':guard.utc(),'hostname':socket.gethostname(),'preflight':str(path),'scope':'ONE prefix measurement only, never automatic extension'})
    run=base/(('chipnet-resume-' if plan else 'chipnet-stage1-')+uuid.uuid4().hex[:8]);run.mkdir(mode=0o700)
    store=None;child=None;watcher=None;ledger=None;reaper=None;logger=None
    started=time.monotonic();result={'scope':'Chipnet prefix measurement only','run':str(run),'status':'setting_up','peer_activation_attempts':[],'full_sync_authorized':False,'automatic_resume':False,'rest_endpoint_advertised':False}
    try:
        store=chipnet_resume.attach_preserved(run,plan) if plan else bounded_store.create_store(run,1536)
        routes=peers_from_official_seeds()
        data=Path(store['mountpoint'])/'data';
        if not plan:
            data.mkdir(mode=0o700);(data/'chipnet').mkdir(mode=0o700);(data/'tmp').mkdir(mode=0o700)
        else:
            guard.private_directory(data);guard.private_directory(data/'chipnet');guard.private_directory(data/'tmp')
        conf=run/'empty.conf';conf.write_text('');os.chmod(conf,0o600)
        reserve=socket.socket();reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1];reserve.close()
        argv=[str(binary),'-chipnet',f'-datadir={data}',f'-conf={conf}','-server=1','-daemon=0','-listen=0','-connect=0','-dnsseed=0','-discover=0','-upnp=0','-natpmp=0','-disablewallet=1','-prune=0','-txindex=1','-stopatheight=115252','-maxconnections=2','-dbcache=128','-par=1','-maxmempool=20','-persistmempool=0','-maxreceivebuffer=64','-maxsendbuffer=64','-maxuploadtarget=64','-rpcthreads=2','-rpcworkqueue=16','-rpcbind=127.0.0.1',f'-rpcport={port}','-debuglogfile=0','-printtoconsole=1']
        child=subprocess.Popen(argv,cwd=run,env={**os.environ,'TMPDIR':str(data/'tmp')},stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,preexec_fn=lambda:resource.setrlimit(resource.RLIMIT_CORE,(0,0)))
        reaper=threading.Thread(target=child.wait,daemon=True);reaper.start()
        def capture():
            size=0
            with open(run/'node.log','xb',opener=lambda name,flags:os.open(name,flags,0o600)) as file:
                while True:
                    chunk=child.stdout.read(4096)
                    if not chunk:break
                    file.write(chunk[:max(0,8*2**20-size)]);size+=len(chunk)
                    if size>=8*2**20:
                        try:guard.save_new(run/'log-limit.json',{'at':guard.utc()})
                        except FileExistsError:pass
        logger=threading.Thread(target=capture,daemon=True);logger.start()
        guard.save_new(run/'spawn.json',{'pid':child.pid,'argv':argv,'at':guard.utc()})
        identity=guard.capture_child_identity(child)
        ledger={'schema':1,'hostname':socket.gethostname(),'pid':child.pid,'uid':os.getuid(),'identity':identity,'parent_identity':guard.inspect_process(os.getpid()),'executable':str(binary),'datadir':str(data),'cookie':str(data/'chipnet/.cookie'),'rpc_port':port,'network':'chipnet','storage':store,'peer_routes':routes}
        if plan:
            ledger.update(control_run=str(run),prior_received_bytes=plan['prior_received_bytes'],prior_uploaded_bytes=plan['prior_uploaded_bytes'])
            result['resume_plan']=plan
        guard.save_new(run/'owner.json',ledger)
        limits={'deadline':time.time()+max(0,1740-(plan['prior_elapsed_seconds'] if plan else 0)-(time.monotonic()-started)),'free_stop_bytes':9*guard.GIB,'allocated_stop_bytes':1792*2**20,'rss_stop_bytes':2*guard.GIB,'initial_swap_bytes':second['swap_bytes'],'swap_growth_stop_bytes':512*2**20,'receive_stop_bytes':1792*2**20,'checkpoint_height':115252,'no_progress_seconds':600,'startup_grace_seconds':15,'poll_seconds':1,'graceful_stop_seconds':10,'term_stop_seconds':10}
        guard.save_new(run/'limits.json',limits)
        watcher=subprocess.Popen([sys.executable,'-B',str(Path(guard.__file__).resolve()),'watch','--run',str(run)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        guard.save_new(run/'supervisor.json',{'pid':watcher.pid,'identity':guard.capture_child_identity(watcher)})
        # No native automatic peers or DNS are enabled. Gate ports appear only after owned native identity checks.
        until=time.monotonic()+20
        while not (run/'armed.json').exists() and child.poll() is None and watcher.poll() is None and time.monotonic()<until:time.sleep(0.05)
        if not (run/'armed.json').exists():raise guard.GuardError('Guardian did not arm; no peer activation')
        fresh=guard.host_sample(run)
        if fresh['pressure']!=1 or fresh['heavy_builds'] or fresh['swap_bytes']>second['swap_bytes'] or fresh['free_bytes']<(12 if plan else 9)*guard.GIB:
            raise guard.GuardError('Resource gate changed before peer activation')
        gates=guard.load_private(run/'peer-gate.json')
        for gate_port in gates['ports']:
            target=f'127.0.0.1:{gate_port}';result['peer_activation_attempts'].append({'target':target,'at':guard.utc(),'once':True})
            guard.rpc(ledger,'addnode',[target,'onetry'])
        result['status']='measuring';result['native_identity']=guard.load_private(run/'armed.json')
        print(json.dumps({'status':'stage1_measuring','run':str(run),'pid':child.pid,'watchdog_pid':watcher.pid,'network':'chipnet','max_height':115252}),flush=True)
        signal.signal(signal.SIGINT,lambda *args:request_stop(run,'operator_interrupt'));signal.signal(signal.SIGTERM,lambda *args:request_stop(run,'operator_interrupt'))
        last_report=0;heartbeat=guard.watchdog_progress(run)
        while child.poll() is None and watcher.poll() is None and time.monotonic()-started<1790:
            heartbeat=guard.watchdog_progress(run,heartbeat)
            if heartbeat['stale']:
                result['parent_independent_stop_reason']='watchdog_heartbeat_stale'
                request_stop(run,'watchdog_heartbeat_stale')
                if not (run/'stop-claim.json').exists():guard.stop_owned(ledger,run,'parent_watchdog_heartbeat_backstop',10,10)
                break
            if time.monotonic()-last_report>=30:
                print(json.dumps({'status':'stage1_in_progress','run':str(run),'elapsed_seconds':round(time.monotonic()-started),'allocated_bytes':guard.owned_allocation(run,ledger)}),flush=True);last_report=time.monotonic()
            time.sleep(0.25)
        if child.poll() is None:request_stop(run,'parent_lifecycle_or_deadline')
    except (guard.GuardError,OSError,ValueError,subprocess.SubprocessError) as error:
        result['status']='stopped_during_setup_or_measurement';result['failure_type']=type(error).__name__;result['failure_detail']=str(error)[:200] if isinstance(error,guard.GuardError) else 'system operation failed; retained for review'
        if child is not None:request_stop(run,'setup_or_activation_failure_no_retry')
    finally:
        if child is not None:
            if watcher is None or watcher.poll() is not None:
                if child.poll() is None and not (run/'stop-claim.json').exists() and ledger is not None:guard.stop_owned(ledger,run,'parent_backstop_no_watchdog',5,5)
            try:result['node_exit_code']=child.wait(timeout=25)
            except subprocess.TimeoutExpired:result['node_exit_code']=None
        if watcher is not None:
            try:result['watchdog_exit_code']=watcher.wait(timeout=10)
            except subprocess.TimeoutExpired:result['watchdog_exit_code']=None
        if logger is not None:logger.join(timeout=1)
        result['elapsed_seconds']=time.monotonic()-started;result['at']=guard.utc();result['no_forced_kill_or_restart']=True
        result['guard_report']=json.loads((run/'guard-report.json').read_text()) if (run/'guard-report.json').exists() else None
        result['peer_gate_receipt']=json.loads((run/'peer-gate-receipt.json').read_text()) if (run/'peer-gate-receipt.json').exists() else None
        result['cumulative_received_application_bytes']=(plan['prior_received_bytes'] if plan else 0)+(result['peer_gate_receipt'] or {}).get('received_application_bytes',0)
        result['cumulative_uploaded_application_bytes']=(plan['prior_uploaded_bytes'] if plan else 0)+(result['peer_gate_receipt'] or {}).get('uploaded_application_bytes',0)
        result['cumulative_elapsed_seconds']=(plan['prior_elapsed_seconds'] if plan else 0)+result['elapsed_seconds']
        result['process_exit_confirmed']=(child is None or result.get('node_exit_code') is not None) and (watcher is None or result.get('watchdog_exit_code') is not None)
        result['status']='stopped' if result['process_exit_confirmed'] else 'ambiguous_no_resume'
        result['stop_reason']=(result['guard_report'] or {}).get('reason',result.get('failure_type','native_exit'))
        result['checkpoint_tip_log_match']=False
        if (run/'node.log').exists():
            result['checkpoint_tip_log_match']=f'new best={guard.CHECKPOINT} height=115252' in (run/'node.log').read_text(errors='replace')
        result['allocated_outer_bytes']=guard.owned_allocation(run,ledger) if ledger and store and os.path.ismount(store['mountpoint']) else guard.allocated_bytes(run)
        if store and result['process_exit_confirmed']:
            try:result['detach']=bounded_store.detach_store(run,store)
            except (guard.GuardError,OSError,subprocess.SubprocessError):result['detach']={'outcome':'ambiguous_no_force_or_retry'}
        guard.save_new(run/'measurement-receipt.json',result)
        print(json.dumps({'status':'stage1_finished_or_blocked','run':str(run),'receipt':str(run/'measurement-receipt.json'),'process_exit_confirmed':result['process_exit_confirmed'],'node_exit_code':result.get('node_exit_code'),'checkpoint_tip_log_match':result['checkpoint_tip_log_match'],'no_full_sync_or_endpoint':True}),flush=True)
    return 0 if result['process_exit_confirmed'] else 2


if __name__=='__main__':
    try:sys.exit(main())
    except (guard.GuardError,OSError,ValueError) as error:print(json.dumps({'status':'refused_before_start','error_type':type(error).__name__}),file=sys.stderr);sys.exit(2)

"""Retained, no-peer regtest integration of the independent owner watchdog."""
import sys
sys.dont_write_bytecode=True
import argparse,hashlib,json,os,socket,subprocess,threading,time,uuid,resource
from pathlib import Path
import owned_node as guard
import bounded_store


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);parser.add_argument('--fixed-store',action='store_true');args=parser.parse_args()
    binary=Path(args.binary).resolve()
    if hashlib.sha256(binary.read_bytes()).hexdigest()!=guard.PREVIEW_HASH:raise guard.GuardError('Runtime digest does not match accepted preview')
    fs=os.statvfs(binary.parent)
    if fs.f_bavail*fs.f_frsize<10*guard.GIB+256*2**20:raise guard.GuardError('Offline smoke reserve floor')
    run=Path('.build/runtime').resolve()/('supervised-regtest-'+uuid.uuid4().hex[:8]);run.mkdir(mode=0o700)
    storage=None;child=None;watcher=None;ledger=None;logger=None
    started=time.monotonic();report={'at':guard.utc(),'scope':'Actual accepted preview, independent-watchdog no-peer regtest integration only','run':str(run),'preserved':True,'p2p_traffic_authorized_or_enabled':False,'rpc_port_advertised_to_consumers':False}
    try:
        # 32 MiB is below BCHN's unchanged low-disk floor. This remains below the 256 MiB smoke budget.
        storage=bounded_store.create_store(run,96) if args.fixed_store else None
        data=(Path(storage['mountpoint']) if storage else run)/'data';data.mkdir(mode=0o700);(data/'regtest').mkdir(mode=0o700)
        conf=run/'empty.conf';conf.write_text('');os.chmod(conf,0o600)
        sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
        argv=[str(binary),'-regtest',f'-datadir={data}',f'-conf={conf}','-server=1','-daemon=0','-listen=0','-connect=0','-dnsseed=0','-discover=0','-upnp=0','-natpmp=0','-disablewallet=1','-txindex=1','-maxmempool=5','-dbcache=64','-par=1','-persistmempool=0','-rpcbind=127.0.0.1',f'-rpcport={port}','-debuglogfile=0','-printtoconsole=1']
        child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,preexec_fn=lambda:resource.setrlimit(resource.RLIMIT_CORE,(0,0)))
        threading.Thread(target=child.wait,daemon=True).start()
        guard.save_new(run/'spawn.json',{'pid':child.pid,'argv':argv,'at':guard.utc()})
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
        identity=guard.capture_child_identity(child)
        ledger={'schema':1,'hostname':socket.gethostname(),'pid':child.pid,'uid':os.getuid(),'identity':identity,'parent_identity':guard.inspect_process(os.getpid()),'executable':str(binary),'datadir':str(data),'cookie':str(data/'regtest/.cookie'),'rpc_port':port,'network':'regtest'}
        if storage:ledger['storage']=storage
        guard.save_new(run/'owner.json',ledger)
        limits={'deadline':time.time()+20,'free_stop_bytes':10*guard.GIB,'allocated_stop_bytes':192*2**20,'rss_stop_bytes':256*2**20,'initial_swap_bytes':guard.host_sample(run)['swap_bytes'],'swap_growth_stop_bytes':512*2**20,'receive_stop_bytes':1,'checkpoint_height':115252,'no_progress_seconds':15,'startup_grace_seconds':3,'poll_seconds':0.5,'graceful_stop_seconds':2,'term_stop_seconds':3}
        guard.save_new(run/'limits.json',limits)
        watcher=subprocess.Popen([sys.executable,'-B',str(Path(guard.__file__).resolve()),'watch','--run',str(run)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        guard.save_new(run/'supervisor.json',{'pid':watcher.pid,'identity':guard.capture_child_identity(watcher),'independent_process':True})
        requested=False
        while watcher.poll() is None and time.monotonic()-started<35:
            if (run/'armed.json').exists() and not requested:
                guard.save_new(run/'stop-request.json',{'reason':'owned_offline_smoke_complete'});requested=True
            time.sleep(0.05)
    except (guard.GuardError,OSError,ValueError,subprocess.SubprocessError) as error:
        report['setup_failure']=str(error)[:150] if isinstance(error,guard.GuardError) else type(error).__name__
    finally:
        if child is not None:
            if child.poll() is None and ledger is not None and not (run/'stop-claim.json').exists():guard.stop_owned(ledger,run,'parent_independent_backstop',1,3)
            try:report['child_exit_code']=child.wait(timeout=4)
            except subprocess.TimeoutExpired:report['child_exit_code']=None
        if watcher is not None:
            try:report['watchdog_exit_code']=watcher.wait(timeout=4)
            except subprocess.TimeoutExpired:report['watchdog_exit_code']=None
        if logger is not None:logger.join(timeout=1)
        report['pid']=child.pid if child else None;report['watchdog_pid']=watcher.pid if watcher else None
        report['elapsed_seconds']=time.monotonic()-started;report['separate_processes']=watcher is not None and watcher.pid!=os.getpid()
        report['stop_receipt']=json.loads((run/'stop-receipt.json').read_text()) if (run/'stop-receipt.json').exists() else None
        report['armed']=json.loads((run/'armed.json').read_text()) if (run/'armed.json').exists() else None
        report['clean_exit_verified']=report.get('child_exit_code')==0 and report.get('watchdog_exit_code')==0
        report['process_exit_confirmed']=(child is None or report.get('child_exit_code') is not None) and (watcher is None or report.get('watchdog_exit_code') is not None)
        report['allocated_bytes']=guard.owned_allocation(run,ledger or {'storage':storage}) if storage else guard.allocated_bytes(run)
        if storage and report['process_exit_confirmed']:
            report['fixed_store']=storage;report['detach_receipt']=bounded_store.detach_store(run,storage)
        guard.save_new(run/'integration-receipt.json',report)
        print(json.dumps({key:report.get(key) for key in ['scope','run','pid','watchdog_pid','child_exit_code','watchdog_exit_code','elapsed_seconds','allocated_bytes','clean_exit_verified','armed','setup_failure']},indent=2))
    return 0 if report['clean_exit_verified'] and report['armed'] else 2


if __name__=='__main__':sys.exit(main())

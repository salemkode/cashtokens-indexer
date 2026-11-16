"""Validated continuation of the one retained stage image; no copies or implicit retries."""
import os,plistlib,subprocess
from pathlib import Path
import owned_node as guard


def resume_plan(origin):
    origin=guard.private_directory(origin)
    receipt=guard.load_private(origin/'measurement-receipt.json')
    detach=guard.load_private(origin/'detach-receipt.json')
    store=guard.load_private(origin/'fixed-store.json')
    image=Path(store['image']);mount=Path(store['mountpoint'])
    if not image.exists():
        raise guard.GuardError('Encoded image absent or cold-archived; explicit byte-verified restoration and inode reconciliation required before resume (docs/cold-image-custody.md)')
    if (origin/'restoration-claim.json').exists() or (origin/'restoration-receipt.json').exists():
        from cold_restore import verify_restored
        store=verify_restored(origin,store)
    stat=image.lstat()
    if (not receipt.get('process_exit_confirmed') or receipt.get('node_exit_code')!=0 or
        receipt.get('watchdog_exit_code')!=0 or detach.get('exit_code')!=0 or not detach.get('unmounted')):
        raise guard.GuardError('Previous native/watchdog shutdown or detach is not confirmed clean')
    if (image.parent!=origin or mount.parent!=origin or image.is_symlink() or mount.is_symlink() or
        os.path.ismount(mount) or stat.st_uid!=os.getuid() or stat.st_mode&0o077 or
        stat.st_ino!=store['image_inode'] or stat.st_size!=store['image_bytes'] or stat.st_size>1536*2**20):
        raise guard.GuardError('Preserved image identity/private ownership/detached state changed')
    gate=receipt.get('peer_gate_receipt') or {}
    received=gate.get('received_application_bytes');uploaded=gate.get('uploaded_application_bytes')
    elapsed=receipt.get('elapsed_seconds')
    if any(type(x) is not int or x<0 for x in [received,uploaded]) or not isinstance(elapsed,(int,float)) or not 0<=elapsed<1740:
        raise guard.GuardError('Prior cumulative counters unavailable or invalid')
    if received>=1792*2**20 or uploaded>=64*2**20:
        raise guard.GuardError('Prior receive/upload budget exhausted')
    allocated=guard.allocated_bytes(origin,excluded=mount)+guard.cold_allocation(store)
    if allocated>=1792*2**20:raise guard.GuardError('Cumulative retained allocation lacks stop headroom')
    return {'origin_run':str(origin),'store':store,'prior_allocated_bytes':allocated,'prior_received_bytes':received,
            'prior_uploaded_bytes':uploaded,'prior_elapsed_seconds':elapsed,
            'remaining_receive_bytes':1792*2**20-received,'remaining_upload_bytes':64*2**20-uploaded}


def attach_preserved(run, plan):
    run=guard.private_directory(run)
    checked=resume_plan(plan['origin_run'])
    if checked!=plan:raise guard.GuardError('Resume provenance/counters changed after preflight')
    store=plan['store'];image=Path(store['image']);mount=Path(store['mountpoint'])
    if run.parent!=image.parent.parent:raise guard.GuardError('Resume control directory outside owned runtime root')
    info=plistlib.loads(subprocess.check_output(['/usr/bin/hdiutil','info','-plist'],timeout=10))
    if any(x.get('image-path')==str(image) for x in info['images']):raise guard.GuardError('Preserved image is already attached')
    result=subprocess.run(['/usr/bin/hdiutil','attach','-nobrowse','-noautoopen','-owners','on','-mountpoint',str(mount),'-plist',str(image)],capture_output=True,timeout=30)
    if result.returncode:raise guard.GuardError('Owned resume attach failed; no retry/force')
    found=next((x for x in plistlib.loads(result.stdout)['system-entities'] if x.get('mount-point')==str(mount)),None)
    if not found:raise guard.GuardError('Resume mount cannot be identified; reconcile without retry')
    updated=dict(store,origin_run=str(image.parent),device=found['dev-entry'],mount_device=mount.stat().st_dev)
    guard.save_new(run/'resume-provenance.json',plan)
    guard.save_new(run/'fixed-store.json',updated)
    from bounded_store import image_binding
    image_binding(run,updated)
    return updated


def quiet_reasons(samples, elapsed):
    if not samples or elapsed<60:return ['quiet_window_shorter_than_60_seconds']
    reasons=set()
    for i,sample in enumerate(samples):
        reasons.update(guard.preflight(samples[max(0,i-1)],sample,strict_control=True))
    return sorted(reasons)

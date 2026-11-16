"""Fixed-capacity owned filesystem images; no resize, overwrite, forced detach or deletion."""
from pathlib import Path
import json,os,plistlib,subprocess
import owned_node as guard


def image_binding(run, store):
    run=guard.private_directory(run); image=Path(store['image']); mount=Path(store['mountpoint'])
    owner=guard.private_directory(store['origin_run']) if store.get('origin_run') else run
    if owner!=run:
        provenance=guard.load_private(run/'resume-provenance.json')
        original=provenance['store']
        if run.parent!=owner.parent or provenance['origin_run']!=str(owner) or any(store[key]!=original[key] for key in ['image','mountpoint','image_inode','image_bytes']):
            raise guard.GuardError('Resume storage provenance mismatch')
    if image.parent!=owner or mount.parent!=owner or image.is_symlink() or mount.is_symlink():
        raise guard.GuardError('Storage path/ownership mismatch')
    stat=image.lstat()
    if stat.st_uid!=os.getuid() or stat.st_mode&0o077 or stat.st_ino!=store['image_inode'] or stat.st_size!=store['image_bytes']:
        raise guard.GuardError('Fixed image identity/size changed')
    if mount.stat().st_dev!=store['mount_device'] or not os.path.ismount(mount):
        raise guard.GuardError('Owned mount disappeared or changed')
    fs=os.statvfs(mount)
    if fs.f_blocks*fs.f_frsize>store['image_bytes'] or store['image_bytes']>1792*2**20:
        raise guard.GuardError('Filesystem capacity exceeds owned fixed image')
    return True


def create_store(run, mebibytes):
    run=guard.private_directory(run)
    if not 32<=mebibytes<=1792:raise guard.GuardError('Fixed store capacity outside authorization')
    if os.statvfs(run).f_bavail*os.statvfs(run).f_frsize < 10*guard.GIB+mebibytes*2**20:
        raise guard.GuardError('Fixed store reserve unavailable')
    image=run/'bounded.dmg'; mount=run/'mount'
    if image.exists() or mount.exists():raise guard.GuardError('Store destination already exists; no retry/overwrite')
    mount.mkdir(mode=0o700)
    result=subprocess.run(['/usr/bin/hdiutil','create','-size',f'{mebibytes}m','-fs','Journaled HFS+','-volname','BlazeOwnedBounded','-type','UDIF','-nospotlight',str(image)],capture_output=True,timeout=40)
    if result.returncode:raise guard.GuardError('Owned image creation failed; preserve partial files')
    os.chmod(image,0o600)
    attached=subprocess.run(['/usr/bin/hdiutil','attach','-nobrowse','-noautoopen','-owners','on','-mountpoint',str(mount),'-plist',str(image)],capture_output=True,timeout=30)
    if attached.returncode:raise guard.GuardError('Owned image attachment failed; no retry/force')
    entities=plistlib.loads(attached.stdout)['system-entities']
    found=next((x for x in entities if x.get('mount-point')==str(mount)),None)
    if not found:raise guard.GuardError('Cannot identify exact owned mount; manual reconciliation required')
    os.chmod(mount,0o700)
    store={'image':str(image),'mountpoint':str(mount),'device':found['dev-entry'],'image_inode':image.stat().st_ino,'image_bytes':image.stat().st_size,'mount_device':mount.stat().st_dev,'capacity_bytes':os.statvfs(mount).f_blocks*os.statvfs(mount).f_frsize,'created_at':guard.utc()}
    image_binding(run,store);guard.save_new(run/'fixed-store.json',store);return store


def detach_store(run, store):
    image_binding(run,store)
    # Confirm hdiutil's current association; never detach a device from a stale name alone.
    info=plistlib.loads(subprocess.check_output(['/usr/bin/hdiutil','info','-plist'],timeout=10))
    associations=[x for x in info['images'] if x.get('image-path')==store['image']]
    if len(associations)!=1 or not any(e.get('dev-entry')==store['device'] and e.get('mount-point')==store['mountpoint'] for e in associations[0]['system-entities']):
        raise guard.GuardError('Device/image association changed; no detach')
    result=subprocess.run(['/usr/bin/hdiutil','detach',store['device']],capture_output=True,text=True,timeout=20)
    receipt={'at':guard.utc(),'device':store['device'],'exit_code':result.returncode,'force':False,'image_preserved':True,'unmounted':not os.path.ismount(store['mountpoint'])}
    guard.save_new(Path(run)/'detach-receipt.json',receipt)
    if result.returncode or not receipt['unmounted']:raise guard.GuardError('Owned detach ambiguous; no retry/force')
    return receipt

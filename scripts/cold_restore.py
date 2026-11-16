"""Explicit byte-verified cold restoration. Never edits historical ledgers or starts a node."""
import datetime,gzip,hashlib,json,os,stat,uuid
from pathlib import Path
import owned_node as guard
import cold_archive as cold

FLOOR=12*guard.GIB
HEADROOM=64*2**20


def private_file(path):
    path=Path(path).absolute();guard.private_directory(path.parent)
    try:value=path.lstat()
    except FileNotFoundError as error:raise guard.GuardError('Required custody/restoration file missing') from error
    if path.is_symlink() or not stat.S_ISREG(value.st_mode) or value.st_uid!=os.getuid() or value.st_mode&0o077 or value.st_nlink!=1:
        raise guard.GuardError('Custody/restoration file ownership, symlink or link count refused')
    return path


def sync_parent(path):
    fd=os.open(Path(path).parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def append_atomic(path,record):
    """Publish a complete fsynced new receipt without replacing any name."""
    path=Path(path);pending=path.with_name(path.name+'.pending-'+uuid.uuid4().hex[:8])
    guard.save_new(pending,record)
    # Hard-link publication is atomic and fails if the destination already exists.
    os.link(pending,path,follow_symlinks=False);sync_parent(path)
    os.unlink(pending);sync_parent(path)


def custody_chain(path):
    path=private_file(path);record=guard.load_private(path)
    archive=private_file(record['archive'])
    if archive.parent!=path.parent or archive.with_suffix('.custody.json')!=path:
        raise guard.GuardError('Archive/custody path binding mismatch')
    original=record['original'];target=Path(original['path']);owner=guard.private_directory(target.parent)
    if target.name!='bounded.dmg' or target.parent!=owner:raise guard.GuardError('Original image path mismatch')
    removal_path=archive.with_suffix('.removal.json');removal=guard.load_private(private_file(removal_path))
    if removal.get('verified_custody')!=str(path) or removal.get('original_path')!=str(target) or not removal.get('removed_only_original_encoded_image') or not removal.get('original_parent_fsynced'):
        raise guard.GuardError('Verified removal/custody chain mismatch')
    if not record.get('complete_decompression_verified') or not record.get('archive_fsynced') or record['decoded_sha256']!=record['original_sha256'] or record['decoded_length']!=record['original_length'] or record['original_length']!=original['identity']['st_size']:
        raise guard.GuardError('Custody full-byte proof mismatch')
    if type(record['original_length']) is not int or not 1<=record['original_length']<=1536*2**20:
        raise guard.GuardError('Restoration length outside reviewed image bound')
    if archive.stat().st_size!=record['archive_bytes'] or cold.file_hash(archive)!=record['archive_sha256']:
        raise guard.GuardError('Archive SHA/length mismatch')
    for name,digest in original['receipt_sha256'].items():
        if Path(name).name!=name or cold.file_hash(private_file(owner/name))!=digest:raise guard.GuardError('Historical receipt changed')
    store=guard.load_private(owner/'fixed-store.json')
    if store['image']!=str(target) or store['image_inode']!=original['identity']['st_ino'] or store['image_bytes']!=record['original_length']:
        raise guard.GuardError('Historical fixed-store identity does not match custody')
    mount=Path(store['mountpoint'])
    if mount.parent!=owner or mount.is_symlink() or os.path.ismount(mount):raise guard.GuardError('Original mount is not inactive owned path')
    config={}
    conf=owner/'empty.conf'
    if conf.exists():
        private_file(conf)
        if conf.stat().st_size!=0:raise guard.GuardError('Original diagnostic config is no longer empty')
        config[str(conf)]=cold.file_hash(conf)
    return {'custody':str(path),'custody_sha256':cold.file_hash(path),'removal_sha256':cold.file_hash(removal_path),
            'archive':str(archive),'archive_sha256':record['archive_sha256'],'target':str(target),
            'old_identity':original['identity'],'length':record['original_length'],'sha256':record['original_sha256'],
            'historical_receipt_sha256':original['receipt_sha256'],'config_sha256':config}


def admit_quiet(report_path,required_bytes):
    report=guard.load_private(private_file(report_path));samples=report.get('samples',[])
    if report.get('reasons')!=[] or report.get('elapsed_seconds',0)<60 or len(samples)<31:
        raise guard.GuardError('Restoration requires a complete passed sustained quiet report')
    times=[datetime.datetime.fromisoformat(s['at']).timestamp() for s in samples]
    now=datetime.datetime.now(datetime.timezone.utc).timestamp()
    if times[-1]-times[0]<60 or not 0<=now-times[-1]<=10 or any(b<=a or b-a>3 for a,b in zip(times,times[1:])):
        raise guard.GuardError('Quiet report stale, interrupted or not sustained')
    for i,sample in enumerate(samples):
        if guard.preflight(samples[max(0,i-1)],sample,True):raise guard.GuardError('Quiet report resources failed')
    current=guard.host_sample(Path(report_path).parent)
    if guard.preflight(samples[-1],current,True) or current['free_bytes']<FLOOR+required_bytes+HEADROOM:
        raise guard.GuardError('Need decoded-image space plus >=12GiB postrestore reserve and normal quiet resources')
    return current['swap_bytes']


def restore_image(custody_path,quiet_report):
    proof=custody_chain(custody_path);target=Path(proof['target']);owner=guard.private_directory(target.parent)
    if os.path.lexists(target) or (owner/'restoration-claim.json').exists() or (owner/'restoration-receipt.json').exists():
        raise guard.GuardError('Destination or prior restoration claim exists; no overwrite or retry')
    baseline_swap=admit_quiet(quiet_report,proof['length'])
    cold.idle(target)
    # Durable claim before destination creation: interrupted output can never receive old-inode admission.
    append_atomic(owner/'restoration-claim.json',{'schema':1,'at':guard.utc(),'proof':proof,'quiet_report':str(quiet_report),'quiet_sha256':cold.file_hash(quiet_report)})
    identity=None;count=0;digest=hashlib.sha256()
    with open(target,'xb',opener=lambda name,flags:os.open(name,flags|os.O_NOFOLLOW,0o600)) as output:
        identity=cold.fingerprint(os.fstat(output.fileno()))
        with gzip.open(proof['archive'],'rb') as archive:
            while True:
                chunk=archive.read(cold.CHUNK)
                if not chunk:break
                if count+len(chunk)>proof['length']:raise guard.GuardError('Decoded image exceeds recorded length')
                sample=guard.host_sample(owner)
                if sample['pressure']!=1 or sample['heavy_builds'] or sample['swap_bytes']>baseline_swap or sample['free_bytes']<FLOOR+(proof['length']-count)+HEADROOM:
                    raise guard.GuardError('Restoration resource gate changed; preserve incomplete output, no retry')
                output.write(chunk);digest.update(chunk);count+=len(chunk)
        output.flush();os.fsync(output.fileno())
    sync_parent(target)
    if count!=proof['length'] or digest.hexdigest()!=proof['sha256'] or cold.file_hash(private_file(target))!=proof['sha256']:
        raise guard.GuardError('Restored full SHA/length mismatch; no admission')
    if custody_chain(custody_path)!=proof:raise guard.GuardError('Custody/config chain changed during restoration')
    value=target.lstat()
    if value.st_ino!=identity['st_ino'] or value.st_dev!=identity['st_dev'] or value.st_size!=count:
        raise guard.GuardError('Restored destination identity changed')
    record={'schema':1,'at':guard.utc(),'proof':proof,'restoration_claim_sha256':cold.file_hash(owner/'restoration-claim.json'),
            'new_identity':cold.fingerprint(value),'decoded_sha256':digest.hexdigest(),'decoded_length':count,
            'restored_file_and_parent_fsynced':True,'archive_retained':True,'automatic_mount_or_node':False}
    append_atomic(owner/'restoration-receipt.json',record)
    return record


def verify_restored(owner,store):
    owner=guard.private_directory(owner)
    claim=guard.load_private(private_file(owner/'restoration-claim.json'))
    receipt=guard.load_private(private_file(owner/'restoration-receipt.json'))
    proof=custody_chain(receipt['proof']['custody'])
    target=private_file(store['image']);value=target.lstat()
    if (receipt.get('schema')!=1 or claim.get('proof')!=proof or receipt.get('proof')!=proof or
        receipt.get('restoration_claim_sha256')!=cold.file_hash(owner/'restoration-claim.json') or
        target.parent!=owner or proof['target']!=str(target) or
        receipt.get('new_identity')!=cold.fingerprint(value) or receipt.get('decoded_sha256')!=proof['sha256'] or
        receipt.get('decoded_length')!=proof['length'] or not receipt.get('restored_file_and_parent_fsynced') or
        value.st_size!=store['image_bytes'] or cold.file_hash(target)!=proof['sha256']):
        raise guard.GuardError('Restored inode admission requires exact verified bytes and immutable custody/config chain')
    archive=Path(proof['archive'])
    return dict(store,image_inode=value.st_ino,cold_archive_files=[str(archive),proof['custody'],str(archive.with_suffix('.removal.json'))],restoration_receipt=str(owner/'restoration-receipt.json'),
                restoration_receipt_sha256=cold.file_hash(owner/'restoration-receipt.json'))

"""Lossless cold custody for explicitly inventoried, owned detached diagnostic images.
No restore, mount, daemon, overwrite, foreign cleanup or automatic retry.
"""
import sys
sys.dont_write_bytecode=True
import gzip,hashlib,json,os,stat,subprocess,plistlib,uuid
from pathlib import Path
import owned_node as guard

CAP=127*2**20  # aggregate encoded bodies; leave1 MiB of the128 MiB cap for custody records
CHUNK=2**20


def file_hash(path):
    value=hashlib.sha256()
    with open(path,'rb') as file:
        while True:
            chunk=file.read(CHUNK)
            if not chunk:break
            value.update(chunk)
    return value.hexdigest()


def fingerprint(value):
    return {key:getattr(value,key) for key in ['st_dev','st_ino','st_uid','st_mode','st_size','st_mtime_ns','st_ctime_ns','st_nlink']}


def idle(image):
    images=plistlib.loads(subprocess.check_output(['/usr/bin/hdiutil','info','-plist'],timeout=10))
    if any(x.get('image-path')==str(image) for x in images.get('images',[])):raise guard.GuardError('Image attached; skip')
    if image.exists():
        result=subprocess.run(['/usr/sbin/lsof','-nP','-t','--',str(image)],capture_output=True,text=True,timeout=3)
        if result.returncode not in [0,1] or result.stderr.strip():raise guard.GuardError('Open-handle inspection uncertain')
        if any(int(x)!=os.getpid() for x in result.stdout.split()):raise guard.GuardError('Image held by another process')
    rows=guard.command(['/bin/ps','-axo','comm=,args='],timeout=2)
    if any(str(image.parent) in row and 'bitcoind' in row for row in rows.splitlines()):raise guard.GuardError('Native process uses this run')


def eligible(image):
    owner=guard.private_directory(image.parent);store=guard.load_private(owner/'fixed-store.json');detach=guard.load_private(owner/'detach-receipt.json')
    value=image.lstat()
    if image.is_symlink() or not stat.S_ISREG(value.st_mode) or value.st_nlink!=1 or value.st_uid!=os.getuid() or value.st_mode&0o077:
        raise guard.GuardError('Image is not private regular sole-link owner file')
    if store['image']!=str(image) or store['image_inode']!=value.st_ino or store['image_bytes']!=value.st_size or os.path.ismount(store['mountpoint']):raise guard.GuardError('Image/mount identity changed')
    if detach['exit_code']!=0 or not detach['unmounted'] or detach['force']:raise guard.GuardError('Clean detach unconfirmed')
    if owner.name.startswith('chipnet-stage1-'):
        receipt=guard.load_private(owner/'measurement-receipt.json')
    elif owner.name.startswith('supervised-regtest-'):
        receipt=guard.load_private(owner/'integration-receipt.json')
    elif owner.name.startswith('filesystem-') and owner.parent.name.startswith('supervisor-tests-'):
        receipt=None
    else:raise guard.GuardError('Outside selected native/process-test image scope')
    if receipt and (receipt.get('node_exit_code',receipt.get('child_exit_code'))!=0 or receipt.get('watchdog_exit_code')!=0):raise guard.GuardError('Clean native/watchdog exit unconfirmed')
    idle(image)
    return {'path':str(image),'identity':fingerprint(value),'allocated_bytes':value.st_blocks*512,'store':store,
            'receipt_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in owner.glob('*.json')}}


class CappedWriter:
    def __init__(self,file,budget):self.file=file;self.budget=budget;self.written=0
    def write(self,data):
        if self.written+len(data)>self.budget:raise guard.GuardError('Encoded archive budget exceeded; original retained')
        result=self.file.write(data);self.written+=result;return result
    def flush(self):self.file.flush()


def archive_image(entry,destination,budget,check_idle=idle):
    image=Path(entry['path']);owner=guard.private_directory(image.parent);destination=guard.private_directory(destination)
    source=os.open(image,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        if fingerprint(os.fstat(source))!=entry['identity']:raise guard.GuardError('Inventory identity changed')
        check_idle(image)
        encoded=destination/(owner.name+'-'+uuid.uuid4().hex[:8]+'.dmg.gz')
        digest=hashlib.sha256();length=0
        with open(encoded,'xb',opener=lambda name,flags:os.open(name,flags,0o600)) as out:
            capped=CappedWriter(out,budget)
            with gzip.GzipFile(filename='',fileobj=capped,mode='wb',compresslevel=1,mtime=0) as archive:
                while True:
                    chunk=os.read(source,CHUNK)
                    if not chunk:break
                    length+=len(chunk);digest.update(chunk);archive.write(chunk)
            out.flush();os.fsync(out.fileno())
        restored_hash=hashlib.sha256();restored_length=0
        with gzip.open(encoded,'rb') as decoded:
            while True:
                chunk=decoded.read(CHUNK)
                if not chunk:break
                restored_length+=len(chunk)
                if restored_length>entry['identity']['st_size']:raise guard.GuardError('Decoded archive exceeds inventoried original length')
                restored_hash.update(chunk)
        if restored_length!=length or length!=entry['identity']['st_size'] or restored_hash.digest()!=digest.digest():raise guard.GuardError('Complete decompression SHA/length mismatch; original retained')
        if fingerprint(image.lstat())!=entry['identity'] or fingerprint(os.fstat(source))!=entry['identity']:raise guard.GuardError('Original changed during custody verification')
        check_idle(image)
        record={'at':guard.utc(),'original':entry,'archive':str(encoded),'archive_bytes':encoded.stat().st_size,'archive_sha256':file_hash(encoded),
                'original_sha256':digest.hexdigest(),'original_length':length,'decoded_sha256':restored_hash.hexdigest(),'decoded_length':restored_length,'complete_decompression_verified':True,
                'archive_fsynced':True,'original_removed_at_this_record':False,'restore_requires_explicit_inode_reconciliation':True}
        guard.save_new(encoded.with_suffix('.custody.json'),record)
        parent=os.open(destination,os.O_RDONLY);os.fsync(parent);os.close(parent)
        # Exact inventoried encoded image only, after durable verified custody; no recursive delete/trash.
        if fingerprint(image.lstat())!=entry['identity']:raise guard.GuardError('Identity changed before removal')
        guard.private_directory(owner)
        os.unlink(image)
        parent=os.open(owner,os.O_RDONLY);os.fsync(parent);os.close(parent)
        guard.save_new(encoded.with_suffix('.removal.json'),{'at':guard.utc(),'original_path':str(image),'removed_only_original_encoded_image':True,'verified_custody':str(encoded.with_suffix('.custody.json')),'original_parent_fsynced':True})
        parent=os.open(destination,os.O_RDONLY);os.fsync(parent);os.close(parent)
        return record
    finally:os.close(source)


def main():
    base=Path('.build/runtime').resolve();destination=base/('cold-images-'+uuid.uuid4().hex[:8]);destination.mkdir(mode=0o700)
    free=lambda:os.statvfs(base).f_bavail*os.statvfs(base).f_frsize
    before=free();entries=[];skips=[]
    # Tiny synthetic metadata fixtures and unrelated source/runtime/audit artifacts are excluded.
    candidates=list(base.glob('chipnet-stage1-*/bounded.dmg'))+list(base.glob('supervised-regtest-*/bounded.dmg'))+list(base.glob('supervisor-tests-*/filesystem-*/bounded.dmg'))
    for image in sorted(candidates):
        try:entries.append(eligible(image))
        except (guard.GuardError,OSError,ValueError,subprocess.SubprocessError) as error:skips.append({'path':str(image),'reason':str(error)[:160]})
    if len(entries)>32:raise guard.GuardError('Custody record-count bound exceeded')
    guard.save_new(destination/'inventory.json',{'at':guard.utc(),'free_before_bytes':before,'entries':entries,'skips':skips,'scope':'Detached owned native-stage and process-test filesystem images only; no source/runtime/public-node/evidence cleanup'})
    receipts=[];used=0
    for entry in entries:
        receipt=archive_image(entry,destination,CAP-used);receipts.append(receipt);used+=receipt['archive_bytes']
        for name,digest in entry['receipt_sha256'].items():
            if hashlib.sha256((Path(entry['path']).parent/name).read_bytes()).hexdigest()!=digest:raise guard.GuardError('Protected original receipt changed')
        print(json.dumps({'archived':entry['path'],'original_bytes':receipt['original_length'],'encoded_bytes':receipt['archive_bytes'],'verified':True}),flush=True)
    summary={'at':guard.utc(),'directory':str(destination),'free_before_bytes':before,'free_after_bytes':free(),'original_allocated_bytes_removed':sum(x['original']['allocated_bytes'] for x in receipts),'archive_body_bytes':used,'new_directory_allocated_bytes':guard.allocated_bytes(destination),'cap_bytes':128*2**20,'archived_count':len(receipts),'skips':skips,'receipts':receipts,'no_mount_restore_node_or_p2p':True}
    guard.save_new(destination/'summary.json',summary)
    print(json.dumps({k:v for k,v in summary.items() if k!='receipts'},indent=2))


if __name__=='__main__':sys.exit(main())

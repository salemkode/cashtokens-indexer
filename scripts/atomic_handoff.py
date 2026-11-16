"""No-clobber atomic JSON handoff publication inside a private owned run directory.
Dedicated to the two bounded-runner handoffs; does not change guard.save_new.
"""
import json,os,stat,uuid
from pathlib import Path
import owned_node as guard


def publish_handoff(run,name,value):
    run=guard.private_directory(run)
    if name not in ['consumer-owner.json','connection.json']:raise guard.GuardError('Unsupported handoff name')
    payload=(json.dumps(value,indent=2,allow_nan=False)+'\n').encode('utf8')
    directory=os.open(run,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    temporary='.'+name+'.'+uuid.uuid4().hex+'.pending'
    created=None
    try:
        owner=os.fstat(directory)
        if owner.st_uid!=os.getuid() or owner.st_mode&0o077:raise guard.GuardError('Private handoff directory identity changed')
        try:os.stat(name,dir_fd=directory,follow_symlinks=False)
        except FileNotFoundError:pass
        else:raise FileExistsError('Existing handoff is never replaced')
        descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
        try:
            created=os.fstat(descriptor)
            offset=0
            while offset<len(payload):
                written=os.write(descriptor,payload[offset:])
                if written<=0:raise OSError('Incomplete handoff write')
                offset+=written
            os.fsync(descriptor)
        finally:os.close(descriptor)
        os.fsync(directory)
        # linkat is atomic and refuses any existing final entry, including a symlink.
        os.link(temporary,name,src_dir_fd=directory,dst_dir_fd=directory,follow_symlinks=False)
        os.fsync(directory)
    finally:
        try:
            if created is not None:
                try:current=os.stat(temporary,dir_fd=directory,follow_symlinks=False)
                except FileNotFoundError:current=None
                if current is not None and stat.S_ISREG(current.st_mode) and current.st_uid==os.getuid() and (current.st_dev,current.st_ino)==(created.st_dev,created.st_ino):
                    os.unlink(temporary,dir_fd=directory);os.fsync(directory)
        finally:os.close(directory)
    return run/name

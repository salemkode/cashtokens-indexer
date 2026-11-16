#!/usr/bin/env python3
"""Package verified source and compiled runtime; no installs, servers or chain data."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import tarfile


def hashes(root, names):
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in sorted(names)}


def build_inputs(root):
    names = {'package.json', 'package-lock.json', 'tsconfig.json'}
    for folder in ['src', 'scripts', 'test']:
        names.update(str(path.relative_to(root)) for path in (root / folder).rglob('*')
                     if path.is_file() and path.suffix in ('.ts', '.json'))
    return hashes(root, names)


def runtime_outputs(root):
    names = [str(path.relative_to(root)) for folder in ['dist/src', 'dist/scripts']
             for path in (root / folder).rglob('*') if path.is_file()]
    if 'dist/src/main.js' not in names or 'dist/scripts/server-acceptance.js' not in names:
        raise ValueError('Compile the runtime and server acceptance first')
    return hashes(root, names)


def deployment_inputs(root):
    names = {'Dockerfile', 'Dockerfile.runtime', 'Dockerfile.runtime.dockerignore', '.dockerignore',
             'scripts/package_server.py'}
    names.update(str(path.relative_to(root)) for path in (root / 'deploy/server').rglob('*')
                 if path.is_file() and path.suffix not in ('.env', '.pyc') and '__pycache__' not in path.parts)
    names.update(str(path.relative_to(root)) for path in (root / 'test').glob('test_server_*.py'))
    return hashes(root, names)


def package(root, verification, destination):
    report = json.loads(verification.read_text())
    if (report.get('status') != 'passed' or report.get('build_inputs') != build_inputs(root)
            or report.get('runtime_outputs') != runtime_outputs(root)
            or report.get('deployment_inputs') != deployment_inputs(root)):
        raise ValueError('Verification does not match current source and compiled runtime')
    names = ['package.json', 'package-lock.json', 'tsconfig.json', 'Dockerfile', 'Dockerfile.runtime',
             'Dockerfile.runtime.dockerignore', '.dockerignore', '.gitignore', '.env.example',
             'compose.yaml', 'README.md', 'RELEASE-STATUS.md', 'WORK-STATUS.md', 'AGENTS.md']
    for folder in ['src', 'scripts', 'test', 'docs', 'deploy/server', 'dist/src', 'dist/scripts']:
        if (root / folder).is_symlink():
            raise ValueError('Symlinked source directories are not permitted')
        for path in sorted((root / folder).rglob('*')):
            if path.is_symlink():
                raise ValueError('Symlinks are not permitted in the server handoff')
            if (path.is_file() and '__pycache__' not in path.parts
                    and path.suffix not in ('.pyc', '.env') and path.name != '.env'):
                names.append(str(path.relative_to(root)))
    if any((root / name).is_symlink() for name in names):
        raise ValueError('Symlinked source files are not permitted')
    content = {name: (root / name).read_bytes() for name in names}
    # Verify again after capture so a simultaneous source edit cannot mix releases.
    for name, digest in {**report['build_inputs'], **report['runtime_outputs'], **report['deployment_inputs']}.items():
        if name not in content or hashlib.sha256(content[name]).hexdigest() != digest:
            raise ValueError('Source/runtime changed while packaging')
    content['SERVER-VERIFICATION.json'] = verification.read_bytes()
    manifest = {name: hashlib.sha256(value).hexdigest() for name, value in sorted(content.items())}
    content['SOURCE-MANIFEST.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    destination.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    archive = destination / ('blaze-linux-server-' + stamp + '.tar.gz')
    with archive.open('xb') as output:
        with tarfile.open(fileobj=output, mode='w:gz') as bundle:
            for name, value in content.items():
                entry = tarfile.TarInfo(name)
                entry.mode = 0o755 if name in ['deploy/server/blaze', 'deploy/server/session-stop',
                                             'deploy/server/test-offline'] else 0o644
                entry.size = len(value)
                bundle.addfile(entry, io.BytesIO(value))
    with tarfile.open(archive, 'r:gz') as bundle:
        if len(bundle.getmembers()) != len(content):
            raise ValueError('Archive member count mismatch')
        for entry in bundle:
            if not entry.isfile() or entry.name not in content or bundle.extractfile(entry).read() != content[entry.name]:
                raise ValueError('Archive member verification failed')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    with archive.with_name(archive.name + '.sha256').open('x') as output:
        output.write(digest + '  ' + archive.name + '\n')
    return {'archive': str(archive), 'sha256': digest, 'bytes': archive.stat().st_size,
            'files': len(content), 'source_and_runtime_match_verification': True,
            'archive_members_verified': True, 'compiled_runtime_included': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verification', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=Path('.build/artifacts'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    print(json.dumps(package(root, args.verification, args.output_dir), indent=2))

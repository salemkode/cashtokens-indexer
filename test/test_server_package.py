import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('server_package', Path(__file__).resolve().parents[1] / 'scripts/package_server.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ServerPackageTests(unittest.TestCase):
    def fixture(self, root):
        for folder in ['src', 'scripts', 'test', 'docs', 'deploy/server', 'dist/src', 'dist/scripts']:
            (root / folder).mkdir(parents=True, exist_ok=True)
        for name in ['package.json', 'package-lock.json', 'tsconfig.json', 'Dockerfile', 'Dockerfile.runtime',
                     'Dockerfile.runtime.dockerignore', '.dockerignore', '.gitignore', '.env.example',
                     'compose.yaml', 'README.md', 'RELEASE-STATUS.md', 'WORK-STATUS.md', 'AGENTS.md',
                     'src/main.ts', 'scripts/package_server.py', 'dist/src/main.js', 'dist/scripts/server-acceptance.js', 'deploy/server/blaze']:
            (root / name).write_text('fixture: ' + name)
        (root / '.env').write_text('PRIVATE_VALUE=not-for-the-archive')
        (root / 'deploy/server/mainnet.env').write_text('PRIVATE_VALUE=not-for-the-archive')
        (root / 'deploy/server/mainnet.env.example').write_text('PUBLIC_PLACEHOLDER=replace-me')
        verification = root / 'verified.json'
        verification.write_text(json.dumps({'status': 'passed', 'build_inputs': release.build_inputs(root),
                                             'runtime_outputs': release.runtime_outputs(root),
                                             'deployment_inputs': release.deployment_inputs(root)}))
        return verification

    def test_archive_round_trip_verifies_content_excludes_secrets_and_preserves_launcher_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            verification = self.fixture(root)
            result = release.package(root, verification, root / 'output')
            with tarfile.open(result['archive']) as bundle:
                names = bundle.getnames()
                self.assertNotIn('.env', names)
                self.assertNotIn('deploy/server/mainnet.env', names)
                self.assertIn('deploy/server/mainnet.env.example', names)
                self.assertIn('dist/src/main.js', names)
                self.assertEqual(bundle.getmember('deploy/server/blaze').mode, 0o755)
                self.assertNotIn(b'not-for-the-archive', b''.join(bundle.extractfile(name).read() for name in names))
            self.assertTrue(result['archive_members_verified'])

    def test_stale_source_or_compiled_output_refuses_packaging(self):
        for name in ['src/main.ts', 'dist/src/main.js', 'deploy/server/blaze']:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                verification = self.fixture(root)
                (root / name).write_text('changed after verification')
                with self.assertRaises(ValueError):
                    release.package(root, verification, root / 'output')
                self.assertFalse((root / 'output').exists())

    def test_symlinked_document_cannot_pull_private_data_into_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            verification = self.fixture(root)
            (root / 'README.md').unlink()
            (root / 'README.md').symlink_to(root / '.env')
            with self.assertRaises(ValueError):
                release.package(root, verification, root / 'output')
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()

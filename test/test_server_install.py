import importlib.machinery
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('server_install', str(Path(__file__).resolve().parents[1] / 'install'))
spec = importlib.util.spec_from_loader(loader.name, loader)
installer = importlib.util.module_from_spec(spec)
loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def test_actual_entrypoint_refuses_macos_before_preparing_files(self):
        with patch.object(installer.platform, 'system', return_value='Darwin'), patch.object(installer, 'prepare') as prepare:
            with self.assertRaises(ValueError):
                installer.main()
            prepare.assert_not_called()

    def fixture(self, root):
        directory = root / 'deploy/server'
        directory.mkdir(parents=True)
        for name in ['mainnet', 'chipnet', 'tuning']:
            (directory / (name + '.env.example')).write_text('PASSWORD=replace-me\n')
        return directory

    def test_prepare_creates_private_files_and_preserves_existing_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            configs = self.fixture(root)
            self.assertEqual(len(installer.prepare(root)), 3)
            for target in configs.glob('*.env'):
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            target = configs / 'mainnet.env'
            target.write_text('PASSWORD=existing-private-value\n')
            self.assertEqual(installer.prepare(root), [])
            self.assertEqual(target.read_text(), 'PASSWORD=existing-private-value\n')

    def test_symlinked_configuration_cannot_overwrite_another_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            configs = self.fixture(root)
            target = root / 'keep-private'
            target.write_text('unchanged')
            (configs / 'mainnet.env').symlink_to(target)
            with self.assertRaises(ValueError):
                installer.prepare(root)
            self.assertEqual(target.read_text(), 'unchanged')


if __name__ == '__main__':
    unittest.main()

# SPDX-License-Identifier: MulanPSL-2.0
import argparse
import hashlib
import os
import platform
import shutil
import subprocess
import sys
from importlib.metadata import distributions
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def freeze_backend():
    build = ROOT / 'build'
    bundle = build / 'backend/fortuna-backend'
    stamp = build / 'freeze/backend.sha256'
    spec = ROOT / 'electron/backend.spec'
    versions = sorted((dist.metadata['Name'], dist.version) for dist in distributions())
    runtime = (sys.executable, sys.version, sys.platform, platform.machine(), versions)
    inputs = hashlib.sha256(repr(runtime).encode())
    sources = [spec, ROOT / 'electron/requirements-build.txt', ROOT / 'server/requirements.txt']
    sources.extend(p for p in (ROOT / 'server/src').rglob('*') if p.suffix in {'.py', '.json', '.sql'})
    for source in sorted(sources):
        inputs.update(source.relative_to(ROOT).as_posix().encode() + b'\0')
        inputs.update(hashlib.sha256(source.read_bytes()).digest())

    def fingerprint():
        digest = inputs.copy()
        for file in sorted(bundle.rglob('*')):
            if file.is_file():
                stat = file.stat()
                digest.update(repr((file.relative_to(bundle).as_posix(), stat.st_size, stat.st_mtime_ns)).encode())
        return digest.hexdigest()

    if stamp.is_file() and stamp.read_text(encoding='ascii') == fingerprint():
        print('Using cached desktop backend', flush=True)
        return

    stamp.unlink(missing_ok=True)
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--distpath', 'build/backend',
                    '--workpath', 'build/freeze', str(spec)], cwd=ROOT, check=True,
                   env={**os.environ, 'PYINSTALLER_CONFIG_DIR': str(build / 'freeze/cache')})
    stamp.write_text(fingerprint(), encoding='ascii')


def main():
    parser = argparse.ArgumentParser(description='Build Fortuna for this native platform')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dev', action='store_true', help='Launch the development app and watch for changes')
    mode.add_argument('--prepare', action='store_true', help='Build the backend, renderer and Electron runtime for development')
    mode.add_argument('--signed', action='store_true', help='Require release signing credentials')
    args = parser.parse_args()
    if (sys.platform, platform.machine().lower()) not in {('darwin', 'arm64'), ('win32', 'amd64')}:
        parser.error('Use Python for native macOS ARM64 or Windows x64')
    if sys.version_info < (3, 14):
        parser.error('Python 3.14 or newer is required')
    vp = shutil.which('vp')
    if not vp:
        parser.error('Install Vite+ on the build machine')
    freeze_backend()
    if args.dev:
        try:
            return subprocess.run([vp, 'run', 'dev'], cwd=ROOT / 'electron').returncode
        except KeyboardInterrupt:
            return 130
    subprocess.run([vp, 'run', 'build:desktop'], cwd=ROOT / 'web', check=True)
    subprocess.run([vp, 'run', 'build' if args.prepare else 'dist', *(['--signed'] if args.signed else [])],
                   cwd=ROOT / 'electron', check=True)


if __name__ == '__main__':
    sys.exit(main())

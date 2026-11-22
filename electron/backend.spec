# SPDX-License-Identifier: MulanPSL-2.0
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files

src = Path(SPECPATH).parent / 'server' / 'src'
a = Analysis([str(src / 'embedded/launcher.py')], pathex=[str(src)],
             datas=[(str(src / 'config.schema.json'), '.'), (str(src / 'sql/schema.sql'), 'sql')]
                   + collect_data_files('jsonschema_specifications'),
             hiddenimports=['_cffi_backend', '_argon2_cffi_bindings._ffi'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='fortuna-backend', console=True)
coll = COLLECT(exe, a.binaries, a.datas, name='fortuna-backend')

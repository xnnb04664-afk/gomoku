"""Inspect the actual APK's stripped JNI libraries for all supported ABIs."""
from pathlib import Path
import json
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('D:/Android/Sdk/ndk/27.2.12479018/toolchains/llvm/prebuilt/windows-x86_64/bin')
EXPECTED = {'Java_com_gomoku_master_NativeGomokuAI_chooseMoveNative',
            'Java_com_gomoku_master_NativeGomokuAI_warmUpNative'}
results = []
with zipfile.ZipFile(ROOT / '五子棋.apk') as apk, tempfile.TemporaryDirectory(prefix='gomoku-elf-') as directory:
    for abi in ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']:
        entry = apk.getinfo(f'lib/{abi}/libgomoku_ai.so')
        lib = Path(directory) / f'{abi}.so'
        lib.write_bytes(apk.read(entry))
        def run(tool, *args):
            return subprocess.check_output([str(BIN / (tool+'.exe')), *args, str(lib)], text=True)
        exports = run('llvm-nm', '-D', '--defined-only')
        names = {line.split()[-1] for line in exports.splitlines() if line.strip()}
        assert names == EXPECTED, (abi, names)
        sections = run('llvm-readelf', '-S')
        assert '.symtab' not in sections and '.debug_' not in sections, abi
        headers = run('llvm-readelf', '-lW')
        loads = [line.split() for line in headers.splitlines() if line.strip().startswith('LOAD ')]
        assert loads and all(int(row[-1], 16) >= 16384 for row in loads), (abi, loads)
        assert 'Build ID:' in run('llvm-readelf', '-n'), abi
        results.append({'abi':abi, 'bytes':entry.file_size, 'compressedBytes':entry.compress_size,
                        'jniExports':len(names), 'pageAligned16KiB':True, 'stripped':True})
print(json.dumps({'pass':True, 'abis':results, 'nativeCompressedBytes':sum(r['compressedBytes'] for r in results)}))

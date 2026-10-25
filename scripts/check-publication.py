#!/usr/bin/env python3
"""Check public entry-point links and the licenses actually shipped in a tarball.

No network or credentials are used. Run from any directory; pass one or more
built bundle tarballs as arguments. Historical research notes are not link gates.
"""
from pathlib import Path
import json
import re
import sys
import tarfile
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PAGES = ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/quickstart.md']
ROOT_FILES = {'.gitignore', '.gitleaks.toml', 'AGENTS.md', 'LICENSE', 'NOTICE',
              'THIRD_PARTY_NOTICES.md', 'README.md', 'README.en.md', 'CONTRIBUTING.md',
              'SECURITY.md', 'references.lock.json', 'scripts/check-publication.py',
              'docs/quickstart.md', 'docs/evo-first-run.patch.yml', 'docs/evo-learning.patch.yml',
              'dsh-evolve/README.md', 'dsh-evolve/.gitignore', 'dsh-evolve/package.json',
              'dsh-evolve/pnpm-lock.yaml', 'dsh-evolve/pnpm-workspace.yaml',
              'dsh-evolve/tsconfig.json', 'dsh-evolve/tsconfig.base.json',
              'dsh-evolve/docs/install.md', 'dsh-evolve/docs/compat.md', 'dsh-evolve/THIRD_PARTY_NOTICES.md',
              'dsh-evolve/LICENSE', 'dsh-evolve/NOTICE',
              'licenses/Apache-2.0.txt', 'licenses/MIT-DeepSeek.txt'}
PACKAGES = {'core', 'agent', 'observer', 'probe', 'sandbox', 'tools', 'commands', 'ui', 'bundle', 'loop'}
PRIVATE_PARTS = {'test', 'tests', '__tests__', 'fixtures', '__fixtures__', 'eval',
                 'evaluation', 'spikes', 'reports', 'runs', 'runs-real', '.dsh-evolve',
                 'node_modules', '.git', '.env'}


def forbidden(name):
    parts = Path(name).parts
    return any(p.lower() in PRIVATE_PARTS or p.startswith('.env.') or
               p.endswith(('.key', '.pem')) or re.search(r'\.(spec|test)\.', p) for p in parts)


def allowed_source(name):
    if forbidden(name):
        return False
    if name in ROOT_FILES:
        return True
    if name.startswith('.github/'):
        return Path(name).suffix in {'.md', '.yml', '.yaml'}
    parts = Path(name).parts
    if len(parts) < 4 or parts[:2] != ('dsh-evolve', 'packages') or parts[2] not in PACKAGES:
        return False
    if len(parts) == 4:
        return parts[3] in {'package.json', 'tsconfig.json', 'build.mjs', 'cordis.patch.yml',
                            'LICENSE', 'NOTICE', 'README.md'}
    return (parts[3] == 'src' and Path(name).suffix in {'.ts', '.js', '.mjs'}) or (
        parts[2] == 'loop' and parts[3] == 'locale' and Path(name).suffix == '.json')


def check_public_source():
    # Validate every reachable commit, not just HEAD: deleting a file is not a privacy boundary.
    commits = subprocess.check_output(['git', 'rev-list', '--all'], cwd=ROOT, text=True).splitlines()
    if not commits:
        raise ValueError('no committed public snapshot')
    checked = set()
    for commit in commits:
        rows = subprocess.check_output(['git', 'ls-tree', '-rz', commit], cwd=ROOT).split(b'\0')
        for row in rows:
            if not row:
                continue
            meta, raw_name = row.split(b'\t', 1)
            mode, kind, oid = meta.decode().split()
            name = raw_name.decode()
            if mode not in {'100644', '100755'} or kind != 'blob' or not allowed_source(name):
                raise ValueError(f'non-public path in history: {name}')
            if oid not in checked:
                payload = subprocess.check_output(['git', 'cat-file', 'blob', oid], cwd=ROOT)
                check_content(name, payload)
                checked.add(oid)
    print('OK: all reachable public commits contain only allowed source and documentation')


def check_content(name, payload):
    value = payload.decode('utf-8')
    patterns = [r'\bark-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[A-Za-z0-9]+)?\b',
                r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
                r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b']
    if any(re.search(pattern, value) for pattern in patterns):
        raise ValueError(f'credential pattern found in {name}; value withheld')
    if Path(name).suffix in {'.ts', '.js', '.mjs'} and re.search(
        r"(?:from|import)\s*['\"](?:vitest|@vitest/|node:test)|(?:^|\n)\s*(?:describe|it|test)\s*\(", value):
        raise ValueError(f'test code found in {name}')



def check_links():
    for relative in subprocess.check_output(['git', 'ls-files', '*.md'], cwd=ROOT, text=True).splitlines():
        page = ROOT / relative
        for target in re.findall(r'\]\(([^\s)]+)(?:\s+[^)]*)?\)', page.read_text()):
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            path = (page.parent / unquote(parsed.path)).resolve()
            if not path.is_relative_to(ROOT) or not path.exists():
                raise ValueError(f'{relative}: missing/nonlocal link {target}')


def check_tarball(path):
    expected = {
        'package/LICENSE': 'LICENSE',
        'package/NOTICE': 'NOTICE',
        'package/THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
        'package/LICENSES/Apache-2.0.txt': 'licenses/Apache-2.0.txt',
        'package/LICENSES/MIT-DeepSeek.txt': 'licenses/MIT-DeepSeek.txt',
    }
    with tarfile.open(path, 'r:gz') as archive:
        entries = {item.name: item for item in archive.getmembers()}
        for name, canonical in expected.items():
            if name not in entries or not entries[name].isfile():
                raise ValueError(f'{path}: missing license/notice {name}')
            with archive.extractfile(entries[name]) as stream:
                if stream.read() != (ROOT / canonical).read_bytes():
                    raise ValueError(f'{path}: stale license/notice {name}')
        for name, entry in entries.items():
            parts = Path(name).parts
            if entry.issym() or entry.islnk() or name.startswith('/') or '..' in parts:
                raise ValueError(f'{path}: unsafe archive path/link {name}')
            if forbidden(name) or name.endswith('.map'):
                raise ValueError(f'{path}: private/runtime file in package {name}')
            if entry.isfile():
                with archive.extractfile(entry) as stream:
                    check_content(name, stream.read())
        with archive.extractfile('package/package.json') as stream:
            manifest = json.load(stream)
        source = json.loads((ROOT / 'dsh-evolve/packages/bundle/package.json').read_text())
        if manifest['name'] != '@dsh-evolve/bundle' or manifest['version'] != source['version']:
            raise ValueError(f'{path}: package identity/version mismatch')
        if manifest.get('license') != '(MIT AND Apache-2.0)':
            raise ValueError(f'{path}: inaccurate third-party license metadata')
        if any(isinstance(v, str) and v.startswith(('workspace:', 'file:', 'link:')) for v in manifest.get('dependencies', {}).values()):
            raise ValueError(f'{path}: local-only production dependency')
        if any(name.startswith('@deepseek-ai/') for name in manifest.get('dependencies', {})):
            raise ValueError(f'{path}: private DSH runtime must not be installed by the plugin')
        for name in manifest.get('peerDependencies', {}):
            if name.startswith('@deepseek-ai/') and not manifest.get('peerDependenciesMeta', {}).get(name, {}).get('optional'):
                raise ValueError(f'{path}: host peer {name} would be auto-installed')
        for required in ('lib/ui.js', 'lib/client.js', 'lib/worker.js', 'lib/host-ui.js', 'lib/host-core.js', 'lib/host-compatibility.mjs', 'cordis.patch.yml'):
            if f'package/{required}' not in entries:
                raise ValueError(f'{path}: missing runtime entry {required}')
    print(f'OK: {Path(path).name}: runtime entries, licenses, notices, metadata and archive boundaries')


if __name__ == '__main__':
    check_public_source()
    check_links()
    print('OK: public documentation local links')
    for candidate in sys.argv[1:]:
        check_tarball(candidate)

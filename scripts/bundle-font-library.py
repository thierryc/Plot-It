"""Bundle reviewed OpenPlotFont exports and original outline fonts for lazy loading.

Usage: python3 scripts/bundle-font-library.py --library /path/to/OpenPlotFont/output/font-library/fonts
  --inter /path/to/Inter.ttf --inter-italic /path/to/Inter-Italic.ttf
  --inter-license /path/to/OFL.txt --squarebot /path/to/squarebot-2.009.zip
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--inter', type=Path, required=True)
    parser.add_argument('--inter-italic', type=Path, required=True)
    parser.add_argument('--inter-license', type=Path, required=True)
    parser.add_argument('--squarebot', type=Path, required=True)
    args = parser.parse_args()
    destination = ROOT / 'public/fonts/library'
    destination.mkdir(parents=True, exist_ok=True)
    entries = []
    for row in json.loads((args.library / 'catalog.json').read_text())['fonts']:
        key = row['id']
        folder = args.library / key
        source = folder / f'{key}.opf.json'
        original = source.read_bytes()
        font = json.loads(original)
        target = destination / key
        target.mkdir(exist_ok=True)
        data = (json.dumps(font, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        (target / source.name).write_bytes(data)
        # Include original font sources and every ancestor notice, including GPL sources.
        for item in folder.iterdir():
            if item.is_file() and item.name not in [source.name, 'specimen.svg', 'glyph-atlas.svg']:
                shutil.copyfile(item, target / item.name)
        mapping = str(font['metadata'].get('mapping', ''))
        group = 'Hershey' if 'hershey' in key else 'EMS' if key.startswith('pf-ems-') else 'Other stroke fonts'
        entries.append(dict(id=key, name=f"{font['familyName']} {font['styleName']}", kind='openplotfont', group=group,
                            url=f'/fonts/library/{key}/{source.name}', noticeUrl=f'/fonts/library/{key}/ATTRIBUTION.txt',
                            sourceUrl=row['sourceUrl'], license=row['license'], sha256=digest(data),
                            originalSha256=digest(original), glyphCount=len(font['glyphs']),
                            coverageHint=('Symbol/non-Latin drawings use temporary private-use codes (U+E000 + source row); standard text mappings are not available.' if 'private-use' in mapping else '')))
    for key, name, source in [('inter', 'Inter Regular', args.inter), ('inter-italic', 'Inter Italic', args.inter_italic)]:
        target = destination / key
        target.mkdir(exist_ok=True)
        data = source.read_bytes()
        (target / f'{key}.ttf').write_bytes(data)
        shutil.copyfile(args.inter_license, target / 'OFL.txt')
        credit = 'Inter by Rasmus Andersson and The Inter Project Authors. SIL Open Font License 1.1.\nhttps://github.com/rsms/inter\n\n' + args.inter_license.read_text()
        (target / 'ATTRIBUTION.txt').write_text(credit)
        entries.append(dict(id=key, name=name, kind='outline', group='Outline fonts', url=f'/fonts/library/{key}/{key}.ttf',
                            noticeUrl=f'/fonts/library/{key}/ATTRIBUTION.txt', sourceUrl='https://github.com/google/fonts/tree/main/ofl/inter',
                            license='SIL OFL 1.1', sha256=digest(data), coverageHint=''))
    key = 'square-bot-sans'
    target = destination / key
    target.mkdir(exist_ok=True)
    with zipfile.ZipFile(args.squarebot) as archive:
        data = archive.read('fonts/variable/SquareBotSans[ital,wdth,wght].ttf')
        (target / 'square-bot-sans.ttf').write_bytes(data)
        for name in ['OFL.txt', 'README.md']:
            (target / name).write_bytes(archive.read(name))
        credit = 'Square Bot Sans by Thierry Charbonnel / AP.CX, derived from Hubot Sans.\nhttps://ap.cx/fonts/squarebot/\nRelease package: squarebot-2.009.zip\n\n' + archive.read('OFL.txt').decode()
        (target / 'ATTRIBUTION.txt').write_text(credit)
    entries.append(dict(id=key, name='Square Bot Sans Regular', kind='outline', group='Outline fonts', url=f'/fonts/library/{key}/{key}.ttf',
                        noticeUrl=f'/fonts/library/{key}/ATTRIBUTION.txt', sourceUrl='https://ap.cx/fonts/squarebot/',
                        license='SIL OFL 1.1', sha256=digest(data), coverageHint=''))
    (ROOT / 'src/fonts/catalog.json').write_text(json.dumps(entries, indent=2, ensure_ascii=False) + '\n')
    print(f'Bundled {len(entries)} catalog entries with source digests and notices.')


if __name__ == '__main__':
    main()

import json
import sys
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString

if len(sys.argv) != 3:
    raise SystemExit('Usage: python3 openplotfont-shaping-probe.py OPENPLOTFONT_REPO OUTPUT_DIR')
root = Path(sys.argv[1]).expanduser().resolve()
out = Path(sys.argv[2]).expanduser().resolve()
out.mkdir(parents=True, exist_ok=True)

def build(data, name, features=''):
    glyphs = {g['name']: g for g in data['glyphs']}
    order = [data['missingGlyph']] + [g for g in glyphs if g != data['missingGlyph']]
    fb = FontBuilder(data['unitsPerEm'], isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({int(u, 16): g['name'] for g in data['glyphs'] for u in g['unicodes']})
    fb.setupGlyf({g: TTGlyphPen(None).glyph() for g in order})
    fb.setupHorizontalMetrics({g: (round(glyphs[g]['advanceWidth']), 0) for g in order})
    m = data['metrics']
    fb.setupHorizontalHeader(ascent=round(m['ascender']), descent=round(m['descender']), lineGap=round(m['lineGap']))
    fb.setupNameTable({'familyName': name, 'styleName': 'Regular', 'uniqueFontIdentifier': name, 'fullName': name, 'psName': name})
    fb.setupOS2(sTypoAscender=round(m['ascender']), sTypoDescender=round(m['descender']), sTypoLineGap=round(m['lineGap']), usWinAscent=round(m['ascender']), usWinDescent=round(-m['descender']), sCapHeight=round(m['capHeight']), sxHeight=round(m['xHeight']))
    fb.setupPost()
    fb.setupMaxp()
    if features:
        addOpenTypeFeaturesFromString(fb.font, features)
    fb.save(out / (name + '.ttf'))
    (out / (name + '.json')).write_text(json.dumps({'gidToName': order, 'openplotfont': data}))

for path in sorted(root.glob('fonts/hershey-*/*.opf.json')):
    data = json.loads(path.read_text())
    build(data, path.stem.replace('.opf', ''))
    print(data['familyName'], 'glyphs=', len(data['glyphs']), 'kern pairs=', len(data.get('kerning', [])))

data = json.loads((root / 'examples/minimal.opf.json').read_text())
for name, unicode, advance in [('V', '0056', 650), ('f', '0066', 300), ('i', '0069', 200), ('f_i', None, 450), ('A.alt', None, 650), ('acutecomb', '0301', 0)]:
    data['glyphs'].append({'name': name, 'unicodes': [unicode] if unicode else [], 'advanceWidth': advance, 'strokes': [{'closed': False, 'commands': [['M', 0, 0], ['L', 100, 100]]}]})
build(data, 'SyntheticFeatures', '''
languagesystem DFLT dflt;
languagesystem latn dflt;
feature kern { pos A V -50; } kern;
feature liga { sub f i by f_i; } liga;
feature ss01 { sub A by A.alt; } ss01;
markClass acutecomb <anchor 75 100> @TOP;
feature mark { pos base A <anchor 250 700> mark @TOP; } mark;
''')

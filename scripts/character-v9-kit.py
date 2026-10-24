"""Package approved source PNGs unchanged and analyze semantic skin colors.

This script never paints, cleans, crops or resamples artwork. It copies exact
source bytes and records fixed display registration plus skin-only color masks.
"""
from pathlib import Path
from PIL import Image
import hashlib, json, shutil

project = Path(__file__).resolve().parents[1]
source = project / 'design/characters/retro-v9'
out = project / 'src/assets/characters/modular-v9'
catalog = json.loads((source / 'catalog.json').read_text(encoding='utf-8'))
placement = json.loads((source / 'registration.json').read_text(encoding='utf-8'))

def skin_path(image, role):
    if not role:
        return ''
    boxes = {'head': [(270,380,855,810)],
             'upper': [(490,745,636,830),(315,993,431,1078),(688,993,811,1078)],
             'legs': [(390,1100,734,1300)]}[role]
    pixels = image.load()
    active, rectangles = {}, []
    for y in range(image.height):
        runs, start = [], None
        for x in range(image.width + 1):
            chosen = False
            if x < image.width and any(x0 <= x < x1 and y0 <= y < y1 for x0,y0,x1,y1 in boxes):
                r,g,b,a = pixels[x,y]
                chosen = a > 4 and r > 185 and g > 130 and b > 80 and g < r * .91 and g > b + 12
            if chosen and start is None:
                start = x
            if not chosen and start is not None:
                runs.append((start,x-start)); start = None
        next_active = {}
        for run in runs:
            rect = active.pop(run, [run[0],y,run[1],0])
            rect[3] += 1
            next_active[run] = rect
        rectangles.extend(active.values())
        active = next_active
    rectangles.extend(active.values())
    return ''.join(f'M{x},{y}h{w}v{h}h{-w}z' for x,y,w,h in rectangles)

missing = [p['file'] for p in catalog['assets'].values() if not (source / p['file']).exists()]
if missing:
    raise SystemExit('Missing source artwork: ' + ', '.join(missing))
out.mkdir(parents=True, exist_ok=True)
manifest = {k:v for k,v in catalog.items() if k != 'assets'}
manifest['viewport'] = [120,80,880,1200]
manifest['assets'] = {}
imports, mappings = [], []
for i,(key,spec) in enumerate(catalog['assets'].items()):
    file = source / spec['file']
    with Image.open(file) as raw:
        image = raw.convert('RGBA')
        # Preserve the generator's original canvas even when it differs slightly.
        # Fixed per-source registration maps it into the shared anatomical space.
        if min(image.size) < 500 or max(image.size) > 2000:
            raise ValueError('Unexpected source canvas: ' + str(file))
        size = list(image.size)
        bounds = image.getchannel('A').point(lambda a: 255 if a >= 200 else 0).getbbox()
        if not bounds:
            raise ValueError('Empty source: ' + str(file))
        skin = skin_path(image, spec.get('skin'))
    target = out / (key + '.png')
    shutil.copyfile(file, target)
    manifest['assets'][key] = {'file': target.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'width': size[0], 'height': size[1],
                               'bounds': bounds, 'placement': placement.get(key, spec.get('offset', [0,0])),
                               'skinPath': skin}
    imports.append(f"import image{i} from './assets/characters/modular-v9/{target.name}';")
    mappings.append(f"  '{key}': image{i},")
(out / 'kit.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',',':')) + '\n', encoding='utf-8')
(project / 'src/character-v9-images.ts').write_text('\n'.join(imports) + '\nexport const characterImages:Record<string,string>={\n' + '\n'.join(mappings) + '\n};\n', encoding='utf-8')
print(f'Packaged {len(manifest["assets"])} unchanged PNG sources and semantic skin masks.')

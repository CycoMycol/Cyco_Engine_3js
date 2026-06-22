"""
CycoModeler icons — one-time sync.

The icons in editor/src/CycoModeler/Icons/ are hand-painted multi-color PNGs
(26x26) that were sourced from the UModeler Unity Asset Store asset and
rebadged for the Cyco Engine. They are NOT procedurally generated — attempting
to procedurally recreate them produced ugly monochrome results that did not
match the originals.

To refresh / re-sync the icons (e.g. if the source folder is re-populated):

    python tools/generate_cycomodeler_icons.py

The script will:
  1. Read the icon list referenced from editor/src/panels/CenterPanel.js
  2. Copy each matching PNG from UModeler/Icons/ into
     editor/src/CycoModeler/Icons/, applying the rename map below
  3. Delete any stale PNGs in the destination that are no longer referenced

Rename map (Cyco-rebadged icons):
  Icon_Misc_NewUModelerObject.png  ->  Icon_Misc_NewCycoModelerObject.png
"""
import os
import re
import shutil

SRC = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'UModeler', 'Icons'))
DST = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'editor', 'src', 'CycoModeler', 'Icons'))
PANEL = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'editor', 'src', 'panels', 'CenterPanel.js'))

RENAMES = {
    'Icon_Misc_NewUModelerObject.png': 'Icon_Misc_NewCycoModelerObject.png',
}


def main():
    text = open(PANEL, encoding='utf-8').read()
    required = set(re.findall(r"icon:\s*'([^']+\.png)'", text))

    copied, missing = 0, []
    for target in sorted(required):
        source = next((s for s, d in RENAMES.items() if d == target), target)
        src, dst = os.path.join(SRC, source), os.path.join(DST, target)
        if not os.path.exists(src):
            missing.append(source)
            continue
        shutil.copy2(src, dst)
        copied += 1

    # Drop stale files
    for fname in os.listdir(DST):
        if fname not in required:
            os.remove(os.path.join(DST, fname))

    print(f'Copied : {copied}/{len(required)}')
    print(f'Missing: {missing or "NONE"}')
    print(f'Final  : {len(os.listdir(DST))} PNGs in {DST}')


if __name__ == '__main__':
    main()
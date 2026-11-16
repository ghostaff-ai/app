"""place.json (read by swap.py) from what was saved on the placing page.

The page (a Claude artifact, files from placing.py) saves one document per
object: its node's matrix in three.js space (y up, column by column) and the
boxes drawn from the front. Fetch them into a folder as JSON files (one per
document), then (Blender's Python, for numpy):

    blender -b -P design/blender/place_from_page.py -- <folder with the documents>
"""
import json, os, sys, glob
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
# Blender (x, y, z) -> three.js (x, z, -y)
C = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)

out = {}
for f in sorted(glob.glob(os.path.join(sys.argv[sys.argv.index('--') + 1], '**', '*.json'), recursive=True)):
    d = json.load(open(f))
    d = d.get('data', d)
    G = np.array(d['matrix'], float).reshape(4, 4, order='F')
    M = C.T @ G[:3, :3] @ C          # the node's turn and size, in Blender's space
    at = C.T @ G[:3, 3]
    size = np.linalg.norm(M, axis=0)  # width, depth, height
    right, back, up = (M[:, i] / size[i] for i in range(3))
    out.setdefault(d['ghost'], {})[d['prop']] = {
        'at': at.round(5).tolist(), 'right': right.round(5).tolist(), 'back': back.round(5).tolist(),
        'up': up.round(5).tolist(), 'size': size.round(5).tolist(),
        'keep': d.get('keep'), 'also': d.get('also'), 'saved': d.get('savedAt')}
    print(d['ghost'], d['prop'], 'at', out[d['ghost']][d['prop']]['at'], 'size', out[d['ghost']][d['prop']]['size'])
json.dump(out, open(os.path.join(HERE, 'place.json'), 'w'), indent=1)

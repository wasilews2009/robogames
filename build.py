"""Збирає всю систему в один файл index.html (python build.py)."""
import base64, json, pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
img = lambda f: base64.b64encode((root / 'public' / 'img' / f).read_bytes()).decode()
b64 = {'robogames': img('robogames.png'), 'puet': img('puet.png'), 'pano': img('pano.png'), '2d3d': img('2d3d.png')}
cfg_file = root / 'firebase-config.json'
cfg = cfg_file.read_text(encoding='utf-8').strip() if cfg_file.exists() else 'null'
seed = (src / 'seed.json').read_text(encoding='utf-8')
js = lambda n: (src / n).read_text(encoding='utf-8')
html = f'''<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RoboGames-2026 — система суддівства</title>
<link rel="icon" href="data:image/png;base64,{b64['robogames']}">
<style>
{js('styles.css')}
</style>
</head>
<body>
<div id="app"></div>
<div class="toast" id="toast"></div>
<script>
/* Конфігурація Firebase (необов'язково). Можна вписати сюди або підключити в інтерфейсі. */
window.FIREBASE_CONFIG = {cfg};
window.IMG_B64 = {json.dumps(b64)};
window.IMG = {{ robogames: 'data:image/png;base64,' + IMG_B64.robogames, puet: 'data:image/png;base64,' + IMG_B64.puet, pano: 'data:image/png;base64,' + IMG_B64.pano, d2d3: 'data:image/png;base64,' + IMG_B64['2d3d'] }};
window.SEED = {seed};
</script>
<script>
{js('logic.js')}
</script>
<script>
{js('docx.js')}
{js('documents.js')}
</script>
<script>
{js('backend.js')}
</script>
<script>
{js('app.js')}
</script>
</body>
</html>
'''
(root / 'index.html').write_text(html, encoding='utf-8')
print('index.html', len(html.encode()) // 1024, 'KB')

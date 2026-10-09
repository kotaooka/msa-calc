# docs/explanation.md（解説）を HTML にして index.html の <!--EXPLAIN-START--> ～ <!--EXPLAIN-END--> に埋め込む
#   pip install markdown
#   python tools/build.py
from pathlib import Path
import re, markdown
root = Path(__file__).resolve().parent.parent
md = (root / 'docs' / 'explanation.md').read_text(encoding='utf-8')
# 原文は入れ子のリストを 2 桁字下げで書いている。Python-Markdown は 4 桁を前提にするので倍にする
md = re.sub(r'^( +)', lambda m: m.group(1) * 2, md, flags=re.M)
html = markdown.markdown(md, extensions=['tables', 'fenced_code', 'sane_lists'])
idx = root / 'index.html'
s = idx.read_text(encoding='utf-8')
new, n = re.subn(r'<!--EXPLAIN-START-->.*?<!--EXPLAIN-END-->', lambda m: '<!--EXPLAIN-START-->\n' + html + '\n<!--EXPLAIN-END-->', s, flags=re.S)
assert n == 1, '埋め込み位置の目印が見つかりません'
idx.write_text(new, encoding='utf-8', newline='\n')
print('index.html に解説を埋め込みました')

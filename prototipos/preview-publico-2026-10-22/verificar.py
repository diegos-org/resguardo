from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import re, json

ROOT = Path(__file__).resolve().parent / 'site'
errors=[]; links=0; pages=list(ROOT.glob('*.html'))
class Check(HTMLParser):
    def handle_starttag(self,tag,attrs):
        global links
        attrs=dict(attrs)
        if tag=='form' and attrs.get('method','get').lower()!='get': errors.append('form writes data')
        for attr in ['href','src','action']:
            value=attrs.get(attr)
            if not value:continue
            url=urlsplit(value)
            if url.scheme or not url.path:continue
            links+=1
            if not (ROOT/url.path).is_file():errors.append(f'{page.name}: missing {value}')
for page in pages:
    html=page.read_text(); Check().feed(html)
    assert 'sem reservas ou pagamentos' in html and 'noindex,nofollow' in html
    assert 'images/places/' not in html
    assert 'https://www.suacasaleblon.com/termos' in html
assert len(pages)==8
for file in ROOT.glob('*.js'):
    assert not re.search(r'\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage',file.read_text())
assert "connect-src 'none'" in (ROOT/'vercel.json').read_text()
assert not list(ROOT.rglob('.env*'))
assert not errors, errors
print(json.dumps({'pages':len(pages),'local_references_checked':links,'errors':errors,'network_writes':'absent; CSP connect-src none'},ensure_ascii=False))

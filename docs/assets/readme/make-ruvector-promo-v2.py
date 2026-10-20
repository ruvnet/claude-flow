"""Generate a 20-second RuVector capability trailer with outlined display type."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import os,math
f=TTFont(os.environ.get('RUFLO_DISPLAY_FONT','/usr/share/fonts/opentype/urw-base35/NimbusSansNarrow-Bold.otf'));g=f.getGlyphSet();c=f.getBestCmap()
def title(t,x,y,size,color):
 pen=SVGPathPen(g);a=0;k=size/f['head'].unitsPerEm
 for ch in t:
  n=c.get(ord(ch),'.notdef');g[n].draw(TransformPen(pen,(k,0,0,-k,a,0)));a+=g[n].width*k+.5
 return f'<g transform="translate({x} {y})" aria-label="{t}"><path d="{pen.getCommands()}" fill="{color}"/></g>'
css='''text{font-family:Arial,Helvetica,sans-serif}.scene{opacity:0;animation:scene 20s linear infinite}.first{opacity:1}.type{animation:rise 5s cubic-bezier(.2,.8,.2,1) infinite}.flow{stroke-dasharray:5 22;animation:flow 3s linear infinite}.orbit{transform-origin:758px 167px;animation:orbit 16s linear infinite}.scan{animation:scan 5s ease-in-out infinite}.pulse{animation:pulse 3s ease-in-out infinite}.progress{stroke-dasharray:176;animation:progress 5s linear infinite}.nav{animation:nav 20s linear infinite}@keyframes scene{0%,22%{opacity:1}25%,99.99%{opacity:0}100%{opacity:1}}@keyframes rise{0%{transform:translateY(20px);opacity:.2}12%,90%{transform:translateY(0);opacity:1}100%{transform:translateY(-8px);opacity:.3}}@keyframes flow{to{stroke-dashoffset:-108}}@keyframes orbit{to{transform:rotate(360deg)}}@keyframes scan{0%,100%{transform:translateY(-44px)}50%{transform:translateY(55px)}}@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}@keyframes progress{from{stroke-dashoffset:176}to{stroke-dashoffset:0}}@keyframes nav{0%,22%{fill:#ffe33b}25%,100%{fill:#597586}}@media(prefers-reduced-motion:reduce){*{animation:none!important}.scene{display:none}.first{display:inline;opacity:1}.type{opacity:1}}'''
s=f'''<svg xmlns="http://www.w3.org/2000/svg" width="960" height="340" viewBox="0 0 960 340" role="img" aria-labelledby="t d"><title id="t">RuVector: search meaning, remember context, connect knowledge, learn from feedback</title><desc id="d">20 second illustrative capability trailer. Local semantic embeddings and vector retrieval; persistent agent memory; graph relationships; learning from recorded outcomes and explicit feedback. Rust native. No live metrics.</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#111e32"/><stop offset="1" stop-color="#03080e"/></linearGradient><radialGradient id="aura"><stop stop-color="#006775" stop-opacity=".35"/><stop offset="1" stop-color="#006775" stop-opacity="0"/></radialGradient></defs><style>{css}</style><rect x="1" y="1" width="958" height="338" rx="10" fill="url(#bg)" stroke="#2f485b"/><path d="M650 1H959V339H572Z" fill="#07151f"/><circle cx="758" cy="167" r="165" fill="url(#aura)"/><path d="M24 22H320M24 22V56M936 282V318H897" fill="none" stroke="#ff36a0" stroke-width="2"/><text x="38" y="49" fill="#f3f6ff" font-size="23" font-weight="700" letter-spacing="-1">RuVector</text><text x="166" y="48" fill="#ff79bd" font-size="10" letter-spacing="2.2">RUST NATIVE / AGENT INTELLIGENCE</text>'''
scenes=[('SEARCH','MEANING.','Local embeddings turn text into searchable context.','Retrieve related vectors where your agents work.'),('REMEMBER','CONTEXT.','Persist useful knowledge across agent sessions.','Recall decisions, episodes and procedures.'),('CONNECT','KNOWLEDGE.','Represent relationships between entities.','Combine vector retrieval with graph context.'),('LEARN FROM','FEEDBACK.','Record outcomes. Retain useful patterns.','Learning needs explicit feedback, not reads alone.')]
for i,(a,b,sub,sub2) in enumerate(scenes):
 s+=f'<g class="scene {"first" if i==0 else ""}" style="animation-delay:{i*5}s"><g class="type">{title(a,34,133,66,"#f4f6ef")}{title(b,34,199,66,"#ffe43b")}</g><text x="38" y="235" fill="#b4ccdc" font-size="16">{sub}</text><text x="38" y="260" fill="#8fadc2" font-size="14">{sub2}</text>'
 if i==0:
  s+='<g stroke="#287386" fill="none"><ellipse cx="758" cy="166" rx="127" ry="62"/><ellipse cx="758" cy="166" rx="90" ry="113" transform="rotate(34 758 166)"/><ellipse cx="758" cy="166" rx="90" ry="113" transform="rotate(-34 758 166)"/></g><g class="orbit"><ellipse cx="758" cy="166" rx="112" ry="80" fill="none" stroke="#27eaff" stroke-width="2" stroke-dasharray="100 50"/></g>'
  for j in range(19):
   x=758+math.cos(j*2.4)*(25+j*4);y=166+math.sin(j*2.4)*(20+j*3.2);s+=f'<circle class="pulse" style="animation-delay:{j*.2}s" cx="{x}" cy="{y}" r="{3+j%3}" fill="{["#27eaff","#ffe33b","#ff47a6"][j%3]}"/>'
  s+='<path class="scan" d="M636 160H886" stroke="#ffe33b" stroke-width="2"/>'
 elif i==1:
  for j in range(3):
   y=88+j*51;s+=f'<rect x="663" y="{y}" width="192" height="43" rx="7" fill="#122936" stroke="#27a7bc"/><path class="flow" d="M681 {y+28}H837" stroke="#27eaff"/><text x="681" y="{y+18}" fill="#ffe33b" font-size="11" letter-spacing="2">{["DECISIONS","EPISODES","PROCEDURES"][j]}</text>'
  s+='<path class="flow" d="M874 97V247H652V97" fill="none" stroke="#ff479f" stroke-width="2"/>'
 elif i==2:
  pts=[(758,165),(657,96),(852,102),(869,231),(662,237),(751,67),(752,264)]
  for x,y in pts[1:]:s+=f'<path class="flow" d="M758 165L{x} {y}" stroke="#27eaff" stroke-width="2"/>'
  for j,(x,y) in enumerate(pts):s+=f'<circle class="pulse" style="animation-delay:{j*.3}s" cx="{x}" cy="{y}" r="{23 if j==0 else 12}" fill="#112b3c" stroke="{ "#ffe33b" if j==0 else "#27eaff"}" stroke-width="2"/>'
 else:
  s+='<g class="orbit"><circle cx="758" cy="167" r="95" fill="none" stroke="#27eaff" stroke-width="3" stroke-dasharray="160 39"/><circle cx="853" cy="167" r="7" fill="#ffe43b"/></g><path d="M726 166L748 188L793 138" fill="none" stroke="#ffe43b" stroke-width="5"/><text x="758" y="58" text-anchor="middle" fill="#ff79bd" font-size="12" letter-spacing="2">OUTCOMES → PATTERNS</text><text x="758" y="286" text-anchor="middle" fill="#9cbccd" font-size="11">Explicit feedback loop</text>'
 s+='</g>'
s+='<path d="M38 284H547" stroke="#294352"/>'
for i,label in enumerate(['SEARCH','MEMORY','GRAPH','LEARN']):s+=f'<text class="nav" style="animation-delay:{i*5}s" x="{38+i*124}" y="307" fill="#597586" font-size="10" letter-spacing="1.5">0{i+1} / {label}</text>'
s+='<rect x="650" y="300" width="230" height="26" rx="4" fill="#12323b" stroke="#228e9f"/><text x="671" y="318" fill="#7af8ff" font-size="12" font-weight="700" letter-spacing="1">EXPLORE RUVECTOR →</text><path class="progress" d="M677 334H853" stroke="#ff36a0" stroke-width="2"/></svg>'
Path(__file__).with_name('ruvector-promo-v2.svg').write_text(s)

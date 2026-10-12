"""Vector replay of theme-demo.mts cell frames, with no scripts or external assets."""
import sys, json, hashlib
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

root=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/ruflo-console-demo')
frames=json.loads((root/'frames.json').read_text())
width=1208
height=120+max(len(f['rows']) for f in frames)*19
height+=height%2
fps=12;duration=len(frames)/fps
font=TTFont('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
glyphset=font.getGlyphSet();cmap=font.getBestCmap();upm=font['head'].unitsPerEm
glyphs={};rows={};parts=[]
def glyph(ch,size=16):
 key=(ch,size)
 if key not in glyphs:
  pen=SVGPathPen(glyphset);glyphset[cmap.get(ord(ch),'.notdef')].draw(pen)
  ident=f'g{ord(ch):x}_{size}'
  glyphs[key]=(ident,f'<g id="{ident}" transform="translate(0,{15 if size==16 else 12}) scale({size/upm}, {-size/upm})"><path d="{pen.getCommands()}"/></g>')
 return glyphs[key][0]
def lettering(s,x,y,color,size=16):
 advance=9.6328125 if size==16 else 7.224609375
 return f'<g fill="{color}" transform="translate({x},{y})">'+''.join(f'<use href="#{glyph(ch,size)}" x="{i*advance:g}"/>' for i,ch in enumerate(s) if ch!=' ')+'</g>'
def row_id(cells):
 key=tuple((c['ch'],c['fg'],c.get('bg')) for c in cells)
 if key in rows:return rows[key][0]
 ident=f'r{len(rows)}';out=[]
 start=0
 while start<len(cells):
  color=cells[start].get('bg');end=start+1
  while end<len(cells) and cells[end].get('bg')==color:end+=1
  if color:out.append(f'<path fill="{color}" d="M{start*10} 0h{(end-start)*10}v19H{start*10}z"/>')
  start=end
 for x,c in enumerate(cells):
  ch=c['ch'];fg=c['fg']
  if ch in ['█','▀','▄']:
   y=9 if ch=='▄' else 0;h=9 if ch=='▀' else 10 if ch=='▄' else 19
   out.append(f'<path fill="{fg}" d="M{x*10} {y}h10v{h}h-10z"/>')
  elif ch!=' ':out.append(f'<use href="#{glyph(ch)}" x="{x*10}" fill="{fg}"/>')
 rows[key]=(ident,f'<g id="{ident}">'+''.join(out)+'</g>')
 return ident
for n,f in enumerate(frames):
 start=n/len(frames);end=(n+1)/len(frames)
 if n==0:times=f'0;{end:.12f};1';values='visible;hidden;hidden'
 elif n==len(frames)-1:times=f'0;{start:.12f};1';values='hidden;visible;visible'
 else:times=f'0;{start:.12f};{end:.12f};1';values='hidden;visible;hidden;hidden'
 out=[f'<g id="frame{n}" visibility="{ "visible" if n==0 else "hidden"}"><animate attributeName="visibility" calcMode="discrete" values="{values}" keyTimes="{times}" dur="{duration:g}s" repeatCount="indefinite"/>',f'<path fill="{f["bg"]}" d="M0 0h{width}v{height}H0z"/>']
 out.append(lettering('RUFLO / COMPLETE THEME WORKFLOW',24,16,f['accent']))
 out.append(lettering(f['caption'],24,45,'#a8b2bd',12))
 out.append(f'<path stroke="{f["accent"]}" d="M24 68H{width-24}"/>')
 left=24+(116-f['columns'])*5
 for y,row in enumerate(f['rows']):out.append(f'<use href="#{row_id(row)}" x="{left}" y="{78+y*19}"/>')
 out.append(f'<path stroke="{f["accent"]}" stroke-width="2" d="M24 {height-35}H{24+(width-48)*(n+1)/len(frames):.4f}"/>')
 out.append(lettering('RENDERER DEMO / real UI actions + disk persistence / native host and AI generation unverified',24,height-23,'#a8b2bd',12))
 out.append('</g>');parts.append(''.join(out))
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc"><title id="title">Ruflo console theme workflow</title><desc id="desc">38 second replay of actual renderer frames. Boot, six presets, customization, persistence, JSON import and resize. Native host and AI provider execution are unverified.</desc><defs>'+''.join(v[1] for v in glyphs.values())+''.join(v[1] for v in rows.values())+'</defs>'+''.join(parts)+'</svg>'
path=root/'ruflo-console-demo.svg';path.write_text(svg)
print(json.dumps({'file':str(path),'bytes':path.stat().st_size,'frames':len(frames),'seconds':duration,'rowSymbols':len(rows),'glyphSymbols':len(glyphs),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}))

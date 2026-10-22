"""Generate the conceptual Ruflo learning slideshow. No browser scripts required."""
from pathlib import Path
from math import sin, cos, pi
from html import escape
import xml.etree.ElementTree as ET
P=Path(__file__).parent
slides=[
('THE COMPLETE LOOP','Experience becomes context.','User → CLI / MCP → Router → Swarm','Agents → Memory → LLM providers','#39eaff','ROUTE','EXECUTE','REMEMBER'),
('01 / RECALL','Start with useful memory.','Retrieve related context and prior outcomes.','Relevant experience informs the next task.','#39eaff','QUERY','RETRIEVE','CONTEXT'),
('02 / EXECUTE','Coordinate the work.','The router assigns work across the swarm.','Agents use tools, memory and LLM providers.','#bd8aff','ROUTER','SWARM','AGENTS'),
('03 / EVALUATE','Turn outcomes into feedback.','Check task results against explicit criteria.','Record success, failure and useful corrections.','#ffcc66','RESULT','CHECK','FEEDBACK'),
('04 / RETAIN','Keep what helps next time.','Store useful trajectories and task feedback.','Memory makes experience available for recall.','#52f2b1','EPISODE','MEMORY','RECALL'),
('05 / ADAPT','Close the learning loop.','Use retained feedback to inform future routing.','Evaluate the next result. Repeat the cycle.','#ff74c9','FEEDBACK','ROUTING','NEXT TASK')]
out=['<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720" role="img" aria-labelledby="title desc"><title id="title">Ruflo self learning architecture</title><desc id="desc">Six conceptual scenes: architecture, recall, execute, evaluate, retain and adapt. Feedback recorded in memory informs future routing. This is an illustration, not live telemetry or a claim of automatic model training.</desc><defs><radialGradient id="halo"><stop stop-color="#16344d"/><stop offset="1" stop-color="#050912"/></radialGradient><linearGradient id="edge"><stop stop-color="#39eaff"/><stop offset=".5" stop-color="#bd8aff"/><stop offset="1" stop-color="#ff74c9"/></linearGradient></defs>']
css='text{font-family:Arial,Helvetica,sans-serif}.scene{opacity:0;animation:scene 42s linear infinite}.wire{fill:none;stroke-width:1.2}.trail{stroke-dasharray:10 20;animation:trail 2s linear infinite}@keyframes trail{to{stroke-dashoffset:-60}}@keyframes scene{0%,1%{opacity:0}2%,14.8%{opacity:1}16.5%,100%{opacity:0}}'
for i in range(6): css+=f'.s{i}{{animation-delay:-{42-i*7}s}}'
css+='@media(prefers-reduced-motion:reduce){.scene{animation:none;opacity:0}.s0{opacity:1}.motion{display:none}.trail{animation:none}}'
out+=['<style>'+css+'</style>','<rect width="960" height="720" rx="24" fill="#050912"/><rect x="1" y="1" width="958" height="718" rx="23" fill="none" stroke="#263746"/><ellipse cx="480" cy="348" rx="420" ry="235" fill="url(#halo)"/>']
for y in range(220,520,30):out.append(f'<path d="M40 {y}H920" stroke="#192a3a" opacity=".3"/>')
for x in range(80,960,80):out.append(f'<path d="M480 200L{x} 525" stroke="#192a3a" opacity=".35"/>')
out.append('<text x="40" y="43" fill="#a0b8ca" font-size="18" letter-spacing="4">RUFLO / SELF LEARNING ARCHITECTURE</text><text x="920" y="43" text-anchor="end" fill="#6e8b9e" font-size="15">CONCEPTUAL</text>')
def point(i,j,kind):
 a=2*pi*i/12;b=2*pi*j/4
 if kind==0:return (135*cos(a)*(1+.22*cos(b)),100*sin(b),135*sin(a)*(1+.22*cos(b)))
 if kind==1:return (150*cos(a)*sin((j+1)*pi/5),150*cos((j+1)*pi/5),150*sin(a)*sin((j+1)*pi/5))
 if kind==2:return ((i%4-1.5)*85,(j-1.5)*63,(i//4-1)*85)
 if kind==3:return ((90+40*cos(b))*cos(a),80*sin(b),(90+40*cos(b))*sin(a))
 if kind==4:return (140*cos(a), (j-1.5)*63,140*sin(a))
 return (125*cos(a+j*.6),(j-1.5)*66+28*sin(a),125*sin(a+j*.6))
def project(p,t):
 x,y,z=p;r=t*2*pi;x,z=x*cos(r)+z*sin(r),-x*sin(r)+z*cos(r);y,z=y*cos(.3)-z*sin(.3),y*sin(.3)+z*cos(.3);s=650/(650+z)
 return (480+x*s,347+y*s,s)
for k,(label,title,l1,l2,color,*chips) in enumerate(slides):
 out.append(f'<g class="scene s{k}"><text x="40" y="87" fill="{color}" font-size="20" letter-spacing="3">{label}</text><text x="40" y="141" fill="#f0f7ff" font-size="46" font-weight="700" letter-spacing="-1.5">{title}</text>')
 pts=[point(i,j,k) for j in range(4) for i in range(12)];frames=[[project(p,f/24) for f in range(25)] for p in pts]
 edges=[(j*12+i,j*12+(i+1)%12) for j in range(4) for i in range(12)]+[(j*12+i,(j+1)*12+i) for j in range(3) for i in range(12)]
 out.append(f'<ellipse cx="480" cy="512" rx="214" ry="22" fill="none" stroke="{color}" opacity=".2"/><g stroke="{color}" class="wire">')
 for a,b in edges:
  vals=[f'M{frames[a][f][0]:.1f} {frames[a][f][1]:.1f}L{frames[b][f][0]:.1f} {frames[b][f][1]:.1f}' for f in range(25)]
  out.append(f'<path d="{vals[0]}" opacity=".36"><animate class="motion" attributeName="d" values="'+ ';'.join(vals)+'" dur="18s" repeatCount="indefinite"/></path>')
 out.append('</g>')
 for n,fs in enumerate(frames):
  out.append(f'<circle cx="{fs[0][0]:.1f}" cy="{fs[0][1]:.1f}" r="{4 if n%5==0 else 2.5}" fill="{color}">')
  for a,idx in [('cx',0),('cy',1)]:out.append(f'<animate class="motion" attributeName="{a}" values="'+ ';'.join(f'{p[idx]:.1f}' for p in fs)+'" dur="18s" repeatCount="indefinite"/>')
  out.append('</circle>')
 out.append(f'<path class="trail" d="M90 330C160 195 800 195 870 330C800 495 160 495 90 330" fill="none" stroke="{color}" stroke-width="2" opacity=".55"/>')
 for j,chip in enumerate(chips):
  x=42+j*310
  out.append(f'<rect x="{x}" y="542" width="256" height="46" rx="10" fill="#0d1826" stroke="{color}" stroke-opacity=".6"/><text x="{x+128}" y="573" text-anchor="middle" fill="{color}" font-size="22" font-weight="700">{chip}</text>')
  if j<2:out.append(f'<path d="M{x+268} 565h26m-8 -7 8 7 -8 7" fill="none" stroke="{color}" stroke-width="2"/>')
 out.append(f'<text x="480" y="627" text-anchor="middle" fill="#e0eaf4" font-size="27">{escape(l1)}</text><text x="480" y="665" text-anchor="middle" fill="#a5b9cd" font-size="25">{escape(l2)}</text>')
 for j in range(6):out.append(f'<rect x="{360+j*41}" y="693" width="30" height="4" rx="2" fill="{color if j==k else "#253443"}"/>')
 out.append('</g>')
out.append('</svg>');svg=''.join(out);ET.fromstring(svg);(P/'learning-architecture-slideshow.svg').write_text(svg)
print(f'Generated {len(svg):,} bytes; XML valid; 6 slides; 42 seconds.')

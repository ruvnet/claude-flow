"""Generate the README's self-contained vector illustrations. Run with Python 3."""
from pathlib import Path
from html import escape as e
import os, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
# Outlined display typography needs no remote fonts in GitHub image rendering.
# Set RUFLO_DISPLAY_FONT to a Nimbus Sans Narrow Bold OTF on other systems.
_font=TTFont(os.environ.get('RUFLO_DISPLAY_FONT','/usr/share/fonts/opentype/urw-base35/NimbusSansNarrow-Bold.otf'))
_glyphs=_font.getGlyphSet(); _cmap=_font.getBestCmap(); _upm=_font['head'].unitsPerEm
def display(text,x,y,size,color='#f5f3e8',spacing=.5,center=False):
 scale=size/_upm; pen=SVGPathPen(_glyphs); advance=0
 for char in text:
  name=_cmap.get(ord(char),'.notdef')
  _glyphs[name].draw(TransformPen(pen,(scale,0,0,-scale,advance,0)))
  advance+=_glyphs[name].width*scale+spacing
 if center: x-=advance/2
 return f'<g transform="translate({x} {y})" aria-label="{e(text)}"><path d="{pen.getCommands()}" fill="{color}"/></g>'

P=Path(__file__).parent
CSS='''text{font-family:Arial,Helvetica,sans-serif}.mono{font-family:monospace}.flow{stroke-dasharray:12 40;animation:flow 5s linear infinite;filter:url(#glow)}.tube{filter:url(#glow);animation:flicker 13s linear infinite}.tube2{filter:url(#glow);animation:flicker 17s 3s linear infinite}.gold{fill:#ffe64c;filter:url(#soft)}@keyframes flicker{0%,43%,45%,47%,100%{opacity:1}44%,46%{opacity:.55}}.orbit{transform-box:fill-box;transform-origin:center;animation:spin 14s linear infinite}.pulse{animation:pulse 3s ease-in-out infinite}.rise{animation:rise 7s ease-in-out infinite}@keyframes flow{to{stroke-dashoffset:-208}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:.45}50%{opacity:1}}@keyframes rise{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}'''
CSS += '''.rim{stroke-dasharray:90 390;animation:rim 9s linear infinite;filter:url(#glow)}.sweep{animation:sweep 8s ease-in-out infinite;opacity:.18}.halo{transform-box:fill-box;transform-origin:center;animation:halo 4s ease-out infinite}.equalizer{transform-box:fill-box;transform-origin:bottom;animation:eq 1.6s ease-in-out infinite alternate}@keyframes rim{to{stroke-dashoffset:-960}}@keyframes sweep{0%,100%{transform:translateX(-200px);opacity:0}30%,70%{opacity:.18}85%{transform:translateX(1100px);opacity:0}}@keyframes halo{0%{transform:scale(.8);opacity:0}25%{opacity:.4}100%{transform:scale(1.25);opacity:0}}@keyframes eq{from{transform:scaleY(.3)}to{transform:scaleY(1)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}.sweep,.halo{display:none}}'''
def svg(name,w,h,title,body):
 # Keep compact interface labels as text; outline only display headlines.
 def outline(match):
  attrs,txt=match.group(1),match.group(2)
  if 'class="gold"' not in attrs: return match.group(0)
  x=float(re.search(r'x="([0-9.]+)"',attrs).group(1)); y=float(re.search(r'y="([0-9.]+)"',attrs).group(1))
  size=float(re.search(r'font-size="([0-9.]+)"',attrs).group(1))
  return display(txt,x,y,size*1.1)
 body=re.sub(r'<text ([^>]+)>([^<]+)</text>',outline,body)
 s=f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{e(title)}</title><desc id="desc">Illustrative Ruflo artwork. Motion is decorative; no live metrics. Supports reduced motion.</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#181821"/><stop offset="1" stop-color="#101018"/></linearGradient><linearGradient id="neon"><stop stop-color="#27eaff"/><stop offset=".55" stop-color="#ffe32e"/><stop offset="1" stop-color="#ff168f"/></linearGradient><filter id="glow" x="-60%" y="-100%" width="220%" height="300%"><feGaussianBlur stdDeviation="3"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="soft" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="1.5"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><pattern id="grid" width="96" height="48" patternUnits="userSpaceOnUse"><path d="M0 0H96M0 24H96M48 0V24M0 24V48M96 24V48" fill="none" stroke="#8d6683" stroke-opacity=".04"/></pattern></defs><style>{CSS}</style><rect x="1" y="1" width="{w-2}" height="{h-2}" rx="18" fill="url(#bg)" stroke="#26364e"/><rect width="{w}" height="{h}" rx="18" fill="url(#grid)"/><rect x="10" y="10" width="{w-20}" height="{h-20}" rx="14" fill="none" stroke="#ff168f" stroke-width="2.5" class="tube"/><rect x="13" y="13" width="{w-26}" height="{h-26}" rx="12" fill="none" stroke="#ff9ad0" stroke-opacity=".5" stroke-width=".7"/><rect class="rim" x="10" y="10" width="{w-20}" height="{h-20}" rx="14" fill="none" stroke="#ffc0e5" stroke-width="1.4"/>{body}</svg>'''
 (P/(name+'.svg')).write_text(s)
def icon(kind,x,y):
 shapes={
 'swarm':'<path d="M0 0L-30 -22M0 0L30 -22M0 0L-30 24M0 0L30 24"/><circle r="10"/><circle cx="-30" cy="-22" r="6"/><circle cx="30" cy="-22" r="6"/><circle cx="-30" cy="24" r="6"/><circle cx="30" cy="24" r="6"/>',
 'memory':'<ellipse cy="-22" rx="28" ry="10"/><path d="M-28 -22V22C-28 36 28 36 28 22V-22M-28 0C-28 14 28 14 28 0"/><path class="flow" d="M-40 0H-29M29 0H45"/>',
 'learn':'<path d="M-24 15A28 28 0 1 1 25 13M25 13V-1M25 13H11"/><path d="M-17 8L-5 -6L7 3L18 -14"/><circle cx="-17" cy="8" r="3"/>',
 'shield':'<path d="M0 -32L28 -20V0Q27 22 0 36Q-27 22 -28 0V-20Z"/><path d="M-13 0L-3 10L16 -12"/>',
 'terminal':'<rect x="-34" y="-26" width="68" height="52" rx="6"/><path d="M-22 -9L-11 0L-22 9M-3 12H18"/><path d="M-34 -15H34"/>',
 'plugins':'<path d="M-26 -26H-7C-15 -44 15 -44 7 -26H26V-7C44 -15 44 15 26 7V26H7C15 8 -15 8 -7 26H-26Z"/>',
 'federation':'<circle r="30"/><ellipse rx="13" ry="30"/><path d="M-30 0H30M-25 -16H25M-25 16H25"/>',
 'book':'<path d="M0 -22Q-18 -32 -32 -23V26Q-18 16 0 26Q18 16 32 26V-23Q18 -32 0 -22V26"/>',
 }
 return f'<g transform="translate({x} {y})"><circle class="pulse" r="49" fill="#36e5e9" fill-opacity=".045"/><g class="tube2" fill="none" stroke="#26eaff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">{shapes[kind]}</g><circle class="halo" r="50" fill="none" stroke="#27eaff" stroke-width="1"/><circle class="orbit" style="animation-direction:reverse;animation-duration:21s" r="53" fill="none" stroke="#ffe64c" stroke-width="1" stroke-dasharray="3 28"/><circle class="orbit" r="43" fill="none" stroke="#ff168f" stroke-width="1.5" stroke-dasharray="26 109" opacity=".7"/></g>'
headers=[('console','MISSION CONTROL','See the work. Inspect the decisions. Stay in control.','terminal'),('quick-start','START BUILDING','Choose your install path. Give your agents a harness.','terminal'),('capabilities','YOUR AGENT TOOLKIT','Coordinate teams. Recall context. Verify the work.','swarm'),('federation','CONNECTED INTELLIGENCE','Identity, trust and shared work across machines.','federation'),('documentation','GO DEEPER','Guides, architecture, benchmarks and verification.','book'),('support','BUILD WITH THE COMMUNITY','Find answers. Share ideas. Move the ecosystem forward.','swarm')]
for i,(name,title,sub,kind) in enumerate(headers):
 body=f'<path d="M24 165H936" stroke="url(#neon)" stroke-opacity=".25"/><path class="flow" d="M24 165H936" stroke="url(#neon)"/><text x="30" y="33" fill="#ff80c2" font-size="11" letter-spacing="3">RUFLO / {i+1:02d}</text><text x="30" y="76" class="gold" font-size="30" font-weight="700" letter-spacing="1">{e(title)}</text><text x="31" y="105" fill="#aabbd2" font-size="16">{e(sub)}</text>{icon(kind,850,68)}<path d="M735 28H774M735 34H760M916 103H933" stroke="#ffe32e" opacity=".4"/>'
 labels={
  'console':['OBSERVE','INSPECT','CONTROL'], 'quick-start':['INSTALL','INITIALIZE','BUILD'],
  'capabilities':['COORDINATE','REMEMBER','VERIFY'], 'federation':['IDENTITY','POLICY','EXCHANGE'],
  'documentation':['EXPLORE','REPRODUCE','VERIFY'], 'support':['CONNECT','CONTRIBUTE','CREATE']}
 body += '<g opacity=".7">' + ''.join(f'<rect class="equalizer" style="animation-delay:{j*.17}s" x="{745+j*9}" y="{139-j%3*5}" width="3" height="{10+j%3*5}" rx="1" fill="{["#ff168f","#27eaff","#ffe64c"][j%3]}"/>' for j in range(18)) + '</g>'
 for j,label in enumerate(labels[name]):
  x=31+j*168
  body+=f'<rect x="{x}" y="125" width="150" height="25" rx="5" fill="#131d2c" stroke="#364d5d"/><circle class="pulse" style="animation-delay:{j}s" cx="{x+12}" cy="137" r="3" fill="#27eaff"/><text x="{x+25}" y="141" fill="#b9d4e3" font-size="10" letter-spacing="1.3">{label}</text>'
 svg(name,960,184,title,body)
cards=[('swarm','Agent teams','Coordinate specialized agents.','Share tasks and context.','swarm'),('memory','Persistent memory','Retrieve useful context.','Carry knowledge across sessions.','memory'),('learning','Learning loops','Capture successful patterns.','Use feedback on future tasks.','learn'),('security','Security controls','Inspect inputs and tool access.','Keep decisions auditable.','shield'),('plugins','Plugin ecosystem','Add plugins, skills and tools.','Build the setup your team needs.','plugins'),('routing','Models and routing','Connect model providers.','Route work through your harness.','terminal')]
for i,(name,title,a,b,kind) in enumerate(cards):
 body=icon(kind,64,66)+f'<text x="126" y="45" fill="#ff80c2" font-size="10" letter-spacing="2">RUFLO / CAPABILITY</text><text x="126" y="78" class="gold" font-size="23" font-weight="700">{title}</text><text x="27" y="145" fill="#b2c4d9" font-size="17">{a}</text><text x="27" y="171" fill="#b2c4d9" font-size="17">{b}</text><path d="M27 207H421" stroke="#22364e"/><path class="flow" d="M27 207H421" stroke="url(#neon)" stroke-width="2"/><circle class="pulse" cx="421" cy="207" r="4" fill="#50e9ec"/>'
 svg('card-'+name,448,232,title,body)
svg('signal-divider',960,44,'Ruflo signal divider','<path d="M20 22H390L410 10H550L570 22H940" fill="none" stroke="#294359"/><path class="flow" d="M20 22H390L410 10H550L570 22H940" fill="none" stroke="url(#neon)"/><text x="480" y="31" text-anchor="middle" fill="#80a9bf" font-size="10" letter-spacing="3">RUFLO</text>')

# Diagram edges are illustrative data paths, not a live execution recording.
CSS += '''.packet{stroke-dasharray:7 93;stroke-dashoffset:7;opacity:0;stroke-linecap:round;animation:packet 12s linear infinite;filter:url(#glow)}.active{animation:active 12s ease-in-out infinite}.scan{animation:scan 6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}@keyframes packet{0%{stroke-dashoffset:7;opacity:0}1%{opacity:1}12.4%{stroke-dashoffset:-100;opacity:1}12.5%,100%{stroke-dashoffset:-100;opacity:0}}@keyframes active{0%,14%,100%{stroke:#29d9ed;fill:#141b29}1%,10%{stroke:#ffe649;fill:#33301b}}@keyframes scan{0%,100%{opacity:.2}50%{opacity:1}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}'''
def node(x,y,title,sub,n=0,color='#29d9ed'):
 return f'<g><rect class="active" style="animation-delay:{n*1.5}s" x="{x-93}" y="{y-39}" width="186" height="78" rx="12" fill="#141b29" stroke="{color}" stroke-width="1.5"/><path d="M{x-91} {y-25}V{y+25}" stroke="#ff168f" stroke-width="3"/><text x="{x-80}" y="{y-22}" fill="#ff80c2" font-size="9" font-family="monospace">{n+1:02d}</text><path d="M{x-80} {y+33}H{x+80}" stroke="#27eaff" stroke-opacity=".15"/>{display(title,x,y-3,23,center=True)}<text x="{x}" y="{y+22}" text-anchor="middle" fill="#bbcddd" font-size="13">{e(sub)}</text></g>'
edge_index=0
def edge(d,color='#27eaff',delay=None):
 global edge_index
 if delay is None: delay=edge_index*1.5
 edge_index+=1
 return f'<path d="{d}" fill="none" stroke="{color}" stroke-opacity=".25" stroke-width="2" marker-end="url(#arrow)"/><path class="packet" style="animation-delay:{delay}s" d="{d}" pathLength="100" fill="none" stroke="{color}" stroke-width="4"/>'
def heading(title,sub):
 global edge_index
 edge_index=0
 return f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="#85cddd" stroke-width="1.5"/></marker></defs><text x="32" y="45" class="gold" font-size="26" font-weight="700">{e(title)}</text><text x="32" y="73" fill="#b6c5db" font-size="15">{e(sub)}</text>'
b=heading('SELF-LEARNING AGENT ARCHITECTURE','Follow a task through the harness. Return useful experience to future routing.')
for d in ['M223 146H267','M453 146H497','M683 146H727','M820 185V259','M727 298H683','M497 298H453']:
 b+=edge(d)
b+=edge('M550 259V219H590V185','#ff168f',7.5)
b+='<text x="457" y="213" fill="#ff80c2" font-size="13" text-anchor="end">Learning feedback</text>'
for i,(x,y,t,s) in enumerate([(130,146,'User','Goal + constraints'),(360,146,'Ruflo','CLI / MCP entry point'),(590,146,'Router','Select a work path'),(820,146,'Swarm','Coordinate the team'),(820,298,'Agents','Execute specialized work'),(590,298,'Memory','Recall + store context'),(360,298,'LLM providers','Model access')]):b+=node(x,y,t,s,i)
b+='<text x="32" y="379" fill="#8ea8bf" font-size="13">Conceptual flow • Cyan: task and context • Pink: feedback • No live metrics</text>'
svg('architecture-flow',960,404,'Self-learning agent architecture: user, Ruflo, router, swarm, agents, memory and LLM providers; memory feeds routing.',b)
b=heading('EXPERIENCE BECOMES CONTEXT','An illustrative learning cycle: capture, evaluate, retain and reuse.')
for d in ['M258 150H387','M573 150H702','M795 189V267','M702 306H573','M387 306H258','M165 267V189']:b+=edge(d,'#ff45a1')
for i,(x,y,t,s) in enumerate([(165,150,'Recall','Find related experience'),(480,150,'Execute','Tools + agent actions'),(795,150,'Evaluate','Tests + task feedback'),(795,306,'Store','Keep useful trajectories'),(480,306,'Adapt','Update reusable patterns'),(165,306,'Reuse','Inform the next task')]):b+=node(x,y,t,s,i)
b+='<path class="flow" d="M322 228H638" stroke="#ffe32e" stroke-width="2"/><text x="480" y="217" text-anchor="middle" fill="#ffe64c" font-size="14">RECALL → ACTION → FEEDBACK</text><text x="32" y="379" fill="#8ea8bf" font-size="13">Learning quality depends on feedback and configuration; improvement is not guaranteed.</text>'
svg('learning-flow',960,404,'Illustrative learning cycle: recall, execute, evaluate, store, adapt and reuse.',b)
b=heading('FEDERATION / TRUST IN MOTION','A conceptual message path between agents on different machines.')
for d in ['M238 151H302','M488 151H552','M738 151H820V220H145V267','M238 306H302','M488 306H552']:b+=edge(d)
for i,(x,y,t,s) in enumerate([(145,151,'Outbound agent','Prepare shared work'),(395,151,'Filter data','Apply outbound policy'),(645,151,'Sign + encrypt','Protect the message'),(145,306,'Verify identity','Check the sender'),(395,306,'Inspect input','Apply trust + safety rules'),(645,306,'Receiving agent','Accept permitted work')]):b+=node(x,y,t,s,i)
b+='<text x="820" y="192" text-anchor="middle" fill="#ff80c2" font-size="12">TRUST BOUNDARY</text><text x="32" y="380" fill="#8ea8bf" font-size="13">Audit events accompany the exchange. Policies and trust levels determine permitted actions.</text>'
svg('federation-flow',960,404,'Federation message flow with data filtering, signing, encryption, identity and input checks.',b)

# Art-directed chapter slates: kinetic typography, restrained rails, orbital schematics.
MOTION=''' .headline{animation:headline 12s cubic-bezier(.2,.8,.2,1) infinite}.second{animation-delay:.16s}.rule{stroke-dasharray:610;animation:rule 12s ease-in-out infinite}.spin{transform-origin:800px 126px;animation:rot 24s linear infinite}.counter{animation-direction:reverse;animation-duration:36s}.beacon{animation:beacon 3s ease-in-out infinite}.stage{animation:stage 9s ease-in-out infinite}@keyframes headline{0%{transform:translateY(13px);opacity:.35}7%,92%{transform:translateY(0);opacity:1}100%{transform:translateY(0);opacity:.35}}@keyframes rule{0%{stroke-dashoffset:610}12%,90%{stroke-dashoffset:0}100%{stroke-dashoffset:-610}}@keyframes rot{to{transform:rotate(360deg)}}@keyframes beacon{0%,100%{opacity:.3}50%{opacity:1}}@keyframes stage{0%,33%,100%{fill:#7599ac}8%,25%{fill:#ffe649}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}'''
slates=[('console','MISSION','CONTROL','Your team. Every decision in view.',['OBSERVE','INSPECT','CONTROL'],'terminal'),('quick-start','FROM ZERO','TO RUFLO','Choose a path. Initialize. Start building.',['INSTALL','INITIALIZE','BUILD'],'terminal'),('capabilities','ONE HARNESS.','MANY MINDS.','Teams, memory and tools working together.',['COORDINATE','REMEMBER','VERIFY'],'swarm'),('federation','LOCAL AGENTS.','SHARED INTENT.','Work across machines with identity and policy.',['IDENTIFY','PROTECT','EXCHANGE'],'federation'),('documentation','UNDERSTAND.','THEN BUILD.','Explore the guides. Inspect the evidence.',['EXPLORE','REPRODUCE','VERIFY'],'book'),('support','BUILD WHAT','COMES NEXT.','Join the people moving the ecosystem forward.',['CONNECT','CONTRIBUTE','CREATE'],'swarm')]
for n,(name,line1,line2,subtitle,stages,kind) in enumerate(slates):
 body=f'<path d="M28 22H622M28 22V58M932 202V238H876" fill="none" stroke="#ff168f" stroke-width="2"/><text x="40" y="46" fill="#ff75b9" font-family="monospace" font-size="11" letter-spacing="3">RUFLO  /  CHAPTER {n+1:02d}</text><g class="headline">{display(line1,38,105,56)}</g><g class="headline second">{display(line2,38,164,56,"#ffe338")}</g><text x="40" y="195" fill="#a6bdca" font-family="Arial,sans-serif" font-size="16">{e(subtitle)}</text><path d="M40 211H616" stroke="#20384a"/><path class="rule" d="M40 211H616" stroke="#27eaff" stroke-width="2"/>'
 for j,label in enumerate(stages):
  body+=f'<text class="stage" style="animation-delay:{j*3}s" x="{40+j*192}" y="239" fill="#7599ac" font-family="monospace" font-size="11" letter-spacing="1.5">0{j+1} / {label}</text>'
 body+='<path d="M666 24V236" stroke="#223444"/><circle cx="800" cy="126" r="90" fill="#0a1720" stroke="#193341"/><g class="spin"><circle cx="800" cy="126" r="90" fill="none" stroke="#24e5f3" stroke-width="1.8" stroke-dasharray="160 406"/><circle cx="890" cy="126" r="4" fill="#eaffff"/></g><g class="spin counter"><circle cx="800" cy="126" r="74" fill="none" stroke="#ff168f" stroke-width="3" stroke-dasharray="35 81"/></g><circle cx="800" cy="126" r="103" fill="none" stroke="#527689" stroke-dasharray="1 17"/>'
 body+=icon(kind,800,126)
 body+=f'<text x="800" y="246" text-anchor="middle" fill="#7da8be" font-family="monospace" font-size="9" letter-spacing="3">{stages[0]} / {stages[-1]}</text>'
 # A soft diagonal panel adds depth without obscuring the letterforms.
 out=f'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="266" viewBox="0 0 960 266" role="img" aria-labelledby="title desc"><title id="title">{e(line1+" "+line2)}</title><desc id="desc">{e(subtitle)} Decorative motion, reduced motion supported. Display lettering uses vector outlines.</desc><defs><linearGradient id="panel" x2="1" y2="1"><stop stop-color="#111726"/><stop offset="1" stop-color="#05090f"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="2"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><style>{CSS}{MOTION}</style><rect x="1" y="1" width="958" height="264" rx="8" fill="url(#panel)" stroke="#263542"/><path d="M715 1H959V265H642Z" fill="#0b1320"/>{body}</svg>'
 (P/(name+'.svg')).write_text(out)

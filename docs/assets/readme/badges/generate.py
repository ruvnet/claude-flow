"""Regenerate the five README badges. Downloads use data/npm-downloads.latest.json; clone count preserves its existing snapshot."""
from pathlib import Path
from html import escape
import json
P=Path(__file__).parent
stats=json.loads((P.parents[3]/"data/npm-downloads.latest.json").read_text())
headline=f"{stats['total']/1e6:.2f}M / 12mo"
items=[('ruvector','RuVector','AGENTIC DB',215,'#27eaff','M-7 -5L0 0L7 -5M0 0V8M-7 -5V5L0 8L7 5V-5M-7 -5L0 -9L7 -5'),('downloads','Ecosystem',headline,262,'#ffe338','M0 -9V4M-5 -1L0 4L5 -1M-8 5V9H8V5'),('clones','Git clones','106k / 14d',217,'#ff3b9e','M-5 -7V6Q-5 9 0 9Q5 9 5 4V-2M-8 -7H-2M2 -5L5 -2L8 -5'),('claude','Claude Code','PLUGIN',214,'#ffe338','M0 -9V9M-9 0H9M-6 -6L6 6M-6 6L6 -6'),('codex','Codex','PLUGIN',170,'#27eaff','M-4 -6L-10 0L-4 6M4 -6L10 0L4 6')]
for name,label,value,w,color,icon in items:
 if name != 'ruvector': w=220
 split=109 if name=='ruvector' else 124
 desc=f'{label}: {value}. '+('Preserved README snapshot, not a live counter.' if name in ('downloads','clones') else 'Ruflo ecosystem link.')
 if name=='downloads': desc=f"{stats['total']:,} npm package downloads from {stats['start']} through {stats['end']}; six tracked packages. Not unique users."
 s=f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="32" viewBox="0 0 {w} 32" role="img" aria-labelledby="t d"><title id="t">{escape(label+' '+value)}</title><desc id="d">{escape(desc)}</desc><style>text{{font-family:Arial,Helvetica,sans-serif}}.signal{{stroke-dasharray:28 180;animation:travel 6s linear infinite}}.icon{{animation:glow 4s ease-in-out infinite}}@keyframes travel{{to{{stroke-dashoffset:-416}}}}@keyframes glow{{0%,100%{{opacity:.55}}50%{{opacity:1}}}}@media(prefers-reduced-motion:reduce){{*{{animation:none!important}}}}</style><rect x=".5" y=".5" width="{w-1}" height="31" rx="5" fill="#0b111d" stroke="#314151"/><path d="M{split} 5V27" stroke="#314151"/><path d="M6 30H{w-6}" stroke="{color}" stroke-opacity=".15"/><path class="signal" d="M6 30H{w-6}" stroke="{color}" stroke-width="1.2"/><g class="icon" transform="translate(18 16)" fill="none" stroke="{color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="{icon}"/></g><text x="35" y="20.5" fill="#e6edf6" font-size="12" font-weight="600">{label}</text><text x="{split+10}" y="20.5" fill="{color}" font-size="11" font-weight="700">{value}</text></svg>'''
 (P/(name+'.svg')).write_text(s)

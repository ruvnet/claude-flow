/** Reproducible renderer workflow demo. No native host or model invocation is simulated. */
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { newState } from '../hooks/state'
import { themesOf, themeActions, activeTheme, loadThemes, THEME_PRESETS } from '../hooks/themes'
import { paneView } from '../hooks/views/pane'
import { setBootChecks } from '../hooks/boot-checks'
import { selfCheckResults } from '../hooks/self-check'
import { picturesOf } from '../hooks/views/frames'
import { THEME } from '../hooks/views/common'
const output=process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(),'ruflo-console-demo-'))
mkdirSync(output,{recursive:true})
const storePath=resolve(output,'demo-session.json')
writeFileSync(storePath,'{}',{flag:'wx'})
const host:any={storeGet:async(key:string)=>JSON.parse(readFileSync(storePath,'utf8'))[key],storeSet:async(key:string,value:unknown)=>{const data=JSON.parse(readFileSync(storePath,'utf8'));data[key]=value;writeFileSync(storePath,JSON.stringify(data,null,2))},invalidate:()=>{}}
const fresh=()=>{const s=newState({look:'orbital',boot:false});Object.assign(s.pane,{rows:70,columns:116,isOpen:true,isShown:true,isFocused:true});s.view='menu';s.cwd='/demo/ruflo';return s}
let state=fresh(),columns=116
let actions=themeActions(state,host,()=>{throw Error('AI provider not connected in this renderer demo')})
setBootChecks(selfCheckResults())
const kit=Object.fromEntries(['Box','Text','Button','Input','Raster'].map(type=>[type,(props:any)=>({type,props})]))
const names:any={success:'#72c79b',error:'#ff6868',warning:'#e3ba74',suggestion:'#c6cbc8',claude:'#f06449'}
type C={ch:string,fg:string,bg?:string};type R=C[][]
let focus=''
const line=(s:string,fg:string,bg?:string):R=>[[...s].map(ch=>({ch,fg,bg}))]
const spaces=(n:number)=>Array.from({length:Math.max(0,n)},()=>({ch:' ',fg:THEME.info}))
function render(el:any,avail=columns):R {
 if(!el)return []
 if(typeof el==='string')return line(el,THEME.info)
 const p=el.props;if(!p||p.display==='none')return []
 if(el.type==='Raster'){const b=Buffer.from(p.cells,'base64');return Array.from({length:p.rows},(_,y)=>Array.from({length:p.columns},(_,x)=>{const at=(y*p.columns+x)*12;return {ch:String.fromCodePoint(b.readUInt32LE(at)),fg:'#'+(b.readUInt32LE(at+4)&0xffffff).toString(16).padStart(6,'0'),bg:'#'+(b.readUInt32LE(at+8)&0xffffff).toString(16).padStart(6,'0')}}))}
 if(el.type==='Text')return line(String(p.children??'').slice(0,avail),names[p.color]??p.color??THEME.info,p.backgroundColor)
 if(el.type==='Button')return line((p.plain?p.label:'['+p.label+'] ')??'',p.key===focus?'#ffffff':THEME.info,p.key===focus?'#41404c':undefined)
 if(el.type==='Input')return [...line(p.label,THEME.head),...line(('> '+p.placeholder).slice(0,avail),'#83948f')]
 const nodes=(Array.isArray(p.children)?p.children:[p.children]).filter(Boolean)
 const border=p.borderStyle?1:0,pad=p.paddingX??0,width=Math.min(avail,p.width??avail),inside=Math.max(1,width-2*border-2*pad)
 const kids=nodes.map((n:any)=>render(n,inside));const widths=kids.map(k=>Math.max(0,...k.map(r=>r.length)))
 if(p.flexDirection==='row'&&p.flexWrap!=='wrap'){
  const shrink=nodes.findIndex((n:any)=>n.props?.flexGrow)
  const target=shrink>=0?shrink:nodes.findLastIndex((n:any)=>n.props?.wrap==='truncate-end')
  if(target>=0){const room=Math.max(1,inside-widths.reduce((sum,w,i)=>sum+(i===target?0:w),0)-Math.max(0,kids.length-1)*(p.gap??0));kids[target]=render(nodes[target],room);widths[target]=Math.max(0,...kids[target]!.map(r=>r.length))}
 }
 let rows:R
 if(p.flexDirection!=='row')rows=kids.flatMap((k,i)=>[...k,...Array.from({length:i<kids.length-1?p.gap??0:0},()=>[])])
 else if(p.flexWrap==='wrap'){
  rows=[];let current:R=[];let used=0
  kids.forEach((child,i)=>{
   const w=widths[i]!,gap=used>0?p.gap??0:0
   if(used>0&&used+gap+w>inside){rows.push(...current);current=[];used=0}
   const space=used>0?p.gap??0:0
   const h=Math.max(current.length,child.length)
   current=Array.from({length:h},(_,y)=>[...(current[y]??spaces(used)),...spaces(space),...(child[y]??[]),...spaces(w-(child[y]?.length??0))]);used+=space+w
  });rows.push(...current)
 } else {
  const gap=p.gap??0;let remaining=inside-widths.reduce((a,b)=>a+b,0)-Math.max(0,kids.length-1)*gap
  const grow=nodes.findIndex((n:any)=>n.props?.flexGrow);if(grow>=0&&remaining>0)widths[grow]+=remaining
  const height=Math.max(0,...kids.map(k=>k.length))
  rows=Array.from({length:height},(_,y)=>kids.flatMap((k,i)=>[...(k[y]??[]),...spaces(widths[i]-(k[y]?.length??0)),...spaces(i<kids.length-1?gap:0)]))
 }
 if(border){const w=p.width?width:Math.min(width,Math.max(0,...rows.map(r=>r.length))+2+2*pad);const color=names[p.borderColor]??p.borderColor??THEME.head;const edge=(ch:string)=>({ch,fg:color});rows=rows.map(r=>[edge('│'),...spaces(pad),...r.slice(0,w-2-pad*2),...spaces(w-2-pad-r.length),edge('│')]);rows=[...line('┌'+'─'.repeat(Math.max(0,w-2))+'┐',color),...rows,...line('└'+'─'.repeat(Math.max(0,w-2))+'┘',color)]}
 return [...Array.from({length:p.marginTop??0},()=>[]),...rows]
}

const noop:any=new Proxy(()=>undefined,{get:()=>noop})
const act=new Proxy(noop,{get:(_,key)=>key==='themes'?actions:key==='view'?(view:any)=>{state.view=view;state.pane.viewAtMs=clock}:noop})
const flat=(node:any):any[]=>node&&typeof node==='object'?[node,...(Array.isArray(node.props?.children)?node.props.children.flatMap(flat):flat(node.props?.children))]:[]
let clock=1
const draw=()=>paneView({state,kit,act,columns,nowMs:clock,pictures:picturesOf(state,columns,clock,clock)} as any)
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0))}
const evidence:string[]=[]
const click=async(key:string)=>{const el=flat(draw()).find(n=>n.props?.key===key);assert.equal(typeof el?.props.onPress,'function',key);focus=key;el.props.onPress();await flush()}
const submit=async(key:string,value:string)=>{const el=flat(draw()).find(n=>n.props?.key===key);assert.equal(typeof el?.props.onSubmit,'function',key);focus=key;el.props.onSubmit(value);await flush()}
const frames:any[]=[]
function capture(seconds:number,caption:string){
 for(let i=0;i<seconds*12;i++){
  const rows=render(draw());assert.ok(rows.every(r=>r.length<=columns),`overflow at ${columns}: ${Math.max(...rows.map(r=>r.length))}`)
  frames.push({rows,caption,bg:activeTheme(state).palette.background,accent:THEME.head,columns});clock+=1000/12
 }
 focus=''
}
state.options.boot=true;state.pane.bootAtMs=1
capture(3,'01 / BOOT / actual local self checks')
state.options.boot=false;state.pane.viewAtMs=clock
capture(3,'02 / MAIN MENU / full console navigation')
await click('menu-go-themes');assert.equal(state.view,'themes');evidence.push('Main menu opens Theme Studio')
for(const preset of THEME_PRESETS){
 await click(`theme-preset-${preset.id}`)
 assert.equal(activeTheme(state).name,preset.theme.name)
 capture(2,`03 / LOAD PRESET / ${preset.theme.name}`)
}
evidence.push('All six bundled palettes applied through visible buttons')
await click('theme-preset-synthwave')
await submit('theme-name','Night Shift')
await submit('theme-color','#79dfff')
assert.equal(activeTheme(state).name,'Synthwave');capture(2,'04 / CUSTOMIZE / draft leaves active palette unchanged')
await click('theme-tab-motion');await click('theme-speed-0.5');capture(2,'05 / MOTION / half speed globe and orchestration')
await click('theme-save');assert.equal(activeTheme(state).name,'Night Shift');evidence.push('Custom color and motion persisted to disk')
capture(2,'06 / SAVE / custom Night Shift palette applied')
state=fresh();actions=themeActions(state,host,()=>{});await loadThemes(state,host);state.pane.viewAtMs=clock
assert.equal(activeTheme(state).name,'Night Shift');assert.equal(activeTheme(state).motion.speed,0.5);assert.equal(activeTheme(state).palette.head,'#79dfff');evidence.push('Fresh state restores custom palette and motion from disk')
capture(3,'07 / REOPEN / saved selection restored from disk')
await click('menu-go-themes');await click('theme-tab-generate')
const imported={...THEME_PRESETS[0]!.theme,name:'Imported Arctic'}
await submit('theme-import',JSON.stringify(imported));await click('theme-save');assert.equal(activeTheme(state).name,'Imported Arctic')
evidence.push('Portable JSON imports through input and persists')
capture(2,'08 / IMPORT JSON / portable Arctic preset applied')
await click('theme-tab-motion');state.options.fps=0
const frozen=picturesOf(state,columns,clock,clock).get('title')!.encode()
assert.equal(frozen,picturesOf(state,columns,clock+1000,clock+1000).get('title')!.encode());evidence.push('Reduced motion keeps identical header frames')
capture(2,'09 / REDUCED MOTION / fps 0 freezes graphics')
state.options.fps=12;columns=80;state.pane.columns=80
capture(3,'10 / RESIZE / 80 columns, stacked editor and preview')
columns=116;state.pane.columns=116
capture(2,'11 / RESIZE / 116 columns, editor beside preview')
evidence.push('Renderer bounds verified at 80 and 116 columns; native layout unverified')
await click('tab-menu');assert.equal(state.view,'menu');assert.equal(activeTheme(state).name,'Imported Arctic');capture(2,'12 / MAIN MENU / imported theme retained')
evidence.push('Return to main menu retains imported theme')
writeFileSync(resolve(output,'frames.json'),JSON.stringify(frames))
writeFileSync(resolve(output,'receipt.json'),JSON.stringify({mode:'renderer workflow with actual view handlers and filesystem storage',nativeHost:false,aiProviderInvoked:false,frames:frames.length,fps:12,seconds:frames.length/12,evidence},null,2))
console.log(JSON.stringify({output,frames:frames.length,maxRows:Math.max(...frames.map(f=>f.rows.length)),evidence}))

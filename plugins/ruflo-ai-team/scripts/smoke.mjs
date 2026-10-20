import { readFileSync, existsSync, readdirSync } from 'node:fs';
const root=new URL('../',import.meta.url); const read=(p)=>readFileSync(new URL(p,root),'utf8'); const checks=[]; const check=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name)};
const manifest=JSON.parse(read('.claude-plugin/plugin.json'));
check('manifest name',manifest.name==='ruflo-ai-team');
check('manifest semver',/^\d+\.\d+\.\d+$/.test(manifest.version));
check('manifest keywords',manifest.keywords?.includes('ruvector'));
check('no component arrays',!manifest.skills&&!manifest.commands&&!manifest.agents);
for(const dir of ['skills','commands','agents','docs/adrs'])check(`${dir} exists`,existsSync(new URL(dir,root)));
check('README v3.48 pin',read('README.md').includes('v3.48'));
check('README namespace',read('README.md').includes('Namespace coordination'));
check('ADR proposed',read('docs/adrs/0001-multitenant-service-boundary.md').includes('Status: Proposed'));
check('six skills',readdirSync(new URL('skills/',root),{withFileTypes:true}).filter((entry)=>entry.isDirectory()).length===6);
check('four agents',readdirSync(new URL('agents/',root)).filter((name)=>name.endsWith('.md')).length===4);
check('four commands',readdirSync(new URL('commands/',root)).filter((name)=>name.endsWith('.md')).length===4);
const server=read('src/server.mjs');
check('fourteen MCP tools',(server.match(/mcp\.tool\('/g)||[]).length+(server.match(/mcp\.registerTool\('/g)||[]).length===14);
check('explicit annotation factories',server.includes('readOnlyHint: true')&&server.includes('readOnlyHint: false')&&server.includes('destructiveHint: false')&&server.includes('idempotentHint:')&&server.includes('openWorldHint: false'));
// surface-neutral content (0.3.0): no Claude Code namespaced tool names, no angle brackets, real names only
const frontmatter=(text)=>{const m=text.match(/^---\n([\s\S]*?)\n---/);const o={};for(const line of (m?m[1]:"").split("\n")){const i=line.indexOf(": ");if(i>0)o[line.slice(0,i)]=line.slice(i+2)}return o};
const names=(dir,file)=>readdirSync(new URL(dir,root),{withFileTypes:true}).filter((e)=>file?e.isDirectory():e.name.endsWith(".md")).map((e)=>file?`${dir}${e.name}/${file}`:`${dir}${e.name}`);
const items=[...names("skills/","SKILL.md"),...names("commands/"),...names("agents/")];
const serverTools=new Set([...server.matchAll(/mcp\.(?:tool|registerTool)\('([a-z_]+)'/g)].map((m)=>m[1]));
for(const f of items){const text=read(f);const fm=frontmatter(text);
  check(`${f}: no namespaced tool names`,!/mcp__/.test(text));
  check(`${f}: description present, no angle brackets, under 300 chars`,!!fm.description&&!/[<>]/.test(fm.description)&&fm.description.length<300);
  check(`${f}: description is valid plain YAML`,!fm.description.includes(": ")&&!/^["']/.test(fm.description)||/^"/.test(fm.description));
  for(const t of text.matchAll(/\b((?:team|run|task|memory|evidence)_[a-z_]+)\b/g))check(`${f}: tool ${t[1]} exists on the server`,serverTools.has(t[1]));}
const commandNames=new Set(names("commands/").map((f)=>f.slice(9,-3)));
const skillNames=new Set(names("skills/","SKILL.md").map((f)=>f.split("/")[1]));
for(const f of [...names("commands/"),...names("skills/","SKILL.md")])for(const m of read(f).matchAll(/(?:Use the |Use )([a-z-]+) skill/g))check(`${f}: skill ${m[1]} exists`,skillNames.has(m[1]));
const readme=read("README.md");
for(const m of readme.matchAll(/\`\/(team-[a-z]+)/g))check(`README example /${m[1]} is a real command`,commandNames.has(m[1]));
check("README has examples, auth/data and troubleshooting sections",/## Examples/.test(readme)&&/## How auth works and what leaves your machine/.test(readme)&&/## Troubleshooting/.test(readme));
check("README opens with the directory short description",readme.includes(manifest.description));
// directory bundle copies must match the plugin
for(const f of items)check(`directory/${f} matches`,existsSync(new URL(`directory/${f}`,root))&&read(`directory/${f}`)===read(f));
const bundle=JSON.parse(read("directory/.claude-plugin/plugin.json"));
check("directory manifest description matches",bundle.description===manifest.description);
check("changelog top entry matches manifest version",read("CHANGELOG.md").includes(`## ${manifest.version} —`));
// mod (ADR-445 pattern)
const hooksJson=JSON.parse(read('hooks/hooks.json'));
check('mod: hooks.json names register.ts',hooksJson.modules?.includes('./register.ts'));
for(const name of ['options','screen','guard','command','status','register']){check(`mod: hooks/${name}.ts present and <=500 lines`,existsSync(new URL(`hooks/${name}.ts`,root))&&read(`hooks/${name}.ts`).split('\n').length<=501)}
check('mod: guard defaults on',manifest.userConfig?.guard?.default==='on');
check('mod: no network or process in hooks',!['screen','guard','command','status','register','options'].some((name)=>/\$\.(http|process)\.|child_process|fetch\(/.test(read(`hooks/${name}.ts`))));
check('mod: /ai-team-mod collides with no command or skill',read('hooks/register.ts').includes("name: 'ai-team-mod'")&&!existsSync(new URL('commands/ai-team-mod.md',root))&&!existsSync(new URL('skills/ai-team-mod',root)));
console.log(`smoke ok: ${checks.length} checks`);

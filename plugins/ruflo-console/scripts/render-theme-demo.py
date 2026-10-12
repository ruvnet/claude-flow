"""Render theme-demo.mts frames to GIF and MP4. Requires Pillow and ffmpeg."""
import json, sys, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/ruflo-console-demo')
frames=json.loads((root/'frames.json').read_text())
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',16)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',12)
width=1208
height=120+max(len(f['rows']) for f in frames)*19
height+=height%2
# Cache rendered terminal cells so repeated text is not rasterized hundreds of times.
cache={}
def tile(c,bg):
 key=(c['ch'],c['fg'],c.get('bg',bg))
 if key not in cache:
  im=Image.new('RGB',(10,19),key[2]);d=ImageDraw.Draw(im)
  if c['ch'] in ['█','▀','▄']:
   lo=9 if c['ch']=='▄' else 0;hi=8 if c['ch']=='▀' else 18
   d.rectangle((0,lo,9,hi),fill=c['fg'])
  elif c['ch']!=' ':d.text((0,0),c['ch'],font=font,fill=c['fg'])
  cache[key]=im
 return cache[key]
video=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{width}x{height}','-framerate','12','-i','-','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(root/'ruflo-console-demo.mp4')],stdin=subprocess.PIPE)
images=[]
for n,f in enumerate(frames):
 im=Image.new('RGB',(width,height),f['bg']);d=ImageDraw.Draw(im)
 d.text((24,16),'RUFLO / COMPLETE THEME WORKFLOW',font=font,fill=f['accent'])
 d.text((24,45),f['caption'],font=small,fill='#a8b2bd')
 d.line((24,68,width-24,68),fill=f['accent'])
 left=24+(116-f['columns'])*5
 for y,row in enumerate(f['rows']):
  for x,c in enumerate(row):im.paste(tile(c,f['bg']),(left+x*10,78+y*19))
 d.line((24,height-35,24+(width-48)*(n+1)/len(frames),height-35),fill=f['accent'],width=2)
 d.text((24,height-23),'RENDERER DEMO / real UI actions + disk persistence / native host and AI generation unverified',font=small,fill='#a8b2bd')
 video.stdin.write(im.tobytes())
 # GIF at 6 fps; MP4 retains the full 12 fps capture.
 if n%2==0:images.append(im.quantize(colors=128))
 if n in [60,96,180,300,420]:im.save(root/f'check-{n}.png')
video.stdin.close()
if video.wait()!=0:raise RuntimeError('ffmpeg failed')
images[0].save(root/'ruflo-console-demo.gif',save_all=True,append_images=images[1:],duration=[160 if i%3==0 else 170 for i in range(len(images))],loop=0,optimize=False)
print(json.dumps({'width':width,'height':height,'frames':len(frames),'gifFrames':len(images),'seconds':len(frames)/12}))

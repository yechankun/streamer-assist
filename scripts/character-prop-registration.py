"""Analyze alpha geometry and write fixed registration. Never edits PNG pixels."""
from pathlib import Path
from PIL import Image
import numpy as np
import json,sys
from collections import deque
root=Path(__file__).resolve().parents[1]/'design/characters/retro-v9'
directory=root/'parts/revision-2'

def shape(file, holes=False):
    image=Image.open(directory/file).convert('RGBA')
    alpha=np.array(image.getchannel('A'))
    ys,xs=np.where(alpha>=128)
    bounds=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
    x0,y0,x1,y1=bounds
    mask=(alpha[y0:y1,x0:x1]<64) if holes else (alpha[y0:y1,x0:x1]>=128)
    visited=np.zeros(mask.shape,dtype=bool); components=[]
    for y,x in zip(*np.where(mask)):
        if visited[y,x]: continue
        queue=deque([(int(x),int(y))]); visited[y,x]=True
        area=totalx=totaly=0; edge=False
        while queue:
            cx,cy=queue.popleft(); area+=1;totalx+=cx+x0;totaly+=cy+y0
            edge|=cx==0 or cy==0 or cx==mask.shape[1]-1 or cy==mask.shape[0]-1
            for nx,ny in ((cx-1,cy),(cx+1,cy),(cx,cy-1),(cx,cy+1)):
                if 0<=nx<mask.shape[1] and 0<=ny<mask.shape[0] and mask[ny,nx] and not visited[ny,nx]:
                    visited[ny,nx]=True;queue.append((nx,ny))
        if area>400 and (not holes or not edge):components.append({'area':area,'center':[totalx/area,totaly/area]})
    return {'size':list(image.size),'bounds':bounds,'components':sorted(components,key=lambda p:p['area'],reverse=True)}

placements={};records={}
def box(id,file,width,top,center=561):
    data=shape(file);x0,y0,x1,y1=data['bounds'];s=width/(x1-x0)
    placements[id]=[round(center-(x0+x1)*s/2,3),round(top-y0*s,3),round(s,6)]
    records[id]={'file':file,**data}
def pair(id,file,target_left,target_right,holes=False):
    data=shape(file,holes);parts=sorted(data['components'][:2],key=lambda p:p['center'][0])
    if len(parts)!=2: raise ValueError(id+': two closed transparent lens openings/cups required')
    a,b=[p['center'] for p in parts];s=(target_right[0]-target_left[0])/(b[0]-a[0]);cx=(a[0]+b[0])/2;cy=(a[1]+b[1])/2
    placements[id]=[round((target_left[0]+target_right[0])/2-cx*s,3),round((target_left[1]+target_right[1])/2-cy*s,3),round(s,6)]
    records[id]={'file':file,**data}

pair('prop-round-glasses','prop-round-glasses-fitted.png',[452,646],[670,647],True)
pair('prop-square-glasses','prop-square-glasses-fitted.png',[452,646],[670,647],True)
pair('prop-headphones-front','prop-headphones-front-fitted.png',[463,824],[659,824])
box('prop-scarf-front','prop-scarf-front-fitted.png',252,778)
box('prop-scarf-back','prop-scarf-back-fitted.png',210,765)
box('prop-headphones-back','prop-headphones-back-fitted.png',220,778)
box('prop-bowtie','prop-bowtie-fitted.png',140,780)
box('prop-pendant','prop-pendant.png',200,795)
box('hat-earflap-front','hat-earflap-front.png',614,207,553)
data=shape('hat-earflap-back-complete.png');x0,y0,x1,y1=data['bounds'];s=240/(y1-y0)
placements['hat-earflap-back']=[round(843-(x0+x1)*s/2,3),round(525-y0*s,3),round(s,6)]
records['hat-earflap-back']={'file':'hat-earflap-back-complete.png',**data}
(directory/'registration-candidates.json').write_text(json.dumps({'placements':placements,'analysis':records},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if '--apply' in sys.argv:
    catalog=json.loads((root/'catalog.json').read_text(encoding='utf-8'))
    registration=json.loads((root/'registration.json').read_text(encoding='utf-8'))
    for key,record in records.items():
        catalog['assets'][key]['file']='parts/revision-2/'+record['file']
        registration[key]=placements[key]
    (root/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (root/'registration.json').write_text(json.dumps(registration,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(placements))

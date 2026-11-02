#!/usr/bin/env python3
"""WCAG 2.x relative-luminance contrast. Usage: python3 contrast.py  (prints tables)"""
def hx(h):
    h=h.lstrip('#'); return [int(h[i:i+2],16)/255 for i in (0,2,4)]
def blend(fg,a,bg):
    f,b=hx(fg),hx(bg); return '#'+''.join('%02x'%round((f[i]*a+b[i]*(1-a))*255) for i in range(3))
def lum(h):
    c=[x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4 for x in hx(h)]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def ratio(a,b):
    l1,l2=sorted([lum(a),lum(b)],reverse=True); return (l1+0.05)/(l2+0.05)
BG={'bg':'#080c10','surface':'#0f1419','elevated':'#161d27','card':'#1a2332'}
NEW_TEXT={'text':'#f1f5f9','text-secondary':'#cbd5e1','text-muted':'#94a3b8','link':'#22d3ee','error':'#fca5a5','success':'#6ee7b7','warning':'#fcd34d'}
NEW_NONTEXT={'border-strong':'#64748b','focus-ring':'#67e8f9'}
ON={('#080c10','#22d3ee'):'primary btn text on --primary',('#080c10','#67e8f9'):'primary btn hover',('#080c10','#fca5a5'):'danger btn text',('#cbd5e1','#1e293b'):'disabled text on disabled bg'}
# scrim: worst case pure-white photo pixel under scrim
SCRIM=blend('#080c10',0.72,'#ffffff')
OLD={'muted on card':('#94a3b8','#1a2332'),'border 8% on elevated (input edge)':(blend('#ffffff',0.08,'#161d27'),'#080c10'),
 'border 8% vs card':(blend('#ffffff',0.08,'#1a2332'),'#1a2332'),
 'btn text #080c10 on gradient end #3b8fd9':('#080c10','#3b8fd9'),
 'disabled btn 50%: #080c10 on (#3b8fd9 @50% over bg)':(blend('#080c10',0.5,'#080c10'),blend('#3b8fd9',0.5,'#080c10')),
 'disabled outline btn 50%: text on bg':(blend('#f1f5f9',0.5,'#080c10'),'#080c10'),
 'focus glow cyan 30% vs bg':(blend('#00c4d1',0.3,'#080c10'),'#080c10'),
 'error text on error-bg over card':('#f87171',blend('#ef4444',0.12,'#1a2332')),
 'muted on white photo (no scrim)':('#94a3b8','#ffffff'),
 'text-primary on white photo (no scrim)':('#f1f5f9','#ffffff'),
 'dev banner text on amber':('#080c10','#fbbf24'),
}
if __name__=='__main__':
    print('## New tokens: text on backgrounds');print('| fg | '+' | '.join(BG)+' |');print('|---|'+'---|'*len(BG))
    for n,c in NEW_TEXT.items(): print(f'| {n} `{c}` | '+' | '.join(f'{ratio(c,b):.2f}' for b in BG.values())+' |')
    for n,c in NEW_NONTEXT.items(): print(f'| {n} `{c}` (non-text, need 3:1) | '+' | '.join(f'{ratio(c,b):.2f}' for b in BG.values())+' |')
    print('\n## Paired');[print(f'| {v} | `{a}` on `{b}` | {ratio(a,b):.2f} |') for (a,b),v in ON.items()]
    print(f'| text on scrim over white (scrim=#080c10 @72% -> {SCRIM}) | | {ratio("#f1f5f9",SCRIM):.2f} |')
    print(f'| text-secondary on scrim over white | | {ratio("#cbd5e1",SCRIM):.2f} |')
    print('\n## v1 live theme');[print(f'| {k} | `{a}` on `{b}` | {ratio(a,b):.2f} |') for k,(a,b) in OLD.items()]

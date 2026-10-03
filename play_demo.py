"""Two small original games that ship with NRS Play, so the platform isn't empty and creators
can see what a game file looks like. Each is one self-contained HTML file: no external
resources, no storage -- exactly what the locked-down game frame allows."""

STAR_CATCHER = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;height:100%;background:#0d1030;color:#fff;font-family:system-ui,sans-serif;overflow:hidden;touch-action:manipulation;user-select:none}
canvas{display:block;width:100%;height:100%}
#hud{position:fixed;top:12px;left:16px;right:16px;display:flex;justify-content:space-between;font-weight:700;font-size:18px;pointer-events:none;text-shadow:0 2px 8px #000a}
#msg{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#0d1030d9;text-align:center;padding:20px}
h1{margin:0;font-size:30px} p{margin:0;opacity:.8}
button{font:inherit;font-weight:700;padding:12px 28px;border:0;border-radius:999px;background:linear-gradient(135deg,#7cf5d4,#8b7bff);color:#10102a;cursor:pointer;margin-top:6px}
</style></head><body>
<canvas id="c"></canvas>
<div id="hud"><span id="s">Punkte: 0</span><span id="t">30</span></div>
<div id="msg"><h1>Sternenfänger</h1><p>Tippe die fallenden Sterne an, bevor sie unten ankommen.</p><button id="go">Start</button></div>
<script>
var c=document.getElementById("c"),x=c.getContext("2d"),stars=[],score=0,left=30,running=false,last=0,spawn=0;
function size(){c.width=innerWidth;c.height=innerHeight}size();addEventListener("resize",size);
function star(cx,cy,r){x.beginPath();for(var i=0;i<10;i++){var a=-Math.PI/2+i*Math.PI/5,d=i%2?r*.45:r;x.lineTo(cx+Math.cos(a)*d,cy+Math.sin(a)*d)}x.closePath();x.fill()}
function start(){stars=[];score=0;left=30;running=true;last=performance.now();spawn=0;document.getElementById("msg").style.display="none"}
function end(){running=false;var m=document.getElementById("msg");m.style.display="flex";m.querySelector("h1").textContent="Zeit ist um!";m.querySelector("p").textContent="Du hast "+score+" Sterne gefangen.";document.getElementById("go").textContent="Nochmal"}
function tick(now){var dt=(now-last)/1000;last=now;
 if(running){left-=dt;spawn-=dt;if(spawn<=0){spawn=.45;stars.push({x:30+Math.random()*(c.width-60),y:-20,r:16+Math.random()*14,v:90+Math.random()*120+(30-left)*4,h:Math.random()*360})}
  stars.forEach(function(s){s.y+=s.v*dt});stars=stars.filter(function(s){return s.y<c.height+40});
  if(left<=0){left=0;end()}}
 x.clearRect(0,0,c.width,c.height);
 stars.forEach(function(s){x.fillStyle="hsl("+s.h+",90%,68%)";star(s.x,s.y,s.r)});
 document.getElementById("s").textContent="Punkte: "+score;document.getElementById("t").textContent=Math.ceil(left);
 requestAnimationFrame(tick)}
function hit(e){if(!running)return;var p=e.touches?e.touches[0]:e,b=c.getBoundingClientRect(),px=p.clientX-b.left,py=p.clientY-b.top;
 for(var i=stars.length-1;i>=0;i--){var s=stars[i];if(Math.hypot(px-s.x,py-s.y)<s.r+14){stars.splice(i,1);score++;break}}}
c.addEventListener("pointerdown",hit);document.getElementById("go").onclick=start;requestAnimationFrame(function(t){last=t;tick(t)});
</script></body></html>
"""

COLOR_ECHO = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;height:100%;background:linear-gradient(160deg,#1a1240,#0b1d3a);color:#fff;font-family:system-ui,sans-serif;user-select:none;touch-action:manipulation}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
h1{margin:0;font-size:28px} #info{opacity:.85;min-height:24px;text-align:center;padding:0 16px}
#pads{display:grid;grid-template-columns:1fr 1fr;gap:14px;width:min(78vmin,360px)}
.pad{aspect-ratio:1;border-radius:26px;border:0;cursor:pointer;opacity:.45;transition:opacity .12s,transform .12s;box-shadow:inset 0 2px 0 #fff5}
.pad.on{opacity:1;transform:scale(1.04)}
button.go{font:inherit;font-weight:700;padding:11px 26px;border:0;border-radius:999px;background:linear-gradient(135deg,#7cf5d4,#8b7bff);color:#10102a;cursor:pointer}
</style></head><body>
<h1>Farb-Echo</h1><div id="info">Merk dir die Reihenfolge und tippe sie nach.</div>
<div id="pads"></div><button class="go" id="go">Start</button>
<script>
var colors=["#ff5d7a","#ffc857","#52e0a3","#5ab0ff"],pads=[],seq=[],pos=0,locked=true,info=document.getElementById("info");
colors.forEach(function(col,i){var b=document.createElement("button");b.className="pad";b.style.background=col;b.onclick=function(){press(i)};document.getElementById("pads").appendChild(b);pads.push(b)});
function flash(i,ms){pads[i].classList.add("on");setTimeout(function(){pads[i].classList.remove("on")},ms||320)}
function play(){locked=true;pos=0;info.textContent="Runde "+seq.length+" - schau zu ...";
 seq.forEach(function(n,k){setTimeout(function(){flash(n)},600+k*600)});
 setTimeout(function(){locked=false;info.textContent="Jetzt du!"},600+seq.length*600)}
function next(){seq.push(Math.floor(Math.random()*4));play()}
function press(i){if(locked)return;flash(i,200);
 if(i!==seq[pos]){locked=true;info.textContent="Falsch! Du hast "+(seq.length-1)+" Runden geschafft.";document.getElementById("go").textContent="Nochmal";return}
 pos++;if(pos===seq.length){locked=true;info.textContent="Richtig!";setTimeout(next,700)}}
document.getElementById("go").onclick=function(){seq=[];this.textContent="Neu starten";next()};
</script></body></html>
"""

DEMO_GAMES = [
    {"title": "Sternenfänger", "emoji": "⭐", "accent": 4,
     "description": "30 Sekunden, fallende Sterne, so viele Punkte wie möglich. Tippe die Sterne an!",
     "code": STAR_CATCHER},
    {"title": "Farb-Echo", "emoji": "🎨", "accent": 1,
     "description": "Merk dir die Reihenfolge der Farben und tippe sie nach. Mit jeder Runde wird es länger.",
     "code": COLOR_ECHO},
]

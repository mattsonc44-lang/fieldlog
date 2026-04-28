import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  FIREBASE CONFIG — paste your project values here                  ║
// ╠══════════════════════════════════════════════════════════════════════╣
const FIREBASE_URL    = "https://fieldlog-cd3e6-default-rtdb.firebaseio.com";
const DB_PATH         = "fieldlog";   // root key in Realtime DB
const ANTHROPIC_KEY   = (typeof window !== "undefined" && window.__ANTHROPIC_KEY__) || "";
// ╚══════════════════════════════════════════════════════════════════════╝

const FB_CONFIGURED = !FIREBASE_URL.includes("YOUR-PROJECT");

// ── Firebase REST helpers (no SDK needed) ─────────────────────────────
const fbUrl  = (path) => `${FIREBASE_URL}/${DB_PATH}/${path}.json`;
const fbRead = async (path="")  => { const r=await fetch(fbUrl(path)); if(!r.ok) throw new Error(r.status); return r.json(); };
const fbSet  = async (path,data)=> { const r=await fetch(fbUrl(path),{method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)}); if(!r.ok) throw new Error(r.status); return r.json(); };
const fbDel  = async (path)     => fetch(fbUrl(path),{method:"DELETE"});

// SSE real-time listener — returns unsubscribe fn
const fbListen = (onChange) => {
  if (!FB_CONFIGURED) return ()=>{};
  try {
    const es = new EventSource(`${FIREBASE_URL}/${DB_PATH}.json`);
    es.addEventListener("put",  (e)=>{ try{ onChange(JSON.parse(e.data)); }catch(_){} });
    es.addEventListener("patch",(e)=>{ try{ onChange(JSON.parse(e.data)); }catch(_){} });
    es.onerror = ()=>{};
    return ()=>es.close();
  } catch(_){ return ()=>{}; }
};

// ── Google Fonts ──────────────────────────────────────────────────────
if (!document.getElementById("fl-fonts")) {
  const l=document.createElement("link");
  l.id="fl-fonts"; l.rel="stylesheet";
  l.href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Barlow:wght@300;400;600;700&display=swap";
  document.head.appendChild(l);
}

// ── Constants ─────────────────────────────────────────────────────────
const CROPS        = ["Wheat","Durum","Barley","Oats","Canola","Flax","Peas","Lentils","Chickpeas","Mustard","Corn","Soybeans","Sunflowers","Alfalfa","Hay","Other"];
const FERT_BLENDS  = ["28-0-0 (UAN)","46-0-0 (Urea)","11-52-0 (MAP)","18-46-0 (DAP)","0-0-60 (Potash)","10-26-26","34-0-0 (AN)","12-40-0","Custom Blend"];
const CHEMICALS    = ["Glyphosate (Roundup)","2,4-D Amine","MCPA Amine","Lontrel 360","Infinity","Odyssey","Axial","Puma Super","Buctril M","Muster 75DF","Centurion","Tundra","Refine M","Bumper 418 EC","Stratego YLD","Headline","Priaxor","Trivapro","Dimethoate","Matador","Other"];
const ACTIVITY_META = {
  seeding:     {label:"Seeding",      icon:"🌱",color:"#C07010"},
  spraying:    {label:"Spraying",     icon:"💧",color:"#4A90C8"},
  rockPicking: {label:"Rock Picking", icon:"🪨",color:"#9A7060"},
  tillage:     {label:"Tillage",      icon:"⚙️", color:"#6B8F71"},
  harvest:     {label:"Harvest",      icon:"🌾",color:"#D4B040"},
  other:       {label:"Other",        icon:"📋",color:"#888888"},
};
const DEMO_FIELDS = [
  {id:"demo1",name:"Home Quarter",acres:"160",legalDesc:"NW-12-34-15-W4",boundary:[]},
  {id:"demo2",name:"North Flat",  acres:"320",legalDesc:"N½-18-34-15-W4",boundary:[]},
];
const DEMO_ACTIVITIES = [
  {id:"a1",fieldId:"demo1",type:"seeding",  date:"2025-05-10T07:30",data:{crop:"Wheat",seedRate:"90",totalSeed:"14400",fertBlend:"11-52-0 (MAP)",fertRate:"40",totalFert:"6400",equipment:"JD 1910 Air Cart",depth:"1.5"},notes:"Good conditions, 12°C, calm wind"},
  {id:"a2",fieldId:"demo1",type:"spraying", date:"2025-05-06T06:00",data:{waterVol:"10",equipment:"Case 4430",purpose:"Pre-seed burnoff",tankMix:[{id:"c1",chemical:"Glyphosate (Roundup)",oz:"16",unit:"oz/ac"},{id:"c2",chemical:"2,4-D Amine",oz:"12",unit:"oz/ac"}]},notes:"Wind NW 8 km/h"},
  {id:"a3",fieldId:"demo2",type:"rockPicking",date:"2025-04-22T09:15",data:{details:"Full pass with rock picker and rock cart"},notes:"Removed 6 loads"},
  {id:"a4",fieldId:"demo1",type:"seeding",  date:"2024-05-08T07:00",data:{crop:"Peas",seedRate:"160",totalSeed:"25600",fertBlend:"11-52-0 (MAP)",fertRate:"20",totalFert:"3200",inoculantProduct:"Nodulator PRO",inoculantRate:"4 oz/cwt",equipment:"JD 1910 Air Cart",depth:"2"},notes:""},
];

// ── Helpers ───────────────────────────────────────────────────────────
const genId    = ()=>`${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
const nowLocal = ()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const fmtDate  = (iso)=>{ try{return new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return iso||""} };
const obj2arr  = (obj)=>obj ? Object.values(obj) : [];

// ── GeoJSON / KML parsers for field import ────────────────────────────
const parseGeoJSONFields = (text) => {
  const gj = JSON.parse(text);
  const features = gj.type==="FeatureCollection" ? gj.features
                 : gj.type==="Feature"            ? [gj]
                 : gj.features                    ? gj.features : [];
  return features
    .filter(f=>f.geometry&&(f.geometry.type==="Polygon"||f.geometry.type==="MultiPolygon"))
    .map((f,i)=>{
      const p=f.properties||{};
      // Coordinates: GeoJSON is [lng,lat] → we store [lat,lng]
      let ring;
      if(f.geometry.type==="Polygon"){
        ring=f.geometry.coordinates[0];
      } else {
        // MultiPolygon — take the largest ring
        const rings=f.geometry.coordinates.map(poly=>poly[0]);
        ring=rings.reduce((a,b)=>a.length>b.length?a:b);
      }
      const boundary=ring.map(([lng,lat])=>[lat,lng]);
      // Auto-name from common FSA CLU property names
      const cluNum = p.clu_number||p.CLU_NUMBER||p.field_number||p.FIELD_NUMBER||p.FLD_NUM||"";
      const tractNum= p.tract_number||p.TRACT_NUMBER||p.TRACT_NO||"";
      const label  = p.label||p.LABEL||p.name||p.NAME||"";
      const name   = label     ? label
                   : cluNum&&tractNum ? `Tract ${tractNum} Field ${cluNum}`
                   : cluNum    ? `Field ${cluNum}`
                   : tractNum  ? `Tract ${tractNum}`
                   : `Field ${i+1}`;
      const acres  = p.clu_calculated_acreage||p.CLU_CALCULATED_ACREAGE
                   ||p.clu_official_acreage  ||p.CLU_OFFICIAL_ACREAGE
                   ||p.CALCACRES||p.GIS_ACRES||p.acres||p.ACRES||"";
      const legalDesc = p.legal_description||p.LEGAL_DESCRIPTION||"";
      return { id:genId(), name, acres:acres?String(Math.round(Number(acres)*10)/10):"", legalDesc, boundary };
    });
};

const parseKMLFields = (text) => {
  const doc=new DOMParser().parseFromString(text,"text/xml");
  return Array.from(doc.querySelectorAll("Placemark"))
    .filter(p=>p.querySelector("Polygon"))
    .map((p,i)=>{
      const name=p.querySelector("name")?.textContent||`Field ${i+1}`;
      const coordStr=p.querySelector("Polygon outerBoundaryIs coordinates, Polygon coordinates")?.textContent?.trim()||"";
      const boundary=coordStr.split(/\s+/).filter(c=>c.includes(","))
        .map(c=>{ const[lng,lat]=c.split(","); return[parseFloat(lat),parseFloat(lng)]; })
        .filter(c=>!isNaN(c[0])&&!isNaN(c[1]));
      return{id:genId(),name,acres:"",legalDesc:"",boundary};
    });
};

// ── Convex hull for merging field boundaries ──────────────────────────
const convexHull = (pts) => {
  if(pts.length<=2) return pts;
  const s=[...pts].sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
  const cross=(o,a,b)=>(a[1]-o[1])*(b[0]-o[0])-(a[0]-o[0])*(b[1]-o[1]);
  const lower=[];
  for(const p of s){ while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop(); lower.push(p); }
  const upper=[];
  for(let i=s.length-1;i>=0;i--){ const p=s[i]; while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
};

// ── Design tokens ─────────────────────────────────────────────────────
const T={
  bg:"#F4EFE6",panel:"#E8DFD0",card:"#FFFFFF",cardHov:"#F0E8D8",
  border:"#D8CEBC",borderHi:"#C4A468",
  gold:"#C07010",goldSoft:"#D48820",
  text:"#1E1408",muted:"#7A6645",faint:"#B8A880",
  green:"#2A5E2A",blue:"#1E5078",danger:"#841A18",
};
const S={
  app:   {fontFamily:"'Barlow',sans-serif",background:T.bg,minHeight:"100vh",color:T.text},
  header:{background:T.panel,borderBottom:`1px solid ${T.border}`,padding:"12px 20px",display:"flex",alignItems:"center",gap:"14px",position:"sticky",top:0,zIndex:50},
  content:{padding:"20px",maxWidth:"820px",margin:"0 auto"},
  card:  {background:T.card,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"16px",marginBottom:"12px"},
  label: {display:"block",fontSize:"11px",color:T.muted,textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700,marginBottom:"5px"},
  input: {width:"100%",background:"#FFFFFF",border:`1px solid ${T.borderHi}`,borderRadius:"6px",padding:"8px 11px",color:T.text,fontSize:"14px",fontFamily:"'Barlow',sans-serif",outline:"none",boxSizing:"border-box"},
  row:   {marginBottom:"14px"},
  g2:    {display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"},
  g3:    {display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px"},
  sh:    {fontFamily:"'Playfair Display',serif",fontSize:"16px",color:T.gold,margin:"0 0 14px 0"},
};
const mkBtn=(v="primary")=>({
  display:"inline-flex",alignItems:"center",gap:"6px",
  padding:"8px 16px",borderRadius:"6px",
  border:v==="ghost"?`1px solid ${T.border}`:v==="outline"?`1px solid ${T.gold}`:"none",
  cursor:"pointer",fontSize:"13px",fontWeight:600,fontFamily:"'Barlow',sans-serif",
  background:v==="primary"?T.gold:v==="danger"?T.danger:"transparent",
  color:v==="primary"?"#FFFFFF":v==="danger"?"#FFFFFF":v==="outline"?T.gold:T.muted,
});

// ╔═══════════════════════════════════════════════════════════╗
// ║  TILE MAP — <img> tiles + <svg> overlay                  ║
// ╚═══════════════════════════════════════════════════════════╝
function FieldMap({boundary=[],onBoundaryChange,height=350}){
  const wrapRef=useRef(null);
  const dragRef=useRef({on:false,sx:0,sy:0,sc:[0,0],moved:false});
  const touchR =useRef({x:0,y:0,sc:[0,0],moved:false});
  const [ctr,setCtr]=useState(()=>{
    if(boundary&&boundary.length>0){
      const lats=boundary.map(p=>p[0]),lngs=boundary.map(p=>p[1]);
      return[(Math.min(...lats)+Math.max(...lats))/2,(Math.min(...lngs)+Math.max(...lngs))/2];
    }
    return[48.513,-110.979];
  });
  const [zoom,setZoom]=useState(()=>{
    if(boundary&&boundary.length>1){
      const lats=boundary.map(p=>p[0]),lngs=boundary.map(p=>p[1]);
      const span=Math.max(Math.max(...lats)-Math.min(...lats),Math.max(...lngs)-Math.min(...lngs));
      return Math.min(17,Math.max(12,Math.round(Math.log2(0.08/span)+14)));
    }
    return 14;
  });
  const [pts,setPts]=useState(boundary.length?[...boundary]:[]);
  const [saved,setSaved]=useState(false);
  const [W,setW]=useState(600);
  const H=height;
  const mX =(lon,z)=>(lon+180)/360*Math.pow(2,z)*256;
  const mY =(lat,z)=>{ const r=lat*Math.PI/180; return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*Math.pow(2,z)*256; };
  const iX =(mx,z)=>mx/(Math.pow(2,z)*256)*360-180;
  const iY =(my,z)=>{ const n=Math.PI-2*Math.PI*my/(Math.pow(2,z)*256); return Math.atan(0.5*(Math.exp(n)-Math.exp(-n)))*180/Math.PI; };
  const tz=Math.max(0,Math.min(19,Math.round(zoom)));
  const ll2px=(lat,lng)=>[Math.round(W/2+mX(lng,tz)-mX(ctr[1],tz)),Math.round(H/2+mY(lat,tz)-mY(ctr[0],tz))];
  const px2ll=(px,py)=>[iY(mY(ctr[0],tz)+py-H/2,tz),iX(mX(ctr[1],tz)+px-W/2,tz)];
  useEffect(()=>{
    const el=wrapRef.current; if(!el) return;
    const ro=new ResizeObserver(([e])=>setW(e.contentRect.width||600));
    ro.observe(el); setW(el.clientWidth||600); return()=>ro.disconnect();
  },[]);
  const tiles=useMemo(()=>{
    const cx=mX(ctr[1],tz),cy=mY(ctr[0],tz),x0=cx-W/2,y0=cy-H/2,n=Math.pow(2,tz),out=[];
    for(let tx=Math.floor(x0/256);tx<=Math.ceil((cx+W/2)/256);tx++)
      for(let ty=Math.floor(y0/256);ty<=Math.ceil((cy+H/2)/256);ty++){
        if(ty<0||ty>=n) continue;
        const wx=((tx%n)+n)%n;
        out.push({key:`${tz}/${wx}/${ty}`,src:`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tz}/${ty}/${wx}`,left:tx*256-x0,top:ty*256-y0});
      }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ctr,tz,W,H]);
  const polyStr=pts.map(([la,ln])=>ll2px(la,ln).join(",")).join(" ");
  const evXY=(e)=>{const r=wrapRef.current.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];};
  const pan=(dx,dy,sc)=>setCtr([iY(mY(sc[0],tz)-dy,tz),iX(mX(sc[1],tz)-dx,tz)]);
  const onMD=(e)=>{const[x,y]=evXY(e);dragRef.current={on:true,sx:x,sy:y,sc:[...ctr],moved:false};};
  const onMM=(e)=>{
    if(!dragRef.current.on) return;
    const[x,y]=evXY(e),dx=x-dragRef.current.sx,dy=y-dragRef.current.sy;
    if(Math.abs(dx)>3||Math.abs(dy)>3) dragRef.current.moved=true;
    if(dragRef.current.moved) pan(dx,dy,dragRef.current.sc);
  };
  const onMU=()=>{dragRef.current.on=false;};
  const onClick=(e)=>{
    if(dragRef.current.moved) return;
    const[x,y]=evXY(e); setPts(p=>[...p,px2ll(x,y)]); setSaved(false);
  };
  const onWheel=(e)=>{e.preventDefault();setZoom(z=>Math.max(8,Math.min(18,z+(e.deltaY<0?1:-1))));};
  const onTS=(e)=>{if(e.touches.length===1)touchR.current={x:e.touches[0].clientX,y:e.touches[0].clientY,sc:[...ctr],moved:false};};
  const onTM=(e)=>{
    if(e.touches.length!==1) return; e.preventDefault();
    const dx=e.touches[0].clientX-touchR.current.x,dy=e.touches[0].clientY-touchR.current.y;
    if(Math.abs(dx)>5||Math.abs(dy)>5) touchR.current.moved=true;
    if(touchR.current.moved) pan(dx,dy,touchR.current.sc);
  };
  const onTE=(e)=>{
    if(touchR.current.moved||e.changedTouches.length!==1) return;
    const r=wrapRef.current.getBoundingClientRect();
    setPts(p=>[...p,px2ll(e.changedTouches[0].clientX-r.left,e.changedTouches[0].clientY-r.top)]);
    setSaved(false);
  };
  const undo =()=>{setPts(p=>p.slice(0,-1));setSaved(false);};
  const clear=()=>{setPts([]);setSaved(false);};
  const save =()=>{ if(pts.length>=3&&onBoundaryChange){onBoundaryChange([...pts]);setSaved(true);} };
  const nPts=pts.length;
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"5px"}}>
        <span style={{fontSize:"11px",color:T.muted}}>Drag to pan · Scroll to zoom · <strong style={{color:T.goldSoft}}>Click map to place corners</strong></span>
        <div style={{display:"flex",gap:"3px"}}>
          <button style={{...mkBtn("ghost"),padding:"2px 10px",fontSize:"18px",lineHeight:1}} onClick={()=>setZoom(z=>Math.max(8,z-1))}>−</button>
          <button style={{...mkBtn("ghost"),padding:"2px 10px",fontSize:"18px",lineHeight:1}} onClick={()=>setZoom(z=>Math.min(18,z+1))}>+</button>
        </div>
      </div>
      <div ref={wrapRef} style={{position:"relative",width:"100%",height:`${H}px`,borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.borderHi}`,background:"#C8C8C0",cursor:"crosshair",userSelect:"none"}}
        onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}
        onClick={onClick} onWheel={onWheel}
        onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE}>
        {tiles.map(t=><img key={t.key} src={t.src} alt="" draggable={false} style={{position:"absolute",left:`${t.left}px`,top:`${t.top}px`,width:"256px",height:"256px",display:"block",pointerEvents:"none"}}/>)}
        <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",overflow:"visible"}}>
          {nPts>=3&&<polygon points={polyStr} fill="rgba(200,149,42,0.22)" stroke="#C07010" strokeWidth="2.5" strokeLinejoin="round"/>}
          {nPts===2&&(()=>{const[ax,ay]=ll2px(pts[0][0],pts[0][1]),[bx,by]=ll2px(pts[1][0],pts[1][1]);return<line x1={ax} y1={ay} x2={bx} y2={by} stroke="#C07010" strokeWidth="2.5"/>;})()}
          {pts.map(([la,ln],i)=>{const[px,py]=ll2px(la,ln);return(<g key={i}><circle cx={px} cy={py} r={6} fill="#E8B84B" stroke="#A07020" strokeWidth={2}/><text x={px} y={py} textAnchor="middle" dominantBaseline="middle" fill="#1A0E04" fontSize={9} fontWeight="bold">{i+1}</text></g>);})}
        </svg>
        <div style={{position:"absolute",bottom:0,right:0,background:"rgba(0,0,0,0.55)",color:"#bbb",fontSize:"9px",padding:"2px 6px",pointerEvents:"none"}}>© Esri, DigitalGlobe, GeoEye</div>
        <div style={{position:"absolute",bottom:0,left:0,background:"rgba(0,0,0,0.55)",color:"#bbb",fontSize:"9px",padding:"2px 6px",pointerEvents:"none"}}>z{tz}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"8px",flexWrap:"wrap"}}>
        <span style={{flex:1,fontSize:"12px",color:nPts>=3?T.gold:T.muted}}>{nPts<3?`Click to place field corners — ${nPts} point${nPts!==1?"s":""} placed`:`${nPts} points — polygon drawn${saved?" ✓ Saved":""}`}</span>
        <button style={{...mkBtn("ghost"),padding:"5px 11px",fontSize:"12px"}} onClick={undo}  disabled={!nPts}>Undo</button>
        <button style={{...mkBtn("ghost"),padding:"5px 11px",fontSize:"12px"}} onClick={clear} disabled={!nPts}>Clear</button>
        <button style={{...mkBtn("primary"),padding:"6px 14px",fontSize:"12px"}} onClick={save} disabled={nPts<3}>✓ Save Boundary</button>
      </div>
    </div>
  );
}

// ── Seeding Form ──────────────────────────────────────────────────────
function SeedingForm({v,set}){
  return(
    <div>
      <div style={S.row}><label style={S.label}>Crop Seeded *</label>
        <select style={S.input} value={v.crop||""} onChange={e=>set({...v,crop:e.target.value})}>
          <option value="">Select crop…</option>{CROPS.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>
      <div style={S.g2}>
        <div style={S.row}><label style={S.label}>Seed Rate (lbs / ac)</label><input style={S.input} type="number" step="0.1" placeholder="e.g. 90" value={v.seedRate||""} onChange={e=>set({...v,seedRate:e.target.value})}/></div>
        <div style={S.row}><label style={S.label}>Total Seed (lbs)</label><input style={S.input} type="number" step="1" placeholder="e.g. 14400" value={v.totalSeed||""} onChange={e=>set({...v,totalSeed:e.target.value})}/></div>
      </div>
      <div style={{background:"#FBF6EC",border:`1px solid #E0CFA0`,borderRadius:"8px",padding:"14px",marginBottom:"14px"}}>
        <p style={{margin:"0 0 12px",fontSize:"11px",color:T.muted,textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>Seed-Placed Fertilizer</p>
        <div style={S.g2}>
          <div style={S.row}><label style={S.label}>Fertilizer Rate (lbs / ac)</label><input style={S.input} type="number" step="0.1" placeholder="e.g. 40" value={v.fertRate||""} onChange={e=>set({...v,fertRate:e.target.value})}/></div>
          <div style={S.row}><label style={S.label}>Total Fertilizer (lbs)</label><input style={S.input} type="number" step="1" placeholder="e.g. 6400" value={v.totalFert||""} onChange={e=>set({...v,totalFert:e.target.value})}/></div>
        </div>
        <div style={S.row}><label style={S.label}>Fertilizer Blend</label>
          <select style={S.input} value={v.fertBlend||""} onChange={e=>set({...v,fertBlend:e.target.value})}>
            <option value="">Select blend…</option>{FERT_BLENDS.map(b=><option key={b}>{b}</option>)}
          </select>
        </div>
        {v.fertBlend==="Custom Blend"&&<div style={S.row}><label style={S.label}>Custom Blend Analysis</label><input style={S.input} type="text" placeholder="e.g. 16-20-10-5S" value={v.fertCustom||""} onChange={e=>set({...v,fertCustom:e.target.value})}/></div>}
      </div>
      {v.crop==="Peas"&&(
        <div style={{background:"#EFF7ED",border:`1px solid #A8CCA4`,borderRadius:"8px",padding:"14px",marginBottom:"14px"}}>
          <p style={{margin:"0 0 12px",fontSize:"11px",color:"#2A6A28",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🧪 Inoculant (Peas)</p>
          <div style={S.g2}>
            <div style={S.row}><label style={S.label}>Inoculant Product</label><input style={S.input} type="text" placeholder="e.g. Nodulator PRO, TagTeam" value={v.inoculantProduct||""} onChange={e=>set({...v,inoculantProduct:e.target.value})}/></div>
            <div style={S.row}><label style={S.label}>Application Rate</label><input style={S.input} type="text" placeholder="e.g. 4 oz / cwt" value={v.inoculantRate||""} onChange={e=>set({...v,inoculantRate:e.target.value})}/></div>
          </div>
        </div>
      )}
      <div style={S.g2}>
        <div style={S.row}><label style={S.label}>Seeder / Equipment</label><input style={S.input} type="text" placeholder="e.g. JD 1910 Air Cart" value={v.equipment||""} onChange={e=>set({...v,equipment:e.target.value})}/></div>
        <div style={S.row}><label style={S.label}>Seeding Depth (in)</label><input style={S.input} type="number" step="0.25" placeholder="e.g. 1.5" value={v.depth||""} onChange={e=>set({...v,depth:e.target.value})}/></div>
      </div>
    </div>
  );
}

// ── Spraying Form ─────────────────────────────────────────────────────
function SprayingForm({v,set}){
  const mix=v.tankMix||[];
  const add=()=>set({...v,tankMix:[...mix,{id:genId(),chemical:"",oz:"",unit:"oz/ac"}]});
  const upd=(id,f,val)=>set({...v,tankMix:mix.map(c=>c.id===id?{...c,[f]:val}:c)});
  const del=(id)=>set({...v,tankMix:mix.filter(c=>c.id!==id)});
  return(
    <div>
      <div style={S.g2}>
        <div style={S.row}><label style={S.label}>Water Volume (gal / ac)</label><input style={S.input} type="number" step="0.5" placeholder="e.g. 10" value={v.waterVol||""} onChange={e=>set({...v,waterVol:e.target.value})}/></div>
        <div style={S.row}><label style={S.label}>Sprayer / Equipment</label><input style={S.input} type="text" placeholder="e.g. Case 4430" value={v.equipment||""} onChange={e=>set({...v,equipment:e.target.value})}/></div>
      </div>
      <div style={{background:"#EEF3FA",border:`1px solid #A8C0DC`,borderRadius:"8px",padding:"14px",marginBottom:"14px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
          <p style={{margin:0,fontSize:"11px",color:"#2A5080",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>💧 Tank Mix</p>
          <button style={{...mkBtn("ghost"),padding:"5px 12px",fontSize:"12px",borderColor:"#1E5078",color:"#1E5078"}} onClick={add}>+ Add Chemical</button>
        </div>
        {mix.length===0&&<div style={{textAlign:"center",padding:"18px",color:T.faint,fontSize:"13px",border:`1px dashed ${T.border}`,borderRadius:"6px"}}>Click "+ Add Chemical" to build your tank mix</div>}
        {mix.map((c,i)=>(
          <div key={c.id} style={{background:"#F4F6FB",border:`1px solid #C0CCE0`,borderRadius:"8px",padding:"12px",marginBottom:"8px"}}>
            <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap"}}>
              <div style={{flex:"3 1 160px"}}>
                <label style={S.label}>Chemical #{i+1}</label>
                <select style={S.input} value={c.chemical} onChange={e=>upd(c.id,"chemical",e.target.value)}>
                  <option value="">Select chemical…</option>{CHEMICALS.map(ch=><option key={ch}>{ch}</option>)}
                </select>
                {c.chemical==="Other"&&<input style={{...S.input,marginTop:"6px"}} type="text" placeholder="Chemical name" value={c.chemicalName||""} onChange={e=>upd(c.id,"chemicalName",e.target.value)}/>}
              </div>
              <div style={{flex:"1 1 70px"}}><label style={S.label}>Rate</label><input style={S.input} type="number" step="0.1" placeholder="16" value={c.oz} onChange={e=>upd(c.id,"oz",e.target.value)}/></div>
              <div style={{flex:"1 1 80px"}}><label style={S.label}>Unit</label>
                <select style={S.input} value={c.unit} onChange={e=>upd(c.id,"unit",e.target.value)}>
                  {["oz/ac","fl oz/ac","ml/ac","L/ac","lbs/ac","pt/ac","qt/ac"].map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <button style={{...mkBtn("ghost"),padding:"7px 10px",color:T.danger,border:"none",background:"transparent",fontSize:"16px"}} onClick={()=>del(c.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
      <div style={S.row}><label style={S.label}>Target / Purpose</label><input style={S.input} type="text" placeholder="e.g. Pre-seed burnoff, broadleaf weeds" value={v.purpose||""} onChange={e=>set({...v,purpose:e.target.value})}/></div>
    </div>
  );
}

// ── Activity Card ─────────────────────────────────────────────────────
function ActivityCard({activity,onDelete}){
  const[open,setOpen]=useState(false);
  const meta=ACTIVITY_META[activity.type]||ACTIVITY_META.other;
  const d=activity.data||{};
  const summary=()=>{
    if(activity.type==="seeding") return[d.crop&&`Crop: ${d.crop}`,d.seedRate&&`${d.seedRate} lbs/ac`,(d.fertBlend&&d.fertBlend!=="Custom Blend")&&`Fert: ${d.fertBlend}`,(d.fertBlend==="Custom Blend"&&d.fertCustom)&&`Fert: ${d.fertCustom}`,d.inoculantProduct&&`Inoc: ${d.inoculantProduct}`].filter(Boolean).join("  ·  ");
    if(activity.type==="spraying") return(d.tankMix||[]).map(c=>`${c.chemical==="Other"?(c.chemicalName||"?"):c.chemical} ${c.oz}${c.unit}`).join(", ")||"No chemicals";
    return d.details||"";
  };
  const detail=()=>{
    if(activity.type==="seeding") return(
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 16px",marginTop:"10px",fontSize:"13px"}}>
        {d.crop&&<span><span style={{color:T.muted}}>Crop:</span> {d.crop}</span>}
        {d.seedRate&&<span><span style={{color:T.muted}}>Seed rate:</span> {d.seedRate} lbs/ac</span>}
        {d.totalSeed&&<span><span style={{color:T.muted}}>Total seed:</span> {Number(d.totalSeed).toLocaleString()} lbs</span>}
        {d.fertBlend&&<span><span style={{color:T.muted}}>Fert blend:</span> {d.fertBlend==="Custom Blend"?d.fertCustom:d.fertBlend}</span>}
        {d.fertRate&&<span><span style={{color:T.muted}}>Fert rate:</span> {d.fertRate} lbs/ac</span>}
        {d.totalFert&&<span><span style={{color:T.muted}}>Total fert:</span> {Number(d.totalFert).toLocaleString()} lbs</span>}
        {d.inoculantProduct&&<span><span style={{color:T.muted}}>Inoculant:</span> {d.inoculantProduct}</span>}
        {d.inoculantRate&&<span><span style={{color:T.muted}}>Inoc rate:</span> {d.inoculantRate}</span>}
        {d.equipment&&<span><span style={{color:T.muted}}>Equipment:</span> {d.equipment}</span>}
        {d.depth&&<span><span style={{color:T.muted}}>Depth:</span> {d.depth}"</span>}
      </div>
    );
    if(activity.type==="spraying") return(
      <div style={{marginTop:"10px",fontSize:"13px"}}>
        {d.waterVol&&<div style={{marginBottom:"5px"}}><span style={{color:T.muted}}>Water vol:</span> {d.waterVol} gal/ac</div>}
        {d.equipment&&<div style={{marginBottom:"5px"}}><span style={{color:T.muted}}>Equipment:</span> {d.equipment}</div>}
        {d.purpose&&<div style={{marginBottom:"8px"}}><span style={{color:T.muted}}>Purpose:</span> {d.purpose}</div>}
        {(d.tankMix||[]).length>0&&<><p style={{margin:"0 0 4px",fontSize:"11px",color:T.muted,textTransform:"uppercase",letterSpacing:"0.8px"}}>Tank Mix</p>
          {d.tankMix.map((c,i)=><div key={c.id||i} style={{display:"flex",gap:"12px",padding:"5px 10px",background:T.panel,borderRadius:"4px",marginBottom:"4px"}}><span style={{flex:1}}>{c.chemical==="Other"?(c.chemicalName||"—"):c.chemical}</span><span style={{color:T.gold,fontWeight:700}}>{c.oz} {c.unit}</span></div>)}</>}
      </div>
    );
    return d.details?<p style={{marginTop:"8px",fontSize:"13px"}}>{d.details}</p>:null;
  };
  return(
    <div style={{...S.card,borderLeft:`3px solid ${meta.color}`,padding:"11px 14px",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
      <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
        <span style={{fontSize:"17px"}}>{meta.icon}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
            <span style={{fontWeight:700,color:meta.color,fontSize:"13px"}}>{meta.label}</span>
            <span style={{color:T.faint,fontSize:"11px"}}>•</span>
            <span style={{color:T.muted,fontSize:"12px"}}>{fmtDate(activity.date)}</span>
          </div>
          {!open&&summary()&&<p style={{margin:"2px 0 0",fontSize:"12px",color:"#B8A890",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"430px"}}>{summary()}</p>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
          <span style={{color:T.faint,fontSize:"11px"}}>{open?"▲":"▼"}</span>
          <button style={{...mkBtn("ghost"),padding:"3px 7px",fontSize:"11px",color:T.danger,borderColor:"#4A1010"}} onClick={e=>{e.stopPropagation();onDelete(activity.id)}}>✕</button>
        </div>
      </div>
      {open&&<div style={{borderTop:`1px solid ${T.border}`,marginTop:"10px",paddingTop:"4px"}}>{detail()}{activity.notes&&<p style={{margin:"10px 0 0",fontSize:"12px",color:T.muted,fontStyle:"italic"}}>📝 {activity.notes}</p>}</div>}
    </div>
  );
}

// ── Add Activity Modal ────────────────────────────────────────────────
function AddActivityModal({field,onClose,onSave}){
  const[type,setType]=useState("");const[date,setDate]=useState(nowLocal());
  const[data,setData]=useState({});const[notes,setNotes]=useState("");const[err,setErr]=useState("");
  const save=()=>{ if(!type){setErr("Please select an activity type.");return;} onSave({id:genId(),fieldId:field.id,type,date,data,notes}); onClose(); };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:200,overflowY:"auto",display:"flex",justifyContent:"center",padding:"20px 12px"}}>
      <div style={{background:"#E8DFD0",border:`1px solid ${T.borderHi}`,borderRadius:"12px",width:"100%",maxWidth:"620px",padding:"22px",alignSelf:"flex-start",marginTop:"10px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"18px"}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"20px",color:T.gold,margin:0}}>Log Activity — <span style={{color:T.text}}>{field.name}</span></h2>
          <button style={{...mkBtn("ghost"),padding:"5px 10px"}} onClick={onClose}>✕</button>
        </div>
        <div style={S.row}><label style={S.label}>Date & Time</label><input style={S.input} type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></div>
        <div style={S.row}>
          <label style={S.label}>Activity Type</label>
          <div style={S.g3}>
            {Object.entries(ACTIVITY_META).map(([k,m])=>(
              <button key={k} style={{...mkBtn("ghost"),justifyContent:"center",flexDirection:"column",padding:"10px 4px",fontSize:"11px",gap:"3px",background:type===k?m.color:T.card,color:type===k?"#FDFAF4":T.muted,border:`1px solid ${type===k?m.color:T.border}`,borderRadius:"8px"}} onClick={()=>{setType(k);setData({});setErr("");}}>
                <span style={{fontSize:"20px"}}>{m.icon}</span><span style={{fontWeight:700}}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
        {type==="seeding"&&<SeedingForm v={data} set={setData}/>}
        {type==="spraying"&&<SprayingForm v={data} set={setData}/>}
        {["rockPicking","tillage","harvest","other"].includes(type)&&<div style={S.row}><label style={S.label}>Details / Equipment</label><input style={S.input} type="text" placeholder="Describe equipment, area, conditions…" value={data.details||""} onChange={e=>setData({...data,details:e.target.value})}/></div>}
        {type&&<div style={S.row}><label style={S.label}>Notes</label><textarea style={{...S.input,height:"60px",resize:"vertical"}} placeholder="Weather, observations…" value={notes} onChange={e=>setNotes(e.target.value)}/></div>}
        {err&&<p style={{color:"#E05050",fontSize:"13px",margin:"0 0 10px"}}>{err}</p>}
        <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
          <button style={mkBtn("ghost")} onClick={onClose}>Cancel</button>
          <button style={mkBtn("primary")} onClick={save} disabled={!type}>Save Activity</button>
        </div>
      </div>
    </div>
  );
}

// ── Field Detail ──────────────────────────────────────────────────────
function FieldDetailView({field,activities,onBack,onAddActivity,onDeleteActivity,onUpdateField,onDeleteField}){
  const[mapOpen,setMapOpen]=useState(field.boundary?.length>=3);const[editName,setEditName]=useState(false);
  const[nameVal,setNameVal]=useState(field.name);const[acresVal,setAcresVal]=useState(field.acres||"");
  const[filter,setFilter]=useState("all");const[confirmDelete,setConfirmDelete]=useState(false);
  const all=activities.filter(a=>a.fieldId===field.id);
  const shown=all.filter(a=>filter==="all"||a.type===filter).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const stats=Object.entries(ACTIVITY_META).map(([k,m])=>({...m,key:k,n:all.filter(a=>a.type===k).length})).filter(x=>x.n>0);
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"18px",flexWrap:"wrap"}}>
        <button style={{...mkBtn("ghost"),padding:"6px 12px"}} onClick={onBack}>← Fields</button>
        {!editName
          ?<><h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"22px",margin:0,flex:1}}>{field.name}</h2>{field.acres&&<span style={{color:T.muted,fontSize:"14px"}}>{field.acres} ac</span>}<button style={{...mkBtn("ghost"),padding:"5px 10px",fontSize:"12px"}} onClick={()=>setEditName(true)}>✏️ Edit</button></>
          :<div style={{display:"flex",gap:"8px",flex:1,alignItems:"center",flexWrap:"wrap"}}><input style={{...S.input,flex:"2 1 160px"}} value={nameVal} onChange={e=>setNameVal(e.target.value)}/><input style={{...S.input,flex:"1 1 80px",width:"auto"}} type="number" placeholder="Acres" value={acresVal} onChange={e=>setAcresVal(e.target.value)}/><button style={{...mkBtn("primary"),padding:"6px 12px",fontSize:"12px"}} onClick={()=>{onUpdateField(field.id,{name:nameVal,acres:acresVal});setEditName(false);}}>Save</button><button style={{...mkBtn("ghost"),padding:"6px 12px",fontSize:"12px"}} onClick={()=>setEditName(false)}>Cancel</button></div>
        }
        <button style={mkBtn("primary")} onClick={onAddActivity}>+ Log Activity</button>
        <button style={{...mkBtn("danger"),padding:"6px 12px",fontSize:"12px"}} onClick={()=>setConfirmDelete(true)}>🗑 Delete</button>
      </div>

      {/* Delete confirmation */}
      {confirmDelete&&(
        <div style={{...S.card,background:"#FDF0EE",border:`1px solid #E0A0A0`,marginBottom:"16px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
          <span style={{flex:1,fontSize:"13px",color:"#841A18"}}>Delete <strong>{field.name}</strong> and all its activity logs? This cannot be undone.</span>
          <button style={{...mkBtn("danger"),padding:"6px 14px",fontSize:"12px"}} onClick={()=>onDeleteField(field.id)}>Yes, Delete</button>
          <button style={{...mkBtn("ghost"),padding:"6px 12px",fontSize:"12px"}} onClick={()=>setConfirmDelete(false)}>Cancel</button>
        </div>
      )}

      {stats.length>0&&<div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px"}}>{stats.map(s=><div key={s.key} style={{padding:"5px 12px",borderRadius:"20px",background:T.card,border:`1px solid ${s.color}40`,fontSize:"12px",display:"flex",gap:"5px",alignItems:"center"}}><span>{s.icon}</span><span style={{color:s.color,fontWeight:700}}>{s.n}×</span><span style={{color:T.muted}}>{s.label}</span></div>)}</div>}
      <div style={S.card}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontWeight:700,color:T.gold,fontSize:"13px"}}>📍 Field Boundary</span>
          <button style={{...mkBtn("ghost"),padding:"4px 10px",fontSize:"12px"}} onClick={()=>setMapOpen(o=>!o)}>
            {mapOpen?"Hide Map":field.boundary?.length?"View / Edit Map":"Draw Boundary"}
          </button>
        </div>
        {!mapOpen&&<p style={{margin:"6px 0 0",fontSize:"12px",color:T.muted}}>{field.boundary?.length>=3?`Boundary set — ${field.boundary.length} corner points`:"No boundary drawn yet."}</p>}
        {mapOpen&&<div style={{marginTop:"12px"}}><FieldMap key={`${field.id}-map`} boundary={field.boundary||[]} onBoundaryChange={(pts)=>{onUpdateField(field.id,{boundary:pts});}} height={320}/></div>}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px",marginTop:"4px"}}>
        <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"16px",margin:0,color:T.gold}}>Activity Log</h3>
        <select style={{...S.input,width:"auto",padding:"5px 10px",fontSize:"12px"}} value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="all">All Types</option>
          {Object.entries(ACTIVITY_META).map(([k,m])=><option key={k} value={k}>{m.icon} {m.label}</option>)}
        </select>
      </div>
      {shown.length===0&&<div style={{...S.card,textAlign:"center",padding:"36px",color:T.faint}}>{all.length===0?"No activities logged yet. Click \"+ Log Activity\" to get started.":"No activities match this filter."}</div>}
      {shown.map(a=><ActivityCard key={a.id} activity={a} onDelete={onDeleteActivity}/>)}
    </div>
  );
}

// ── Add Field View ────────────────────────────────────────────────────
function AddFieldView({onBack,onSave}){
  const[name,setName]=useState("");const[acres,setAcres]=useState("");const[legal,setLegal]=useState("");
  const[boundary,setBdry]=useState(null);const[err,setErr]=useState("");
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px"}}>
        <button style={{...mkBtn("ghost"),padding:"6px 12px"}} onClick={onBack}>← Back</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"22px",margin:0}}>Add New Field</h2>
      </div>
      <div style={S.card}>
        <h3 style={S.sh}>Field Details</h3>
        <div style={S.g2}>
          <div style={S.row}><label style={S.label}>Field Name *</label><input style={S.input} type="text" placeholder="e.g. North Half, Home Quarter" value={name} onChange={e=>{setName(e.target.value);setErr("");}}/></div>
          <div style={S.row}><label style={S.label}>Acres</label><input style={S.input} type="number" step="0.1" placeholder="e.g. 320" value={acres} onChange={e=>setAcres(e.target.value)}/></div>
        </div>
        <div style={S.row}><label style={S.label}>Legal Description</label><input style={S.input} type="text" placeholder="e.g. NW-12-34-15-W4" value={legal} onChange={e=>setLegal(e.target.value)}/></div>
      </div>
      <div style={S.card}>
        <h3 style={S.sh}>Draw Field Boundary</h3>
        <p style={{margin:"0 0 12px",fontSize:"13px",color:T.muted}}>Navigate to your field on the satellite map, then click corner points around the boundary.</p>
        <FieldMap onBoundaryChange={setBdry} height={380}/>
        {boundary?.length>=3&&<p style={{margin:"8px 0 0",fontSize:"12px",color:T.green}}>✓ Boundary captured — {boundary.length} points</p>}
      </div>
      {err&&<p style={{color:"#E05050",fontSize:"13px"}}>{err}</p>}
      <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
        <button style={mkBtn("ghost")} onClick={onBack}>Cancel</button>
        <button style={mkBtn("primary")} onClick={()=>{if(!name.trim()){setErr("Field name required.");return;}onSave({id:genId(),name:name.trim(),acres,legalDesc:legal,boundary:boundary||[]});}}>Create Field</button>
      </div>
    </div>
  );
}

// ── Import Fields Modal ───────────────────────────────────────────────
function ImportFieldsModal({onClose,onImport}){
  const[tab,setTab]      =useState("file");
  const[step,setStep]    =useState("upload");
  const[parsed,setParsed]=useState([]);
  const[names,setNames]  =useState({});
  const[sel,setSel]      =useState({});
  const[err,setErr]      =useState("");
  const[busy,setBusy]    =useState(false);
  const[scanNote,setScanNote]=useState("");
  const[mergeName,setMergeName]=useState("");

  const processFields=(fields)=>{
    if(!fields.length){setErr("No polygon fields found in this file.");return;}
    setParsed(fields);
    setNames(Object.fromEntries(fields.map(f=>[f.id,f.name])));
    setSel(Object.fromEntries(fields.map(f=>[f.id,true])));
    setStep("preview");
  };

  // ── File import ──
  const handleFile=async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    setBusy(true); setErr("");
    try{
      const ext=file.name.split(".").pop().toLowerCase();
      if(ext==="geojson"||ext==="json"){
        processFields(parseGeoJSONFields(await file.text()));
      } else if(ext==="kml"){
        processFields(parseKMLFields(await file.text()));
      } else {
        setErr(`Unsupported format: .${ext} — please use .geojson, .json, or .kml`);
      }
    }catch(e){ setErr("Could not parse file: "+e.message); }
    finally{ setBusy(false); }
  };

  // ── AI image scan ──
  const handleScan=async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    setBusy(true); setErr(""); setScanNote("");
    try{
      if(!ANTHROPIC_KEY) throw new Error("API key not configured — check ANTHROPIC_KEY in Netlify environment variables.");

      // Resize to max 1600px JPEG to keep payload manageable
      const base64=await new Promise((res,rej)=>{
        const img=new Image();
        const url=URL.createObjectURL(file);
        img.onload=()=>{
          const MAX=1600;
          const scale=Math.min(1,MAX/Math.max(img.width,img.height));
          const c=document.createElement("canvas");
          c.width=Math.round(img.width*scale);
          c.height=Math.round(img.height*scale);
          c.getContext("2d").drawImage(img,0,0,c.width,c.height);
          c.toBlob(blob=>{
            const r=new FileReader();
            r.onload=()=>res(r.result.split(",")[1]);
            r.onerror=rej; r.readAsDataURL(blob);
          },"image/jpeg",0.82);
          URL.revokeObjectURL(url);
        };
        img.onerror=rej; img.src=url;
      });

      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-api-key":ANTHROPIC_KEY,
          "anthropic-version":"2023-06-01",
          "anthropic-dangerous-direct-browser-access":"true",
        },
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:2000,
          messages:[{role:"user",content:[
            {type:"image",source:{type:"base64",media_type:"image/jpeg",data:base64}},
            {type:"text",text:`This is a USDA FSA farm map from Montana.

Step 1 — Read every field label: tract numbers, field numbers, legal descriptions (Section-Township-Range), and acreages.

Step 2 — For each field, calculate four corner GPS coordinates using the Montana PLSS system:
- Montana Principal Meridian: 45.7764°N, 111.0667°W
- Townships go north (N) from baseline, each 6 miles (0.08682° lat)
- Ranges go east (E) or west (W) from meridian, each 6 miles
- Sections are 1×1 mile, numbered 1-36 (row 1 north: 6,5,4,3,2,1 west to east; row 2: 7,8,9,10,11,12 west to east; etc.)
- Quarter sections (NW/NE/SW/SE) are 0.5×0.5 mile (160 ac)

Reply ONLY with valid JSON, no markdown fences:
{"fields":[{"name":"Tract 1 Field 1","acres":160,"legalDesc":"NW Sec 12 T34N R15E","boundary":[[lat,lng],[lat,lng],[lat,lng],[lat,lng]]}],"notes":"accuracy note"}`}
          ]}]
        })
      });

      if(!resp.ok){
        const body=await resp.text();
        throw new Error(`API ${resp.status}: ${body.slice(0,300)}`);
      }
      const data=await resp.json();
      const txt=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      if(!txt) throw new Error("Empty response — check API key and credits at console.anthropic.com");
      const match=txt.match(/\{[\s\S]*\}/);
      if(!match) throw new Error("Response wasn't JSON. Got: "+txt.slice(0,200));
      const result=JSON.parse(match[0]);
      setScanNote(result.notes||"");
      const fields=(result.fields||[]).map(f=>({
        id:genId(), name:f.name||"Scanned Field",
        acres:f.acres?String(f.acres):"", legalDesc:f.legalDesc||"",
        boundary:Array.isArray(f.boundary)&&f.boundary.length>=3?f.boundary:[],
      }));
      processFields(fields);
    }catch(e){ setErr("Scan failed: "+e.message); }
    finally{ setBusy(false); }
  };

  const doImport=()=>{
    onImport(parsed.filter(f=>sel[f.id]).map(f=>({...f,name:names[f.id]||f.name})));
    onClose();
  };
  const allSel=parsed.every(f=>sel[f.id]);
  const toggleAll=()=>setSel(Object.fromEntries(parsed.map(f=>[f.id,!allSel])));

  const selCount=parsed.filter(f=>sel[f.id]).length;

  const doMerge=()=>{
    const toMerge=parsed.filter(f=>sel[f.id]);
    if(toMerge.length<2) return;
    const allPts=toMerge.flatMap(f=>f.boundary);
    const hull=convexHull(allPts);
    const totalAcres=toMerge.reduce((s,f)=>s+(parseFloat(f.acres)||0),0);
    const newField={
      id:genId(),
      name:mergeName||toMerge.map(f=>names[f.id]||f.name).join(" + "),
      acres:totalAcres?String(Math.round(totalAcres*10)/10):"",
      legalDesc:"",
      boundary:hull,
    };
    const remaining=parsed.filter(f=>!sel[f.id]);
    const next=[...remaining,newField];
    setParsed(next);
    setNames(n=>({...n,[newField.id]:newField.name}));
    setSel({[newField.id]:true});
    setMergeName("");
  };

  const tabBtn=(id,label)=>({
    ...mkBtn("ghost"), padding:"6px 16px", fontSize:"13px",
    background:tab===id?T.gold:"transparent",
    color:tab===id?"#FDFAF4":T.muted,
    border:`1px solid ${tab===id?T.gold:T.border}`,
    borderRadius:"6px",
  });

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:200,overflowY:"auto",display:"flex",justifyContent:"center",padding:"20px 12px"}}>
      <div style={{background:"#E8DFD0",border:`1px solid ${T.borderHi}`,borderRadius:"12px",width:"100%",maxWidth:"620px",padding:"22px",alignSelf:"flex-start",marginTop:"10px"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"18px"}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"20px",color:T.gold,margin:0}}>Import Fields</h2>
          <button style={{...mkBtn("ghost"),padding:"5px 10px"}} onClick={onClose}>✕</button>
        </div>

        {step==="upload"&&<>
          {/* Tabs */}
          <div style={{display:"flex",gap:"8px",marginBottom:"18px"}}>
            <button style={tabBtn("file","📂 Import File")} onClick={()=>{setTab("file");setErr("");}}>📂 Import File</button>
            <button style={tabBtn("scan","🤖 Scan Map Image")} onClick={()=>{setTab("scan");setErr("");}}>🤖 Scan Map Image</button>
          </div>

          {tab==="file"&&(
            <div>
              <div style={{background:"#F8F4EC",border:`1px dashed ${T.borderHi}`,borderRadius:"8px",padding:"24px",textAlign:"center",marginBottom:"14px"}}>
                <div style={{fontSize:"32px",marginBottom:"8px"}}>📂</div>
                <p style={{color:T.text,fontWeight:600,marginBottom:"4px"}}>Drop your FSA / CLU file here</p>
                <p style={{color:T.muted,fontSize:"12px",marginBottom:"16px"}}>Supports .geojson  ·  .json  ·  .kml</p>
                <label style={{...mkBtn("primary"),cursor:"pointer"}}>
                  Choose File
                  <input type="file" accept=".geojson,.json,.kml" style={{display:"none"}} onChange={handleFile} disabled={busy}/>
                </label>
              </div>
              <div style={{background:"#F5F5EC",border:`1px solid #D8D8B0`,borderRadius:"8px",padding:"12px",fontSize:"12px",color:T.muted}}>
                <p style={{margin:"0 0 6px",fontWeight:600,color:"#6A6830"}}>📋 How to get your FSA file</p>
                <p style={{margin:"0 0 4px"}}>1. Go to <strong style={{color:T.text}}>fsa.usda.gov</strong> → your local service center</p>
                <p style={{margin:"0 0 4px"}}>2. Or download from <strong style={{color:T.text}}>datagateway.nrcs.usda.gov</strong></p>
                <p style={{margin:0}}>3. Request your CLU (Common Land Unit) boundaries as GeoJSON</p>
              </div>
            </div>
          )}

          {tab==="scan"&&(
            <div>
              <div style={{background:"#F8F4EC",border:`1px dashed ${T.borderHi}`,borderRadius:"8px",padding:"24px",textAlign:"center",marginBottom:"14px"}}>
                <div style={{fontSize:"32px",marginBottom:"8px"}}>🤖</div>
                <p style={{color:T.text,fontWeight:600,marginBottom:"4px"}}>Upload a photo of your FSA map</p>
                <p style={{color:T.muted,fontSize:"12px",marginBottom:"4px"}}>Claude AI will read the section grid and extract field boundaries</p>
                <p style={{color:"#8A6A30",fontSize:"11px",marginBottom:"16px"}}>Works best with maps showing township/range/section labels</p>
                <label style={{...mkBtn("primary"),cursor:"pointer"}}>
                  Choose Image
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={handleScan} disabled={busy}/>
                </label>
              </div>
              {busy&&(
                <div style={{textAlign:"center",padding:"16px",color:T.muted,fontSize:"13px"}}>
                  <div style={{fontSize:"24px",marginBottom:"8px"}}>⏳</div>
                  Analyzing map image…
                </div>
              )}
            </div>
          )}
        </>}

        {step==="preview"&&(
          <div>
            {scanNote&&<div style={{background:"#F5F5EC",border:`1px solid #D8D8B0`,borderRadius:"6px",padding:"10px 12px",marginBottom:"14px",fontSize:"12px",color:"#6A6830"}}>🤖 {scanNote}</div>}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
              <span style={{color:T.muted,fontSize:"13px"}}>{parsed.length} field{parsed.length!==1?"s":""} found — select which to import</span>
              <button style={{...mkBtn("ghost"),padding:"4px 10px",fontSize:"12px"}} onClick={toggleAll}>{allSel?"Deselect All":"Select All"}</button>
            </div>

            {/* Merge bar — shows when 2+ fields are checked */}
            {selCount>=2&&(
              <div style={{display:"flex",gap:"8px",alignItems:"center",background:"#EDF2FB",border:`1px solid #A0B8E0`,borderRadius:"8px",padding:"10px 12px",marginBottom:"10px",flexWrap:"wrap"}}>
                <span style={{fontSize:"12px",color:"#2A4A90",fontWeight:700}}>🔗 Merge {selCount} selected fields</span>
                <input style={{...S.input,flex:"1 1 160px",padding:"5px 10px",fontSize:"12px"}} placeholder="Name for merged field (optional)" value={mergeName} onChange={e=>setMergeName(e.target.value)}/>
                <button style={{...mkBtn("primary"),padding:"6px 14px",fontSize:"12px",background:"#2A4A9A",color:"#fff"}} onClick={doMerge}>Merge →</button>
              </div>
            )}

            <div style={{maxHeight:"320px",overflowY:"auto",marginBottom:"14px"}}>
              {parsed.map(f=>(
                <div key={f.id} style={{display:"flex",gap:"10px",alignItems:"center",background:sel[f.id]?T.card:"#F5F0E8",border:`1px solid ${sel[f.id]?T.borderHi:T.border}`,borderRadius:"8px",padding:"10px 12px",marginBottom:"6px"}}>
                  <input type="checkbox" checked={!!sel[f.id]} onChange={e=>setSel(s=>({...s,[f.id]:e.target.checked}))} style={{width:"16px",height:"16px",accentColor:T.gold,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <input style={{...S.input,padding:"4px 8px",fontSize:"13px",fontWeight:600,marginBottom:"3px"}} value={names[f.id]||""} onChange={e=>setNames(n=>({...n,[f.id]:e.target.value}))} placeholder="Field name"/>
                    <span style={{fontSize:"11px",color:T.muted}}>{f.acres&&`${f.acres} ac  ·  `}{f.boundary.length} boundary points{f.legalDesc&&`  ·  ${f.legalDesc}`}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {err&&<p style={{color:"#E05050",fontSize:"12px",margin:"0 0 12px",background:"#1A0808",padding:"8px 12px",borderRadius:"6px"}}>{err}</p>}
        {busy&&step==="upload"&&tab==="file"&&<p style={{color:T.muted,fontSize:"12px",margin:"0 0 12px"}}>Parsing file…</p>}

        <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
          {step==="preview"&&<button style={mkBtn("ghost")} onClick={()=>{setStep("upload");setParsed([]);}}>← Back</button>}
          <button style={mkBtn("ghost")} onClick={onClose}>Cancel</button>
          {step==="preview"&&<button style={mkBtn("primary")} onClick={doImport} disabled={!parsed.some(f=>sel[f.id])}>Import {parsed.filter(f=>sel[f.id]).length} Field{parsed.filter(f=>sel[f.id]).length!==1?"s":""}</button>}
        </div>
      </div>
    </div>
  );
}

// ── Reports View ──────────────────────────────────────────────────────
function ReportsView({fields,activities,onBack}){
  const[type,setType]=useState("spraying");
  const[sortBy,setSortBy]=useState("date");   // "date" | "field"
  const[dateFrom,setDateFrom]=useState("");
  const[dateTo,setDateTo]=useState("");

  const fieldName=(id)=>fields.find(f=>f.id===id)?.name||"Unknown Field";

  // Filter and sort
  const results=activities
    .filter(a=>a.type===type)
    .filter(a=>!dateFrom||a.date>=dateFrom)
    .filter(a=>!dateTo  ||a.date<=dateTo+"T23:59")
    .sort((a,b)=>sortBy==="field"
      ? fieldName(a.fieldId).localeCompare(fieldName(b.fieldId)) || new Date(b.date)-new Date(a.date)
      : new Date(b.date)-new Date(a.date));

  const meta=ACTIVITY_META[type]||ACTIVITY_META.other;

  const print=()=>{
    const style=document.createElement("style");
    style.id="print-style";
    style.textContent=`@media print{body{background:#fff!important;color:#000!important;font-family:Arial,sans-serif;} .no-print{display:none!important;} .print-card{border:1px solid #ccc!important;background:#fff!important;break-inside:avoid;margin-bottom:8px;padding:10px;} h1,h2,h3{color:#000!important;}}`;
    document.head.appendChild(style);
    window.print();
    setTimeout(()=>document.getElementById("print-style")?.remove(),1000);
  };

  const renderDetail=(a)=>{
    const d=a.data||{};
    if(a.type==="spraying") return(
      <div>
        <div style={{display:"flex",gap:"20px",flexWrap:"wrap",marginBottom:"8px",fontSize:"13px"}}>
          {d.waterVol&&<span><span style={{color:T.muted}}>Water:</span> {d.waterVol} gal/ac</span>}
          {d.equipment&&<span><span style={{color:T.muted}}>Equipment:</span> {d.equipment}</span>}
          {d.purpose&&<span><span style={{color:T.muted}}>Purpose:</span> {d.purpose}</span>}
        </div>
        {(d.tankMix||[]).length>0&&(
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
            <thead>
              <tr style={{background:T.panel}}>
                <th style={{textAlign:"left",padding:"5px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase",letterSpacing:"0.7px"}}>Chemical</th>
                <th style={{textAlign:"right",padding:"5px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase",letterSpacing:"0.7px"}}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {d.tankMix.map((c,i)=>(
                <tr key={i} style={{borderBottom:`1px solid ${T.border}`}}>
                  <td style={{padding:"5px 8px"}}>{c.chemical==="Other"?(c.chemicalName||"—"):c.chemical}</td>
                  <td style={{padding:"5px 8px",textAlign:"right",fontWeight:600,color:T.gold}}>{c.oz} {c.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
    if(a.type==="seeding") return(
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"6px 16px",fontSize:"13px"}}>
        {d.crop&&<span><span style={{color:T.muted}}>Crop:</span> {d.crop}</span>}
        {d.seedRate&&<span><span style={{color:T.muted}}>Seed rate:</span> {d.seedRate} lbs/ac</span>}
        {d.totalSeed&&<span><span style={{color:T.muted}}>Total seed:</span> {Number(d.totalSeed).toLocaleString()} lbs</span>}
        {d.fertBlend&&<span><span style={{color:T.muted}}>Fert blend:</span> {d.fertBlend==="Custom Blend"?d.fertCustom:d.fertBlend}</span>}
        {d.fertRate&&<span><span style={{color:T.muted}}>Fert rate:</span> {d.fertRate} lbs/ac</span>}
        {d.totalFert&&<span><span style={{color:T.muted}}>Total fert:</span> {Number(d.totalFert).toLocaleString()} lbs</span>}
        {d.inoculantProduct&&<span><span style={{color:T.muted}}>Inoculant:</span> {d.inoculantProduct} @ {d.inoculantRate}</span>}
        {d.equipment&&<span><span style={{color:T.muted}}>Equipment:</span> {d.equipment}</span>}
        {d.depth&&<span><span style={{color:T.muted}}>Depth:</span> {d.depth}"</span>}
      </div>
    );
    return d.details?<p style={{margin:0,fontSize:"13px"}}>{d.details}</p>:null;
  };

  return(
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px",flexWrap:"wrap"}} className="no-print">
        <button style={{...mkBtn("ghost"),padding:"6px 12px"}} onClick={onBack}>← Home</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"22px",margin:0,flex:1}}>Reports</h2>
        <button style={{...mkBtn("ghost"),padding:"7px 14px",fontSize:"13px"}} onClick={print}>🖨 Print</button>
      </div>

      {/* Filters */}
      <div style={{...S.card,marginBottom:"16px"}} className="no-print">
        <div style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"flex-end"}}>
          {/* Activity type */}
          <div style={{flex:"1 1 300px"}}>
            <label style={S.label}>Activity Type</label>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {Object.entries(ACTIVITY_META).map(([k,m])=>(
                <button key={k} style={{
                  ...mkBtn("ghost"),padding:"6px 12px",fontSize:"12px",
                  background:type===k?m.color:"transparent",
                  color:type===k?"#FFFFFF":T.muted,
                  border:`1px solid ${type===k?m.color:T.border}`,
                  borderRadius:"6px",
                }} onClick={()=>setType(k)}>
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
          </div>
          {/* Date range */}
          <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap"}}>
            <div>
              <label style={S.label}>From</label>
              <input style={{...S.input,width:"140px"}} type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
            </div>
            <div>
              <label style={S.label}>To</label>
              <input style={{...S.input,width:"140px"}} type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
            </div>
            {(dateFrom||dateTo)&&<button style={{...mkBtn("ghost"),padding:"6px 10px",fontSize:"12px"}} onClick={()=>{setDateFrom("");setDateTo("");}}>Clear</button>}
          </div>
          {/* Sort */}
          <div>
            <label style={S.label}>Sort By</label>
            <div style={{display:"flex",gap:"4px"}}>
              <button style={{...mkBtn("ghost"),padding:"5px 12px",fontSize:"12px",background:sortBy==="date"?T.gold:"transparent",color:sortBy==="date"?"#FFFFFF":T.muted,border:`1px solid ${sortBy==="date"?T.gold:T.border}`}} onClick={()=>setSortBy("date")}>Date</button>
              <button style={{...mkBtn("ghost"),padding:"5px 12px",fontSize:"12px",background:sortBy==="field"?T.gold:"transparent",color:sortBy==="field"?"#FFFFFF":T.muted,border:`1px solid ${sortBy==="field"?T.gold:T.border}`}} onClick={()=>setSortBy("field")}>Field</button>
            </div>
          </div>
        </div>
      </div>

      {/* Print header (only shows when printing) */}
      <div style={{display:"none"}} className="print-header">
        <h1 style={{fontFamily:"'Playfair Display',serif",marginBottom:"4px"}}>{meta.icon} {meta.label} Report</h1>
        <p style={{color:T.muted,fontSize:"13px",marginBottom:"16px"}}>Generated {new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})} · {results.length} record{results.length!==1?"s":""}</p>
      </div>

      {/* Summary bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <span style={{fontFamily:"'Playfair Display',serif",fontSize:"18px",color:meta.color}}>{meta.icon} {meta.label}</span>
          <span style={{background:meta.color,color:"#fff",borderRadius:"12px",padding:"2px 10px",fontSize:"12px",fontWeight:700}}>{results.length} record{results.length!==1?"s":""}</span>
        </div>
        {results.length>0&&sortBy==="field"&&<span style={{fontSize:"12px",color:T.muted}}>{[...new Set(results.map(a=>a.fieldId))].length} field{[...new Set(results.map(a=>a.fieldId))].length!==1?"s":""}</span>}
      </div>

      {/* Results */}
      {results.length===0&&(
        <div style={{...S.card,textAlign:"center",padding:"40px",color:T.faint}}>
          No {meta.label.toLowerCase()} records found{(dateFrom||dateTo)?" in this date range":""}.
        </div>
      )}

      {sortBy==="field"
        ? // Grouped by field
          [...new Set(results.map(a=>a.fieldId))].map(fid=>{
            const fName=fieldName(fid);
            const fResults=results.filter(a=>a.fieldId===fid);
            return(
              <div key={fid} style={{marginBottom:"20px"}}>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"15px",color:T.text,margin:"0 0 8px",paddingBottom:"6px",borderBottom:`2px solid ${meta.color}`}}>
                  🌾 {fName} <span style={{color:T.muted,fontSize:"12px",fontWeight:400}}>— {fResults.length} application{fResults.length!==1?"s":""}</span>
                </h3>
                {fResults.map(a=>(
                  <div key={a.id} style={{...S.card,borderLeft:`3px solid ${meta.color}`,padding:"12px 14px",marginBottom:"8px"}} className="print-card">
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
                      <span style={{fontWeight:700,fontSize:"13px",color:meta.color}}>{fmtDate(a.date)}</span>
                    </div>
                    {renderDetail(a)}
                    {a.notes&&<p style={{margin:"8px 0 0",fontSize:"12px",color:T.muted,fontStyle:"italic"}}>📝 {a.notes}</p>}
                  </div>
                ))}
              </div>
            );
          })
        : // Sorted by date
          results.map(a=>(
            <div key={a.id} style={{...S.card,borderLeft:`3px solid ${meta.color}`,padding:"12px 14px",marginBottom:"8px"}} className="print-card">
              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px",flexWrap:"wrap"}}>
                <span style={{fontWeight:700,fontSize:"14px",color:T.text}}>🌾 {fieldName(a.fieldId)}</span>
                <span style={{color:T.faint}}>·</span>
                <span style={{fontSize:"13px",color:meta.color,fontWeight:600}}>{fmtDate(a.date)}</span>
              </div>
              {renderDetail(a)}
              {a.notes&&<p style={{margin:"8px 0 0",fontSize:"12px",color:T.muted,fontStyle:"italic"}}>📝 {a.notes}</p>}
            </div>
          ))
      }
    </div>
  );
}

// ── Home View ─────────────────────────────────────────────────────────
function HomeView({fields,activities,onSelect,onAdd,onImport,onReport}){
  const[q,setQ]=useState("");
  const filtered=fields.filter(f=>f.name.toLowerCase().includes(q.toLowerCase())||(f.legalDesc||"").toLowerCase().includes(q.toLowerCase()));
  return(
    <div>
      <div style={{background:"linear-gradient(135deg,#E8DDD0,#DDD3C0)",border:`1px solid ${T.borderHi}`,borderRadius:"12px",padding:"22px",marginBottom:"20px",display:"flex",alignItems:"center",gap:"16px"}}>
        <div style={{fontSize:"40px"}}>🌾</div>
        <div style={{flex:1}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"24px",margin:"0 0 4px",color:T.gold}}>FieldLog</h2>
          <p style={{margin:0,fontSize:"13px",color:T.muted}}>{fields.length} field{fields.length!==1?"s":""} · {activities.length} activit{activities.length!==1?"ies":"y"} logged</p>
        </div>
        <button style={{...mkBtn("ghost"),padding:"10px 16px",fontSize:"14px"}} onClick={onReport}>📊 Reports</button>
        <button style={{...mkBtn("ghost"),padding:"10px 16px",fontSize:"14px"}} onClick={onImport}>⬆ Import</button>
        <button style={{...mkBtn("primary"),padding:"10px 20px",fontSize:"14px"}} onClick={onAdd}>+ Add Field</button>
      </div>
      {fields.length>3&&<div style={S.row}><input style={S.input} type="search" placeholder="Search fields…" value={q} onChange={e=>setQ(e.target.value)}/></div>}
      {fields.length===0&&<div style={{...S.card,textAlign:"center",padding:"52px 24px"}}><div style={{fontSize:"48px",marginBottom:"12px"}}>🗺️</div><p style={{color:T.muted,marginBottom:"18px"}}>No fields registered yet.</p><button style={mkBtn("primary")} onClick={onAdd}>Add Your First Field</button></div>}
      {filtered.map(f=>{
        const fa=activities.filter(a=>a.fieldId===f.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
        const last=fa[0];const lm=last?(ACTIVITY_META[last.type]||ACTIVITY_META.other):null;
        const tc=Object.fromEntries(Object.keys(ACTIVITY_META).map(k=>[k,fa.filter(a=>a.type===k).length]));
        return(
          <div key={f.id} style={{...S.card,cursor:"pointer",transition:"all .15s"}} onClick={()=>onSelect(f)}
            onMouseEnter={e=>{e.currentTarget.style.background=T.cardHov;e.currentTarget.style.borderColor=T.borderHi;}}
            onMouseLeave={e=>{e.currentTarget.style.background=T.card;e.currentTarget.style.borderColor=T.border;}}>
            <div style={{display:"flex",gap:"14px",alignItems:"center"}}>
              <div style={{width:"46px",height:"46px",borderRadius:"8px",background:"#EAE0CC",border:`1px solid ${T.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"22px",flexShrink:0}}>🌾</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:"16px",marginBottom:"2px"}}>{f.name}</div>
                <div style={{color:T.muted,fontSize:"12px",display:"flex",gap:"8px"}}>{f.acres&&<span>{f.acres} ac</span>}{f.legalDesc&&<><span style={{color:T.faint}}>|</span><span>{f.legalDesc}</span></>}</div>
                <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginTop:"6px"}}>{Object.entries(tc).filter(([,n])=>n>0).map(([k,n])=>{const m=ACTIVITY_META[k];return<span key={k} style={{fontSize:"10px",padding:"2px 7px",borderRadius:"10px",background:T.panel,border:`1px solid ${m.color}40`,color:m.color}}>{m.icon} {n}</span>;})}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:"12px",color:T.muted,marginBottom:"4px"}}>{fa.length} log{fa.length!==1?"s":""}</div>
                {last&&<div style={{fontSize:"11px",color:lm.color}}>{lm.icon} {new Date(last.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>}
                <div style={{fontSize:"10px",color:T.faint,marginTop:"6px"}}>View →</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ╔═══════════════════════════════════════════════════════════╗
// ║  ROOT APP — Firebase sync wired in here                  ║
// ╚═══════════════════════════════════════════════════════════╝
export default function App(){
  const[view,setView]      =useState("home");
  const[fields,setFields]  =useState([]);
  const[activities,setActs]=useState([]);
  const[loading,setLoading]=useState(true);
  const[sync,setSync]      =useState("idle"); // "idle"|"saving"|"saved"|"error"|"offline"
  const[activeField,setAF] =useState(null);
  const[showAdd,setShowAdd] =useState(false);
  const[showImport,setShowImport]=useState(false);
  const skipSSE=useRef(false);  // prevent SSE echo after our own write

  // ── Sync status dot ──────────────────────────────────────
  const syncDot = {
    idle:    {bg:"#3A3028",label:""},
    saving:  {bg:"#8C5408",label:"Saving…"},
    saved:   {bg:"#2A5E2A",label:"Saved"},
    error:   {bg:"#841A18",label:"Save error"},
    offline: {bg:"#666",   label:"Offline mode"},
  }[sync];

  // ── Load on mount ────────────────────────────────────────
  useEffect(()=>{
    if(!FB_CONFIGURED){
      setFields(DEMO_FIELDS); setActs(DEMO_ACTIVITIES);
      setSync("offline"); setLoading(false); return;
    }
    fbRead("").then(data=>{
      if(data){
        setFields(obj2arr(data.fields||{}));
        setActs(obj2arr(data.activities||{}));
      }
    }).catch(()=>{
      setFields(DEMO_FIELDS); setActs(DEMO_ACTIVITIES); setSync("offline");
    }).finally(()=>setLoading(false));
  },[]);

  // ── Real-time SSE listener ───────────────────────────────
  useEffect(()=>{
    if(loading||!FB_CONFIGURED) return;
    return fbListen(({path,data})=>{
      if(skipSSE.current) return;
      if(!data) return;
      if(path==="/"||path===""){
        setFields(obj2arr(data.fields||{}));
        setActs(obj2arr(data.activities||{}));
      } else if(path==="/fields"){
        setFields(obj2arr(data));
      } else if(path==="/activities"){
        setActs(obj2arr(data));
      }
    });
  },[loading]);

  // ── Write helper ─────────────────────────────────────────
  const persist=useCallback(async(newFields,newActs)=>{
    if(!FB_CONFIGURED) return;
    setSync("saving");
    skipSSE.current=true;
    try{
      await fbSet("",{
        fields:    Object.fromEntries(newFields.map(f=>[f.id,f])),
        activities:Object.fromEntries(newActs.map(a=>[a.id,a])),
      });
      setSync("saved");
    }catch{
      setSync("error");
    }finally{
      setTimeout(()=>{ skipSSE.current=false; setSync("idle"); },1500);
    }
  },[]);

  // ── Mutations ─────────────────────────────────────────────
  const addField=(f)=>{
    const nf=[...fields,f]; setFields(nf); persist(nf,activities); setView("home");
  };
  const importFields=(imported)=>{
    const nf=[...fields,...imported]; setFields(nf); persist(nf,activities);
  };
  const updateField=(id,u)=>{
    const nf=fields.map(f=>f.id===id?{...f,...u}:f); setFields(nf); persist(nf,activities);
  };
  const addActivity=(a)=>{
    const na=[...activities,a]; setActs(na); persist(fields,na);
  };
  const delActivity=(id)=>{
    const na=activities.filter(a=>a.id!==id); setActs(na); persist(fields,na);
  };
  const deleteField=(id)=>{
    const nf=fields.filter(f=>f.id!==id);
    const na=activities.filter(a=>a.fieldId!==id);
    setFields(nf); setActs(na); persist(nf,na); setView("home");
  };

  const curField=activeField?fields.find(f=>f.id===activeField.id)||activeField:null;

  if(loading) return(
    <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:"16px"}}>
      <div style={{fontSize:"40px"}}>🌾</div>
      <p style={{color:T.muted,fontSize:"14px"}}>Loading from Firebase…</p>
    </div>
  );

  return(
    <div style={S.app}>
      {/* Header */}
      <div style={S.header}>
        <div style={{width:"36px",height:"36px",background:T.gold,borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px",flexShrink:0}}>🌾</div>
        <div>
          <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:"20px",color:T.gold,margin:0}}>FieldLog</h1>
          <p style={{margin:0,fontSize:"10px",color:T.faint,letterSpacing:"1.2px",textTransform:"uppercase"}}>Farm Activity Tracker</p>
        </div>
        {/* Sync indicator */}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:"6px"}}>
          {syncDot.label&&<span style={{fontSize:"11px",color:sync==="error"?T.danger:sync==="saved"?T.green:T.muted}}>{syncDot.label}</span>}
          <div style={{width:"8px",height:"8px",borderRadius:"50%",background:syncDot.bg,flexShrink:0}}/>
          {!FB_CONFIGURED&&<span style={{fontSize:"10px",color:"#7A5A20",background:"#2A1A04",border:"1px solid #5A3A10",borderRadius:"4px",padding:"2px 6px"}}>Configure Firebase</span>}
        </div>
        {view!=="home"&&<button style={{...mkBtn("ghost"),padding:"5px 12px",fontSize:"12px"}} onClick={()=>setView("home")}>Home</button>}
      </div>

      {/* Not configured banner */}
      {!FB_CONFIGURED&&(
        <div style={{background:"#FDF6EC",borderBottom:`1px solid #D4A840`,padding:"8px 20px",fontSize:"12px",color:"#7A5008",display:"flex",gap:"8px",alignItems:"center"}}>
          <span>⚠️</span>
          <span>Firebase not configured — running in demo mode. Set <code style={{background:"#F0E4C8",padding:"1px 4px",borderRadius:"3px",fontFamily:"monospace"}}>FIREBASE_URL</code> at the top of the file to enable persistence.</span>
        </div>
      )}

      <div style={S.content}>
        {view==="home"        &&<HomeView fields={fields} activities={activities} onSelect={f=>{setAF(f);setView("fieldDetail");}} onAdd={()=>setView("addField")} onImport={()=>setShowImport(true)} onReport={()=>setView("reports")}/>}
        {view==="reports"     &&<ReportsView fields={fields} activities={activities} onBack={()=>setView("home")}/>}
        {view==="addField"    &&<AddFieldView onBack={()=>setView("home")} onSave={addField}/>}
        {view==="fieldDetail" &&curField&&<FieldDetailView field={curField} activities={activities} onBack={()=>setView("home")} onAddActivity={()=>setShowAdd(true)} onDeleteActivity={delActivity} onUpdateField={updateField} onDeleteField={deleteField}/>}
      </div>

      {showAdd&&curField&&<AddActivityModal field={curField} onClose={()=>setShowAdd(false)} onSave={addActivity}/>}
      {showImport&&<ImportFieldsModal onClose={()=>setShowImport(false)} onImport={importFields}/>}
    </div>
  );
}

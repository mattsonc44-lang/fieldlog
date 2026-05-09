import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import JSZip from "jszip";

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
  spraying:    {label:"Spraying",     icon:"💧",color:"#1E5078"},
  scouting:    {label:"Scouting",     icon:"🔍",color:"#2A7A3A"},
  rockPicking: {label:"Rock Picking", icon:"🪨",color:"#9A7060"},
  tillage:     {label:"Tillage",      icon:"⚙️", color:"#6B8F71"},
  harvest:     {label:"Harvest",      icon:"🌾",color:"#C09010"},
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
function FieldMap({boundary=[],onBoundaryChange,height=350,readOnly=false}){
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
      // Zoom out 1 extra level for context
      return Math.min(16,Math.max(11,Math.round(Math.log2(0.08/span)+13)));
    }
    return 14;
  });
  const [pts,setPts]=useState(boundary.length?[...boundary]:[]);
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
    if(readOnly||dragRef.current.moved) return;
    const[x,y]=evXY(e); setPts(p=>[...p,px2ll(x,y)]);
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
    if(readOnly||touchR.current.moved||e.changedTouches.length!==1) return;
    const r=wrapRef.current.getBoundingClientRect();
    setPts(p=>[...p,px2ll(e.changedTouches[0].clientX-r.left,e.changedTouches[0].clientY-r.top)]);
  };
  const undo =()=>setPts(p=>p.slice(0,-1));
  const clear=()=>setPts([]);

  // Auto-save whenever pts changes (3+ points)
  useEffect(()=>{
    if(pts.length>=3&&onBoundaryChange) onBoundaryChange([...pts]);
    else if(pts.length===0&&onBoundaryChange) onBoundaryChange([]);
  },[pts]);

  const nPts=pts.length;
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"5px"}}>
        <span style={{fontSize:"11px",color:T.muted}}>
          {readOnly
            ? "Drag to pan · Scroll to zoom"
            : <>Drag to pan · Scroll to zoom · <strong style={{color:T.goldSoft}}>Click map to place corners</strong></>}
        </span>
        <div style={{display:"flex",gap:"3px"}}>
          <button style={{...mkBtn("ghost"),padding:"2px 10px",fontSize:"18px",lineHeight:1}} onClick={()=>setZoom(z=>Math.max(8,z-1))}>−</button>
          <button style={{...mkBtn("ghost"),padding:"2px 10px",fontSize:"18px",lineHeight:1}} onClick={()=>setZoom(z=>Math.min(18,z+1))}>+</button>
        </div>
      </div>
      <div ref={wrapRef} style={{position:"relative",width:"100%",height:`${H}px`,borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.borderHi}`,background:"#C8C8C0",cursor:readOnly?"grab":"crosshair",userSelect:"none"}}
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
      {!readOnly&&(
        <div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"8px",flexWrap:"wrap"}}>
          <span style={{flex:1,fontSize:"12px",color:nPts>=3?T.green:T.muted}}>
            {nPts<3?`Click to place corners — ${nPts} point${nPts!==1?"s":""} placed`:`✓ ${nPts} points — boundary auto-saved`}
          </span>
          <button style={{...mkBtn("ghost"),padding:"5px 11px",fontSize:"12px"}} onClick={undo}  disabled={!nPts}>Undo</button>
          <button style={{...mkBtn("ghost"),padding:"5px 11px",fontSize:"12px"}} onClick={clear} disabled={!nPts}>Clear</button>
        </div>
      )}
    </div>
  );
}

// ── Seeding Form ──────────────────────────────────────────────────────
const PULSE_CROPS = ["Peas","Lentils","Chickpeas","Soybeans"];

function SeedingForm({v,set}){
  // ── Crops (multiple for double-crop) ──
  const crops   = v.crops   || (v.crop ? [{id:genId(),crop:v.crop,seedRate:v.seedRate||"",totalSeed:v.totalSeed||""}] : [{id:genId(),crop:"",seedRate:"",totalSeed:""}]);
  const addCrop = ()=>set({...v,crops:[...crops,{id:genId(),crop:"",seedRate:"",totalSeed:""}]});
  const updCrop = (id,f,val)=>set({...v,crops:crops.map(c=>c.id===id?{...c,[f]:val}:c)});
  const delCrop = (id)=>set({...v,crops:crops.filter(c=>c.id!==id)});

  // ── Fertilizers (multiple products) ──
  const ferts   = v.ferts   || (v.fertBlend ? [{id:genId(),blend:v.fertBlend,custom:v.fertCustom||"",rate:v.fertRate||"",total:v.totalFert||"",placement:"Seed-placed"}] : []);
  const addFert = ()=>set({...v,ferts:[...ferts,{id:genId(),blend:"",custom:"",rate:"",total:"",placement:"Seed-placed"}]});
  const updFert = (id,f,val)=>set({...v,ferts:ferts.map(x=>x.id===id?{...x,[f]:val}:x)});
  const delFert = (id)=>set({...v,ferts:ferts.filter(x=>x.id!==id)});

  // ── Inoculants (multiple products) ──
  const inoculants   = v.inoculants   || (v.inoculantProduct ? [{id:genId(),product:v.inoculantProduct,rate:v.inoculantRate||""}] : []);
  const addInoculant = ()=>set({...v,inoculants:[...inoculants,{id:genId(),product:"",rate:""}]});
  const updInoculant = (id,f,val)=>set({...v,inoculants:inoculants.map(x=>x.id===id?{...x,[f]:val}:x)});
  const delInoculant = (id)=>set({...v,inoculants:inoculants.filter(x=>x.id!==id)});

  const hasPulse = crops.some(c=>PULSE_CROPS.includes(c.crop));
  const PLACEMENTS = ["Seed-placed","Side-band","Mid-row band","Broadcast","In-furrow"];

  return(
    <div>
      {/* ── Crops ── */}
      <div style={{background:"#F8F4EC",border:`1px solid #E0CFA0`,borderRadius:"8px",padding:"14px",marginBottom:"14px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
          <p style={{margin:0,fontSize:"11px",color:"#7A6020",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🌱 Crop(s) Seeded</p>
          <button style={{...mkBtn("ghost"),padding:"4px 10px",fontSize:"12px",borderColor:"#C0A040",color:"#7A6020"}} onClick={addCrop}>+ Add Crop</button>
        </div>
        {crops.map((c,i)=>(
          <div key={c.id} style={{background:"#FFFFFF",border:`1px solid #E0CFA0`,borderRadius:"7px",padding:"11px",marginBottom:"8px"}}>
            <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap"}}>
              <div style={{flex:"2 1 150px"}}>
                <label style={S.label}>{crops.length>1?`Crop #${i+1}`:"Crop"} *</label>
                <select style={S.input} value={c.crop} onChange={e=>updCrop(c.id,"crop",e.target.value)}>
                  <option value="">Select crop…</option>{CROPS.map(cr=><option key={cr}>{cr}</option>)}
                </select>
              </div>
              <div style={{flex:"1 1 90px"}}>
                <label style={S.label}>Rate (lbs/ac)</label>
                <input style={S.input} type="number" step="0.1" placeholder="e.g. 90" value={c.seedRate} onChange={e=>updCrop(c.id,"seedRate",e.target.value)}/>
              </div>
              <div style={{flex:"1 1 90px"}}>
                <label style={S.label}>Total (lbs)</label>
                <input style={S.input} type="number" step="1" placeholder="e.g. 14400" value={c.totalSeed} onChange={e=>updCrop(c.id,"totalSeed",e.target.value)}/>
              </div>
              {crops.length>1&&<button style={{...mkBtn("ghost"),padding:"7px 9px",color:T.danger,border:"none",background:"transparent",fontSize:"16px"}} onClick={()=>delCrop(c.id)}>✕</button>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Fertilizers ── */}
      <div style={{background:"#FBF6EC",border:`1px solid #E0CFA0`,borderRadius:"8px",padding:"14px",marginBottom:"14px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
          <p style={{margin:0,fontSize:"11px",color:T.muted,textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>⚗️ Fertilizer Products</p>
          <button style={{...mkBtn("ghost"),padding:"4px 10px",fontSize:"12px",borderColor:"#C0A040",color:"#7A6020"}} onClick={addFert}>+ Add Fertilizer</button>
        </div>
        {ferts.length===0&&<div style={{textAlign:"center",padding:"14px",color:T.faint,fontSize:"13px",border:`1px dashed ${T.border}`,borderRadius:"6px"}}>Click "+ Add Fertilizer" to log products applied</div>}
        {ferts.map((f,i)=>(
          <div key={f.id} style={{background:"#FFFFFF",border:`1px solid #E0CFA0`,borderRadius:"7px",padding:"11px",marginBottom:"8px"}}>
            <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap"}}>
              <div style={{flex:"2 1 150px"}}>
                <label style={S.label}>Product #{i+1}</label>
                <select style={S.input} value={f.blend} onChange={e=>updFert(f.id,"blend",e.target.value)}>
                  <option value="">Select blend…</option>{FERT_BLENDS.map(b=><option key={b}>{b}</option>)}
                </select>
                {f.blend==="Custom Blend"&&<input style={{...S.input,marginTop:"6px"}} type="text" placeholder="e.g. 16-20-10-5S" value={f.custom} onChange={e=>updFert(f.id,"custom",e.target.value)}/>}
              </div>
              <div style={{flex:"1 1 80px"}}>
                <label style={S.label}>Rate (lbs/ac)</label>
                <input style={S.input} type="number" step="0.1" placeholder="e.g. 40" value={f.rate} onChange={e=>updFert(f.id,"rate",e.target.value)}/>
              </div>
              <div style={{flex:"1 1 80px"}}>
                <label style={S.label}>Total (lbs)</label>
                <input style={S.input} type="number" step="1" placeholder="e.g. 6400" value={f.total} onChange={e=>updFert(f.id,"total",e.target.value)}/>
              </div>
              <div style={{flex:"1 1 110px"}}>
                <label style={S.label}>Placement</label>
                <select style={S.input} value={f.placement} onChange={e=>updFert(f.id,"placement",e.target.value)}>
                  {PLACEMENTS.map(p=><option key={p}>{p}</option>)}
                </select>
              </div>
              <button style={{...mkBtn("ghost"),padding:"7px 9px",color:T.danger,border:"none",background:"transparent",fontSize:"16px"}} onClick={()=>delFert(f.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Inoculants — always available, not just for peas ── */}
      <div style={{background:"#EFF7ED",border:`1px solid #A8CCA4`,borderRadius:"8px",padding:"14px",marginBottom:"14px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
          <p style={{margin:0,fontSize:"11px",color:"#2A6A28",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🧪 Inoculant / Seed Treatment</p>
          <button style={{...mkBtn("ghost"),padding:"4px 10px",fontSize:"12px",borderColor:"#80B87C",color:"#2A6A28"}} onClick={addInoculant}>+ Add Inoculant</button>
        </div>
        {inoculants.length===0&&<div style={{textAlign:"center",padding:"14px",color:T.faint,fontSize:"13px",border:`1px dashed #C0DCC0`,borderRadius:"6px"}}>{hasPulse?"Pulse crop detected — ":""}Click "+ Add Inoculant" to log treatments</div>}
        {inoculants.map((n,i)=>(
          <div key={n.id} style={{background:"#FFFFFF",border:`1px solid #A8CCA4`,borderRadius:"7px",padding:"11px",marginBottom:"8px"}}>
            <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap"}}>
              <div style={{flex:"2 1 180px"}}>
                <label style={S.label}>Product #{i+1}</label>
                <input style={S.input} type="text" placeholder="e.g. Nodulator PRO, TagTeam, Optimize" value={n.product} onChange={e=>updInoculant(n.id,"product",e.target.value)}/>
              </div>
              <div style={{flex:"1 1 120px"}}>
                <label style={S.label}>Rate</label>
                <input style={S.input} type="text" placeholder="e.g. 4 oz/cwt" value={n.rate} onChange={e=>updInoculant(n.id,"rate",e.target.value)}/>
              </div>
              <button style={{...mkBtn("ghost"),padding:"7px 9px",color:T.danger,border:"none",background:"transparent",fontSize:"16px"}} onClick={()=>delInoculant(n.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Equipment ── */}
      <div style={S.g2}>
        <div style={S.row}><label style={S.label}>Seeder / Equipment</label><input style={S.input} type="text" placeholder="e.g. JD 1910 Air Cart" value={v.equipment||""} onChange={e=>set({...v,equipment:e.target.value})}/></div>
        <div style={S.row}><label style={S.label}>Seeding Depth (in)</label><input style={S.input} type="number" step="0.25" placeholder="e.g. 1.5" value={v.depth||""} onChange={e=>set({...v,depth:e.target.value})}/></div>
      </div>
    </div>
  );
}

// ── Scouting Form ─────────────────────────────────────────────────────
const WEED_SPECIES = ["Wild Oats","Cleavers","Kochia","Foxtail","Thistle","Buckwheat","Mustard","Lamb's Quarters","Stinkweed","Dandelion","Other"];
const DISEASE_LIST = ["Sclerotinia","Fusarium","Root Rot","Leaf Spot","Stripe Rust","Stem Rust","Powdery Mildew","Clubroot","Ergot","Blackleg","Other"];
const INSECT_LIST  = ["Bertha Armyworm","Diamondback Moth","Flea Beetle","Aphids","Grasshoppers","Cutworm","Wheat Midge","Wireworm","Lygus Bug","Other"];
const RATING_5     = ["1 — None / Excellent","2 — Trace / Good","3 — Moderate / Fair","4 — High / Poor","5 — Severe / Very Poor"];
const RATING_3     = ["Low","Medium","High"];
const GROWTH_STAGES= ["Germination","Seedling (1-2 leaf)","3-4 Leaf","Tillering","Stem Elongation","Boot","Heading / Flowering","Milk","Dough","Ripening","Harvest Ready"];

function ScoutingForm({v,set}){
  const weeds    = v.weeds    || [];
  const diseases = v.diseases || [];
  const insects  = v.insects  || [];

  const addWeed    = ()=>set({...v,weeds:   [...weeds,   {id:genId(),species:"",pressure:"3 — Moderate / Fair",location:""}]});
  const updWeed    = (id,f,val)=>set({...v,weeds:   weeds.map(x=>x.id===id?{...x,[f]:val}:x)});
  const delWeed    = (id)=>set({...v,weeds:   weeds.filter(x=>x.id!==id)});

  const addDisease = ()=>set({...v,diseases:[...diseases,{id:genId(),disease:"",severity:"Low",affectedArea:""}]});
  const updDisease = (id,f,val)=>set({...v,diseases:diseases.map(x=>x.id===id?{...x,[f]:val}:x)});
  const delDisease = (id)=>set({...v,diseases:diseases.filter(x=>x.id!==id)});

  const addInsect  = ()=>set({...v,insects: [...insects, {id:genId(),insect:"",pressure:"Low",count:""}]});
  const updInsect  = (id,f,val)=>set({...v,insects: insects.map(x=>x.id===id?{...x,[f]:val}:x)});
  const delInsect  = (id)=>set({...v,insects: insects.filter(x=>x.id!==id)});

  const secStyle = (bg,border,headColor)=>({background:bg,border:`1px solid ${border}`,borderRadius:"8px",padding:"14px",marginBottom:"14px"});
  const rowStyle = (bg,border)=>({background:bg,border:`1px solid ${border}`,borderRadius:"7px",padding:"11px",marginBottom:"8px"});
  const addBtn   = (col)=>({...mkBtn("ghost"),padding:"4px 10px",fontSize:"12px",borderColor:col,color:col});
  const emptyBox = {textAlign:"center",padding:"12px",color:T.faint,fontSize:"13px",border:`1px dashed ${T.border}`,borderRadius:"6px"};

  return(
    <div>

      {/* ── Crop Status ── */}
      <div style={secStyle("#F8F4EC","#E0CFA0")}>
        <p style={{margin:"0 0 12px",fontSize:"11px",color:"#7A6020",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🌿 Crop Status</p>
        <div style={S.g2}>
          <div style={S.row}>
            <label style={S.label}>Growth Stage</label>
            <select style={S.input} value={v.growthStage||""} onChange={e=>set({...v,growthStage:e.target.value})}>
              <option value="">Select stage…</option>
              {GROWTH_STAGES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={S.row}>
            <label style={S.label}>Crop Health Rating</label>
            <select style={S.input} value={v.cropHealth||""} onChange={e=>set({...v,cropHealth:e.target.value})}>
              <option value="">Select rating…</option>
              {RATING_5.map(r=><option key={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div style={S.g2}>
          <div style={S.row}>
            <label style={S.label}>Stand Density</label>
            <select style={S.input} value={v.standDensity||""} onChange={e=>set({...v,standDensity:e.target.value})}>
              <option value="">Select…</option>
              {["Excellent (uniform, thick)","Good (minor gaps)","Fair (patchy)","Poor (thin / failed areas)"].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
          <div style={S.row}>
            <label style={S.label}>Estimated Yield Potential</label>
            <input style={S.input} type="text" placeholder="e.g. 45 bu/ac, above avg" value={v.yieldPotential||""} onChange={e=>set({...v,yieldPotential:e.target.value})}/>
          </div>
        </div>
      </div>

      {/* ── Weed Pressure ── */}
      <div style={secStyle("#FDF8F0","#E8C880")}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
          <p style={{margin:0,fontSize:"11px",color:"#8A6010",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🌿 Weed Pressure</p>
          <button style={addBtn("#C09030")} onClick={addWeed}>+ Add Weed</button>
        </div>
        <div style={S.g2}>
          <div style={S.row}>
            <label style={S.label}>Overall Weed Pressure</label>
            <select style={S.input} value={v.weedPressure||""} onChange={e=>set({...v,weedPressure:e.target.value})}>
              <option value="">Select…</option>{RATING_3.map(r=><option key={r}>{r}</option>)}
            </select>
          </div>
          <div style={S.row}>
            <label style={S.label}>Economic Threshold Reached?</label>
            <select style={S.input} value={v.weedThreshold||""} onChange={e=>set({...v,weedThreshold:e.target.value})}>
              <option value="">Select…</option>
              {["No — monitor only","Approaching threshold","Yes — action required"].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
        </div>
        {weeds.length===0&&<div style={emptyBox}>Click "+ Add Weed" to log specific species</div>}
        {weeds.map((w,i)=>(
          <div key={w.id} style={rowStyle("#FFFFFF","#E8C880")}>
            <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap"}}>
              <div style={{flex:"2 1 140px"}}>
                <label style={S.label}>Species #{i+1}</label>
                <select style={S.input} value={w.species} onChange={e=>updWeed(w.id,"species",e.target.value)}>
                  <option value="">Select species…</option>{WEED_SPECIES.map(s=><option key={s}>{s}</option>)}
                </select>
                {w.species==="Other"&&<input style={{...S.input,marginTop:"5px"}} type="text" placeholder="Species name" value={w.speciesName||""} onChange={e=>updWeed(w.id,"speciesName",e.target.value)}/>}
              </div>
              <div style={{flex:"1 1 100px"}}>
                <label style={S.label}>Pressure</label>
                <select style={S.input} value={w.pressure} onChange={e=>updWeed(w.id,"pressure",e.target.value)}>
                  {RATING_3.map(r=><option key={r}>{r}</option>)}
                </select>
              </div>
              <div style={{flex:"1 1 120px"}}>
                <label style={S.label}>Location in Field</label>
                <input style={S.input} type="text" placeholder="e.g. NW corner" value={w.location} onChange={e=>updWeed(w.id,"location",e.target.value)}/>
              </div>
              <button style={{...mkBtn("ghost"),padding:"7px 9px",color:T.danger,border:"none",background:"transparent",fontSize:"16px"}} onClick={()=>delWeed(w.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Disease Pressure ── */}
      <div style={secStyle("#FDF0F0","#E8B0A0")}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
          <p style={{margin:0,fontSize:"11px",color:"#8A2010",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🦠 Disease Pressure</p>
          <button style={addBtn("#C04030")} onClick={addDisease}>+ Add Disease</button>
        </div>
        {diseases.length===0&&<div style={emptyBox}>Click "+ Add Disease" to log observations</div>}
        {diseases.map((d,i)=>(
          <div key={d.id} style={rowStyle("#FFFFFF","#E8B0A0")}>
            <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap"}}>
              <div style={{flex:"2 1 140px"}}>
                <label style={S.label}>Disease #{i+1}</label>
                <select style={S.input} value={d.disease} onChange={e=>updDisease(d.id,"disease",e.target.value)}>
                  <option value="">Select disease…</option>{DISEASE_LIST.map(x=><option key={x}>{x}</option>)}
                </select>
                {d.disease==="Other"&&<input style={{...S.input,marginTop:"5px"}} type="text" placeholder="Disease name" value={d.diseaseName||""} onChange={e=>updDisease(d.id,"diseaseName",e.target.value)}/>}
              </div>
              <div style={{flex:"1 1 90px"}}>
                <label style={S.label}>Severity</label>
                <select style={S.input} value={d.severity} onChange={e=>updDisease(d.id,"severity",e.target.value)}>
                  {RATING_3.map(r=><option key={r}>{r}</option>)}
                </select>
              </div>
              <div style={{flex:"1 1 110px"}}>
                <label style={S.label}>% Field Affected</label>
                <input style={S.input} type="text" placeholder="e.g. 10%, patchy" value={d.affectedArea} onChange={e=>updDisease(d.id,"affectedArea",e.target.value)}/>
              </div>
              <button style={{...mkBtn("ghost"),padding:"7px 9px",color:T.danger,border:"none",background:"transparent",fontSize:"16px"}} onClick={()=>delDisease(d.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Insect Pressure ── */}
      <div style={secStyle("#F5F0FC","#C8A8E0")}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
          <p style={{margin:0,fontSize:"11px",color:"#5A2080",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🐛 Insect Pressure</p>
          <button style={addBtn("#7A40A0")} onClick={addInsect}>+ Add Insect</button>
        </div>
        {insects.length===0&&<div style={emptyBox}>Click "+ Add Insect" to log observations</div>}
        {insects.map((n,i)=>(
          <div key={n.id} style={rowStyle("#FFFFFF","#C8A8E0")}>
            <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap"}}>
              <div style={{flex:"2 1 140px"}}>
                <label style={S.label}>Insect #{i+1}</label>
                <select style={S.input} value={n.insect} onChange={e=>updInsect(n.id,"insect",e.target.value)}>
                  <option value="">Select insect…</option>{INSECT_LIST.map(x=><option key={x}>{x}</option>)}
                </select>
                {n.insect==="Other"&&<input style={{...S.input,marginTop:"5px"}} type="text" placeholder="Insect name" value={n.insectName||""} onChange={e=>updInsect(n.id,"insectName",e.target.value)}/>}
              </div>
              <div style={{flex:"1 1 90px"}}>
                <label style={S.label}>Pressure</label>
                <select style={S.input} value={n.pressure} onChange={e=>updInsect(n.id,"pressure",e.target.value)}>
                  {RATING_3.map(r=><option key={r}>{r}</option>)}
                </select>
              </div>
              <div style={{flex:"1 1 110px"}}>
                <label style={S.label}>Count / Density</label>
                <input style={S.input} type="text" placeholder="e.g. 3/ft², 12/plant" value={n.count} onChange={e=>updInsect(n.id,"count",e.target.value)}/>
              </div>
              <button style={{...mkBtn("ghost"),padding:"7px 9px",color:T.danger,border:"none",background:"transparent",fontSize:"16px"}} onClick={()=>delInsect(n.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Soil & Organic Matter ── */}
      <div style={secStyle("#F0F5F0","#A0C8A0")}>
        <p style={{margin:"0 0 12px",fontSize:"11px",color:"#2A5020",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🌍 Soil Observations</p>
        <div style={S.g2}>
          <div style={S.row}>
            <label style={S.label}>Organic Matter</label>
            <input style={S.input} type="text" placeholder="e.g. 4.2%, High" value={v.organicMatter||""} onChange={e=>set({...v,organicMatter:e.target.value})}/>
          </div>
          <div style={S.row}>
            <label style={S.label}>Soil Moisture</label>
            <select style={S.input} value={v.soilMoisture||""} onChange={e=>set({...v,soilMoisture:e.target.value})}>
              <option value="">Select…</option>
              {["Dry / Drought stress","Below average","Average","Above average","Saturated / Wet"].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
          <div style={S.row}>
            <label style={S.label}>Soil Compaction</label>
            <select style={S.input} value={v.soilCompaction||""} onChange={e=>set({...v,soilCompaction:e.target.value})}>
              <option value="">Select…</option>{RATING_3.map(r=><option key={r}>{r}</option>)}
            </select>
          </div>
          <div style={S.row}>
            <label style={S.label}>Soil pH (if known)</label>
            <input style={S.input} type="text" placeholder="e.g. 7.2" value={v.soilPH||""} onChange={e=>set({...v,soilPH:e.target.value})}/>
          </div>
        </div>
        <div style={S.row}>
          <label style={S.label}>Soil Observations</label>
          <textarea style={{...S.input,height:"56px",resize:"vertical"}} placeholder="Salinity patches, erosion, crusting, tile issues…" value={v.soilNotes||""} onChange={e=>set({...v,soilNotes:e.target.value})}/>
        </div>
      </div>

      {/* ── Recommended Action ── */}
      <div style={S.row}>
        <label style={S.label}>Recommended Action</label>
        <select style={S.input} value={v.recommendedAction||""} onChange={e=>set({...v,recommendedAction:e.target.value})}>
          <option value="">Select…</option>
          {["No action required — monitor","Scout again in 5-7 days","Apply herbicide","Apply fungicide","Apply insecticide","Apply fertilizer","Soil test recommended","Other — see notes"].map(o=><option key={o}>{o}</option>)}
        </select>
      </div>

    </div>
  );
}

// ── Harvest Form ──────────────────────────────────────────────────────
const DELIVERY_LOCATIONS = ["Local Elevator","Co-op","Farm Storage — Bin 1","Farm Storage — Bin 2","Farm Storage — Bin 3","Direct to Buyer","Other"];

function HarvestForm({v,set}){
  const totalBu = v.yieldPerAc && v.acres
    ? (parseFloat(v.yieldPerAc)*parseFloat(v.acres)).toFixed(0)
    : v.totalBushels||"";

  return(
    <div>
      {/* Crop + equipment */}
      <div style={S.g2}>
        <div style={S.row}>
          <label style={S.label}>Crop Harvested</label>
          <select style={S.input} value={v.crop||""} onChange={e=>set({...v,crop:e.target.value})}>
            <option value="">Select crop…</option>
            {CROPS.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={S.row}>
          <label style={S.label}>Combine / Equipment</label>
          <input style={S.input} type="text" placeholder="e.g. JD S780" value={v.equipment||""} onChange={e=>set({...v,equipment:e.target.value})}/>
        </div>
      </div>

      {/* Yield */}
      <div style={{background:"#F8F6EC",border:`1px solid #E0CFA0`,borderRadius:"8px",padding:"14px",marginBottom:"14px"}}>
        <p style={{margin:"0 0 12px",fontSize:"11px",color:"#7A6020",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🌾 Yield</p>
        <div style={S.g2}>
          <div style={S.row}>
            <label style={S.label}>Yield (bu / ac)</label>
            <input style={S.input} type="number" step="0.1" placeholder="e.g. 45" value={v.yieldPerAc||""} onChange={e=>set({...v,yieldPerAc:e.target.value})}/>
          </div>
          <div style={S.row}>
            <label style={S.label}>Total Bushels</label>
            <input style={S.input} type="number" step="1" placeholder="Auto-calc or enter" value={v.totalBushels||totalBu||""} onChange={e=>set({...v,totalBushels:e.target.value})}/>
          </div>
          <div style={S.row}>
            <label style={S.label}>Moisture (%)</label>
            <input style={S.input} type="number" step="0.1" placeholder="e.g. 14.5" value={v.moisture||""} onChange={e=>set({...v,moisture:e.target.value})}/>
          </div>
          <div style={S.row}>
            <label style={S.label}>Test Weight (lbs/bu)</label>
            <input style={S.input} type="number" step="0.1" placeholder="e.g. 60" value={v.testWeight||""} onChange={e=>set({...v,testWeight:e.target.value})}/>
          </div>
        </div>
        <div style={S.g2}>
          <div style={S.row}>
            <label style={S.label}>Dockage (%)</label>
            <input style={S.input} type="number" step="0.1" placeholder="e.g. 2.5" value={v.dockage||""} onChange={e=>set({...v,dockage:e.target.value})}/>
          </div>
          <div style={S.row}>
            <label style={S.label}>Grade</label>
            <input style={S.input} type="text" placeholder="e.g. 1CW, 2CWRS" value={v.grade||""} onChange={e=>set({...v,grade:e.target.value})}/>
          </div>
        </div>
      </div>

      {/* Delivery */}
      <div style={{background:"#F0F5F8",border:`1px solid #A8C4D8`,borderRadius:"8px",padding:"14px",marginBottom:"14px"}}>
        <p style={{margin:"0 0 12px",fontSize:"11px",color:"#2A5070",textTransform:"uppercase",letterSpacing:"0.9px",fontWeight:700}}>🚛 Delivery</p>
        <div style={S.g2}>
          <div style={S.row}>
            <label style={S.label}>Delivered To</label>
            <select style={S.input} value={v.deliveredTo||""} onChange={e=>set({...v,deliveredTo:e.target.value})}>
              <option value="">Select location…</option>
              {DELIVERY_LOCATIONS.map(l=><option key={l}>{l}</option>)}
            </select>
            {v.deliveredTo==="Other"&&<input style={{...S.input,marginTop:"6px"}} type="text" placeholder="Location name" value={v.deliveredToCustom||""} onChange={e=>set({...v,deliveredToCustom:e.target.value})}/>}
          </div>
          <div style={S.row}>
            <label style={S.label}>Price ($/bu)</label>
            <input style={S.input} type="number" step="0.01" placeholder="e.g. 7.25" value={v.price||""} onChange={e=>set({...v,price:e.target.value})}/>
          </div>
        </div>
        {/* Revenue calc */}
        {v.price&&(v.totalBushels||totalBu)&&(
          <div style={{background:"#FFFFFF",border:`1px solid #A8C4D8`,borderRadius:"6px",padding:"10px 12px",display:"flex",gap:"20px",flexWrap:"wrap"}}>
            <div><span style={{fontSize:"11px",color:T.muted}}>Est. Revenue</span><div style={{fontWeight:700,fontSize:"17px",color:T.blue}}>${(parseFloat(v.price)*(parseFloat(v.totalBushels||totalBu))).toLocaleString("en-US",{maximumFractionDigits:0})}</div></div>
            <div><span style={{fontSize:"11px",color:T.muted}}>@ {v.price}/bu</span><div style={{fontSize:"13px",color:T.muted}}>{Number(v.totalBushels||totalBu).toLocaleString()} bu</div></div>
          </div>
        )}
      </div>

      {/* AgriScale note */}
      <div style={{background:"#F0F8F5",border:`1px solid #A0C8B0`,borderRadius:"6px",padding:"10px 12px",fontSize:"12px",color:"#2A5040",display:"flex",gap:"8px",alignItems:"center"}}>
        <span style={{fontSize:"16px"}}>⚖️</span>
        <span>AgriScale connected — use <strong>⚖️ Loads</strong> on the home screen to import harvest totals, or enable Auto sync in Settings.</span>
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
    if(activity.type==="seeding"){
      const crops=(d.crops||[]).map(c=>c.crop).filter(Boolean);
      const ferts=(d.ferts||[]).map(f=>f.blend==="Custom Blend"?f.custom:f.blend).filter(Boolean);
      const inocs=(d.inoculants||[]).map(n=>n.product).filter(Boolean);
      // Legacy fallback
      if(!crops.length&&d.crop) crops.push(d.crop);
      if(!ferts.length&&d.fertBlend) ferts.push(d.fertBlend==="Custom Blend"?d.fertCustom:d.fertBlend);
      return[crops.length&&`Crop: ${crops.join(" + ")}`, ferts.length&&`Fert: ${ferts.join(", ")}`, inocs.length&&`Inoc: ${inocs.join(", ")}`].filter(Boolean).join("  ·  ");
    }
    if(activity.type==="spraying") return(d.tankMix||[]).map(c=>`${c.chemical==="Other"?(c.chemicalName||"?"):c.chemical} ${c.oz}${c.unit}`).join(", ")||"No chemicals";
    if(activity.type==="scouting"){
      const parts=[];
      if(d.growthStage) parts.push(d.growthStage);
      if(d.cropHealth)  parts.push(`Health: ${d.cropHealth.split(" — ")[0]}`);
      if(d.weedPressure)parts.push(`Weeds: ${d.weedPressure}`);
      if(d.recommendedAction&&d.recommendedAction!=="No action required — monitor") parts.push(d.recommendedAction.split("—")[0].trim());
      return parts.join("  ·  ")||"Scouting observation";
    }
    if(activity.type==="harvest"){
      return [d.crop&&`Crop: ${d.crop}`, d.yieldPerAc&&`${d.yieldPerAc} bu/ac`, d.moisture&&`${d.moisture}% moisture`, d.grade&&d.grade, d.deliveredTo&&`→ ${d.deliveredTo}`].filter(Boolean).join("  ·  ");
    }
    return d.details||"";
  };
  const detail=()=>{
    if(activity.type==="seeding"){
      // Support both new multi-item and legacy single-item format
      const crops     = d.crops     || (d.crop            ? [{crop:d.crop,seedRate:d.seedRate,totalSeed:d.totalSeed}]   : []);
      const ferts     = d.ferts     || (d.fertBlend        ? [{blend:d.fertBlend,custom:d.fertCustom,rate:d.fertRate,total:d.totalFert,placement:"Seed-placed"}] : []);
      const inoculants= d.inoculants|| (d.inoculantProduct ? [{product:d.inoculantProduct,rate:d.inoculantRate}]          : []);
      return(
        <div style={{marginTop:"10px",fontSize:"13px"}}>
          {crops.length>0&&<>
            <p style={{margin:"0 0 5px",fontSize:"11px",color:T.muted,textTransform:"uppercase",letterSpacing:"0.8px"}}>Crops</p>
            {crops.map((c,i)=>(
              <div key={i} style={{display:"flex",gap:"16px",padding:"5px 10px",background:T.panel,borderRadius:"4px",marginBottom:"4px",flexWrap:"wrap"}}>
                <span style={{fontWeight:600,minWidth:"120px"}}>{c.crop||"—"}</span>
                {c.seedRate&&<span><span style={{color:T.muted}}>Rate:</span> {c.seedRate} lbs/ac</span>}
                {c.totalSeed&&<span><span style={{color:T.muted}}>Total:</span> {Number(c.totalSeed).toLocaleString()} lbs</span>}
              </div>
            ))}
          </>}
          {ferts.length>0&&<>
            <p style={{margin:"8px 0 5px",fontSize:"11px",color:T.muted,textTransform:"uppercase",letterSpacing:"0.8px"}}>Fertilizers</p>
            {ferts.map((f,i)=>(
              <div key={i} style={{display:"flex",gap:"16px",padding:"5px 10px",background:T.panel,borderRadius:"4px",marginBottom:"4px",flexWrap:"wrap"}}>
                <span style={{fontWeight:600,minWidth:"120px"}}>{f.blend==="Custom Blend"?f.custom:f.blend||"—"}</span>
                {f.placement&&<span style={{color:T.muted,fontSize:"12px"}}>{f.placement}</span>}
                {f.rate&&<span><span style={{color:T.muted}}>Rate:</span> {f.rate} lbs/ac</span>}
                {f.total&&<span><span style={{color:T.muted}}>Total:</span> {Number(f.total).toLocaleString()} lbs</span>}
              </div>
            ))}
          </>}
          {inoculants.length>0&&<>
            <p style={{margin:"8px 0 5px",fontSize:"11px",color:"#2A6A28",textTransform:"uppercase",letterSpacing:"0.8px"}}>🧪 Inoculants</p>
            {inoculants.map((n,i)=>(
              <div key={i} style={{display:"flex",gap:"16px",padding:"5px 10px",background:"#F0F8EE",border:`1px solid #C0DCC0`,borderRadius:"4px",marginBottom:"4px",flexWrap:"wrap"}}>
                <span style={{fontWeight:600}}>{n.product||"—"}</span>
                {n.rate&&<span style={{color:T.muted}}>{n.rate}</span>}
              </div>
            ))}
          </>}
          {(d.equipment||d.depth)&&<div style={{marginTop:"6px",display:"flex",gap:"16px",flexWrap:"wrap"}}>
            {d.equipment&&<span><span style={{color:T.muted}}>Equipment:</span> {d.equipment}</span>}
            {d.depth&&<span><span style={{color:T.muted}}>Depth:</span> {d.depth}"</span>}
          </div>}
        </div>
      );
    }
    if(activity.type==="spraying") return(
      <div style={{marginTop:"10px",fontSize:"13px"}}>
        {d.waterVol&&<div style={{marginBottom:"5px"}}><span style={{color:T.muted}}>Water vol:</span> {d.waterVol} gal/ac</div>}
        {d.equipment&&<div style={{marginBottom:"5px"}}><span style={{color:T.muted}}>Equipment:</span> {d.equipment}</div>}
        {d.purpose&&<div style={{marginBottom:"8px"}}><span style={{color:T.muted}}>Purpose:</span> {d.purpose}</div>}
        {(d.tankMix||[]).length>0&&<><p style={{margin:"0 0 4px",fontSize:"11px",color:T.muted,textTransform:"uppercase",letterSpacing:"0.8px"}}>Tank Mix</p>
          {d.tankMix.map((c,i)=><div key={c.id||i} style={{display:"flex",gap:"12px",padding:"5px 10px",background:T.panel,borderRadius:"4px",marginBottom:"4px"}}><span style={{flex:1}}>{c.chemical==="Other"?(c.chemicalName||"—"):c.chemical}</span><span style={{color:T.gold,fontWeight:700}}>{c.oz} {c.unit}</span></div>)}</>}
      </div>
    );
    if(activity.type==="harvest") return(
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 16px",marginTop:"10px",fontSize:"13px"}}>
        {d.crop&&<span><span style={{color:T.muted}}>Crop:</span> {d.crop}</span>}
        {d.yieldPerAc&&<span><span style={{color:T.muted}}>Yield:</span> {d.yieldPerAc} bu/ac</span>}
        {d.totalBushels&&<span><span style={{color:T.muted}}>Total:</span> {Number(d.totalBushels).toLocaleString()} bu</span>}
        {d.moisture&&<span><span style={{color:T.muted}}>Moisture:</span> {d.moisture}%</span>}
        {d.testWeight&&<span><span style={{color:T.muted}}>Test wt:</span> {d.testWeight} lbs/bu</span>}
        {d.dockage&&<span><span style={{color:T.muted}}>Dockage:</span> {d.dockage}%</span>}
        {d.grade&&<span><span style={{color:T.muted}}>Grade:</span> {d.grade}</span>}
        {d.deliveredTo&&<span><span style={{color:T.muted}}>Delivered:</span> {d.deliveredTo==="Other"?d.deliveredToCustom:d.deliveredTo}</span>}
        {d.price&&<span><span style={{color:T.muted}}>Price:</span> ${d.price}/bu</span>}
        {d.equipment&&<span><span style={{color:T.muted}}>Equipment:</span> {d.equipment}</span>}
        {d.price&&d.totalBushels&&<span style={{gridColumn:"span 2",fontWeight:700,color:T.blue}}>Revenue: ${(parseFloat(d.price)*parseFloat(d.totalBushels)).toLocaleString("en-US",{maximumFractionDigits:0})}</span>}
      </div>
    );
    return d.details?<p style={{marginTop:"8px",fontSize:"13px"}}>{d.details}</p>:null;
  };
  const scoutDetail=()=>{
    if(activity.type!=="scouting") return null;
    const d=activity.data||{};
    const badge=(label,val,col)=>val?<span style={{display:"inline-flex",alignItems:"center",gap:"4px",padding:"3px 8px",borderRadius:"12px",fontSize:"12px",background:col+"18",border:`1px solid ${col}40`,color:col,fontWeight:600}}><span style={{color:T.muted,fontWeight:400}}>{label}:</span> {val}</span>:null;
    return(
      <div style={{marginTop:"10px",fontSize:"13px"}}>
        {/* Crop status row */}
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px"}}>
          {badge("Stage",    d.growthStage,           "#2A7A3A")}
          {badge("Health",   d.cropHealth?.split(" — ")[0],  "#2A7A3A")}
          {badge("Stand",    d.standDensity?.split(" (")[0],  "#2A7A3A")}
          {badge("Yield Est",d.yieldPotential,         "#2A7A3A")}
        </div>
        {/* Weeds */}
        {(d.weedPressure||(d.weeds||[]).length>0)&&(
          <div style={{background:"#FDF8F0",border:`1px solid #E8D080`,borderRadius:"6px",padding:"8px 10px",marginBottom:"6px"}}>
            <span style={{fontSize:"11px",fontWeight:700,color:"#8A6010",textTransform:"uppercase",letterSpacing:"0.7px"}}>🌿 Weeds</span>
            {d.weedPressure&&<span style={{marginLeft:"8px",fontSize:"12px",color:T.muted}}>Overall: <strong style={{color:"#8A6010"}}>{d.weedPressure}</strong></span>}
            {d.weedThreshold&&<span style={{marginLeft:"8px",fontSize:"12px",color:T.muted}}> · {d.weedThreshold}</span>}
            {(d.weeds||[]).length>0&&<div style={{marginTop:"5px",display:"flex",gap:"5px",flexWrap:"wrap"}}>{d.weeds.map((w,i)=><span key={i} style={{fontSize:"11px",padding:"2px 7px",borderRadius:"10px",background:"#F8ECC0",border:"1px solid #D0A830"}}>{w.species==="Other"?(w.speciesName||"?"):w.species} — {w.pressure}{w.location&&` (${w.location})`}</span>)}</div>}
          </div>
        )}
        {/* Disease */}
        {(d.diseases||[]).length>0&&(
          <div style={{background:"#FDF0F0",border:`1px solid #E8B0A0`,borderRadius:"6px",padding:"8px 10px",marginBottom:"6px"}}>
            <span style={{fontSize:"11px",fontWeight:700,color:"#8A2010",textTransform:"uppercase",letterSpacing:"0.7px"}}>🦠 Disease</span>
            <div style={{marginTop:"5px",display:"flex",gap:"5px",flexWrap:"wrap"}}>{d.diseases.map((x,i)=><span key={i} style={{fontSize:"11px",padding:"2px 7px",borderRadius:"10px",background:"#FCDDD8",border:"1px solid #E09080"}}>{x.disease==="Other"?(x.diseaseName||"?"):x.disease} — {x.severity}{x.affectedArea&&` (${x.affectedArea})`}</span>)}</div>
          </div>
        )}
        {/* Insects */}
        {(d.insects||[]).length>0&&(
          <div style={{background:"#F5F0FC",border:`1px solid #C8A8E0`,borderRadius:"6px",padding:"8px 10px",marginBottom:"6px"}}>
            <span style={{fontSize:"11px",fontWeight:700,color:"#5A2080",textTransform:"uppercase",letterSpacing:"0.7px"}}>🐛 Insects</span>
            <div style={{marginTop:"5px",display:"flex",gap:"5px",flexWrap:"wrap"}}>{d.insects.map((x,i)=><span key={i} style={{fontSize:"11px",padding:"2px 7px",borderRadius:"10px",background:"#EAD8F8",border:"1px solid #B090D0"}}>{x.insect==="Other"?(x.insectName||"?"):x.insect} — {x.pressure}{x.count&&` (${x.count})`}</span>)}</div>
          </div>
        )}
        {/* Soil */}
        {(d.organicMatter||d.soilMoisture||d.soilCompaction||d.soilPH||d.soilNotes)&&(
          <div style={{background:"#F0F5F0",border:`1px solid #A0C8A0`,borderRadius:"6px",padding:"8px 10px",marginBottom:"6px"}}>
            <span style={{fontSize:"11px",fontWeight:700,color:"#2A5020",textTransform:"uppercase",letterSpacing:"0.7px"}}>🌍 Soil</span>
            <div style={{marginTop:"4px",display:"flex",gap:"12px",flexWrap:"wrap",fontSize:"12px"}}>
              {d.organicMatter&&<span><span style={{color:T.muted}}>OM:</span> {d.organicMatter}</span>}
              {d.soilMoisture&&<span><span style={{color:T.muted}}>Moisture:</span> {d.soilMoisture.split(" /")[0]}</span>}
              {d.soilCompaction&&<span><span style={{color:T.muted}}>Compaction:</span> {d.soilCompaction}</span>}
              {d.soilPH&&<span><span style={{color:T.muted}}>pH:</span> {d.soilPH}</span>}
              {d.soilNotes&&<span style={{color:T.muted,fontStyle:"italic"}}>{d.soilNotes}</span>}
            </div>
          </div>
        )}
        {/* Recommended action */}
        {d.recommendedAction&&(
          <div style={{marginTop:"4px",padding:"6px 10px",borderRadius:"6px",background:d.recommendedAction.includes("action required")||d.recommendedAction.includes("Apply")?"#FDF0F0":"#F0F5F0",border:`1px solid ${d.recommendedAction.includes("action required")||d.recommendedAction.includes("Apply")?"#E0A090":"#A0C8A0"}`}}>
            <span style={{fontSize:"12px",fontWeight:600,color:d.recommendedAction.includes("action required")||d.recommendedAction.includes("Apply")?"#8A2010":"#2A5020"}}>→ {d.recommendedAction}</span>
          </div>
        )}
      </div>
    );
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
      {open&&<div style={{borderTop:`1px solid ${T.border}`,marginTop:"10px",paddingTop:"4px"}}>{activity.type==="scouting"?scoutDetail():detail()}{activity.notes&&<p style={{margin:"10px 0 0",fontSize:"12px",color:T.muted,fontStyle:"italic"}}>📝 {activity.notes}</p>}</div>}
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
        {type==="seeding"  &&<SeedingForm v={data} set={setData}/>}
        {type==="spraying" &&<SprayingForm v={data} set={setData}/>}
        {type==="scouting" &&<ScoutingForm v={data} set={setData}/>}
        {type==="harvest"  &&<HarvestForm v={data} set={setData}/>}
        {["rockPicking","tillage","other"].includes(type)&&<div style={S.row}><label style={S.label}>Details / Equipment</label><input style={S.input} type="text" placeholder="Describe equipment, area, conditions…" value={data.details||""} onChange={e=>setData({...data,details:e.target.value})}/></div>}
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

function FieldDetailView({field,activities,onBack,onAddActivity,onDeleteActivity,onUpdateField,onDeleteField,onReport}){
  const[tab,setTab]         =useState("activities"); // "activities"|"map"
  const[editName,setEditName]=useState(false);
  const[nameVal,setNameVal] =useState(field.name);
  const[acresVal,setAcresVal]=useState(field.acres||"");
  const[filter,setFilter]   =useState("all");
  const[confirmDelete,setConfirmDelete]=useState(false);
  const[editBoundary,setEditBoundary]=useState(false);

  const all   = activities.filter(a=>a.fieldId===field.id);
  const shown = all.filter(a=>filter==="all"||a.type===filter).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const stats = Object.entries(ACTIVITY_META).map(([k,m])=>({...m,key:k,n:all.filter(a=>a.type===k).length})).filter(x=>x.n>0);

  const tabBtn=(id,label)=>({
    ...mkBtn("ghost"),padding:"7px 16px",fontSize:"13px",
    background:tab===id?T.gold:"transparent",
    color:tab===id?"#FFFFFF":T.muted,
    border:`1px solid ${tab===id?T.gold:T.border}`,
    borderRadius:"6px",
  });

  return(
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"14px",flexWrap:"wrap"}}>
        <button style={{...mkBtn("ghost"),padding:"6px 12px"}} onClick={onBack}>← Fields</button>
        {!editName
          ?<><h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"22px",margin:0,flex:1}}>{field.name}</h2>{field.acres&&<span style={{color:T.muted,fontSize:"14px"}}>{field.acres} ac</span>}<button style={{...mkBtn("ghost"),padding:"5px 10px",fontSize:"12px"}} onClick={()=>setEditName(true)}>✏️ Edit</button></>
          :<div style={{display:"flex",gap:"8px",flex:1,alignItems:"center",flexWrap:"wrap"}}><input style={{...S.input,flex:"2 1 160px"}} value={nameVal} onChange={e=>setNameVal(e.target.value)}/><input style={{...S.input,flex:"1 1 80px",width:"auto"}} type="number" placeholder="Acres" value={acresVal} onChange={e=>setAcresVal(e.target.value)}/><button style={{...mkBtn("primary"),padding:"6px 12px",fontSize:"12px"}} onClick={()=>{onUpdateField(field.id,{name:nameVal,acres:acresVal});setEditName(false);}}>Save</button><button style={{...mkBtn("ghost"),padding:"6px 12px",fontSize:"12px"}} onClick={()=>setEditName(false)}>Cancel</button></div>
        }
        <button style={{...mkBtn("ghost"),padding:"6px 12px",fontSize:"13px"}} onClick={onReport}>📊 Report</button>
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

      {/* Activity summary badges */}
      {stats.length>0&&<div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px"}}>{stats.map(s=><div key={s.key} style={{padding:"5px 12px",borderRadius:"20px",background:T.card,border:`1px solid ${s.color}40`,fontSize:"12px",display:"flex",gap:"5px",alignItems:"center"}}><span>{s.icon}</span><span style={{color:s.color,fontWeight:700}}>{s.n}×</span><span style={{color:T.muted}}>{s.label}</span></div>)}</div>}

      {/* Tab bar */}
      <div style={{display:"flex",gap:"6px",marginBottom:"16px",flexWrap:"wrap"}}>
        <button style={tabBtn("activities","📋 Activities")} onClick={()=>setTab("activities")}>📋 Activities</button>
        <button style={tabBtn("map","📍 Map")} onClick={()=>setTab("map")}>📍 Map</button>
      </div>

      {/* ── MAP TAB ── */}
      {tab==="map"&&(
        <div style={S.card}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
            <span style={{fontWeight:700,color:T.gold,fontSize:"13px"}}>📍 Field Boundary</span>
            <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
              {field.boundary?.length>=3&&<span style={{fontSize:"12px",color:T.muted}}>{field.boundary.length} points</span>}
              <button style={{
                ...mkBtn(editBoundary?"primary":"ghost"),
                padding:"5px 12px",fontSize:"12px",
              }} onClick={()=>setEditBoundary(e=>!e)}>
                {editBoundary?"✓ Done Editing":"✏️ Edit Boundary"}
              </button>
            </div>
          </div>
          {!field.boundary?.length&&!editBoundary&&(
            <p style={{margin:"0 0 10px",fontSize:"12px",color:T.muted}}>No boundary drawn yet. Click "Edit Boundary" to draw one.</p>
          )}
          <FieldMap
            key={`${field.id}-map-${editBoundary}`}
            boundary={field.boundary||[]}
            onBoundaryChange={editBoundary?(pts)=>onUpdateField(field.id,{boundary:pts}):undefined}
            readOnly={!editBoundary}
            height={380}
          />
          {field.legalDesc&&<p style={{margin:"8px 0 0",fontSize:"12px",color:T.muted}}>Legal: {field.legalDesc}</p>}
        </div>
      )}

      {/* ── ACTIVITIES TAB ── */}
      {tab==="activities"&&(
        <>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
            <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"16px",margin:0,color:T.gold}}>Activity Log</h3>
            <select style={{...S.input,width:"auto",padding:"5px 10px",fontSize:"12px"}} value={filter} onChange={e=>setFilter(e.target.value)}>
              <option value="all">All Types</option>
              {Object.entries(ACTIVITY_META).map(([k,m])=><option key={k} value={k}>{m.icon} {m.label}</option>)}
            </select>
          </div>
          {shown.length===0&&<div style={{...S.card,textAlign:"center",padding:"36px",color:T.faint}}>{all.length===0?"No activities logged yet. Click \"+ Log Activity\" to get started.":"No activities match this filter."}</div>}
          {shown.map(a=><ActivityCard key={a.id} activity={a} onDelete={onDeleteActivity}/>)}
        </>
      )}
    </div>
  );
}

// ── PLSS legal description → boundary calculator ─────────────────────
// Montana Principal Meridian anchor
const MT_MERIDIAN = { lat: 45.7764, lng: -111.0667 };
const DEG_PER_TWP = 0.08682;   // ~6 miles latitude
const DEG_PER_RNG = 0.10853;   // ~6 miles longitude at ~48°N

// Section layout within a township (1-36, boustrophedon)
const SECTION_ROW_COL = {};
const rows = [[1,2,3,4,5,6],[12,11,10,9,8,7],[13,14,15,16,17,18],[24,23,22,21,20,19],[25,26,27,28,29,30],[36,35,34,33,32,31]];
rows.forEach((row,r)=>row.forEach((sec,c)=>{ SECTION_ROW_COL[sec]={r,c}; }));

const parseLegal = (str) => {
  if(!str) return null;
  const s = str.toUpperCase().replace(/[^A-Z0-9\s]/g," ").replace(/\s+/g," ").trim();
  // Quarter: NW NE SW SE or N½ S½ E½ W½
  const qMatch = s.match(/\b(NW|NE|SW|SE|N2|S2|E2|W2|N1|S1|E1|W1)\b/);
  // Section
  const secMatch = s.match(/\bSEC(?:TION)?\s*(\d{1,2})\b|^(\d{1,2})\b/);
  // Township: T34N or 34N
  const twpMatch = s.match(/T?\s*(\d{1,3})\s*N\b/i);
  // Range: R15E or R15W
  const rngMatch = s.match(/R?\s*(\d{1,3})\s*([EW])\b/i);
  if(!twpMatch||!rngMatch) return null;
  const twp = parseInt(twpMatch[1]);
  const rng = parseInt(rngMatch[1]);
  const rngDir = rngMatch[2].toUpperCase();
  const sec = secMatch ? parseInt(secMatch[1]||secMatch[2]) : 1;
  const quarter = qMatch ? qMatch[1] : null;
  if(sec<1||sec>36) return null;

  // SW corner of township
  const twpSW_lat = MT_MERIDIAN.lat + (twp-1)*DEG_PER_TWP;
  const rngOffset = rngDir==="E" ? (rng-1)*DEG_PER_RNG : -(rng)*DEG_PER_RNG;
  const twpSW_lng = MT_MERIDIAN.lng + rngOffset;

  // Section SW corner within township
  const {r,c} = SECTION_ROW_COL[sec] || {r:0,c:0};
  const secH = DEG_PER_TWP/6, secW = DEG_PER_RNG/6;
  // Rows go S→N (row 0 is north), cols go W→E
  const secSW_lat = twpSW_lat + (5-r)*secH;
  const secSW_lng = twpSW_lng + c*secW;

  // Quarter section
  let minLat=secSW_lat, maxLat=secSW_lat+secH;
  let minLng=secSW_lng, maxLng=secSW_lng+secW;
  if(quarter){
    const midLat=(minLat+maxLat)/2, midLng=(minLng+maxLng)/2;
    if(quarter==="NW"||quarter==="N1"||quarter==="N2"){ minLat=midLat; }
    if(quarter==="SW"||quarter==="S1"||quarter==="S2"){ maxLat=midLat; }
    if(quarter==="NE"||quarter==="SE"||quarter==="E1"||quarter==="E2"){ minLng=midLng; }
    if(quarter==="NW"||quarter==="SW"||quarter==="W1"||quarter==="W2"){ maxLng=midLng; }
    if(quarter==="NE"){ minLat=midLat; minLng=midLng; }
    if(quarter==="SW"){ maxLat=midLat; maxLng=midLng; }
    if(quarter==="SE"){ maxLat=midLat; minLng=midLng; }
    if(quarter==="NW"){ minLat=midLat; maxLng=midLng; }
  }
  const acres = quarter ? 160 : 640;
  return {
    boundary:[[minLat,minLng],[minLat,maxLng],[maxLat,maxLng],[maxLat,minLng]],
    center:[(minLat+maxLat)/2,(minLng+maxLng)/2],
    acres: String(acres),
  };
};

// ── Add Field View ────────────────────────────────────────────────────
function AddFieldView({onBack,onSave}){
  const[name,setName]    =useState("");
  const[acres,setAcres]  =useState("");
  const[legal,setLegal]  =useState("");
  const[boundary,setBdry]=useState([]);
  const[err,setErr]      =useState("");

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px"}}>
        <button style={{...mkBtn("ghost"),padding:"6px 12px"}} onClick={onBack}>← Back</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"22px",margin:0}}>Add New Field</h2>
      </div>

      {/* Field details */}
      <div style={S.card}>
        <h3 style={S.sh}>Field Details</h3>
        <div style={S.g2}>
          <div style={S.row}>
            <label style={S.label}>Field Name *</label>
            <input style={S.input} type="text" placeholder="e.g. Home Quarter, North Flat"
              value={name} onChange={e=>{setName(e.target.value);setErr("");}}/>
          </div>
          <div style={S.row}>
            <label style={S.label}>Acres</label>
            <input style={S.input} type="number" step="0.1" placeholder="e.g. 160"
              value={acres} onChange={e=>setAcres(e.target.value)}/>
          </div>
        </div>
        <div style={S.row}>
          <label style={S.label}>Legal Description</label>
          <input style={S.input} type="text" placeholder="e.g. NW-12-34N-15E"
            value={legal} onChange={e=>setLegal(e.target.value)}/>
        </div>
      </div>

      {/* Map — click to place boundary points */}
      <div style={S.card}>
        <h3 style={S.sh}>Draw Field Boundary</h3>
        <p style={{margin:"0 0 12px",fontSize:"13px",color:T.muted}}>
          Navigate to your field on the satellite map, then <strong>click each corner</strong> of the field boundary. Connect at least 3 points to form a polygon.
        </p>
        <FieldMap
          boundary={boundary}
          onBoundaryChange={setBdry}
          height={420}
        />
        {boundary.length>=3&&(
          <p style={{margin:"8px 0 0",fontSize:"12px",color:T.green}}>
            ✓ {boundary.length} points — boundary ready
          </p>
        )}
      </div>

      {err&&<p style={{color:"#E05050",fontSize:"13px",margin:"0 0 10px"}}>{err}</p>}

      <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginBottom:"20px"}}>
        <button style={mkBtn("ghost")} onClick={onBack}>Cancel</button>
        <button style={mkBtn("primary")} onClick={()=>{
          if(!name.trim()){setErr("Field name is required.");return;}
          onSave({id:genId(),name:name.trim(),acres,legalDesc:legal,boundary});
        }}>
          Create Field
        </button>
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
      } else if(ext==="kmz"){
        // KMZ is a ZIP containing one or more .kml files
        const zip=await JSZip.loadAsync(await file.arrayBuffer());
        const kmlFiles=Object.values(zip.files).filter(f=>f.name.toLowerCase().endsWith(".kml")&&!f.dir);
        if(!kmlFiles.length) throw new Error("No .kml file found inside the KMZ archive.");
        // Combine all KML files (usually just one — doc.kml)
        const allFields=[];
        for(const kmlFile of kmlFiles){
          const kmlText=await kmlFile.async("text");
          allFields.push(...parseKMLFields(kmlText));
        }
        processFields(allFields);
      } else {
        setErr(`Unsupported format: .${ext} — please use .kmz, .kml, .geojson, or .json`);
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
                <p style={{color:T.muted,fontSize:"12px",marginBottom:"16px"}}>Supports .kmz  ·  .kml  ·  .geojson  ·  .json</p>
                <label style={{...mkBtn("primary"),cursor:"pointer"}}>
                  Choose File
                  <input type="file" accept=".kmz,.kml,.geojson,.json" style={{display:"none"}} onChange={handleFile} disabled={busy}/>
                </label>
              </div>
              <div style={{background:"#F5F5EC",border:`1px solid #D8D8B0`,borderRadius:"8px",padding:"12px",fontSize:"12px",color:T.muted}}>
                <p style={{margin:"0 0 6px",fontWeight:600,color:"#6A6830"}}>📋 How to get your FSA file</p>
                <p style={{margin:"0 0 4px"}}>1. Go to <strong style={{color:T.text}}>fsa.usda.gov</strong> → your local service center</p>
                <p style={{margin:"0 0 4px"}}>2. Or download from <strong style={{color:T.text}}>datagateway.nrcs.usda.gov</strong></p>
                <p style={{margin:"0 0 4px"}}>3. Request your CLU (Common Land Unit) boundaries — use <strong style={{color:T.text}}>KMZ</strong> format</p>
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
function ReportsView({fields,activities,onBack,filterFieldId=null}){
  const[type,setType]         =useState("all");
  const[fieldFilter,setFField]=useState(filterFieldId||"all");
  const[sortBy,setSortBy]     =useState("field");
  const[yearFilter,setYearFilter]=useState("all");
  const[dateFrom,setDateFrom] =useState("");
  const[dateTo,setDateTo]     =useState("");

  const isFieldReport = !!filterFieldId;
  const filterField   = isFieldReport ? fields.find(f=>f.id===filterFieldId) : null;
  const fieldName=(id)=>fields.find(f=>f.id===id)?.name||"Unknown Field";
  const activeFieldId = isFieldReport ? filterFieldId : (fieldFilter==="all"?null:fieldFilter);

  // Derive available years from activity dates
  const availableYears = [...new Set(activities.map(a=>a.date?.slice(0,4)).filter(Boolean))].sort((a,b)=>b-a);

  // Filter and sort
  const results=activities
    .filter(a=>!activeFieldId||a.fieldId===activeFieldId)
    .filter(a=>type==="all"||a.type===type)
    .filter(a=>yearFilter==="all"||a.date?.startsWith(yearFilter))
    .filter(a=>!dateFrom||a.date>=dateFrom)
    .filter(a=>!dateTo  ||a.date<=dateTo+"T23:59")
    .sort((a,b)=>sortBy==="field"
      ? fieldName(a.fieldId).localeCompare(fieldName(b.fieldId)) || new Date(b.date)-new Date(a.date)
      : new Date(b.date)-new Date(a.date));

  const meta = type==="all"
    ? {label:"All Activities",icon:"📋",color:T.gold}
    : (ACTIVITY_META[type]||ACTIVITY_META.other);

  // When grouping by field, group results then sort activities within each field by date
  const groupedByField = [...new Set(results.map(a=>a.fieldId))].map(fid=>({
    fid, name:fieldName(fid),
    acts:results.filter(a=>a.fieldId===fid),
  })).sort((a,b)=>a.name.localeCompare(b.name));

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
    if(a.type==="seeding"){
      const crops     = d.crops     || (d.crop            ? [{crop:d.crop,seedRate:d.seedRate,totalSeed:d.totalSeed}]   : []);
      const ferts     = d.ferts     || (d.fertBlend        ? [{blend:d.fertBlend,custom:d.fertCustom,rate:d.fertRate,total:d.totalFert,placement:"Seed-placed"}] : []);
      const inoculants= d.inoculants|| (d.inoculantProduct ? [{product:d.inoculantProduct,rate:d.inoculantRate}]          : []);
      return(
        <div style={{fontSize:"13px"}}>
          {crops.length>0&&(
            <table style={{width:"100%",borderCollapse:"collapse",marginBottom:"8px"}}>
              <thead><tr style={{background:T.panel}}>
                <th style={{textAlign:"left",padding:"4px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase"}}>Crop</th>
                <th style={{textAlign:"right",padding:"4px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase"}}>Rate (lbs/ac)</th>
                <th style={{textAlign:"right",padding:"4px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase"}}>Total (lbs)</th>
              </tr></thead>
              <tbody>{crops.map((c,i)=><tr key={i} style={{borderBottom:`1px solid ${T.border}`}}>
                <td style={{padding:"4px 8px",fontWeight:600}}>{c.crop||"—"}</td>
                <td style={{padding:"4px 8px",textAlign:"right"}}>{c.seedRate||"—"}</td>
                <td style={{padding:"4px 8px",textAlign:"right"}}>{c.totalSeed?Number(c.totalSeed).toLocaleString():"—"}</td>
              </tr>)}</tbody>
            </table>
          )}
          {ferts.length>0&&(
            <table style={{width:"100%",borderCollapse:"collapse",marginBottom:"8px"}}>
              <thead><tr style={{background:T.panel}}>
                <th style={{textAlign:"left",padding:"4px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase"}}>Fertilizer</th>
                <th style={{textAlign:"left",padding:"4px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase"}}>Placement</th>
                <th style={{textAlign:"right",padding:"4px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase"}}>Rate (lbs/ac)</th>
                <th style={{textAlign:"right",padding:"4px 8px",color:T.muted,fontWeight:600,fontSize:"11px",textTransform:"uppercase"}}>Total (lbs)</th>
              </tr></thead>
              <tbody>{ferts.map((f,i)=><tr key={i} style={{borderBottom:`1px solid ${T.border}`}}>
                <td style={{padding:"4px 8px",fontWeight:600}}>{f.blend==="Custom Blend"?f.custom:f.blend||"—"}</td>
                <td style={{padding:"4px 8px",color:T.muted}}>{f.placement||"—"}</td>
                <td style={{padding:"4px 8px",textAlign:"right"}}>{f.rate||"—"}</td>
                <td style={{padding:"4px 8px",textAlign:"right"}}>{f.total?Number(f.total).toLocaleString():"—"}</td>
              </tr>)}</tbody>
            </table>
          )}
          {inoculants.length>0&&<div style={{marginBottom:"6px"}}><span style={{color:"#2A6A28",fontWeight:600}}>🧪 Inoculants: </span>{inoculants.map(n=>`${n.product}${n.rate?` @ ${n.rate}`:""}`).join("  ·  ")}</div>}
          {(d.equipment||d.depth)&&<div style={{color:T.muted}}>{d.equipment&&`Equipment: ${d.equipment}`}{d.equipment&&d.depth&&"  ·  "}{d.depth&&`Depth: ${d.depth}"`}</div>}
        </div>
      );
    }
    if(a.type==="harvest"){
      const d=a.data||{};
      return(
        <div style={{display:"flex",gap:"16px",flexWrap:"wrap",fontSize:"13px"}}>
          {d.crop&&<span><span style={{color:T.muted}}>Crop:</span> {d.crop}</span>}
          {d.yieldPerAc&&<span><span style={{color:T.muted}}>Yield:</span> {d.yieldPerAc} bu/ac</span>}
          {d.totalBushels&&<span><span style={{color:T.muted}}>Total:</span> {Number(d.totalBushels).toLocaleString()} bu</span>}
          {d.moisture&&<span><span style={{color:T.muted}}>Moisture:</span> {d.moisture}%</span>}
          {d.grade&&<span><span style={{color:T.muted}}>Grade:</span> {d.grade}</span>}
          {d.deliveredTo&&<span><span style={{color:T.muted}}>Delivered:</span> {d.deliveredTo==="Other"?d.deliveredToCustom:d.deliveredTo}</span>}
          {d.price&&d.totalBushels&&<span style={{fontWeight:700,color:T.blue}}>Revenue: ${(parseFloat(d.price)*parseFloat(d.totalBushels)).toLocaleString("en-US",{maximumFractionDigits:0})}</span>}
        </div>
      );
    }
    return d.details?<p style={{margin:0,fontSize:"13px"}}>{d.details}</p>:null;
  };
  const renderScoutDetail=(d)=>(
    <div style={{fontSize:"13px"}}>
      <div style={{display:"flex",gap:"12px",flexWrap:"wrap",marginBottom:"8px"}}>
        {d.growthStage&&<span><span style={{color:T.muted}}>Stage:</span> {d.growthStage}</span>}
        {d.cropHealth&&<span><span style={{color:T.muted}}>Health:</span> {d.cropHealth}</span>}
        {d.standDensity&&<span><span style={{color:T.muted}}>Stand:</span> {d.standDensity}</span>}
        {d.yieldPotential&&<span><span style={{color:T.muted}}>Yield Est:</span> {d.yieldPotential}</span>}
      </div>
      {(d.weedPressure||(d.weeds||[]).length>0)&&<div style={{marginBottom:"6px"}}><strong style={{color:"#8A6010"}}>🌿 Weeds:</strong> {d.weedPressure||""}{d.weedThreshold&&` — ${d.weedThreshold}`}{(d.weeds||[]).length>0&&" · "+d.weeds.map(w=>`${w.species==="Other"?(w.speciesName||"?"):w.species} (${w.pressure})`).join(", ")}</div>}
      {(d.diseases||[]).length>0&&<div style={{marginBottom:"6px"}}><strong style={{color:"#8A2010"}}>🦠 Disease: </strong>{d.diseases.map(x=>`${x.disease==="Other"?(x.diseaseName||"?"):x.disease} — ${x.severity}${x.affectedArea?` (${x.affectedArea})`:""}`).join(", ")}</div>}
      {(d.insects||[]).length>0&&<div style={{marginBottom:"6px"}}><strong style={{color:"#5A2080"}}>🐛 Insects: </strong>{d.insects.map(x=>`${x.insect==="Other"?(x.insectName||"?"):x.insect} — ${x.pressure}${x.count?` (${x.count})`:""}`).join(", ")}</div>}
      {(d.organicMatter||d.soilMoisture||d.soilPH)&&<div style={{marginBottom:"6px"}}><strong style={{color:"#2A5020"}}>🌍 Soil: </strong>{[d.organicMatter&&`OM: ${d.organicMatter}`,d.soilMoisture&&`Moisture: ${d.soilMoisture}`,d.soilPH&&`pH: ${d.soilPH}`,d.soilNotes].filter(Boolean).join("  ·  ")}</div>}
      {d.recommendedAction&&<div style={{fontWeight:600,color:d.recommendedAction.includes("Apply")||d.recommendedAction.includes("action required")?"#8A2010":"#2A5020"}}>→ {d.recommendedAction}</div>}
    </div>
  );

  return(
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px",flexWrap:"wrap"}} className="no-print">
        <button style={{...mkBtn("ghost"),padding:"6px 12px"}} onClick={onBack}>{isFieldReport?"← Field":"← Home"}</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"22px",margin:0,flex:1}}>
          {isFieldReport ? `${filterField?.name||"Field"} — Report` : "Reports"}
        </h2>
        <button style={{...mkBtn("ghost"),padding:"7px 14px",fontSize:"13px"}} onClick={print}>🖨 Print</button>
      </div>

      {/* Filters */}
      <div style={{...S.card,marginBottom:"16px"}} className="no-print">

        {/* Row 1: Field selector (only on main reports, not field-specific) */}
        {!isFieldReport&&(
          <div style={{...S.row}}>
            <label style={S.label}>Field</label>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              <button style={{
                ...mkBtn("ghost"),padding:"6px 14px",fontSize:"12px",
                background:fieldFilter==="all"?T.gold:"transparent",
                color:fieldFilter==="all"?"#FFFFFF":T.muted,
                border:`1px solid ${fieldFilter==="all"?T.gold:T.border}`,
              }} onClick={()=>setFField("all")}>🌾 All Fields</button>
              {[...fields].sort((a,b)=>a.name.localeCompare(b.name)).map(f=>(
                <button key={f.id} style={{
                  ...mkBtn("ghost"),padding:"6px 14px",fontSize:"12px",
                  background:fieldFilter===f.id?"#2A5A8A":"transparent",
                  color:fieldFilter===f.id?"#FFFFFF":T.muted,
                  border:`1px solid ${fieldFilter===f.id?"#2A5A8A":T.border}`,
                }} onClick={()=>setFField(f.id)}>{f.name}{f.acres?` (${f.acres}ac)`:""}</button>
              ))}
            </div>
          </div>
        )}

        {/* Row 2: Activity type */}
        <div style={{...S.row,marginBottom:"10px"}}>
          <label style={S.label}>Activity Type</label>
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
            <button style={{
              ...mkBtn("ghost"),padding:"6px 12px",fontSize:"12px",
              background:type==="all"?T.gold:"transparent",
              color:type==="all"?"#FFFFFF":T.muted,
              border:`1px solid ${type==="all"?T.gold:T.border}`,
            }} onClick={()=>setType("all")}>📋 All</button>
            {Object.entries(ACTIVITY_META).map(([k,m])=>(
              <button key={k} style={{
                ...mkBtn("ghost"),padding:"6px 12px",fontSize:"12px",
                background:type===k?m.color:"transparent",
                color:type===k?"#FFFFFF":T.muted,
                border:`1px solid ${type===k?m.color:T.border}`,
              }} onClick={()=>setType(k)}>{m.icon} {m.label}</button>
            ))}
          </div>
        </div>

        {/* Row 3: Year filter */}
        {availableYears.length>0&&(
          <div style={{...S.row,marginBottom:"10px"}}>
            <label style={S.label}>Crop Year</label>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              <button style={{...mkBtn("ghost"),padding:"5px 14px",fontSize:"12px",background:yearFilter==="all"?T.gold:"transparent",color:yearFilter==="all"?"#FFFFFF":T.muted,border:`1px solid ${yearFilter==="all"?T.gold:T.border}`}} onClick={()=>setYearFilter("all")}>All Years</button>
              {availableYears.map(y=>(
                <button key={y} style={{...mkBtn("ghost"),padding:"5px 14px",fontSize:"12px",background:yearFilter===y?"#2A5A8A":"transparent",color:yearFilter===y?"#FFFFFF":T.muted,border:`1px solid ${yearFilter===y?"#2A5A8A":T.border}`}} onClick={()=>setYearFilter(y)}>{y}</button>
              ))}
            </div>
          </div>
        )}

        {/* Row 4: Date range + Group by */}
        <div style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{display:"flex",gap:"8px",alignItems:"flex-end",flexWrap:"wrap",flex:1}}>
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
          {!isFieldReport&&(
            <div>
              <label style={S.label}>Group By</label>
              <div style={{display:"flex",gap:"4px"}}>
                <button style={{...mkBtn("ghost"),padding:"5px 12px",fontSize:"12px",background:sortBy==="field"?T.gold:"transparent",color:sortBy==="field"?"#FFFFFF":T.muted,border:`1px solid ${sortBy==="field"?T.gold:T.border}`}} onClick={()=>setSortBy("field")}>Field</button>
                <button style={{...mkBtn("ghost"),padding:"5px 12px",fontSize:"12px",background:sortBy==="date"?T.gold:"transparent",color:sortBy==="date"?"#FFFFFF":T.muted,border:`1px solid ${sortBy==="date"?T.gold:T.border}`}} onClick={()=>setSortBy("date")}>Date</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Print header (only shows when printing) */}
      <div style={{display:"none"}} className="print-header">
        <h1 style={{fontFamily:"'Playfair Display',serif",marginBottom:"4px"}}>{meta.icon} {meta.label} Report{isFieldReport?` — ${filterField?.name}`:""}</h1>
        <p style={{color:T.muted,fontSize:"13px",marginBottom:"16px"}}>Generated {new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})} · {results.length} record{results.length!==1?"s":""}</p>
      </div>

      {/* Summary bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <span style={{fontFamily:"'Playfair Display',serif",fontSize:"18px",color:meta.color}}>{meta.icon} {meta.label}</span>
          <span style={{background:meta.color,color:"#fff",borderRadius:"12px",padding:"2px 10px",fontSize:"12px",fontWeight:700}}>{results.length} record{results.length!==1?"s":""}</span>
        </div>
        {results.length>0&&!isFieldReport&&sortBy==="field"&&<span style={{fontSize:"12px",color:T.muted}}>{[...new Set(results.map(a=>a.fieldId))].length} field{[...new Set(results.map(a=>a.fieldId))].length!==1?"s":""}</span>}
      </div>

      {/* Results */}
      {results.length===0&&(
        <div style={{...S.card,textAlign:"center",padding:"40px",color:T.faint}}>
          No {meta.label.toLowerCase()} records found{(dateFrom||dateTo)?" in this date range":""}.
        </div>
      )}

      {/* Field-grouped view */}
      {(!isFieldReport&&sortBy==="field")
        ? groupedByField.map(({fid,name:fName,acts:fResults})=>(
            <div key={fid} style={{marginBottom:"24px"}}>
              <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"16px",color:T.text,margin:"0 0 10px",paddingBottom:"8px",borderBottom:`2px solid ${T.borderHi}`,display:"flex",alignItems:"center",gap:"10px"}}>
                <span>🌾 {fName}</span>
                <span style={{fontSize:"12px",color:T.muted,fontWeight:400}}>{fResults.length} record{fResults.length!==1?"s":""}</span>
                {/* mini type breakdown */}
                <span style={{marginLeft:"auto",display:"flex",gap:"4px",flexWrap:"wrap"}}>
                  {Object.entries(ACTIVITY_META).filter(([k])=>fResults.some(a=>a.type===k)).map(([k,m])=>(
                    <span key={k} style={{fontSize:"10px",padding:"1px 6px",borderRadius:"8px",background:m.color+"20",border:`1px solid ${m.color}40`,color:m.color}}>{m.icon} {fResults.filter(a=>a.type===k).length}</span>
                  ))}
                </span>
              </h3>
              {fResults.map(a=>{const am=ACTIVITY_META[a.type]||ACTIVITY_META.other; return(
                <div key={a.id} style={{...S.card,borderLeft:`3px solid ${am.color}`,padding:"12px 14px",marginBottom:"8px"}} className="print-card">
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px",flexWrap:"wrap"}}>
                    <span style={{fontSize:"15px"}}>{am.icon}</span>
                    <span style={{fontWeight:700,fontSize:"13px",color:am.color}}>{am.label}</span>
                    <span style={{color:T.faint}}>·</span>
                    <span style={{fontSize:"12px",color:T.muted}}>{fmtDate(a.date)}</span>
                  </div>
                  {a.type==="scouting"?renderScoutDetail(a.data||{}):renderDetail(a)}
                  {a.notes&&<p style={{margin:"8px 0 0",fontSize:"12px",color:T.muted,fontStyle:"italic"}}>📝 {a.notes}</p>}
                </div>
              );})}
            </div>
          ))
        : // Date-sorted list
          results.map(a=>{
            const am = type==="all" ? (ACTIVITY_META[a.type]||ACTIVITY_META.other) : meta;
            return(
              <div key={a.id} style={{...S.card,borderLeft:`3px solid ${am.color}`,padding:"12px 14px",marginBottom:"8px"}} className="print-card">
                <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px",flexWrap:"wrap"}}>
                  {!activeFieldId&&<span style={{fontWeight:700,fontSize:"14px",color:T.text}}>🌾 {fieldName(a.fieldId)}</span>}
                  {!activeFieldId&&<span style={{color:T.faint}}>·</span>}
                  <span style={{fontSize:"15px"}}>{am.icon}</span>
                  <span style={{fontWeight:700,fontSize:"13px",color:am.color}}>{am.label}</span>
                  <span style={{color:T.faint}}>·</span>
                  <span style={{fontSize:"12px",color:T.muted}}>{fmtDate(a.date)}</span>
                </div>
                {a.type==="scouting"?renderScoutDetail(a.data||{}):renderDetail(a)}
                {a.notes&&<p style={{margin:"8px 0 0",fontSize:"12px",color:T.muted,fontStyle:"italic"}}>📝 {a.notes}</p>}
              </div>
            );})
      }
    </div>
  );
}

// ── Crop Rotation View ────────────────────────────────────────────────
const CROP_COLORS = {
  "Wheat":"#D4A820","Durum":"#C89018","Barley":"#B8A030","Oats":"#C8B840",
  "Canola":"#90B020","Flax":"#6080B0","Peas":"#60A060","Lentils":"#A87840",
  "Chickpeas":"#C8A060","Mustard":"#D0B020","Corn":"#E0C030","Soybeans":"#80A040",
  "Sunflowers":"#E0A020","Alfalfa":"#50A060","Hay":"#90A840","Fallow":"#C0B8A8",
  "Other":"#A09080",
};

function CropRotationView({fields,activities,onBack}){
  const [selectedField,setSelectedField]=useState(null);

  // Get all years with seeding activity
  const seedingActs = activities.filter(a=>a.type==="seeding");
  const allYears = [...new Set(seedingActs.map(a=>a.date?.slice(0,4)).filter(Boolean))].sort((a,b)=>b-a);
  // Also include current year
  const currentYear = String(new Date().getFullYear());
  if(!allYears.includes(currentYear)) allYears.unshift(currentYear);

  // Build rotation grid: field → year → crops[]
  const getFieldYearCrops = (fieldId, year) => {
    const acts = seedingActs.filter(a=>a.fieldId===fieldId && a.date?.startsWith(year));
    const crops = [];
    acts.forEach(a=>{
      const d = a.data||{};
      if(d.crops) d.crops.forEach(c=>c.crop&&crops.push(c.crop));
      else if(d.crop) crops.push(d.crop);
    });
    return [...new Set(crops)];
  };

  const sortedFields = [...fields].sort((a,b)=>a.name.localeCompare(b.name));

  // Detail panel for selected field
  const detailField = selectedField ? fields.find(f=>f.id===selectedField) : null;
  const detailRotation = detailField ? allYears.map(y=>({
    year:y,
    crops:getFieldYearCrops(detailField.id,y),
    acts:seedingActs.filter(a=>a.fieldId===detailField.id&&a.date?.startsWith(y)),
  })).filter(r=>r.crops.length>0) : [];

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px"}}>
        <button style={{...mkBtn("ghost"),padding:"6px 12px"}} onClick={onBack}>← Home</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"22px",margin:0,flex:1}}>Crop Rotation</h2>
        <span style={{fontSize:"13px",color:T.muted}}>{sortedFields.length} fields · {allYears.length} years</span>
      </div>

      {seedingActs.length===0&&(
        <div style={{...S.card,textAlign:"center",padding:"48px",color:T.faint}}>
          <div style={{fontSize:"40px",marginBottom:"12px"}}>🌱</div>
          No seeding records yet. Log seeding activities to see your crop rotation.
        </div>
      )}

      {/* Grid */}
      {sortedFields.length>0&&(
        <div style={{...S.card,overflowX:"auto",marginBottom:"16px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"400px"}}>
            <thead>
              <tr>
                <th style={{textAlign:"left",padding:"8px 12px",fontSize:"12px",color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.7px",borderBottom:`2px solid ${T.border}`,minWidth:"140px"}}>Field</th>
                {allYears.map(y=>(
                  <th key={y} style={{textAlign:"center",padding:"8px 10px",fontSize:"12px",color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.7px",borderBottom:`2px solid ${T.border}`,minWidth:"100px"}}>{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedFields.map((f,fi)=>(
                <tr key={f.id} style={{background:fi%2===0?T.card:"#F8F4EE",cursor:"pointer",transition:"background .1s"}}
                  onClick={()=>setSelectedField(selectedField===f.id?null:f.id)}
                  onMouseEnter={e=>e.currentTarget.style.background="#F0E8D8"}
                  onMouseLeave={e=>e.currentTarget.style.background=fi%2===0?T.card:"#F8F4EE"}>
                  <td style={{padding:"10px 12px",borderBottom:`1px solid ${T.border}`}}>
                    <div style={{fontWeight:700,fontSize:"13px"}}>{f.name}</div>
                    {f.acres&&<div style={{fontSize:"11px",color:T.muted}}>{f.acres} ac</div>}
                  </td>
                  {allYears.map(y=>{
                    const crops=getFieldYearCrops(f.id,y);
                    return(
                      <td key={y} style={{padding:"6px 8px",textAlign:"center",borderBottom:`1px solid ${T.border}`}}>
                        {crops.length>0
                          ? <div style={{display:"flex",gap:"3px",justifyContent:"center",flexWrap:"wrap"}}>
                              {crops.map((c,i)=>(
                                <span key={i} style={{
                                  display:"inline-block",padding:"3px 8px",borderRadius:"10px",
                                  fontSize:"11px",fontWeight:600,
                                  background:(CROP_COLORS[c]||CROP_COLORS.Other)+"25",
                                  border:`1px solid ${(CROP_COLORS[c]||CROP_COLORS.Other)}60`,
                                  color:CROP_COLORS[c]||CROP_COLORS.Other,
                                }}>{c}</span>
                              ))}
                            </div>
                          : <span style={{color:T.faint,fontSize:"12px"}}>—</span>
                        }
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Crop legend */}
      {seedingActs.length>0&&(
        <div style={{...S.card,marginBottom:"16px"}}>
          <p style={{margin:"0 0 8px",fontSize:"11px",color:T.muted,textTransform:"uppercase",letterSpacing:"0.8px",fontWeight:700}}>Crop Legend</p>
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
            {[...new Set(seedingActs.flatMap(a=>{ const d=a.data||{}; return d.crops?d.crops.map(c=>c.crop).filter(Boolean):[d.crop].filter(Boolean); }))].map(c=>(
              <span key={c} style={{padding:"3px 10px",borderRadius:"10px",fontSize:"12px",fontWeight:600,background:(CROP_COLORS[c]||CROP_COLORS.Other)+"25",border:`1px solid ${(CROP_COLORS[c]||CROP_COLORS.Other)}60`,color:CROP_COLORS[c]||CROP_COLORS.Other}}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Detail panel for selected field */}
      {detailField&&(
        <div style={S.card}>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"16px",color:T.gold,margin:"0 0 14px"}}>
            🌾 {detailField.name} — Rotation History
          </h3>
          {detailRotation.length===0
            ?<p style={{color:T.faint,fontSize:"13px"}}>No seeding records for this field.</p>
            :<div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {detailRotation.map(({year,crops,acts})=>(
                <div key={year} style={{display:"flex",gap:"12px",alignItems:"flex-start",padding:"10px 12px",background:"#F8F4EE",borderRadius:"8px",border:`1px solid ${T.border}`}}>
                  <span style={{fontWeight:700,fontSize:"18px",color:T.muted,minWidth:"44px"}}>{year}</span>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"5px"}}>
                      {crops.map((c,i)=><span key={i} style={{padding:"3px 10px",borderRadius:"10px",fontSize:"12px",fontWeight:600,background:(CROP_COLORS[c]||CROP_COLORS.Other)+"25",border:`1px solid ${(CROP_COLORS[c]||CROP_COLORS.Other)}60`,color:CROP_COLORS[c]||CROP_COLORS.Other}}>{c}</span>)}
                    </div>
                    {acts.map((a,i)=>{
                      const d=a.data||{};
                      const ferts=(d.ferts||[]).map(f=>f.blend==="Custom Blend"?f.custom:f.blend).filter(Boolean);
                      const legacyFert=d.fertBlend&&d.fertBlend!=="Custom Blend"?d.fertBlend:d.fertCustom;
                      return(
                        <div key={i} style={{fontSize:"12px",color:T.muted}}>
                          {new Date(a.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                          {(ferts.length>0||legacyFert)&&<span style={{marginLeft:"8px"}}>Fert: {ferts.length>0?ferts.join(", "):legacyFert}</span>}
                          {a.notes&&<span style={{marginLeft:"8px",fontStyle:"italic"}}>"{a.notes}"</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          }
        </div>
      )}
    </div>
  );
}

// ── Home View ─────────────────────────────────────────────────────────
function HomeView({fields,activities,onSelect,onAdd,onImport,onReport,onRotation,pendingCount,onPendingLoads}){
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
        {pendingCount>0&&(
          <button style={{...mkBtn("ghost"),padding:"10px 14px",fontSize:"14px",borderColor:"#C07010",color:"#8C5408",position:"relative"}} onClick={onPendingLoads}>
            ⚖️ Loads
            <span style={{position:"absolute",top:"-6px",right:"-6px",background:T.danger,color:"#fff",borderRadius:"10px",fontSize:"10px",fontWeight:700,padding:"1px 5px",minWidth:"18px",textAlign:"center"}}>{pendingCount}</span>
          </button>
        )}
        <button style={{...mkBtn("ghost"),padding:"10px 16px",fontSize:"14px"}} onClick={onRotation}>🔄 Rotation</button>
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
// ── Pending AgriScale Loads Modal ────────────────────────────────────
function PendingLoadsModal({loads,fields,onImport,onClose}){
  const[assigns,setAssigns]=useState(()=>{
    const m={};
    loads.forEach(g=>{
      const mf=fields.find(f=>{const n=(g._agriFieldName||"").toLowerCase().trim(),fn=f.name.toLowerCase().trim();return fn===n||n.includes(fn)||fn.includes(n);});
      m[g._agriFieldName]=mf?.id||"";
    });
    return m;
  });
  const[sel,setSel]=useState(()=>Object.fromEntries(loads.map(g=>[g._agriFieldName,true])));

  const doImport=()=>{
    const items=loads.filter(g=>sel[g._agriFieldName]&&assigns[g._agriFieldName]).map(g=>({group:g,fieldId:assigns[g._agriFieldName]}));
    onImport(items);
    onClose();
  };

  const importCount=loads.filter(g=>sel[g._agriFieldName]&&assigns[g._agriFieldName]).length;

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:250,display:"flex",justifyContent:"center",padding:"20px 12px",overflowY:"auto"}}>
      <div style={{background:"#FDFAF4",border:`1px solid ${T.borderHi}`,borderRadius:"12px",width:"100%",maxWidth:"560px",padding:"22px",alignSelf:"flex-start",marginTop:"10px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px"}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"20px",color:T.gold,margin:0}}>⚖️ AgriScale Harvest Import</h2>
          <button style={{...mkBtn("ghost"),padding:"5px 10px"}} onClick={onClose}>✕</button>
        </div>
        <p style={{margin:"0 0 14px",fontSize:"13px",color:T.muted}}>
          {loads.length} field{loads.length!==1?"s":""} with new harvest data. Assign each to a FieldLog field to import totals.
        </p>

        {loads.map(g=>(
          <div key={g._agriFieldName} style={{background:sel[g._agriFieldName]?T.card:"#F5F0E8",border:`1px solid ${sel[g._agriFieldName]?T.borderHi:T.border}`,borderRadius:"8px",padding:"12px",marginBottom:"8px"}}>
            <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
              <input type="checkbox" checked={!!sel[g._agriFieldName]} onChange={e=>setSel(s=>({...s,[g._agriFieldName]:e.target.checked}))}
                style={{width:"16px",height:"16px",accentColor:T.gold,flexShrink:0}}/>
              <div style={{flex:1}}>
                {/* Totals summary */}
                <div style={{display:"flex",gap:"12px",alignItems:"baseline",marginBottom:"8px",flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:"14px"}}>{g._agriFieldName}</span>
                  <span style={{color:T.gold,fontWeight:700,fontSize:"16px"}}>{Math.round(g.totalBu).toLocaleString()} bu</span>
                  <span style={{color:T.muted,fontSize:"12px"}}>{g.crop?g.crop.charAt(0)+g.crop.slice(1).toLowerCase():""}</span>
                  <span style={{color:T.muted,fontSize:"12px"}}>{g.loadCount} load{g.loadCount!==1?"s":""}</span>
                  {g.date&&<span style={{color:T.muted,fontSize:"12px"}}>{g.date}</span>}
                </div>
                {/* Field assignment */}
                <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                  <span style={{fontSize:"11px",color:T.muted,whiteSpace:"nowrap"}}>Import to:</span>
                  <select style={{...S.input,flex:1,padding:"5px 8px",fontSize:"12px",
                    border:`1px solid ${assigns[g._agriFieldName]?T.green:T.danger}40`,
                    background:assigns[g._agriFieldName]?"#F0F8F0":"#FDF0EE"}}
                    value={assigns[g._agriFieldName]||""}
                    onChange={e=>setAssigns(a=>({...a,[g._agriFieldName]:e.target.value}))}>
                    <option value="">⚠️ Select FieldLog field…</option>
                    {[...fields].sort((a,b)=>a.name.localeCompare(b.name)).map(f=><option key={f.id} value={f.id}>{f.name}{f.acres?` (${f.acres}ac)`:""}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        ))}

        <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"12px"}}>
          <button style={mkBtn("ghost")} onClick={onClose}>Dismiss</button>
          <button style={mkBtn("primary")} onClick={doImport} disabled={importCount===0}>
            Import {importCount} Field{importCount!==1?"s":""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────
function SettingsModal({settings,onSave,onClose,onBulkImport,bulkLoading}){
  const[s,setS]=useState(settings);
  const upd=(k,v)=>setS(p=>({...p,[k]:v}));

  const toggle=(k)=>setS(p=>({...p,[k]:!p[k]}));

  const save=()=>{ onSave(s); onClose(); };

  const sectionHead={fontFamily:"'Playfair Display',serif",fontSize:"15px",color:T.gold,margin:"0 0 12px"};
  const row={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${T.border}`};
  const desc={fontSize:"12px",color:T.muted,marginTop:"2px"};

  // Toggle switch style
  const Switch=({on,onChange})=>(
    <div onClick={onChange} style={{
      width:"44px",height:"24px",borderRadius:"12px",cursor:"pointer",
      background:on?T.green:"#C8C0B8",
      position:"relative",transition:"background .2s",flexShrink:0,
    }}>
      <div style={{
        position:"absolute",top:"3px",
        left:on?"23px":"3px",
        width:"18px",height:"18px",borderRadius:"50%",
        background:"#FFFFFF",transition:"left .2s",
        boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
      }}/>
    </div>
  );

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:300,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"20px 12px",overflowY:"auto"}}>
      <div style={{background:"#FDFAF4",border:`1px solid ${T.borderHi}`,borderRadius:"12px",width:"100%",maxWidth:"540px",padding:"24px",marginTop:"10px"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"22px"}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"20px",color:T.gold,margin:0}}>⚙️ Settings</h2>
          <button style={{...mkBtn("ghost"),padding:"5px 10px"}} onClick={onClose}>✕</button>
        </div>

        {/* ── AgriScale Integration ── */}
        <div style={{marginBottom:"22px"}}>
          <h3 style={sectionHead}>⚖️ AgriScale Integration</h3>

          <div style={row}>
            <div>
              <div style={{fontWeight:600,fontSize:"13px"}}>Enable AgriScale Connection</div>
              <div style={desc}>Connect to the Mattson Bros grain cart app to sync harvest data</div>
            </div>
            <Switch on={!!s.agriScaleEnabled} onChange={()=>toggle("agriScaleEnabled")}/>
          </div>

          {s.agriScaleEnabled&&<>
            <div style={{...S.row,paddingTop:"10px"}}>
              <label style={S.label}>AgriScale Firebase URL</label>
              <input style={S.input} type="text"
                placeholder="https://mattson-bros-grain-cart-default-rtdb.firebaseio.com"
                value={s.agriScaleUrl||""}
                onChange={e=>upd("agriScaleUrl",e.target.value)}/>
              <p style={{margin:"4px 0 0",fontSize:"11px",color:T.muted}}>⚠️ Ensure Firebase rules on this project are not expired</p>
            </div>

            <div style={{...S.row,paddingTop:"6px"}}>
              <label style={S.label}>Harvest Sync Mode</label>
              <div style={{display:"flex",gap:"0",borderRadius:"7px",overflow:"hidden",border:`1px solid ${T.border}`}}>
                {[["auto","⚡ Auto — create record on each load"],["manual","✋ Manual — review & approve loads"]].map(([val,label])=>(
                  <button key={val} style={{
                    flex:1,padding:"8px 12px",fontSize:"12px",fontWeight:600,
                    fontFamily:"'Barlow',sans-serif",cursor:"pointer",border:"none",
                    background:s.agriScaleMode===val?T.gold:"#F0EAE0",
                    color:s.agriScaleMode===val?"#FFFFFF":T.muted,
                    transition:"all .15s",
                  }} onClick={()=>upd("agriScaleMode",val)}>{label}</button>
                ))}
              </div>
            </div>

            <div style={{background:"#F0F8F5",border:`1px solid #A0C8B0`,borderRadius:"7px",padding:"10px 12px",marginTop:"8px",fontSize:"12px",color:"#2A5040"}}>
              {s.agriScaleMode==="auto"
                ? "🟢 Auto — every completed load in AgriScale will immediately create a Harvest activity in the matching field. Field names must match between apps."
                : "🟡 Manual — a pending loads badge will appear on the home screen. You review and approve which loads to import and which field to assign them to."}
            </div>

            <div style={{...S.row,marginTop:"10px"}}>
              <div>
                <div style={{fontWeight:600,fontSize:"13px"}}>Default Field Matching</div>
                <div style={desc}>How to match AgriScale loads to FieldLog fields</div>
              </div>
              <select style={{...S.input,width:"auto",fontSize:"12px",padding:"5px 10px"}} value={s.agriScaleMatch||"name"} onChange={e=>upd("agriScaleMatch",e.target.value)}>
                <option value="name">Match by field name</option>
                <option value="manual">Always assign manually</option>
              </select>
            </div>

            {/* One-time bulk import */}
            <div style={{marginTop:"14px",padding:"12px",background:"#F0F8F5",border:`1px solid #A0C8B0`,borderRadius:"8px"}}>
              <div style={{fontWeight:600,fontSize:"13px",marginBottom:"4px",color:"#2A5040"}}>Import Current AgriScale Data</div>
              <div style={{...desc,marginBottom:"10px"}}>Pull all existing field totals right now — useful for loading historical harvest data or catching up after connecting.</div>
              <button style={{...mkBtn("primary"),background:"#2A6A48",fontSize:"12px",padding:"7px 16px"}}
                onClick={()=>{ save(); onBulkImport(); }}
                disabled={bulkLoading||!s.agriScaleUrl}>
                {bulkLoading?"⏳ Loading…":"⬇ Import All Current Data"}
              </button>
            </div>
          </>}
        </div>

        {/* ── Display ── */}
        <div style={{marginBottom:"22px"}}>
          <h3 style={sectionHead}>🖥 Display</h3>
          <div style={row}>
            <div>
              <div style={{fontWeight:600,fontSize:"13px"}}>Show Acreage on Field Cards</div>
              <div style={desc}>Display acres next to each field name on the home screen</div>
            </div>
            <Switch on={s.showAcres!==false} onChange={()=>toggle("showAcres")}/>
          </div>
          <div style={row}>
            <div>
              <div style={{fontWeight:600,fontSize:"13px"}}>Show Legal Description on Field Cards</div>
              <div style={desc}>Display legal description on home screen cards</div>
            </div>
            <Switch on={s.showLegal!==false} onChange={()=>toggle("showLegal")}/>
          </div>
        </div>

        {/* ── Farm Info ── */}
        <div style={{marginBottom:"22px"}}>
          <h3 style={sectionHead}>🌾 Farm Info</h3>
          <div style={S.g2}>
            <div style={S.row}>
              <label style={S.label}>Farm / Operation Name</label>
              <input style={S.input} type="text" placeholder="e.g. Flat Acre Farms" value={s.farmName||""} onChange={e=>upd("farmName",e.target.value)}/>
            </div>
            <div style={S.row}>
              <label style={S.label}>Operator Name</label>
              <input style={S.input} type="text" placeholder="Your name" value={s.operatorName||""} onChange={e=>upd("operatorName",e.target.value)}/>
            </div>
          </div>
          <div style={S.row}>
            <label style={S.label}>Location (County / Province)</label>
            <input style={S.input} type="text" placeholder="e.g. Liberty County, MT" value={s.location||""} onChange={e=>upd("location",e.target.value)}/>
          </div>
        </div>

        <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
          <button style={mkBtn("ghost")} onClick={onClose}>Cancel</button>
          <button style={mkBtn("primary")} onClick={save}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const[view,setView]      =useState("home");
  const[fields,setFields]  =useState([]);
  const[showSettings,setShowSettings]=useState(false);
  const[settings,setSettings]=useState({
    agriScaleEnabled:false, agriScaleUrl:"", agriScaleMode:"manual",
    agriScaleMatch:"name", showAcres:true, showLegal:true,
    farmName:"", operatorName:"", location:"",
  });
  const[activities,setActs]=useState([]);
  const[loading,setLoading]=useState(true);
  const[sync,setSync]      =useState("idle"); // "idle"|"saving"|"saved"|"error"|"offline"
  const[activeField,setAF]       =useState(null);
  const[reportFieldId,setRFId]   =useState(null);  const[showAdd,setShowAdd] =useState(false);
  const[showImport,setShowImport]=useState(false);
  const[showPending,setShowPending]=useState(false);
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

  // ── AgriScale integration ────────────────────────────────────────
  const [pendingLoads,setPendingLoads]=useState([]);
  const [agriBins,setAgriBins]        =useState({});
  const seenLoadIds = useRef(new Set());
  const agriSSERef  = useRef(null);

  const parseAgriDate=(dateStr,timeStr)=>{
    try{
      const yr=new Date().getFullYear();
      const d=new Date(`${dateStr}, ${yr} ${timeStr||"12:00 PM"}`);
      if(isNaN(d.getTime())) return nowLocal();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    }catch{ return nowLocal(); }
  };
  const loadToBu=(load)=>load.grainBushelLbs>0?Math.round(load.net/load.grainBushelLbs):load.net;
  const loadToAct=(load,fieldId,binName)=>({
    id:genId(),fieldId,type:"harvest",
    date:parseAgriDate(load.date,load.timeOnly||load.time),
    data:{
      crop:load.grainName?load.grainName.charAt(0)+load.grainName.slice(1).toLowerCase():"",
      totalBushels:String(loadToBu(load)),
      deliveredTo:binName||`Farm Storage — Bin ${load.binId}`,
      equipment:"Grain Cart",
    },
    notes:`AgriScale Load #${load.id}${load.operator?` · ${load.operator}`:""}${load.truckColor?` · ${load.truckColor} truck`:""}`,
  });
  const groupToAct=(g,fieldId)=>({
    id:genId(),fieldId,type:"harvest",
    date:parseAgriDate(g.date,""),
    data:{
      crop:g.crop?g.crop.charAt(0)+g.crop.slice(1).toLowerCase():"",
      totalBushels:String(Math.round(g.totalBu)),
      deliveredTo:"Farm Storage",
      equipment:"Grain Cart",
    },
    notes:`AgriScale import · ${g.loadCount} load${g.loadCount!==1?"s":""} · ${Math.round(g.totalBu).toLocaleString()} bu total`,
  });
  const matchField=(agriName)=>{
    const n=(agriName||"").toLowerCase().trim();
    return fields.find(f=>{const fn=f.name.toLowerCase().trim();return fn===n||n.includes(fn)||fn.includes(n);});
  };

  const processAgriData=useCallback((data)=>{
    if(!data) return;
    const binMap={};
    Object.values(data.bins||{}).forEach(b=>{ if(b.id) binMap[b.id]=b.name; });
    setAgriBins(binMap);

    // Find new load IDs across all fields
    const newByField={};  // agriFieldName → { name, acres, crop, totalBu, loadCount, loadIds, date }
    Object.values(data.fields||{}).forEach(af=>{
      Object.values(af.loads||{}).forEach(load=>{
        if(!seenLoadIds.current.has(load.id)){
          if(seenLoadIds.current.size>0){
            const key=af.name;
            if(!newByField[key]) newByField[key]={
              _agriFieldName:af.name, _agriFieldAcres:af.acres,
              crop:load.grainName||"", totalBu:0, loadCount:0, loadIds:[], date:load.date,
            };
            newByField[key].totalBu   += loadToBu(load);
            newByField[key].loadCount += 1;
            newByField[key].loadIds.push(load.id);
            // Keep latest date
            newByField[key].date = load.date;
          }
          seenLoadIds.current.add(load.id);
        }
      });
    });

    const newGroups=Object.values(newByField);
    if(!newGroups.length) return;

    if(settings.agriScaleMode==="auto"){
      const toAdd=[];
      newGroups.forEach(g=>{
        const mf=matchField(g._agriFieldName);
        if(mf) toAdd.push(groupToAct(g,mf.id));
        else setPendingLoads(p=>[...p,g]);
      });
      if(toAdd.length){ const na=[...activities,...toAdd]; setActs(na); persist(fields,na); }
    } else {
      setPendingLoads(p=>[...p,...newGroups]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[fields,activities,settings.agriScaleMode]);

  useEffect(()=>{
    if(agriSSERef.current){agriSSERef.current.close();agriSSERef.current=null;}
    if(!settings.agriScaleEnabled||!settings.agriScaleUrl) return;
    try{
      const es=new EventSource(`${settings.agriScaleUrl}/state.json`);
      agriSSERef.current=es;
      es.addEventListener("put",(e)=>{ try{const{data}=JSON.parse(e.data);processAgriData(data);}catch(_){} });
      es.onerror=()=>{};
    }catch(_){}
    return()=>{if(agriSSERef.current){agriSSERef.current.close();agriSSERef.current=null;}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[settings.agriScaleEnabled,settings.agriScaleUrl,settings.agriScaleMode]);

  // One-time bulk import of ALL current AgriScale data
  const [bulkLoading,setBulkLoading]=useState(false);
  const bulkImportAgriScale=async()=>{
    if(!settings.agriScaleUrl) return;
    setBulkLoading(true);
    try{
      const resp=await fetch(`${settings.agriScaleUrl}/state.json`);
      const data=await resp.json();
      if(!data) throw new Error("No data");
      const binMap={};
      Object.values(data.bins||{}).forEach(b=>{ if(b.id) binMap[b.id]=b.name; });
      setAgriBins(binMap);
      // Aggregate all loads by field regardless of seenLoadIds
      const byField={};
      Object.values(data.fields||{}).forEach(af=>{
        const loads=Object.values(af.loads||{});
        if(!loads.length) return;
        const key=af.name;
        byField[key]={
          _agriFieldName:af.name, _agriFieldAcres:af.acres,
          crop:loads[0]?.grainName||"",
          totalBu:loads.reduce((s,l)=>s+loadToBu(l),0),
          loadCount:loads.length,
          loadIds:loads.map(l=>l.id),
          date:loads[loads.length-1]?.date||"",
        };
        // Mark all as seen
        loads.forEach(l=>seenLoadIds.current.add(l.id));
      });
      const groups=Object.values(byField).filter(g=>g.totalBu>0);
      if(!groups.length){ setBulkLoading(false); return; }
      setPendingLoads(groups);
      setShowPending(true);
    }catch(e){ alert("Could not read AgriScale data: "+e.message); }
    finally{ setBulkLoading(false); }
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
        {/* Sync indicator + settings */}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:"8px"}}>
          {syncDot.label&&<span style={{fontSize:"11px",color:sync==="error"?T.danger:sync==="saved"?T.green:T.muted}}>{syncDot.label}</span>}
          <div style={{width:"8px",height:"8px",borderRadius:"50%",background:syncDot.bg,flexShrink:0}}/>
          {!FB_CONFIGURED&&<span style={{fontSize:"10px",color:"#7A5A20",background:"#F5ECD8",border:"1px solid #D4A840",borderRadius:"4px",padding:"2px 6px"}}>Configure Firebase</span>}
          <button style={{...mkBtn("ghost"),padding:"5px 9px",fontSize:"16px",lineHeight:1}} onClick={()=>setShowSettings(true)} title="Settings">⚙️</button>
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
        {view==="home"        &&<HomeView fields={fields} activities={activities} onSelect={f=>{setAF(f);setView("fieldDetail");}} onAdd={()=>setView("addField")} onImport={()=>setShowImport(true)} onReport={()=>{setRFId(null);setView("reports");}} onRotation={()=>setView("rotation")} pendingCount={pendingLoads.length} onPendingLoads={()=>setShowPending(true)}/>}
        {view==="reports"     &&<ReportsView fields={fields} activities={activities} onBack={()=>setView(reportFieldId?"fieldDetail":"home")} filterFieldId={reportFieldId}/>}
        {view==="rotation"    &&<CropRotationView fields={fields} activities={activities} onBack={()=>setView("home")}/>}
        {view==="addField"    &&<AddFieldView onBack={()=>setView("home")} onSave={addField}/>}
        {view==="fieldDetail" &&curField&&<FieldDetailView field={curField} activities={activities} onBack={()=>setView("home")} onAddActivity={()=>setShowAdd(true)} onDeleteActivity={delActivity} onUpdateField={updateField} onDeleteField={deleteField} onReport={()=>{setRFId(curField.id);setView("reports");}}/>}
      </div>

      {showAdd&&curField&&<AddActivityModal field={curField} onClose={()=>setShowAdd(false)} onSave={addActivity}/>}
      {showImport&&<ImportFieldsModal onClose={()=>setShowImport(false)} onImport={importFields}/>}
      {showSettings&&<SettingsModal settings={settings} onSave={setSettings} onClose={()=>setShowSettings(false)} onBulkImport={bulkImportAgriScale} bulkLoading={bulkLoading}/>}
      {showPending&&<PendingLoadsModal
        loads={pendingLoads} fields={fields}
        onClose={()=>setShowPending(false)}
        onImport={(items)=>{
          const toAdd=items.map(({group:g,fieldId})=>groupToAct(g,fieldId));
          const na=[...activities,...toAdd]; setActs(na); persist(fields,na);
          setPendingLoads(p=>p.filter(g=>!items.find(i=>i.group._agriFieldName===g._agriFieldName)));
        }}
      />}
    </div>
  );
}

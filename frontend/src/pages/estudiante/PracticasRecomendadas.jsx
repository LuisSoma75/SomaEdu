import React, { useEffect, useMemo, useState, useCallback } from "react";
import StudentSidebar from "../../components/StudentSidebar.jsx"; // ← usar la sidebar del estudiante
import "./PracticasRecomendadas.css";

const API = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/+$/, "");

/* ===================== helpers id_usuario ===================== */
function dig(o, p){return p.split(".").reduce((a,k)=>a?.[k],o)}
function tryId(obj){
  const paths=["id_usuario","id","user.id_usuario","user.id","usuario.id_usuario","usuario.id","profile.id_usuario","profile.id"];
  for(const p of paths){const v=dig(obj||{},p);if(v!=null && Number.isFinite(Number(v))) return Number(v)}
  return null
}
function guessUserIdFromLocalStorage(){
  try{const a=JSON.parse(localStorage.getItem("auth")||"null");const id=tryId(a);if(Number.isFinite(id))return id;}catch{}
  for(const k of ["user","usuario","profile","session","me"]){try{const o=JSON.parse(localStorage.getItem(k)||"null");const id=tryId(o);if(Number.isFinite(id))return id;}catch{}}
  for(const k of ["id_usuario","user_id","id"]){const raw=localStorage.getItem(k);if(raw && Number.isFinite(Number(raw)))return Number(raw)}
  return null;
}
/* ============================================================= */

export default function PracticasRecomendadas(){
  const [userId, setUserId] = useState(() => guessUserIdFromLocalStorage());
  const [loading, setLoading] = useState(true);
  const [items, setItems]     = useState([]);
  const [error, setError]     = useState("");

  const fetchJSON = useCallback(async (url, signal) => {
    const r = await fetch(url, { signal, credentials:"include", headers:{Accept:"application/json"} });
    let data=null; try{data=await r.json()}catch{}
    if(!r.ok){throw new Error((data && (data.msg||data.message||data.error)) || `HTTP ${r.status}`)}
    return data;
  },[]);

  // /me si no hay id local
  useEffect(()=>{
    if(userId!=null) return;
    const ac=new AbortController();
    (async()=>{
      for(const u of [`${API}/api/auth/me`,`${API}/api/me`,`${API}/api/session/me`,`${API}/api/whoami`,`${API}/api/users/me`]){
        try{
          const me=await fetchJSON(u,ac.signal);
          const id=me?.id_usuario ?? me?.id ?? me?.user?.id_usuario ?? me?.user?.id ?? me?.usuario?.id_usuario ?? me?.usuario?.id;
          if(Number.isFinite(Number(id))){ setUserId(Number(id)); return; }
        }catch{}
      }
    })();
    return ()=>ac.abort();
  },[API,userId,fetchJSON]);

  // -------- hidratar RIT (valor de estándar) ----------
  const fetchRitMap = useCallback(async (ids, signal)=>{
    const idList = [...new Set(ids.filter(Number.isFinite))];
    if(!idList.length) return {};
    for(const u of [
      `${API}/api/estandares/rit?ids=${idList.join(",")}`,
      `${API}/api/estandares?ids=${idList.join(",")}`,
      `${API}/api/estandar/rit?ids=${idList.join(",")}`,
      `${API}/api/estandar?ids=${idList.join(",")}`,
    ]){
      try{
        const d=await fetchJSON(u,signal);
        const arr = d.items || d.data || d.rits || d.estandares || d;
        const map = {};
        if(Array.isArray(arr)){
          for(const x of arr){
            const id = Number(x.id_estandar ?? x.id ?? x.estandar_id);
            const val = Number(x.Valor ?? x.valor ?? x.rit ?? x.RIT);
            if(Number.isFinite(id) && Number.isFinite(val)) map[id]=val;
          }
        } else if (arr && typeof arr==='object'){
          for(const [k,v] of Object.entries(arr)){
            const id=Number(k);
            const val=Number(v?.Valor ?? v?.valor ?? v?.rit ?? v);
            if(Number.isFinite(id) && Number.isFinite(val)) map[id]=val;
          }
        }
        if(Object.keys(map).length) return map;
      }catch{}
    }
    // fallback por-id
    const map={};
    for(const id of idList){
      for(const u of [
        `${API}/api/estandar/${id}`,
        `${API}/api/estandares/${id}`,
        `${API}/api/estandar?id=${id}`,
      ]){
        try{
          const d=await fetchJSON(u,signal);
          const v=Number(d?.Valor ?? d?.valor ?? d?.rit ?? d?.data?.Valor ?? d?.data?.valor);
          if(Number.isFinite(v)){ map[id]=v; break; }
        }catch{}
      }
    }
    return map;
  },[API,fetchJSON]);
  // ----------------------------------------------------

  // Carga recomendaciones y separa prioridad vs RIT
  useEffect(()=>{
    const ac=new AbortController();
    (async()=>{
      setLoading(true); setError("");
      try{
        if(!Number.isFinite(Number(userId))) throw new Error("No se detectó el id del usuario. Inicia sesión nuevamente.");

        const qp=new URLSearchParams({ id_usuario:String(userId), carne:String(userId) }); // compat
        const urls=[
          `${API}/api/estudiante/practicas/recomendadas?${qp}`,
          `${API}/api/estudiante/recomendadas?${qp}`,
          `${API}/api/adaptative/recommendations?${qp}`,
        ];

        let result=[];
        for(const u of urls){
          try{
            const j=await fetchJSON(u,ac.signal);
            const arr=j.items||j.data||j||[];
            if(arr?.length){ result=arr; break; }
          }catch{}
        }

        let norm=(result||[]).map(n=>({
          id: n.id || n.id_rec || n.id_practica || n.id_pregunta || (crypto.randomUUID?.() || Math.random().toString(36).slice(2)),
          titulo: n.titulo || n.nombre || n.enunciado || (n.id_estandar ? `Estándar #${n.id_estandar}` : "Práctica"),
          area: n.area || n.nombre_area || n.nombreTema || "Área",
          prioridad: Number(n.prioridad ?? n.valor ?? n.Valor ?? 0), // prioridad ≠ RIT
          rit: (n.rit!=null) ? Number(n.rit)
               : (n.valor_estandar!=null) ? Number(n.valor_estandar)
               : (n.ValorEstandar!=null) ? Number(n.ValorEstandar)
               : null,
          id_estandar: n.id_estandar ?? null,
        }));

        // hidrata RIT si hace falta (desde tabla Estandar)
        if(norm.some(x=>!Number.isFinite(x.rit)) && norm.some(x=>Number.isFinite(x.id_estandar))){
          const ids = norm.filter(x=>!Number.isFinite(x.rit) && Number.isFinite(x.id_estandar)).map(x=>x.id_estandar);
          const ritMap = await fetchRitMap(ids, ac.signal);
          norm = norm.map(x => Number.isFinite(x.rit) ? x : ({...x, rit: ritMap[x.id_estandar] ?? x.rit}));
        }

        setItems(norm);
      } catch(e){
        setError(e.message || "No se pudieron cargar recomendaciones.");
      } finally {
        setLoading(false);
      }
    })();
    return ()=>ac.abort();
  },[API,userId,fetchJSON,fetchRitMap]);

  // Agrupar por bloques usando **rit**
  const groups = useMemo(()=>{
    const buckets=new Map();
    for(const it of items){
      const r = Math.max(1, Math.round(Number(it.rit||0))); // RIT real
      const start = Math.floor((r-1)/10)*10+1;
      const end = start+9;
      const key=`${start}-${end}`;
      if(!buckets.has(key)) buckets.set(key,{start,end,items:[]});
      buckets.get(key).items.push(it);
    }
    const arr=[...buckets.values()].sort((a,b)=>a.start-b.start);
    for(const g of arr){
      g.items.sort((x,y)=>(y.prioridad??0)-(x.prioridad??0) || String(x.area).localeCompare(String(y.area)) || String(x.titulo).localeCompare(String(y.titulo)));
      const byArea = new Map();
      for(const it of g.items){
        const k = String(it.area||"Área");
        if(!byArea.has(k)) byArea.set(k, []);
        byArea.get(k).push(it);
      }
      g.byArea = [...byArea.entries()]
        .sort((a,b)=>a[0].localeCompare(b[0]))
        .map(([area, list])=>({ area, items:list }));
    }
    return arr;
  },[items]);

  return (
    <div className="pr-app with-sidebar">
      {/* Sidebar del estudiante */}
      <StudentSidebar active="practicas" />

      {/* Contenido principal */}
      <main className="pr-main">
        <section className="pr-hero">
          <h1>Prácticas recomendadas</h1>
          <p>Sugerencias personalizadas para reforzar tus áreas.</p>
        </section>

        {loading && <div className="pr-skeleton">Cargando recomendaciones…</div>}
        {error && <div className="pr-alert pr-alert-error">{error}</div>}

        {!loading && !error && groups.length>0 && (
          <div className="pr-groups">
            {groups.map(g=>(
              <section key={`${g.start}-${g.end}`} className="pr-group">
                <header className="pr-group-header">
                  <h2>RIT {g.start} – {g.end}</h2>
                  <span className="pr-group-count">{g.items.length} ítem{g.items.length===1?"":"es"}</span>
                </header>

                {/* --- subdivisiones por área --- */}
                {g.byArea.map((sub)=>(
                  <div className="pr-area" key={`${g.start}-${g.end}-${sub.area}`}>
                    <div className="pr-area-header">
                      <div className="pr-area-title">
                        <span className="pr-area-divider" />
                        <h3>{sub.area}</h3>
                      </div>
                      <span className="pr-area-count">{sub.items.length}</span>
                    </div>

                    <ul className="pr-list">
                      {sub.items.map(it=>(
                        <li key={it.id} className="pr-item">
                          <div className="pr-item-main">
                            <div className="pr-item-top">
                              <div className="pr-item-badges">
                                {Number.isFinite(it.rit) && <span className="pr-badge">RIT {Math.round(it.rit)}</span>}
                                {Number.isFinite(it.prioridad) && <span className="pr-badge pr-badge-alt">Prioridad {it.prioridad}</span>}
                              </div>
                            </div>
                            <h4 className="pr-item-title">{it.titulo}</h4>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

        {!loading && !error && groups.length===0 && (
          <div className="pr-empty">Por ahora no hay recomendaciones disponibles. Completa una evaluación para generarlas.</div>
        )}
      </main>
    </div>
  );
}

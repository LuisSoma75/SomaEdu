import React, { useEffect, useState } from "react";
import { socket } from "../../services/socket";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Props: sessionId (por ruta), idDocente (de auth/context)
 * Ruta sugerida: /docente/sala/:sessionId
 */
export default function SalaDeEsperaDocente({ sessionId, idDocente }) {
  const [estado, setEstado] = useState("en_espera");
  const [counts, setCounts] = useState({ en_espera: 0, listo: 0, en_curso: 0, finalizado: 0 });
  const [iniciando, setIniciando] = useState(false);

  useEffect(() => {
    (async () => {
      socket.emit("join-session", { sessionId, userId: idDocente, role: "docente" });
      const r = await fetch(`${API}/api/waitroom/${sessionId}/state`);
      const j = await r.json();
      if (j.ok) { setEstado(j.estado); setCounts(j.participantes); }
    })();
  }, [sessionId, idDocente]);

  useEffect(() => {
    const onState = (data) => { setEstado(data.estado); setCounts(data.participantes); };
    socket.on("waitroom:state", onState);
    return () => { socket.off("waitroom:state", onState); };
  }, []);

  const iniciar = async () => {
    try {
      setIniciando(true);
      // REST (por si el socket se cae)…
      const r = await fetch(`${API}/api/waitroom/${sessionId}/start`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "start_failed");
      // … y socket para anunciar en tiempo real
      socket.emit("start-session", { sessionId, userId: idDocente, role: "docente" });
    } catch (e) {
      console.error(e);
      alert("No se pudo iniciar la sesión");
    } finally {
      setIniciando(false);
    }
  };

  return (
    <section className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Sala de espera (Docente)</h1>
      <p className="text-gray-600 mb-4">Inicia cuando veas a tus estudiantes conectados.</p>

      <div className="rounded-lg border p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">Estado de la sesión</div>
            <div className="text-lg font-medium capitalize">{estado.replace("_", " ")}</div>
          </div>
          <div className="text-sm grid grid-cols-2 gap-3">
            <div><span className="font-semibold">{counts.en_espera}</span> en espera</div>
            <div><span className="font-semibold">{counts.listo}</span> listos</div>
            <div><span className="font-semibold">{counts.en_curso}</span> en curso</div>
            <div><span className="font-semibold">{counts.finalizado}</span> finalizados</div>
          </div>
        </div>
      </div>

      <button
        onClick={iniciar}
        disabled={iniciando || estado === "activa"}
        className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {estado === "activa" ? "Sesión ya iniciada" : (iniciando ? "Iniciando…" : "Iniciar evaluación")}
      </button>
    </section>
  );
}

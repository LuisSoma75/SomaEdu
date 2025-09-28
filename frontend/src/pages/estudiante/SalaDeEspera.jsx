import React, { useEffect, useState } from "react";
import { socket } from "../../services/socket";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Props: sessionId (por ruta), idEstudiante (de tu auth/context)
 * Ruta sugerida: /estudiante/sala/:sessionId
 */
export default function SalaDeEspera({ sessionId, idEstudiante, onStart }) {
  const [estado, setEstado] = useState("en_espera");
  const [counts, setCounts] = useState({ en_espera: 0, listo: 0, en_curso: 0, finalizado: 0 });
  const [cargando, setCargando] = useState(true);

  // 1) Registra al estudiante en la sala (REST)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/waitroom/${sessionId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_estudiante: idEstudiante })
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "join_failed");

        // 2) Conecta al socket y se une al room
        socket.emit("join-session", { sessionId, userId: idEstudiante, role: "estudiante" }, (ack) => {
          // opcional: revisar ack
        });

        // Carga estado actual
        const rs = await fetch(`${API}/api/waitroom/${sessionId}/state`);
        const js = await rs.json();
        if (!cancel && js.ok) {
          setEstado(js.estado);
          setCounts(js.participantes);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => { cancel = true; };
  }, [sessionId, idEstudiante]);

  // Eventos realtime
  useEffect(() => {
    const onState = (data) => {
      setEstado(data.estado);
      setCounts(data.participantes);
    };
    const onStarted = (data) => {
      // El docente inició → navega al resolutorio
      onStart?.(data.sessionId);
    };

    socket.on("waitroom:state", onState);
    socket.on("waitroom:started", onStarted);

    // Heartbeat opcional
    const hb = setInterval(() => {
      socket.emit("waitroom:ping", { sessionId, userId: idEstudiante });
    }, 15000);

    return () => {
      socket.off("waitroom:state", onState);
      socket.off("waitroom:started", onStarted);
      clearInterval(hb);
    };
  }, [sessionId, idEstudiante, onStart]);

  if (cargando) return <div className="p-6">Cargando sala de espera…</div>;

  return (
    <section className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Sala de espera</h1>
      <p className="text-gray-600 mb-4">La evaluación iniciará cuando el docente lo indique.</p>

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

      <div className="text-sm text-gray-500">
        Mantén esta ventana abierta. Se te redirigirá automáticamente cuando inicie.
      </div>
    </section>
  );
}

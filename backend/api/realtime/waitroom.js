import { Server } from "socket.io";
import db from "../utils/db.js";

export default function attachWaitroom(server, { corsOrigin }) {
  const io = new Server(server, {
    cors: { origin: corsOrigin, credentials: true },
    path: "/socket.io"
  });

  // Namespace opcional (usa el default si prefieres): io.of("/eval")
  io.on("connection", (socket) => {
    // join-session: estudiante o docente se une al room de la sesión
    socket.on("join-session", async (payload, ack) => {
      try {
        const { sessionId, userId, role } = payload || {};
        if (!sessionId || !userId || !role) {
          return ack?.({ ok: false, error: "missing_fields" });
        }

        // Une el socket al room de esa sesión
        const room = `sesion:${sessionId}`;
        socket.join(room);

        // Si es estudiante, upsert a en_espera en DB
        if (role === "estudiante") {
          await db.query(
            `INSERT INTO "Sesion_participante" ("id_sesion","id_estudiante","estado","socket_id")
             VALUES ($1,$2,'en_espera',$3)
             ON CONFLICT ("id_sesion","id_estudiante")
             DO UPDATE SET "estado"='en_espera',"last_ping"=now(),"socket_id"=$3`,
            [sessionId, userId, socket.id]
          );
        }

        // Envía estado actual del room
        const estado = await getWaitroomState(sessionId);
        io.to(room).emit("waitroom:state", estado);

        ack?.({ ok: true });
      } catch (e) {
        console.error("join-session error:", e);
        ack?.({ ok: false, error: "server_error" });
      }
    });

    // docente indica inicio → todos pasan de espera a en_curso
    socket.on("start-session", async (payload, ack) => {
      try {
        const { sessionId, userId, role } = payload || {};
        if (!sessionId || role !== "docente") {
          return ack?.({ ok: false, error: "forbidden" });
        }

        // Cambia estado de la sesión
        await db.query(
          `UPDATE "Sesion_evaluacion"
             SET "estado"='activa',"iniciado_en"=now()
           WHERE "id_sesion"=$1`,
          [sessionId]
        );

        // Actualiza participantes en espera a en_curso
        await db.query(
          `UPDATE "Sesion_participante"
              SET "estado"='en_curso'
            WHERE "id_sesion"=$1 AND "estado" IN ('en_espera','listo')`,
          [sessionId]
        );

        const room = `sesion:${sessionId}`;
        io.to(room).emit("waitroom:started", { ok: true, sessionId });

        ack?.({ ok: true });
      } catch (e) {
        console.error("start-session error:", e);
        ack?.({ ok: false, error: "server_error" });
      }
    });

    // Ping opcional para heartbeat
    socket.on("waitroom:ping", async (payload) => {
      const { sessionId, userId } = payload || {};
      if (!sessionId || !userId) return;
      try {
        await db.query(
          `UPDATE "Sesion_participante"
              SET "last_ping"=now()
            WHERE "id_sesion"=$1 AND "id_estudiante"=$2`,
          [sessionId, userId]
        );
      } catch (e) {
        console.error("waitroom:ping error:", e);
      }
    });

    socket.on("disconnect", async () => {
      try {
        // Si quieres dar de baja a estudiantes al desconectar:
        await db.query(
          `UPDATE "Sesion_participante" SET "socket_id"=NULL WHERE "socket_id"=$1`,
          [socket.id]
        );
      } catch (e) {
        console.error("disconnect cleanup error:", e);
      }
    });
  });

  async function getWaitroomState(sessionId) {
    const ses = await db.query(
      `SELECT "id_sesion","estado","iniciado_en"
         FROM "Sesion_evaluacion"
        WHERE "id_sesion"=$1`,
      [sessionId]
    );

    const counts = await db.query(
      `SELECT estado, COUNT(*)::int AS c
         FROM "Sesion_participante"
        WHERE "id_sesion"=$1
        GROUP BY estado`,
      [sessionId]
    );

    const byState = Object.fromEntries(counts.rows.map(r => [r.estado, r.c]));
    return {
      id_sesion: Number(sessionId),
      estado: ses.rows[0]?.estado || "en_espera",
      participantes: {
        en_espera:  byState["en_espera"]  || 0,
        listo:      byState["listo"]      || 0,
        en_curso:   byState["en_curso"]   || 0,
        finalizado: byState["finalizado"] || 0,
      }
    };
  }
}

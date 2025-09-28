-- Participantes por sesión (sala de espera y estado durante la evaluación)
CREATE TABLE IF NOT EXISTS "Sesion_participante" (
  id_participante    BIGSERIAL PRIMARY KEY,
  id_sesion          BIGINT NOT NULL REFERENCES "Sesion_evaluacion"("id_sesion") ON DELETE CASCADE,
  id_estudiante      BIGINT NOT NULL REFERENCES "Estudiante"("id_estudiante"),
  estado             TEXT   NOT NULL CHECK (estado IN ('en_espera','listo','en_curso','retirado','finalizado')),
  joined_at          TIMESTAMPTZ DEFAULT now(),
  last_ping          TIMESTAMPTZ DEFAULT now(),
  socket_id          TEXT,
  UNIQUE (id_sesion, id_estudiante)
);

CREATE INDEX IF NOT EXISTS idx_sp_sesion_estado ON "Sesion_participante"(id_sesion, estado);

-- Campos útiles en la sesión (si no existen ya)
ALTER TABLE "Sesion_evaluacion"
  ADD COLUMN IF NOT EXISTS "estado"        TEXT NOT NULL DEFAULT 'en_espera', -- programada | en_espera | activa | finalizada
  ADD COLUMN IF NOT EXISTS "iniciado_en"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "finalizado_en" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "pin"           VARCHAR(8);

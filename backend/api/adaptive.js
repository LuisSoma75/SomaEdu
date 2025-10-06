// src/api/adaptive.js
const API = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",        // importante si usas cookies/sesión
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.msg || data?.error || res.statusText || "Error");
  }
  return data;
}

export function startAdaptive({ id_sesion, id_materia, carne_estudiante, num_preg_max = 10 }) {
  return postJSON(`${API}/adaptative/session/start`, {
    id_sesion, id_materia, carne_estudiante, num_preg_max,
  });
}

export function answerAdaptive({ id_evaluacion, id_pregunta, id_opcion, id_materia, valor_estandar_actual, tiempo_respuesta }) {
  return postJSON(`${API}/adaptative/session/${id_evaluacion}/answer`, {
    id_pregunta,
    id_opcion,
    id_materia,
    valor_estandar_actual,
    tiempo_respuesta, // en segundos; el backend lo convierte a HH:MM:SS
  });
}

export function endAdaptive({ id_evaluacion }) {
  return postJSON(`${API}/adaptative/session/${id_evaluacion}/end`, {});
}

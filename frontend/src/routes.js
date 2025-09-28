// src/routes.js
import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useParams,
  useNavigate,
  Navigate,
} from "react-router-dom";

import Login from "./pages/Login";

// Estudiante
import EstudianteDashboard from "./pages/estudiante/EstudianteDashboard.jsx";
import EvaluacionesDisponibles from "./pages/estudiante/EvaluacionesDisponibles.jsx";
import SalaDeEspera from "./pages/estudiante/SalaDeEspera.jsx";

// Docente
import SalaDeEsperaDocente from "./pages/docente/SalaDeEsperaDocente.jsx";
import Monitoreo from "./pages/docente/MonitoreoEvaluacion.jsx";

/* ============ Auth helper (desde localStorage) ============ */
const getAuth = () => {
  try {
    const raw = localStorage.getItem("auth") || "{}";
    const p = JSON.parse(raw);

    return {
      idUsuario: p.idUsuario ?? p.id ?? p.id_usuario ?? null,
      // OJO: en tu backend el identificador de estudiante principal es carne_estudiante;
      // aquí sólo necesitamos el rol + idUsuario para los guards.
      role: p.role ?? p.rol ?? null, // 1 admin? 2 docente, 3 estudiante (ajusta a tu esquema real)
      token: p.token ?? null,
    };
  } catch {
    return { idUsuario: null, role: null, token: null };
  }
};

/* ============ Wrappers específicos ============ */
// Sala de espera (Estudiante)
const StudentWaitroomRoute = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const auth = getAuth();

  // sólo estudiantes (role === 3)
  if (!auth.idUsuario || String(auth.role) !== "3") return <Navigate to="/" replace />;

  const sid = Number(sessionId);
  return (
    <SalaDeEspera
      sessionId={sid}
      idEstudiante={auth.idUsuario /* usamos idUsuario como identificador cliente */}
      onStart={() => navigate(`/estudiante/resolver/${sid}`)}
    />
  );
};

// Sala de espera (Docente)
const DocenteWaitroomRoute = () => {
  const { sessionId } = useParams();
  const auth = getAuth();

  // sólo docentes (role === 2)
  if (!auth.idUsuario || String(auth.role) !== "2") return <Navigate to="/" replace />;

  const sid = Number(sessionId);
  return <SalaDeEsperaDocente sessionId={sid} idDocente={auth.idUsuario} />;
};

/* ============ Guards por rol ============ */
const DocenteGuard = ({ children }) => {
  const auth = getAuth();
  return auth.idUsuario && String(auth.role) === "2" ? children : <Navigate to="/" replace />;
};

const EstudianteGuard = ({ children }) => {
  const auth = getAuth();
  return auth.idUsuario && String(auth.role) === "3" ? children : <Navigate to="/" replace />;
};

/* ============ Router principal ============ */
const AppRoutes = () => (
  <BrowserRouter>
    <Routes>
      {/* Login */}
      <Route path="/" element={<Login />} />

      {/* Estudiante (siempre con prefijo /estudiante) */}
      <Route
        path="/estudiante"
        element={
          <EstudianteGuard>
            <EstudianteDashboard />
          </EstudianteGuard>
        }
      />
      <Route
        path="/estudiante/evaluaciones"
        element={
          <EstudianteGuard>
            <EvaluacionesDisponibles />
          </EstudianteGuard>
        }
      />
      <Route
        path="/estudiante/sala/:sessionId"
        element={<StudentWaitroomRoute />}
      />

      {/* Docente (siempre con prefijo /docente) */}
      <Route
        path="/docente/sala/:sessionId"
        element={<DocenteWaitroomRoute />}
      />
      <Route
        path="/docente/monitoreo"
        element={
          <DocenteGuard>
            <Monitoreo />
          </DocenteGuard>
        }
      />

      {/* No dejes rutas genéricas como /evaluaciones o /monitoreo */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);

export default AppRoutes;

// src/App.jsx   (mueve/renombra desde src/utils/App.jsx si aplica)
import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";

/* ============ PÁGINAS ============ */
// AUTH / ADMIN
import Login from "./pages/auth/Login";
import AdminDashboard from "./pages/admin/AdminDashboard";

// DOCENTE (layout + páginas)
import DocenteLayout from "./layouts/DocenteLayout";
import DocenteDashboard from "./pages/docente/DocenteDashboard";
import GestionEvaluacion from "./pages/docente/GestionEvaluacion";
import MonitoreoEvaluacion from "./pages/docente/MonitoreoEvaluacion";
import HistorialEvaluacionDoc from "./pages/docente/HistorialEvaluacion";
import ReportesDocente from "./pages/docente/ReportesDocente";
import SalaDeEsperaDocente from "./pages/docente/SalaDeEsperaDocente.jsx";

// ESTUDIANTE
import EstudianteDashboard from "./pages/estudiante/EstudianteDashboard";
import EvaluacionesDisponibles from "./pages/estudiante/EvaluacionesDisponibles.jsx";
import HistorialEvaluacion from "./pages/estudiante/HistorialEvaluacion.jsx";
import SalaDeEspera from "./pages/estudiante/SalaDeEspera.jsx";

/* =========================
   Helper de auth (localStorage)
========================= */
const getAuth = () => {
  try {
    const raw = localStorage.getItem("auth") || "{}";
    const p = JSON.parse(raw);
    return {
      idUsuario: p.idUsuario ?? p.id ?? p.id_usuario ?? null,
      role: p.role ?? p.rol ?? null, // 1=admin, 2=docente, 3=estudiante
      token: p.token ?? null,
    };
  } catch {
    return { idUsuario: null, role: null, token: null };
  }
};

/* =========================
   Guards por rol
========================= */
const DocenteGuard = ({ children }) => {
  const { idUsuario, role } = getAuth();
  return idUsuario && String(role) === "2" ? children : <Navigate to="/" replace />;
};

const EstudianteGuard = ({ children }) => {
  const { idUsuario, role } = getAuth();
  return idUsuario && String(role) === "3" ? children : <Navigate to="/" replace />;
};

const AdminGuard = ({ children }) => {
  const { idUsuario, role } = getAuth();
  return idUsuario && String(role) === "1" ? children : <Navigate to="/" replace />;
};

/* =========================
   Wrapper para sala del docente (usa id numérico)
========================= */
const DocenteWaitroomRoute = () => {
  const { sessionId } = useParams();
  const { idUsuario, role } = getAuth();
  if (!idUsuario || String(role) !== "2") return <Navigate to="/" replace />;
  const sid = Number(sessionId);
  if (!Number.isFinite(sid) || sid <= 0) return <Navigate to="/docente" replace />;
  return <SalaDeEsperaDocente sessionId={sid} idDocente={idUsuario} />;
};

/* =========================
   APP
========================= */
function App() {
  return (
    <Router>
      <Routes>
        {/* Público / auth */}
        <Route path="/" element={<Login />} />

        {/* Admin */}
        <Route
          path="/admin"
          element={
            <AdminGuard>
              <AdminDashboard />
            </AdminGuard>
          }
        />

        {/* DOCENTE: layout + rutas hijas bajo /docente */}
        <Route
          path="/docente"
          element={
            <DocenteGuard>
              <DocenteLayout />
            </DocenteGuard>
          }
        >
          <Route index element={<DocenteDashboard />} />
          <Route path="evaluaciones" element={<GestionEvaluacion />} />
          <Route path="monitoreo" element={<MonitoreoEvaluacion />} />
          <Route path="historial" element={<HistorialEvaluacionDoc />} />
          <Route path="reportes" element={<ReportesDocente />} />
        </Route>

        {/* Sala de espera del docente (sesión específica, numérica) */}
        <Route path="/docente/sala/:sessionId" element={<DocenteWaitroomRoute />} />

        {/* ESTUDIANTE */}
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
          path="/estudiante/historial"
          element={
            <EstudianteGuard>
              <HistorialEvaluacion />
            </EstudianteGuard>
          }
        />

        {/* Sala de espera del estudiante
            Usamos :sidOrCode para permitir tanto ID numérico como código (ej. ev1).
            El propio componente SalaDeEspera resuelve el ID internamente y maneja redirección al iniciar. */}
        <Route
          path="/estudiante/sala/:sidOrCode"
          element={
            <EstudianteGuard>
              <SalaDeEspera />
            </EstudianteGuard>
          }
        />

        {/* Fallback a login */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;

// src/App.jsx
import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useParams,
  useNavigate,
  useLocation,
} from "react-router-dom";

// ==== Toggle de LOGS (pon en false para silenciar) ====
const DBG = true;
const log  = (...a) => DBG && console.log("[APP]", ...a);
const warn = (...a) => DBG && console.warn("[APP]", ...a);

// ===== AUTH / ADMIN =====
import Login from "./pages/auth/Login";
import AdminDashboard from "./pages/admin/AdminDashboard";

// ===== DOCENTE (layout + páginas) =====
import DocenteLayout from "./layouts/DocenteLayout";
import DocenteDashboard from "./pages/docente/DocenteDashboard";
import GestionEvaluacion from "./pages/docente/GestionEvaluacion";
import MonitoreoEvaluacion from "./pages/docente/MonitoreoEvaluacion";
import HistorialEvaluacionDoc from "./pages/docente/HistorialEvaluacion";
import ReportesDocente from "./pages/docente/ReportesDocente";
import SalaDeEsperaDocente from "./pages/docente/SalaDeEsperaDocente.jsx";

// ===== ESTUDIANTE =====
import EstudianteDashboard from "./pages/estudiante/EstudianteDashboard";
import EvaluacionesDisponibles from "./pages/estudiante/EvaluacionesDisponibles.jsx";
import HistorialEvaluacion from "./pages/estudiante/HistorialEvaluacion.jsx";
import SalaDeEspera from "./pages/estudiante/SalaDeEspera.jsx";
import ResolverEvaluacion from "./pages/estudiante/ResolverEvaluacion.jsx";
import PracticasRecomendadas from "./pages/estudiante/PracticasRecomendadas.jsx";

/* =========================
   Helper de auth (localStorage) — TOLERANTE
========================= */
const getAuth = () => {
  try {
    const raw = localStorage.getItem("auth") || "{}";
    log("getAuth raw:", raw);
    const p = JSON.parse(raw);

    // Identificadores posibles
    const idUsuario =
      p.idUsuario ??
      p.id_usuario ??
      p.userId ??
      p.usuario_id ??
      p.id ??
      null;

    const carne =
      p.carne_estudiante ??
      p.carne ??
      p.carnet ??
      null;

    // Role opcional (acepta varios nombres/formatos)
    const roleRaw =
      p.role ?? p.rol ?? p.id_rol ?? p.role_id ?? p.tipo ?? p.tipo_usuario ?? null;
    const s = String(roleRaw ?? "").trim().toLowerCase();
    let role = null;
    if (s === "3" || s === "estudiante" || s === "student") role = 3;
    else if (s === "2" || s === "docente" || s === "teacher") role = 2;
    else if (s === "1" || s === "admin" || s === "administrator") role = 1;
    else if (!Number.isNaN(Number(s)) && s !== "") role = Number(s);

    const token = p.token ?? p.access_token ?? p.jwt ?? null;

    const auth = { idUsuario, carne, role, token: token ? "****" : null };
    log("getAuth parsed:", auth);
    return { idUsuario, carne, role, token };
  } catch (e) {
    warn("getAuth error:", e);
    return { idUsuario: null, carne: null, role: null, token: null };
  }
};

/* =========================
   Guards por rol — TOLERANTES
========================= */
// Estudiante: basta con tener identidad (idUsuario o carne).
const isStudent = (a) => !!(a?.idUsuario || a?.carne);

// Docente: requiere idUsuario y role === 2
const isTeacher = (a) => !!a?.idUsuario && a?.role === 2;

// Admin: requiere idUsuario y role === 1
const isAdmin = (a) => !!a?.idUsuario && a?.role === 1;

const DocenteGuard = ({ children }) => {
  const auth = getAuth();
  const loc = useLocation();
  const pass = isTeacher(auth);
  log("DocenteGuard", { path: loc.pathname, pass, auth: { ...auth, token: auth.token ? "****" : null } });
  return pass ? children : <Navigate to="/" replace />;
};

const EstudianteGuard = ({ children }) => {
  const auth = getAuth();
  const loc = useLocation();
  const pass = isStudent(auth);
  log("EstudianteGuard", { path: loc.pathname, pass, auth: { ...auth, token: auth.token ? "****" : null } });
  return pass ? children : <Navigate to="/" replace />;
};

const AdminGuard = ({ children }) => {
  const auth = getAuth();
  const loc = useLocation();
  const pass = isAdmin(auth);
  log("AdminGuard", { path: loc.pathname, pass, auth: { ...auth, token: auth.token ? "****" : null } });
  return pass ? children : <Navigate to="/" replace />;
};

/* =========================
   Wrappers para salas
========================= */
// Sala de espera estudiante (redirige a resolver cuando se inicie)
const StudentWaitroomRoute = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const auth = getAuth();
  const loc = useLocation();

  const pass = isStudent(auth);
  log("StudentWaitroomRoute mount", { path: loc.pathname, sessionId, pass });

  if (!pass) return <Navigate to="/" replace />;

  const sid = Number(sessionId);
  const onStart = () => {
    log("StudentWaitroomRoute.onStart -> resolver", { sid });
    navigate(`/estudiante/resolver/${sid}`);
  };

  return (
    <SalaDeEspera
      sessionId={sid}
      idEstudiante={auth.idUsuario || auth.carne}
      onStart={onStart}
    />
  );
};

// Sala de espera docente
const DocenteWaitroomRoute = () => {
  const { sessionId } = useParams();
  const auth = getAuth();
  const loc = useLocation();

  const pass = isTeacher(auth);
  log("DocenteWaitroomRoute mount", { path: loc.pathname, sessionId, pass });

  if (!pass) return <Navigate to="/" replace />;

  const sid = Number(sessionId);
  return <SalaDeEsperaDocente sessionId={sid} idDocente={auth.idUsuario} />;
};

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

        {/* Sala de espera del docente (sesión específica) */}
        <Route path="/docente/sala/:sessionId" element={<DocenteWaitroomRoute />} />

        {/* ESTUDIANTE (bajo /estudiante) */}
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
        <Route path="/estudiante/sala/:sessionId" element={<StudentWaitroomRoute />} />

        {/* 👉 Ruta para resolver evaluación directamente */}
        <Route
          path="/estudiante/resolver/:sessionId"
          element={
            <EstudianteGuard>
              <ResolverEvaluacion />
            </EstudianteGuard>
          }
        />

        <Route
          path="/estudiante/practicas"
          element={
            <EstudianteGuard>
              <PracticasRecomendadas />
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

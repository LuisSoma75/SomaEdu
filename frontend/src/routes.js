// src/routes.js
import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useParams,
  useNavigate,
  Navigate,
  useLocation, // 👈 para loguear la ruta actual
} from "react-router-dom";

// Toggle global de logs
const DBG = true;
const mask = (t) => (t ? String(t).slice(0, 6) + "…" : null);
const log = (...args) => { if (DBG) console.log("[ROUTES]", ...args); };
const warn = (...args) => { if (DBG) console.warn("[ROUTES]", ...args); };

// ✅ Login vive en /pages/auth
import Login from "./pages/auth/Login.jsx";

// Estudiante
import EstudianteDashboard from "./pages/estudiante/EstudianteDashboard.jsx";
import EvaluacionesDisponibles from "./pages/estudiante/EvaluacionesDisponibles.jsx";
import SalaDeEspera from "./pages/estudiante/SalaDeEspera.jsx";
import ResolverEvaluacion from "./pages/estudiante/ResolverEvaluacion.jsx";

// Docente
import SalaDeEsperaDocente from "./pages/docente/SalaDeEsperaDocente.jsx";
import Monitoreo from "./pages/docente/MonitoreoEvaluacion.jsx";

/* ============ Auth helper (normaliza localStorage) ============ */
const getAuth = () => {
  try {
    const raw = localStorage.getItem("auth") || "{}";
    log("getAuth: raw localStorage.auth =", raw);

    const p = JSON.parse(raw);

    // Normaliza id de usuario (toma el primero que exista)
    const idUsuario =
      p.idUsuario ??
      p.id_usuario ??
      p.userId ??
      p.usuario_id ??
      p.id ??
      null;

    // Carne/carnet del estudiante (si existiera)
    const carne =
      p.carne_estudiante ??
      p.carne ??
      p.carnet ??
      null;

    // Normaliza rol (si viene). No es obligatorio para estudiante.
    const roleRaw =
      p.role ?? p.rol ?? p.id_rol ?? p.role_id ?? p.tipo ?? p.tipo_usuario ?? null;
    const roleStr = (roleRaw == null ? "" : String(roleRaw)).toLowerCase();
    let role = null;
    if (roleStr === "3" || roleStr === "estudiante" || roleStr === "student") role = 3;
    else if (roleStr === "2" || roleStr === "docente" || roleStr === "teacher") role = 2;
    else if (!Number.isNaN(Number(roleStr)) && roleStr !== "") role = Number(roleStr);

    const token = p.token ?? p.access_token ?? p.jwt ?? null;

    const auth = { idUsuario, carne, role, token: mask(token) };
    log("getAuth: normalizado =", auth);
    return { idUsuario, carne, role, token };
  } catch (e) {
    warn("getAuth: error parseando auth:", e);
    return { idUsuario: null, carne: null, role: null, token: null };
  }
};

/* ============ Guards por rol (tolerantes) ============ */
// Acepta estudiante si tiene identidad (idUsuario o carne).
const isStudent = (auth) => !!(auth?.idUsuario || auth?.carne);

// Docente sí requiere rol 2 e idUsuario.
const isTeacher = (auth) => !!auth?.idUsuario && auth?.role === 2;

const DocenteGuard = ({ children }) => {
  const auth = getAuth();
  const loc = useLocation();
  const pass = isTeacher(auth);
  log("DocenteGuard:", { path: loc.pathname, pass, auth: { ...auth, token: mask(auth.token) } });
  return pass ? children : <Navigate to="/" replace />;
};

const EstudianteGuard = ({ children }) => {
  const auth = getAuth();
  const loc = useLocation();
  const pass = isStudent(auth);
  log("EstudianteGuard:", { path: loc.pathname, pass, auth: { ...auth, token: mask(auth.token) } });
  return pass ? children : <Navigate to="/" replace />;
};

/* ============ Wrappers específicos ============ */
// Sala de espera (Estudiante)
const StudentWaitroomRoute = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const auth = getAuth();
  const loc = useLocation();

  const pass = isStudent(auth);
  log("StudentWaitroomRoute mount:", {
    path: loc.pathname,
    sessionId,
    pass,
    auth: { ...auth, token: mask(auth.token) },
  });

  if (!pass) {
    warn("StudentWaitroomRoute: NO PASS -> redirect Login");
    return <Navigate to="/" replace />;
  }

  const sid = Number(sessionId);
  const onStart = () => {
    log("StudentWaitroomRoute.onStart -> navigate resolver", { sid });
    navigate(`/estudiante/resolver/${sid}`);
  };

  return (
    <SalaDeEspera
      sessionId={sid}
      idEstudiante={auth.idUsuario || auth.carne /* tolerante */}
      onStart={onStart}
    />
  );
};

// Sala de espera (Docente)
const DocenteWaitroomRoute = () => {
  const { sessionId } = useParams();
  const auth = getAuth();
  const loc = useLocation();

  const pass = isTeacher(auth);
  log("DocenteWaitroomRoute mount:", {
    path: loc.pathname,
    sessionId,
    pass,
    auth: { ...auth, token: mask(auth.token) },
  });

  if (!pass) {
    warn("DocenteWaitroomRoute: NO PASS -> redirect Login");
    return <Navigate to="/" replace />;
  }

  const sid = Number(sessionId);
  return <SalaDeEsperaDocente sessionId={sid} idDocente={auth.idUsuario} />;
};

/* ============ Router principal ============ */
const AppRoutes = () => (
  <BrowserRouter>
    <Routes>
      {/* Login */}
      <Route path="/" element={<Login />} />

      {/* Estudiante */}
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
      <Route
        path="/estudiante/resolver/:sessionId"
        element={
          <EstudianteGuard>
            <ResolverEvaluacion />
          </EstudianteGuard>
        }
      />

      {/* Docente */}
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

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);

export default AppRoutes;

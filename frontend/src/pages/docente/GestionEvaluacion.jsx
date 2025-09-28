// frontend/src/pages/docente/GestionEvaluacion.jsx
import React, { useEffect, useMemo, useState } from "react";
import "./GestionEvaluacion.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function GestionEvaluacion() {
  // ===== Tabla / datos =====
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // ===== Filtros UI =====
  const [filtros, setFiltros] = useState({
    q: "",
    id_materia: "",
    id_grado: "",
    estado: "", // programada | abierta | cerrada
    desde: "",
    hasta: "",
  });

  // ===== Catálogos (selects) =====
  const [materias, setMaterias] = useState([]);
  const [grados, setGrados] = useState([]);
  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);

  // ===== Clases del docente (para crear) =====
  const [clases, setClases] = useState([]);

  // ===== Modales =====
  const [showForm, setShowForm] = useState(false);
  const [showAsignar, setShowAsignar] = useState(false);

  // ===== Datos de sesión =====
  const id_usuario = localStorage.getItem("id_usuario");
  const dpiDoc = localStorage.getItem("dpi") || localStorage.getItem("docente_dpi");

  // ------------------------------------------------------------
  // Catálogos
  // ------------------------------------------------------------
  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const [rm, rg] = await Promise.all([
          fetch(`${API}/api/materias`),
          fetch(`${API}/api/grados`),
        ]);
        const jm = await rm.json();
        const jg = await rg.json();
        setMaterias(Array.isArray(jm) ? jm : []);
        setGrados(Array.isArray(jg) ? jg : []);
      } catch {
        // opcional: mostrar error
      } finally {
        setCargandoCatalogos(false);
      }
    };
    cargarCatalogos();
  }, []);

  // ------------------------------------------------------------
  // Clases del docente
  // ------------------------------------------------------------
  useEffect(() => {
    const cargarClases = async () => {
      try {
        if (!id_usuario) return;
        const r = await fetch(`${API}/api/docente/clases/${id_usuario}`);
        const j = await r.json();
        setClases(Array.isArray(j) ? j : []);
      } catch {
        setClases([]);
      }
    };
    cargarClases();
  }, [id_usuario]);

  // ------------------------------------------------------------
  // Evaluaciones (sesiones) desde backend
  // ------------------------------------------------------------
  const fetchEvaluaciones = async () => {
    setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (dpiDoc) params.set("creado_por_dpi", dpiDoc);
      if (filtros.id_materia) params.set("id_materia", filtros.id_materia);
      if (filtros.id_grado) params.set("id_grado", filtros.id_grado);
      if (filtros.estado) params.set("estado", filtros.estado);
      if (filtros.desde) params.set("desde", filtros.desde);
      if (filtros.hasta) params.set("hasta", filtros.hasta);

      const r = await fetch(`${API}/api/docente/evaluaciones?${params.toString()}`);
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error("fetch_fail");

      setEvaluaciones(j.items || []);
    } catch (e) {
      console.error(e);
      setError("No se pudieron cargar las evaluaciones.");
      setEvaluaciones([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    fetchEvaluaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.id_materia, filtros.id_grado, filtros.estado, filtros.desde, filtros.hasta]);

  // ------------------------------------------------------------
  // Búsqueda local por texto
  // ------------------------------------------------------------
  const itemsFiltrados = useMemo(() => {
    const q = filtros.q.trim().toLowerCase();
    if (!q) return evaluaciones;
    return evaluaciones.filter((ev) =>
      (ev.nombre || "").toLowerCase().includes(q) ||
      (ev.materia_nombre || "").toLowerCase().includes(q) ||
      (ev.grado_nombre || "").toLowerCase().includes(q)
    );
  }, [evaluaciones, filtros.q]);

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  const nombreMateria = (id) =>
    materias.find((m) => Number(m.id_materia) === Number(id))?.Nombre || "";
  const nombreGrado = (id) =>
    grados.find((g) => Number(g.id_grado) === Number(id))?.Nombre || "";

  const renderConfig = (ev) => {
    if (ev.modalidad === "num_preguntas") return `${ev.num_preguntas ?? "-"} preg.`;
    if (ev.modalidad === "tiempo") return `${ev.minutos ?? "-"} min`;
    return "Hasta detener";
  };

  const badgeEstado = (estado) => (estado === "abierta" ? "activa" : "inactiva");

  // ------------------------------------------------------------
  // Modal: Crear Evaluación (Sesión)
  // ------------------------------------------------------------
  const FormularioEvaluacion = () => {
    const [form, setForm] = useState({
      nombre: "",
      id_clase: "",
      modalidad: "num_preguntas", // num_preguntas | tiempo | hasta_detener
      numPreguntas: 10,
      minutos: 30,
      modoAdaptativo: true,
    });

    const onChange = (e) => {
      const { name, value, type, checked } = e.target;
      setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
    };

    const onSubmit = async (e) => {
      e.preventDefault();
      try {
        const body = {
          nombre: form.nombre,
          id_clase: Number(form.id_clase),
          // Mandamos ambos; el backend resuelve DPI si hace falta:
          creado_por_dpi: dpiDoc || null,
          id_usuario: id_usuario || null,

          modalidad: form.modalidad,
          num_preg_max: form.modalidad === "num_preguntas" ? Number(form.numPreguntas) : null,
          minutos: form.modalidad === "tiempo" ? Number(form.minutos) : null,
          modo_adaptativo: !!form.modoAdaptativo,
        };

        const r = await fetch(`${API}/api/sesiones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok || j.ok === false) throw new Error(j.msg || "create_fail");

        setShowForm(false);
        await fetchEvaluaciones();
      } catch (err) {
        console.error(err);
        alert("Error al crear la evaluación. Revisa los datos (clase/DPI) e intenta de nuevo.");
      }
    };

    return (
      <div className="modal-bg">
        <div className="modal-form">
          <h2>Crear nueva evaluación</h2>

          <form onSubmit={onSubmit}>
            <label>
              Nombre / Etiqueta:
              <input
                name="nombre"
                value={form.nombre}
                onChange={onChange}
                placeholder="Ej. Diagnóstico 2º Básico"
                required
              />
            </label>

            <label>
              Clase:
              <select name="id_clase" value={form.id_clase} onChange={onChange} required>
                <option value="">Selecciona</option>
                {clases.map((c) => (
                  <option key={c.id_clase} value={c.id_clase}>
                    {c.materia} • {c.grado} ({c.estudiantes || 0} est.)
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="fieldset-modalidad">
              <legend>Configuración</legend>

              <label className="inline">
                <input
                  type="radio"
                  name="modalidad"
                  value="num_preguntas"
                  checked={form.modalidad === "num_preguntas"}
                  onChange={onChange}
                />
                Número de preguntas
              </label>
              {form.modalidad === "num_preguntas" && (
                <label className="inline ml8">
                  Cantidad:
                  <input
                    type="number"
                    name="numPreguntas"
                    min="1"
                    max="100"
                    value={form.numPreguntas}
                    onChange={onChange}
                    required
                    style={{ marginLeft: 8 }}
                  />
                </label>
              )}

              <label className="inline mt8">
                <input
                  type="radio"
                  name="modalidad"
                  value="tiempo"
                  checked={form.modalidad === "tiempo"}
                  onChange={onChange}
                />
                Tiempo de evaluación
              </label>
              {form.modalidad === "tiempo" && (
                <label className="inline ml8">
                  Minutos:
                  <input
                    type="number"
                    name="minutos"
                    min="1"
                    max="300"
                    value={form.minutos}
                    onChange={onChange}
                    required
                    style={{ marginLeft: 8 }}
                  />
                </label>
              )}

              <label className="inline mt8">
                <input
                  type="radio"
                  name="modalidad"
                  value="hasta_detener"
                  checked={form.modalidad === "hasta_detener"}
                  onChange={onChange}
                />
                Hasta que el maestro la detenga
              </label>

              <label className="inline mt12">
                <input
                  type="checkbox"
                  name="modoAdaptativo"
                  checked={form.modoAdaptativo}
                  onChange={onChange}
                />
                Modo adaptativo
              </label>
            </fieldset>

            <div className="modal-actions">
              <button type="submit" className="btn-principal">Guardar</button>
              <button type="button" onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const ModalAsignar = () => (
    <div className="modal-bg">
      <div className="modal-form">
        <h2>Asignar Evaluación</h2>
        <p>Próximamente: selector de grupos/estudiantes.</p>
        <div className="modal-actions">
          <button onClick={() => setShowAsignar(false)}>Cerrar</button>
        </div>
      </div>
    </div>
  );

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  return (
    <div className="gestion-evaluacion-container">
      <div className="panel-header">
        <h1>Gestión de Evaluaciones</h1>
        <button className="btn-principal" onClick={() => setShowForm(true)}>
          + Crear nueva evaluación
        </button>
      </div>

      {/* Filtros */}
      <div className="filtros-evaluaciones">
        <input
          type="text"
          placeholder="Buscar por nombre/etiqueta"
          value={filtros.q}
          onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
        />
        <select
          value={filtros.id_materia}
          onChange={(e) => setFiltros({ ...filtros, id_materia: e.target.value })}
        >
          <option value="">Materia</option>
          {materias.map((m) => (
            <option key={m.id_materia} value={String(m.id_materia)}>
              {m.Nombre}
            </option>
          ))}
        </select>
        <select
          value={filtros.id_grado}
          onChange={(e) => setFiltros({ ...filtros, id_grado: e.target.value })}
        >
          <option value="">Grado</option>
          {grados.map((g) => (
            <option key={g.id_grado} value={String(g.id_grado)}>
              {g.Nombre}
            </option>
          ))}
        </select>
        <select
          value={filtros.estado}
          onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}
        >
          <option value="">Estado</option>
          <option value="programada">Programada</option>
          <option value="abierta">Abierta</option>
          <option value="cerrada">Cerrada</option>
        </select>
        <input
          type="date"
          value={filtros.desde}
          onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
        />
        <input
          type="date"
          value={filtros.hasta}
          onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
        />
      </div>

      {/* Tabla */}
      <div className="tabla-evaluaciones-wrapper">
        {cargando ? (
          <div style={{ padding: 12 }}>Cargando…</div>
        ) : error ? (
          <div style={{ padding: 12, color: "#e95b5b" }}>{error}</div>
        ) : itemsFiltrados.length === 0 ? (
          <div style={{ padding: 12, color: "#8aa3c1" }}>
            No hay evaluaciones para los filtros seleccionados.
          </div>
        ) : (
          <table className="tabla-evaluaciones">
            <thead>
              <tr>
                <th>Nombre/Etiqueta</th>
                <th>Grado</th>
                <th>Materia</th>
                <th>Configuración</th>
                <th>Fecha de creación</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {itemsFiltrados.map((ev) => (
                <tr key={ev.id}>
                  <td>{ev.nombre}</td>
                  <td>{ev.grado_nombre || nombreGrado(ev.id_grado)}</td>
                  <td>{ev.materia_nombre || nombreMateria(ev.id_materia)}</td>
                  <td>{renderConfig(ev)}</td>
                  <td>{ev.fecha || "—"}</td>
                  <td>
                    <span className={`badge ${badgeEstado(ev.estado)}`}>
                      {ev.estado}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => alert("Editar próximamente")}>Editar</button>
                    <button onClick={() => setShowAsignar(true)}>Asignar</button>
                    <button onClick={() => alert("Eliminar próximamente")}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && <FormularioEvaluacion />}
      {showAsignar && <ModalAsignar />}
    </div>
  );
}

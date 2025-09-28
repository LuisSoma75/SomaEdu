import React, { useEffect, useState, useMemo } from "react";
import "./HistorialEvaluacion.css";

export default function HistorialEvaluacion() {
  const [clases, setClases] = useState([]);
  const [materias, setMaterias] = useState([]);
  const [claseSeleccionada, setClaseSeleccionada] = useState("");
  const [detalleSeleccionado, setDetalleSeleccionado] = useState(null);
  const [loading, setLoading] = useState(true);

  // Carga clases y materias al iniciar
  useEffect(() => {
    const fetchDatos = async () => {
      setLoading(true);
      try {
        const api = import.meta.env.VITE_API_URL || "http://localhost:3001";
        // Carga clases
        const resClases = await fetch(`${api}/api/clases`);
        const dataClases = await resClases.json();
        const arrClases = Array.isArray(dataClases) ? dataClases : [];
        setClases(arrClases);
        if (arrClases.length > 0) setClaseSeleccionada(arrClases[0].id_clase);

        // Carga materias
        const resMaterias = await fetch(`${api}/api/materias`);
        const dataMaterias = await resMaterias.json();
        setMaterias(Array.isArray(dataMaterias) ? dataMaterias : []);
      } catch (_e) {
        // opcional: mostrar toast/error
      } finally {
        setLoading(false);
      }
    };
    fetchDatos();
  }, []);

  const clase = useMemo(
    () => clases.find((c) => String(c.id_clase) === String(claseSeleccionada)),
    [clases, claseSeleccionada]
  );

  const materia = useMemo(() => {
    return clase ? materias.find((m) => Number(m.id_materia) === Number(clase.id_materia)) : null;
  }, [clase, materias]);

  // Simulación: una evaluación por clase (ajusta cuando tengas el modelo real)
  const historialFiltrado = useMemo(() => {
    if (!clase) return [];
    return [
      {
        id: clase.id_clase,
        fecha: "2025-08-01",
        materia: materia ? materia.Nombre : "Materia desconocida",
        promedioClase: clase.promedio,
        estado: "completada",
      },
    ];
  }, [clase, materia]);

  const handleVerDetalle = () => setDetalleSeleccionado(clase);
  const handleCerrarDetalle = () => setDetalleSeleccionado(null);

  // Sin clases
  if (!loading && !clases.length) {
    return (
      <section className="he">
        <header className="he-header">
          <h1 className="he-title">Historial de evaluaciones por clase</h1>
        </header>
        <div className="card">
          <p className="muted">No hay clases registradas en la base de datos.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="he">
      <header className="he-header">
        <h1 className="he-title">Historial de evaluaciones por clase</h1>
        <div className="he-filters card">
          <label className="he-field">
            <span>Clase</span>
            <select
              value={claseSeleccionada}
              onChange={(e) => setClaseSeleccionada(e.target.value)}
              disabled={loading || !clases.length}
            >
              {clases.map((c) => (
                <option key={c.id_clase} value={c.id_clase}>
                  {c.clase_nombre || c.Nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="card">
        <table className="table he-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Materia</th>
              <th>Promedio clase</th>
              <th>Estado</th>
              <th className="t-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center" }}>
                  <span className="muted">Cargando…</span>
                </td>
              </tr>
            ) : historialFiltrado.length ? (
              historialFiltrado.map((ev) => (
                <tr key={ev.id}>
                  <td>{ev.fecha}</td>
                  <td>{ev.materia}</td>
                  <td>
                    <span className="badge avg">{ev.promedioClase ?? "—"}</span>
                  </td>
                  <td>
                    <span className={`pill done`}>Completada</span>
                  </td>
                  <td className="t-right">
                    <button className="btn sm" onClick={handleVerDetalle}>
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ textAlign: "center" }}>
                  <span className="muted">No hay evaluaciones encontradas para esta clase.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de detalle */}
      {detalleSeleccionado && (
        <ModalDetalle clase={detalleSeleccionado} materia={materia} onClose={handleCerrarDetalle} />
      )}
    </section>
  );
}

// Modal de detalle (mismo look que las otras pantallas adaptadas)
function ModalDetalle({ clase, materia, onClose }) {
  return (
    <div className="he-modal-overlay" role="dialog" aria-modal="true">
      <div className="he-modal card">
        <h2 className="card-title">Detalle de clase</h2>
        <table className="table he-detail">
          <tbody>
            <tr>
              <th>Clase</th>
              <td>{clase.clase_nombre || clase.Nombre}</td>
            </tr>
            <tr>
              <th>Materia</th>
              <td>{materia ? materia.Nombre : "Materia desconocida"}</td>
            </tr>
            <tr>
              <th>Promedio</th>
              <td>{clase.promedio ?? "—"}</td>
            </tr>
          </tbody>
        </table>
        <div className="he-actions">
          <button className="btn primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

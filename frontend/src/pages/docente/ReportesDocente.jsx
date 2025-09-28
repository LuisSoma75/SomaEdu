import React, { useMemo, useState } from "react";
import { Bar, Radar, Pie } from "react-chartjs-2";
import "chart.js/auto";
import "./ReportesDocente.css";

// Catálogos demo
const grados = [
  { id: 1, nombre: "2º Básico" },
  { id: 2, nombre: "3º Básico" },
];
const materias = [
  { id: 1, nombre: "Matemática" },
  { id: 2, nombre: "Ciencias" },
];
const grupos = [
  { id: 1, nombre: "2A" },
  { id: 2, nombre: "2B" },
];
const areas = [
  { id: 1, nombre: "Geometría" },
  { id: 2, nombre: "Álgebra" },
];

// Simulación de datos analíticos
const datosReportes = [
  {
    grado: "2º Básico",
    grupo: "2A",
    materia: "Matemática",
    area: "Geometría",
    promedio: 62,
    estandar: "GE-01",
    fecha: "2025-06-15",
  },
  {
    grado: "2º Básico",
    grupo: "2A",
    materia: "Matemática",
    area: "Álgebra",
    promedio: 85,
    estandar: "AL-01",
    fecha: "2025-06-15",
  },
  {
    grado: "2º Básico",
    grupo: "2B",
    materia: "Ciencias",
    area: "Biología",
    promedio: 72,
    estandar: "BI-01",
    fecha: "2025-06-15",
  },
  {
    grado: "3º Básico",
    grupo: "3A",
    materia: "Matemática",
    area: "Geometría",
    promedio: 77,
    estandar: "GE-01",
    fecha: "2025-06-16",
  },
];

export default function Reportes() {
  // Filtros seleccionados
  const [filtros, setFiltros] = useState({
    grado: [],
    grupo: [],
    materia: [],
    area: [],
    fechaInicio: "",
    fechaFin: "",
    estandar: "",
  });

  // ---- Datos de ejemplo para gráficas (puedes calcularlos a partir de la tabla si gustas)
  const labelsBar = ["2º Básico - Matemática", "2º Básico - Ciencias", "3º Básico - Matemática"];
  const promediosBar = [62, 72, 77];

  const dataBarra = {
    labels: labelsBar,
    datasets: [
      {
        label: "Promedio",
        data: promediosBar,
        backgroundColor: "rgba(59,130,246,0.7)",
        borderRadius: 8,
      },
    ],
  };

  const chartBaseOptions = useMemo(
    () => ({
      responsive: true,
      plugins: {
        legend: { labels: { color: "#e5e7eb" } },
        title: { color: "#e5e7eb" },
      },
      scales: {
        x: {
          ticks: { color: "#cbd5e1" },
          grid: { color: "rgba(148,163,184,0.2)" },
        },
        y: {
          ticks: { color: "#cbd5e1" },
          grid: { color: "rgba(148,163,184,0.2)" },
        },
      },
    }),
    []
  );

  // Radar
  const areasRadar = ["Geometría", "Álgebra", "Biología"];
  const debilesRadar = [62, 85, 72];
  const dataRadar = {
    labels: areasRadar,
    datasets: [
      {
        label: "Promedio de aciertos (%)",
        data: debilesRadar,
        backgroundColor: "rgba(244,63,94,0.25)",
        borderColor: "rgba(244,63,94,0.9)",
        pointBackgroundColor: "rgba(244,63,94,1)",
      },
    ],
  };
  const radarOptions = useMemo(
    () => ({
      responsive: true,
      plugins: { legend: { labels: { color: "#e5e7eb" } } },
      scales: {
        r: {
          grid: { color: "rgba(148,163,184,0.2)" },
          angleLines: { color: "rgba(148,163,184,0.2)" },
          pointLabels: { color: "#cbd5e1" },
          ticks: { color: "#cbd5e1", backdropColor: "transparent", showLabelBackdrop: false },
          suggestedMin: 0,
          suggestedMax: 100,
        },
      },
    }),
    []
  );

  // Pie
  const dataPie = {
    labels: ["Aprobados", "Bajo desempeño"],
    datasets: [
      {
        data: [65, 35],
        backgroundColor: ["rgba(34,197,94,0.85)", "rgba(239,68,68,0.85)"],
      },
    ],
  };
  const pieOptions = useMemo(
    () => ({
      plugins: { legend: { labels: { color: "#e5e7eb" } } },
      responsive: true,
    }),
    []
  );

  // ---- Tabla resumen filtrada
  const tablaFiltrada = datosReportes.filter(
    (d) =>
      (!filtros.grado.length || filtros.grado.includes(d.grado)) &&
      (!filtros.grupo.length || filtros.grupo.includes(d.grupo)) &&
      (!filtros.materia.length || filtros.materia.includes(d.materia)) &&
      (!filtros.area.length || filtros.area.includes(d.area)) &&
      (!filtros.estandar || d.estandar === filtros.estandar) &&
      (!filtros.fechaInicio || d.fecha >= filtros.fechaInicio) &&
      (!filtros.fechaFin || d.fecha <= filtros.fechaFin)
  );

  // ---- Exportación CSV
  const exportarCSV = () => {
    const encabezados = ["Grado", "Grupo", "Materia", "Área", "Estándar", "Promedio", "Fecha"];
    const filas = tablaFiltrada.map((d) => [
      d.grado,
      d.grupo,
      d.materia,
      d.area,
      d.estandar,
      d.promedio,
      d.fecha,
    ]);
    const csv = [encabezados, ...filas].map((f) => f.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reporte.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Recomendaciones demo
  const recomendaciones = [
    "El 40% de los estudiantes de 2º Básico falla en geometría.",
    "Los grupos 2A y 2B necesitan refuerzo en razonamiento lógico.",
    "Álgebra supera el 80% de aciertos, pero geometría sigue siendo área crítica.",
  ];

  return (
    <section className="rpt">
      <header className="rpt-header">
        <h1 className="rpt-title">Reportes analíticos</h1>
      </header>

      {/* FILTROS */}
      <div className="card rpt-filters">
        <Field label="Grado">
          <select
            multiple
            value={filtros.grado}
            onChange={(e) =>
              setFiltros({ ...filtros, grado: Array.from(e.target.selectedOptions, (o) => o.value) })
            }
          >
            {grados.map((g) => (
              <option key={g.id} value={g.nombre}>
                {g.nombre}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Grupo">
          <select
            multiple
            value={filtros.grupo}
            onChange={(e) =>
              setFiltros({ ...filtros, grupo: Array.from(e.target.selectedOptions, (o) => o.value) })
            }
          >
            {grupos.map((g) => (
              <option key={g.id} value={g.nombre}>
                {g.nombre}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Materia">
          <select
            multiple
            value={filtros.materia}
            onChange={(e) =>
              setFiltros({
                ...filtros,
                materia: Array.from(e.target.selectedOptions, (o) => o.value),
              })
            }
          >
            {materias.map((m) => (
              <option key={m.id} value={m.nombre}>
                {m.nombre}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Área">
          <select
            multiple
            value={filtros.area}
            onChange={(e) =>
              setFiltros({ ...filtros, area: Array.from(e.target.selectedOptions, (o) => o.value) })
            }
          >
            {areas.map((a) => (
              <option key={a.id} value={a.nombre}>
                {a.nombre}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Estándar">
          <input
            type="text"
            value={filtros.estandar}
            onChange={(e) => setFiltros({ ...filtros, estandar: e.target.value })}
            placeholder="(opcional)"
          />
        </Field>

        <Field label="Período" wide>
          <div className="rpt-range">
            <input
              type="date"
              value={filtros.fechaInicio}
              onChange={(e) => setFiltros({ ...filtros, fechaInicio: e.target.value })}
            />
            <span className="sep">a</span>
            <input
              type="date"
              value={filtros.fechaFin}
              onChange={(e) => setFiltros({ ...filtros, fechaFin: e.target.value })}
            />
          </div>
        </Field>
      </div>

      {/* GRÁFICAS */}
      <section className="rpt-grid">
        <article className="card chart-card">
          <h4 className="card-title">Comparación de promedios</h4>
          <Bar data={dataBarra} options={chartBaseOptions} />
        </article>

        <article className="card chart-card">
          <h4 className="card-title">Áreas/estándares (Radar)</h4>
          <Radar data={dataRadar} options={radarOptions} />
        </article>

        <article className="card chart-card">
          <h4 className="card-title">Distribución de desempeño</h4>
          <Pie data={dataPie} options={pieOptions} />
        </article>
      </section>

      {/* TABLA RESUMEN */}
      <div className="card">
        <div className="rpt-table-actions">
          <button className="btn" onClick={exportarCSV}>
            Exportar CSV
          </button>
        </div>
        <table className="table rpt-table">
          <thead>
            <tr>
              <th>Grado</th>
              <th>Grupo</th>
              <th>Materia</th>
              <th>Área</th>
              <th>Estándar</th>
              <th>Promedio</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {tablaFiltrada.length ? (
              tablaFiltrada.map((d, i) => (
                <tr key={i}>
                  <td>{d.grado}</td>
                  <td>{d.grupo}</td>
                  <td>{d.materia}</td>
                  <td>{d.area}</td>
                  <td>
                    <span className="pill code">{d.estandar}</span>
                  </td>
                  <td>
                    <span className={`pill ${d.promedio >= 70 ? "ok" : "low"}`}>{d.promedio}</span>
                  </td>
                  <td>{d.fecha}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} style={{ textAlign: "center" }}>
                  <span className="muted">No hay datos para los filtros seleccionados.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* TENDENCIAS */}
      <div className="card rpt-trends">
        <h4 className="card-title">Tendencias y temas críticos</h4>
        <ul className="rpt-list">
          {recomendaciones.map((r, i) => (
            <li key={i}>
              <span className="dot" /> {r}
            </li>
          ))}
        </ul>
        <div className="rpt-actions">
          <button className="btn primary" onClick={() => (window.location.href = "/docente?panel=ia")}>
            Ver recomendaciones IA
          </button>
        </div>
      </div>
    </section>
  );
}

// Campo con etiqueta (para filtros)
function Field({ label, children, wide }) {
  return (
    <label className={`rpt-field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

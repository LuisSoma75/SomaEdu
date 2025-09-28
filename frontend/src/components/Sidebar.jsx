import React from "react";
import { NavLink } from "react-router-dom";
import "./Sidebar.css";

export default function Sidebar() {
  return (
    <aside className="teacher-sidebar">
      <div className="brand">SomaEdu</div>
      <nav className="nav">
        <NavLink to="/docente" end className={({isActive}) => `nav-item ${isActive ? "active" : ""}`}>
          Dashboard
        </NavLink>
        <NavLink to="/docente/evaluaciones" className={({isActive}) => `nav-item ${isActive ? "active" : ""}`}>
          Evaluaciones
        </NavLink>
        <NavLink to="/docente/monitoreo" className={({isActive}) => `nav-item ${isActive ? "active" : ""}`}>
          Monitoreo
        </NavLink>
        <NavLink to="/docente/historial" className={({isActive}) => `nav-item ${isActive ? "active" : ""}`}>
          Historial
        </NavLink>
        <NavLink to="/docente/reportes" className={({isActive}) => `nav-item ${isActive ? "active" : ""}`}>
          Reportes
        </NavLink>
      </nav>
    </aside>
  );
}

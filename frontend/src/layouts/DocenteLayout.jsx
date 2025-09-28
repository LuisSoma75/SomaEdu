import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import "./DocenteLayout.css";
import "../pages/docente/DocenteDashboard.css";

export default function DocenteLayout() {
  let nombre = localStorage.getItem("nombre");
  if (!nombre || nombre === "undefined") nombre = "Docente";
  const docente = { nombre: `Prof. ${nombre}`, avatar: "/avatar-docente.png" };

  const handleLogout = () => {
    localStorage.clear();
    window.location.href = "/";
  };

  return (
    <div className="teacher-page">
      <Sidebar />
      <main className="teacher-main">
        <Header nombre={docente.nombre} avatar={docente.avatar} onLogout={handleLogout} />
        <div className="panel-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

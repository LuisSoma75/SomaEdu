import React from "react";
import { FaBell } from "react-icons/fa";
import "./Header.css";

export default function Header({ nombre, avatar, onLogout }) {
  // Nombre y avatar por defecto si no llegan por props
  const nombreMostrar = nombre || "Prof. Usuario";
  const avatarMostrar = avatar || "/avatar-docente.png";

  return (
    <header className="header">
      <div className="header-user">
        <img src={avatarMostrar} alt="Avatar" className="avatar" />
        <span>{nombreMostrar}</span>
      </div>
      <div className="header-actions">
        <button className="icon-btn" title="Notificaciones"><FaBell /></button>
        <button className="logout-btn" onClick={onLogout}>Cerrar sesión</button>
      </div>
    </header>
  );
}

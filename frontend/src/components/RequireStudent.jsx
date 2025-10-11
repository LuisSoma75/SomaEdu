// src/components/RequireStudent.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";

export default function RequireStudent({ children }) {
  const location = useLocation();
  let auth = {};
  try { auth = JSON.parse(localStorage.getItem("auth") || "{}"); } catch {}
  const rol = String(auth.rol || auth.role || auth.tipo || auth.perfil || "").toLowerCase();
  const isStudent = rol.includes("estud") || rol.includes("alum") || !!auth.carne_estudiante;

  if (!isStudent) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

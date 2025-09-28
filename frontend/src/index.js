import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./assets/global.css"; // O el nombre que desees
import './index.css';
import "tailwindcss/tailwind.css"; // Asegúrate de que Tailwind CSS esté configurado correctamente

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

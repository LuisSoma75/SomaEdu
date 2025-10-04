import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";      // <-- usa App.jsx minimal de arriba
import "./index.css";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

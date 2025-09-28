import React, { useState } from "react";

const LoginForm = () => {
  const [form, setForm] = useState({ usuario: "", password: "" });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Solo visual, no funcional aún
    alert("Login deshabilitado (interfaz de ejemplo)");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input
        type="text"
        name="usuario"
        placeholder="Usuario"
        value={form.usuario}
        onChange={handleChange}
        className="border border-gray-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
        required
      />
      <input
        type="password"
        name="password"
        placeholder="Contraseña"
        value={form.password}
        onChange={handleChange}
        className="border border-gray-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
        required
      />
      <button
        type="submit"
        className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-xl transition"
      >
        Ingresar
      </button>
      <a href="#" className="text-sm text-blue-600 hover:underline text-center">
        ¿Olvidaste tu contraseña?
      </a>
    </form>
  );
};

export default LoginForm;

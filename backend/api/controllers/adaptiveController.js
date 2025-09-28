// Shim ESM que reexporta tu controlador existente (CommonJS o ESM) llamado adaptativeController.js
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Importa tu archivo tal cual lo tienes nombrado:
const controller = require("./adaptativeController.js");

export default controller;

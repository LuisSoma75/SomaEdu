-- =====================================================
-- SCHEMA SQL: Plataforma de Evaluaciones Adaptativas
-- Incluye establecimientos, planes y solvencia de pago
-- =====================================================

-- 1. Roles
CREATE TABLE roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50) NOT NULL
);

-- 2. Establecimientos (instituciones/colegios/academias)
CREATE TABLE establecimientos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    codigo VARCHAR(30) NOT NULL UNIQUE,         -- Código único de establecimiento
    nombre VARCHAR(100) NOT NULL,
    plan VARCHAR(30) NOT NULL,                  -- Ejemplo: 'Básico', 'Premium'
    solvente BOOLEAN DEFAULT TRUE,              -- 1 = al día con pago, 0 = en mora
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Usuarios
CREATE TABLE usuarios (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    rol_id INT NOT NULL,
    establecimiento_id INT NOT NULL,
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rol_id) REFERENCES roles(id),
    FOREIGN KEY (establecimiento_id) REFERENCES establecimientos(id)
);

-- 4. Grados escolares
CREATE TABLE grados (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50) NOT NULL
);

-- 5. Materias
CREATE TABLE materias (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50) NOT NULL
);

-- 6. Áreas
CREATE TABLE areas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50) NOT NULL,
    materia_id INT NOT NULL,
    FOREIGN KEY (materia_id) REFERENCES materias(id)
);

-- 7. Estándares de aprendizaje
CREATE TABLE estandares (
    id INT PRIMARY KEY AUTO_INCREMENT,
    descripcion TEXT NOT NULL,
    area_id INT NOT NULL,
    FOREIGN KEY (area_id) REFERENCES areas(id)
);

-- 8. Dificultades
CREATE TABLE dificultades (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nivel VARCHAR(20) NOT NULL
);

-- 9. Preguntas
CREATE TABLE preguntas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    enunciado TEXT NOT NULL,
    materia_id INT NOT NULL,
    area_id INT NOT NULL,
    estandar_id INT NOT NULL,
    dificultad_id INT NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (materia_id) REFERENCES materias(id),
    FOREIGN KEY (area_id) REFERENCES areas(id),
    FOREIGN KEY (estandar_id) REFERENCES estandares(id),
    FOREIGN KEY (dificultad_id) REFERENCES dificultades(id)
);

-- 10. Opciones de cada pregunta
CREATE TABLE opciones (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pregunta_id INT NOT NULL,
    texto VARCHAR(255) NOT NULL,
    es_correcta BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (pregunta_id) REFERENCES preguntas(id)
);

-- 11. Evaluaciones (prueba realizada por un estudiante)
CREATE TABLE evaluaciones (
    id INT PRIMARY KEY AUTO_INCREMENT,
    estudiante_id INT NOT NULL,
    docente_id INT NOT NULL,
    grado_id INT NOT NULL,
    materia_id INT NOT NULL,
    fecha_inicio DATETIME DEFAULT CURRENT_TIMESTAMP,
    fecha_fin DATETIME,
    nota_final DECIMAL(5,2),
    nivel_estudiante VARCHAR(50),
    FOREIGN KEY (estudiante_id) REFERENCES usuarios(id),
    FOREIGN KEY (docente_id) REFERENCES usuarios(id),
    FOREIGN KEY (grado_id) REFERENCES grados(id),
    FOREIGN KEY (materia_id) REFERENCES materias(id)
);

-- 12. Preguntas presentadas en una evaluación (rastreo adaptativo)
CREATE TABLE evaluacion_preguntas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    evaluacion_id INT NOT NULL,
    pregunta_id INT NOT NULL,
    orden INT,
    FOREIGN KEY (evaluacion_id) REFERENCES evaluaciones(id),
    FOREIGN KEY (pregunta_id) REFERENCES preguntas(id)
);

-- 13. Respuestas del estudiante en la evaluación
CREATE TABLE respuestas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    evaluacion_pregunta_id INT NOT NULL,
    opcion_id INT NOT NULL,
    es_correcta BOOLEAN,
    tiempo_respuesta_segundos INT,
    FOREIGN KEY (evaluacion_pregunta_id) REFERENCES evaluacion_preguntas(id),
    FOREIGN KEY (opcion_id) REFERENCES opciones(id)
);

-- 14. Reporte de desempeño por estándar
CREATE TABLE reporte_estandar (
    id INT PRIMARY KEY AUTO_INCREMENT,
    evaluacion_id INT NOT NULL,
    estandar_id INT NOT NULL,
    preguntas_totales INT NOT NULL,
    correctas INT NOT NULL,
    FOREIGN KEY (evaluacion_id) REFERENCES evaluaciones(id),
    FOREIGN KEY (estandar_id) REFERENCES estandares(id)
);

-- 15. Logs del sistema (auditoría y monitoreo)
CREATE TABLE logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    usuario_id INT,
    accion VARCHAR(255),
    descripcion TEXT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- ===============================
-- Fin del esquema principal
-- ===============================

DELIMITER $$
CREATE PROCEDURE iniciar_evaluacion_adaptativa(
    IN p_estudiante_id INT,
    IN p_docente_id INT,
    IN p_grado_id INT,
    IN p_materia_id INT,
    OUT p_evaluacion_id INT
)
BEGIN
    INSERT INTO evaluaciones (estudiante_id, docente_id, grado_id, materia_id, fecha_inicio)
    VALUES (p_estudiante_id, p_docente_id, p_grado_id, p_materia_id, NOW());
    SET p_evaluacion_id = LAST_INSERT_ID();
END $$
DELIMITER ;

DELIMITER $$
CREATE PROCEDURE asignar_pregunta_adaptativa(
    IN p_evaluacion_id INT,
    IN p_dificultad_id INT,
    IN p_area_id INT,
    OUT p_pregunta_id INT
)
BEGIN
    -- Busca preguntas no usadas en la evaluación, del área y dificultad indicadas
    SELECT p.id INTO p_pregunta_id
    FROM preguntas p
    LEFT JOIN evaluacion_preguntas ep
      ON ep.pregunta_id = p.id AND ep.evaluacion_id = p_evaluacion_id
    WHERE ep.id IS NULL
      AND p.area_id = p_area_id
      AND p.dificultad_id = p_dificultad_id
      AND p.activo = 1
    ORDER BY RAND()
    LIMIT 1;
    
    IF p_pregunta_id IS NOT NULL THEN
        INSERT INTO evaluacion_preguntas (evaluacion_id, pregunta_id, orden)
        VALUES (p_evaluacion_id, p_pregunta_id,
            (SELECT IFNULL(MAX(orden), 0) + 1 FROM evaluacion_preguntas WHERE evaluacion_id = p_evaluacion_id)
        );
    END IF;
END $$
DELIMITER ;

DELIMITER $$
CREATE PROCEDURE registrar_respuesta(
    IN p_evaluacion_pregunta_id INT,
    IN p_opcion_id INT,
    IN p_tiempo_respuesta_segundos INT
)
BEGIN
    DECLARE v_es_correcta BOOLEAN;
    -- Verifica si la opción es correcta
    SELECT es_correcta INTO v_es_correcta FROM opciones WHERE id = p_opcion_id;
    
    INSERT INTO respuestas (evaluacion_pregunta_id, opcion_id, es_correcta, tiempo_respuesta_segundos)
    VALUES (p_evaluacion_pregunta_id, p_opcion_id, v_es_correcta, p_tiempo_respuesta_segundos);
END $$
DELIMITER ;

DELIMITER $$
CREATE PROCEDURE calcular_nota_y_nivel(
    IN p_evaluacion_id INT
)
BEGIN
    DECLARE v_total INT;
    DECLARE v_correctas INT;
    DECLARE v_nota DECIMAL(5,2);
    DECLARE v_nivel VARCHAR(50);

    -- Total de preguntas
    SELECT COUNT(*) INTO v_total
    FROM evaluacion_preguntas
    WHERE evaluacion_id = p_evaluacion_id;

    -- Total de respuestas correctas
    SELECT COUNT(*) INTO v_correctas
    FROM respuestas r
    JOIN evaluacion_preguntas ep ON r.evaluacion_pregunta_id = ep.id
    WHERE ep.evaluacion_id = p_evaluacion_id AND r.es_correcta = 1;

    -- Calcular nota (escala 0-100)
    SET v_nota = IF(v_total > 0, (v_correctas * 100) / v_total, 0);

    -- Determinar nivel (puedes ajustar los rangos según tu criterio)
    IF v_nota >= 90 THEN
        SET v_nivel = 'Avanzado';
    ELSEIF v_nota >= 70 THEN
        SET v_nivel = 'Intermedio';
    ELSE
        SET v_nivel = 'Básico';
    END IF;

    -- Actualiza la evaluación
    UPDATE evaluaciones
    SET nota_final = v_nota,
        nivel_estudiante = v_nivel,
        fecha_fin = NOW()
    WHERE id = p_evaluacion_id;
END $$
DELIMITER ;

DELIMITER $$
CREATE PROCEDURE generar_reporte_estandar(
    IN p_evaluacion_id INT
)
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_estandar_id INT;
    DECLARE cur CURSOR FOR
        SELECT DISTINCT p.estandar_id
        FROM evaluacion_preguntas ep
        JOIN preguntas p ON ep.pregunta_id = p.id
        WHERE ep.evaluacion_id = p_evaluacion_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    
    OPEN cur;
    loop_estandares: LOOP
        FETCH cur INTO v_estandar_id;
        IF done THEN
            LEAVE loop_estandares;
        END IF;
        
        INSERT INTO reporte_estandar (evaluacion_id, estandar_id, preguntas_totales, correctas)
        SELECT
            p_evaluacion_id,
            v_estandar_id,
            COUNT(*),
            SUM(r.es_correcta = 1)
        FROM evaluacion_preguntas ep
        JOIN preguntas p ON ep.pregunta_id = p.id
        LEFT JOIN respuestas r ON r.evaluacion_pregunta_id = ep.id
        WHERE ep.evaluacion_id = p_evaluacion_id AND p.estandar_id = v_estandar_id
        GROUP BY p.estandar_id;
    END LOOP;
    CLOSE cur;
END $$
DELIMITER ;

DELIMITER $$
CREATE TRIGGER tr_log_crear_usuario
AFTER INSERT ON usuarios
FOR EACH ROW
BEGIN
    INSERT INTO logs (usuario_id, accion, descripcion)
    VALUES (NEW.id, 'Creación', CONCAT('Usuario creado: ', NEW.nombre));
END $$
DELIMITER ;

DELIMITER $$
CREATE TRIGGER tr_log_iniciar_evaluacion
AFTER INSERT ON evaluaciones
FOR EACH ROW
BEGIN
    INSERT INTO logs (usuario_id, accion, descripcion)
    VALUES (NEW.docente_id, 'Inicio Evaluación', CONCAT('Evaluación iniciada para estudiante ID ', NEW.estudiante_id, ' en materia ID ', NEW.materia_id));
END $$
DELIMITER ;

DELIMITER $$
CREATE FUNCTION total_correctas(p_evaluacion_id INT)
RETURNS INT
DETERMINISTIC
BEGIN
    DECLARE v_correctas INT;
    SELECT COUNT(*)
    INTO v_correctas
    FROM respuestas r
    JOIN evaluacion_preguntas ep ON r.evaluacion_pregunta_id = ep.id
    WHERE ep.evaluacion_id = p_evaluacion_id AND r.es_correcta = 1;
    RETURN v_correctas;
END $$
DELIMITER ;


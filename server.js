const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer'); // Para subir archivos
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors()); // Permite que el HTML hable con el servidor
app.use(express.json());

// --- CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS (IMPORTANTE) ---
// Esto permite ver el index.html y descargar los archivos subidos
app.use(express.static(__dirname)); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- CONFIGURACIÓN DE CARGA DE ARCHIVOS (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Guarda el archivo con fecha para evitar nombres duplicados
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- CONEXIÓN A BASE DE DATOS ---
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'proyectosBD', 
    password: '1234',   
    port: 5432,
});

// ==========================================
// 1. SISTEMA DE ACCESO (LOGIN Y REGISTRO)
// ==========================================

// LOGIN (Solo verifica credenciales)
app.post('/api/login', async (req, res) => {
    const { ruc, password } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [ruc]);
        
        if (userRes.rows.length === 0) {
            return res.json({ success: false, msg: 'El usuario no existe. Por favor regístrese.' });
        }

        const user = userRes.rows[0];
        if (user.password !== password) {
            return res.json({ success: false, msg: 'Contraseña incorrecta' });
        }

        // Usuario validado. Si es postulante, buscamos su proyecto.
        let project = null;
        if (user.role === 'postulante') {
            const pRes = await pool.query('SELECT * FROM projects WHERE applicant_id = $1', [user.id]);
            project = pRes.rows[0];
        }
        
        res.json({ success: true, user, project });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Error del servidor' });
    }
});

// REGISTRO (Solo crea usuarios nuevos)
app.post('/api/register', async (req, res) => {
    const { ruc, razon, password } = req.body;
    try {
        // Verificar si ya existe
        const checkUser = await pool.query('SELECT * FROM users WHERE username = $1', [ruc]);
        if (checkUser.rows.length > 0) {
            return res.json({ success: false, msg: 'Este RUC ya está registrado.' });
        }

        // Crear Usuario
        const newUser = await pool.query(
            "INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, 'postulante') RETURNING *",
            [ruc, password, razon]
        );
        // Crear Proyecto Vacío asociado al usuario
        const newProj = await pool.query(
            "INSERT INTO projects (applicant_id) VALUES ($1) RETURNING *",
            [newUser.rows[0].id]
        );
        
        res.json({ success: true, user: newUser.rows[0], project: newProj.rows[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Error al registrar' });
    }
});

// ==========================================
// 2. GESTIÓN DE PROYECTOS (POSTULANTES)
// ==========================================

// GUARDAR PASOS Y SUBIR ARCHIVOS
app.post('/api/save-step', upload.any(), async (req, res) => {
    const { projectId, step, formDataJSON } = req.body;
    const files = req.files; 

    try {
        // Obtener datos actuales de la BD para no borrarlos
        const current = await pool.query('SELECT form_data, file_paths FROM projects WHERE id = $1', [projectId]);
        
        // Inicializar objetos si están vacíos
        let dbFormData = current.rows[0].form_data || {};
        let dbFilePaths = current.rows[0].file_paths || {};

        // Mezclar datos de texto nuevos (JSON)
        if (formDataJSON) {
            const incomingData = JSON.parse(formDataJSON);
            dbFormData = { ...dbFormData, ...incomingData };
        }

        // Guardar rutas de archivos nuevos
        if (files && files.length > 0) {
            files.forEach(f => {
                dbFilePaths[f.fieldname] = f.path; // Ej: "contrato": "uploads/123-contrato.pdf"
            });
        }

        // Actualizar BD
        await pool.query(
            'UPDATE projects SET current_step = $1, form_data = $2, file_paths = $3, updated_at = NOW() WHERE id = $4',
            [step, dbFormData, dbFilePaths, projectId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 3. RUTAS DE ADMINISTRADOR (NUEVO)
// ==========================================

// OBTENER TODOS LOS PROYECTOS (Dashboard Admin)
app.get('/api/admin/projects', async (req, res) => {
    try {
        // Hacemos JOIN para traer el nombre de la empresa (full_name) junto con los datos del proyecto
        const result = await pool.query(`
            SELECT p.*, u.full_name as empresa, u.username as ruc 
            FROM projects p 
            JOIN users u ON p.applicant_id = u.id
            ORDER BY p.updated_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error obteniendo proyectos');
    }
});

// ASIGNAR CONSULTOR (Opcional, si quieres implementarlo luego)
app.post('/api/admin/assign', async (req, res) => {
    const { projectId, consultantId } = req.body;
    try {
        await pool.query('UPDATE projects SET consultant_id = $1 WHERE id = $2', [consultantId, projectId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send('Error asignando consultor');
    }
});

// ==========================================
// ARRANCAR SERVIDOR
// ==========================================
app.listen(3000, () => {
    console.log('Servidor conectado a Postgres corriendo en puerto 3000');
});
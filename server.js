// 🚀 WhatsApp-GHL Platform V2 - SERVIDOR PRINCIPAL
// Versión nueva desde cero que FUNCIONA

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const app = express();

// ================================
// CONFIGURACIÓN BÁSICA
// ================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Log todas las requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ================================
// CONFIGURACIÓN EVOLUTION API
// ================================

const EVOLUTION_CONFIG = {
    baseURL: process.env.EVOLUTION_API_URL || 'https://evolutionv2.cloude.es',
    apiKey: process.env.EVOLUTION_API_KEY || 'CwLLVHNynMyfeM7ePCyUgBr6EdOk3eRg'
};

console.log('🔧 Evolution API Config:', EVOLUTION_CONFIG);

// ================================
// BASE DE DATOS FLEXIBLE
// ================================

let db;
let isPostgreSQL = false;

// Intentar conectar a PostgreSQL primero
if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    try {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        // Test the connection
        pool.connect().then(client => {
            console.log('✅ PostgreSQL connected successfully');
            client.release();
            isPostgreSQL = true;
            db = pool;
            
            // Crear tablas PostgreSQL
            initializePostgreSQLTables();
        }).catch(err => {
            console.log('⚠️ PostgreSQL failed, falling back to SQLite:', err.message);
            initializeSQLite();
        });
    } catch (error) {
        console.log('⚠️ PostgreSQL config error, using SQLite:', error.message);
        initializeSQLite();
    }
} else {
    console.log('📝 No PostgreSQL config found, using SQLite');
    initializeSQLite();
}

async function initializePostgreSQLTables() {
    try {
        // Crear tablas PostgreSQL
        await db.query(`CREATE TABLE IF NOT EXISTS clients (
            id SERIAL PRIMARY KEY,
            location_id TEXT UNIQUE,
            company_name TEXT,
            email TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await db.query(`CREATE TABLE IF NOT EXISTS instances (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id),
            location_id TEXT,
            instance_name TEXT UNIQUE,
            instance_number INTEGER,
            status TEXT DEFAULT 'created',
            qr_code TEXT,
            phone_number TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        console.log('✅ PostgreSQL tables initialized');
    } catch (error) {
        console.error('❌ PostgreSQL table creation error:', error);
        console.log('⚠️ Falling back to SQLite');
        initializeSQLite();
    }
}

function initializeSQLite() {
    // Crear directorio database si no existe
    const databaseDir = './database';
    if (!fs.existsSync(databaseDir)) {
        fs.mkdirSync(databaseDir, { recursive: true });
        console.log('📁 Database directory created');
    }

    db = new sqlite3.Database('./database/platform.db');
    isPostgreSQL = false;

    // Crear tablas SQLite
    db.serialize(() => {
        // Tabla de usuarios/clientes
        db.run(`CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location_id TEXT UNIQUE,
            company_name TEXT,
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Tabla de instancias WhatsApp
        db.run(`CREATE TABLE IF NOT EXISTS instances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            location_id TEXT,
            instance_name TEXT UNIQUE,
            instance_number INTEGER,
            status TEXT DEFAULT 'created',
            qr_code TEXT,
            phone_number TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients (id)
        )`);
        
        console.log('✅ SQLite Database initialized');
    });
}

// ================================
// FUNCIONES EVOLUTION API
// ================================

async function createEvolutionInstance(instanceName) {
    try {
        console.log(`🔧 Creating Evolution instance: ${instanceName}`);
        
        const response = await axios.post(
            `${EVOLUTION_CONFIG.baseURL}/instance/create`,
            {
                instanceName: instanceName,
                integration: "WHATSAPP-BAILEYS",
                webhookUrl: `${process.env.APP_URL || 'http://localhost:3000'}/webhook/evolution/${instanceName}`,
                webhookEvents: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': EVOLUTION_CONFIG.apiKey
                }
            }
        );
        
        console.log(`✅ Instance created: ${instanceName}`, response.data);
        return { success: true, data: response.data };
        
    } catch (error) {
        console.error(`❌ Error creating instance ${instanceName}:`, error.response?.data || error.message);
        return { success: false, error: error.message };
    }
}

async function getQRCode(instanceName) {
    try {
        console.log(`📱 Getting QR code for: ${instanceName}`);
        
        // Usar el endpoint correcto con GET (como en la aplicación original)
        const response = await axios.get(
            `${EVOLUTION_CONFIG.baseURL}/instance/connect/${instanceName}`,
            {
                headers: {
                    'apikey': EVOLUTION_CONFIG.apiKey
                }
            }
        );
        
        console.log(`🔗 Connect response for ${instanceName}:`, response.data);
        
        // Verificar si hay QR code en la respuesta
        if (response.data && response.data.code) {
            console.log(`✅ QR code obtained for: ${instanceName}`);
            return { success: true, qrCode: response.data.code };
        } 
        // Si no hay QR en code, buscar en base64
        else if (response.data && response.data.base64) {
            console.log(`✅ QR code (base64) obtained for: ${instanceName}`);
            return { success: true, qrCode: response.data.base64 };
        }
        // Intentar obtener estado de conexión como fallback
        else {
            console.log(`⏳ No immediate QR, trying connectionState...`);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const statusResponse = await axios.get(
                `${EVOLUTION_CONFIG.baseURL}/instance/connectionState/${instanceName}`,
                {
                    headers: {
                        'apikey': EVOLUTION_CONFIG.apiKey
                    }
                }
            );
            
            console.log(`📱 Connection state for ${instanceName}:`, statusResponse.data);
            
            if (statusResponse.data.instance?.qrcode?.base64) {
                console.log(`✅ QR code from connectionState for: ${instanceName}`);
                return { success: true, qrCode: statusResponse.data.instance.qrcode.base64 };
            } else {
                throw new Error('No QR code found in response or connectionState');
            }
        }
        
    } catch (error) {
        console.error(`❌ Error getting QR for ${instanceName}:`, error.response?.data || error.message);
        return { success: false, error: error.message };
    }
}

// ================================
// RUTAS PRINCIPALES
// ================================

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Dashboard del cliente
app.get('/dashboard/:locationId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ================================
// API ENDPOINTS
// ================================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        evolution: EVOLUTION_CONFIG.baseURL
    });
});

// Helper functions for database operations
async function insertClient(locationId, companyName, email) {
    if (isPostgreSQL) {
        const query = 'INSERT INTO clients (location_id, company_name, email) VALUES ($1, $2, $3) ON CONFLICT (location_id) DO UPDATE SET company_name = $2, email = $3 RETURNING id';
        const result = await db.query(query, [locationId, companyName, email]);
        return result.rows[0].id;
    } else {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT OR REPLACE INTO clients (location_id, company_name, email) VALUES (?, ?, ?)',
                [locationId, companyName, email],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }
}

async function insertInstance(clientId, locationId, instanceName, instanceNumber, status) {
    if (isPostgreSQL) {
        const query = 'INSERT INTO instances (client_id, location_id, instance_name, instance_number, status) VALUES ($1, $2, $3, $4, $5)';
        await db.query(query, [clientId, locationId, instanceName, instanceNumber, status]);
    } else {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO instances (client_id, location_id, instance_name, instance_number, status) VALUES (?, ?, ?, ?, ?)',
                [clientId, locationId, instanceName, instanceNumber, status],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}

async function updateInstanceQR(locationId, instanceNumber, qrCode, status) {
    if (isPostgreSQL) {
        await db.query(
            'UPDATE instances SET qr_code = $1, status = $2 WHERE location_id = $3 AND instance_number = $4',
            [qrCode, status, locationId, instanceNumber]
        );
    } else {
        return new Promise((resolve, reject) => {
            db.run(
                'UPDATE instances SET qr_code = ?, status = ? WHERE location_id = ? AND instance_number = ?',
                [qrCode, status, locationId, instanceNumber],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}

async function updateInstanceStatus(instanceName, status) {
    if (isPostgreSQL) {
        await db.query(
            'UPDATE instances SET status = $1 WHERE instance_name = $2',
            [status, instanceName]
        );
    } else {
        return new Promise((resolve, reject) => {
            db.run(
                'UPDATE instances SET status = ? WHERE instance_name = ?',
                [status, instanceName],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}

// Registrar nuevo cliente (desde GHL)
app.post('/api/register', async (req, res) => {
    try {
        const { locationId, companyName, email } = req.body;
        
        console.log(`🆕 Registering new client: ${locationId}`);
        
        // Insertar cliente en DB
        const clientId = await insertClient(locationId, companyName, email);
        console.log(`✅ Client saved with ID: ${clientId}`);
        
        // Crear 5 instancias
        const instances = [];
        for (let i = 1; i <= 5; i++) {
            const instanceName = `${locationId}_wa_${i}`;
            
            // Crear en Evolution API
            const evolutionResult = await createEvolutionInstance(instanceName);
            
            // Guardar en DB
            await insertInstance(clientId, locationId, instanceName, i, 'created');
            
            instances.push({
                name: instanceName,
                number: i,
                evolutionCreated: evolutionResult.success
            });
        }
        
        res.json({
            success: true,
            clientId,
            locationId,
            instances
        });
        
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener instancias de un cliente
app.get('/api/instances/:locationId', async (req, res) => {
    try {
        const { locationId } = req.params;
        
        let instances;
        if (isPostgreSQL) {
            const result = await db.query(
                'SELECT * FROM instances WHERE location_id = $1 ORDER BY instance_number',
                [locationId]
            );
            instances = result.rows;
        } else {
            instances = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT * FROM instances WHERE location_id = ? ORDER BY instance_number',
                    [locationId],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });
        }
        
        res.json({ instances });
        
    } catch (error) {
        console.error('❌ Error getting instances:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generar QR code para una instancia
app.post('/api/instances/:locationId/:number/qr', async (req, res) => {
    try {
        const { locationId, number } = req.params;
        const instanceName = `${locationId}_wa_${number}`;
        
        console.log(`📱 Generating QR for: ${instanceName}`);
        
        const qrResult = await getQRCode(instanceName);
        
        if (qrResult.success) {
            // Actualizar DB
            await updateInstanceQR(locationId, parseInt(number), qrResult.qrCode, 'qr_ready');
            
            res.json({
                success: true,
                instanceName,
                qrCode: qrResult.qrCode
            });
        } else {
            res.status(500).json({
                success: false,
                error: qrResult.error
            });
        }
        
    } catch (error) {
        console.error('❌ QR generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Webhook de Evolution API
app.post('/webhook/evolution/:instanceName', (req, res) => {
    const { instanceName } = req.params;
    const data = req.body;
    
    console.log(`📨 Webhook from ${instanceName}:`, data);
    
    // Procesar webhook según tipo
    if (data.event === 'connection.update') {
        const status = data.data.state;
        
        await updateInstanceStatus(instanceName, status);
        
        console.log(`🔄 Instance ${instanceName} status: ${status}`);
    }
    
    res.json({ received: true });
});

// ================================
// INICIALIZACIÓN
// ================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║     🚀 WhatsApp-GHL Platform V2       ║
║                                        ║
║  Port: ${PORT}                            ║
║  Environment: ${process.env.NODE_ENV || 'development'}       ║
║                                        ║
║  🌐 http://localhost:${PORT}              ║
║  📊 http://localhost:${PORT}/health       ║
╚════════════════════════════════════════╝
    `);
});

module.exports = app;
// 🚀 WhatsApp-GHL Platform V2 - SERVIDOR PRINCIPAL
// Versión nueva desde cero que FUNCIONA

const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
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
// BASE DE DATOS SIMPLE
// ================================

const db = new sqlite3.Database('./database/platform.db');

// Crear tablas si no existen
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
    
    console.log('✅ Database initialized');
});

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

// Registrar nuevo cliente (desde GHL)
app.post('/api/register', async (req, res) => {
    try {
        const { locationId, companyName, email } = req.body;
        
        console.log(`🆕 Registering new client: ${locationId}`);
        
        // Insertar cliente en DB
        db.run(
            'INSERT OR REPLACE INTO clients (location_id, company_name, email) VALUES (?, ?, ?)',
            [locationId, companyName, email],
            async function(err) {
                if (err) {
                    console.error('❌ Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                const clientId = this.lastID;
                console.log(`✅ Client saved with ID: ${clientId}`);
                
                // Crear 5 instancias
                const instances = [];
                for (let i = 1; i <= 5; i++) {
                    const instanceName = `${locationId}_wa_${i}`;
                    
                    // Crear en Evolution API
                    const evolutionResult = await createEvolutionInstance(instanceName);
                    
                    // Guardar en DB
                    db.run(
                        'INSERT INTO instances (client_id, location_id, instance_name, instance_number, status) VALUES (?, ?, ?, ?, ?)',
                        [clientId, locationId, instanceName, i, 'created']
                    );
                    
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
            }
        );
        
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener instancias de un cliente
app.get('/api/instances/:locationId', (req, res) => {
    const { locationId } = req.params;
    
    db.all(
        'SELECT * FROM instances WHERE location_id = ? ORDER BY instance_number',
        [locationId],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ instances: rows });
        }
    );
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
            db.run(
                'UPDATE instances SET qr_code = ?, status = ? WHERE location_id = ? AND instance_number = ?',
                [qrResult.qrCode, 'qr_ready', locationId, parseInt(number)]
            );
            
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
        
        db.run(
            'UPDATE instances SET status = ? WHERE instance_name = ?',
            [status, instanceName]
        );
        
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
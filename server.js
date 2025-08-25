// 🚀 WhatsApp-GHL Platform V2 - SERVIDOR SIMPLE
// Versión optimizada con almacenamiento en memoria

const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');
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
// ALMACENAMIENTO EN MEMORIA
// ================================

let clients = new Map(); // locationId -> client data
let instances = new Map(); // instanceName -> instance data
let clientInstances = new Map(); // locationId -> array of instance names

console.log('✅ In-memory database initialized');

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
                webhookUrl: `${process.env.APP_URL || 'https://nia.cloude.es'}/webhook/evolution/${instanceName}`,
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
        
        const response = await axios.get(
            `${EVOLUTION_CONFIG.baseURL}/instance/connect/${instanceName}`,
            {
                headers: {
                    'apikey': EVOLUTION_CONFIG.apiKey
                }
            }
        );
        
        console.log(`🔗 Connect response for ${instanceName}:`, response.data);
        
        let qrString = null;
        
        if (response.data && response.data.code) {
            console.log(`✅ QR code string obtained for: ${instanceName}`);
            qrString = response.data.code;
        } 
        else if (response.data && response.data.base64) {
            console.log(`✅ QR code (base64) obtained for: ${instanceName}`);
            // Si ya viene como base64, lo devolvemos directo
            return { success: true, qrCode: response.data.base64 };
        }
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
                // Si ya viene como base64, lo devolvemos directo
                return { success: true, qrCode: statusResponse.data.instance.qrcode.base64 };
            } else if (statusResponse.data.instance?.qrcode?.code) {
                qrString = statusResponse.data.instance.qrcode.code;
            } else {
                throw new Error('No QR code found in response or connectionState');
            }
        }
        
        // Si tenemos un string QR, lo convertimos a imagen base64
        if (qrString) {
            console.log(`🎨 Converting QR string to base64 image for: ${instanceName}`);
            try {
                // Generar QR code como Data URL base64
                const qrBase64 = await QRCode.toDataURL(qrString, {
                    width: 300,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });
                
                // Remover el prefijo 'data:image/png;base64,' para devolver solo el base64
                const base64Only = qrBase64.replace(/^data:image\/png;base64,/, '');
                
                console.log(`✅ QR code converted to base64 for: ${instanceName}`);
                return { success: true, qrCode: base64Only };
            } catch (qrError) {
                console.error(`❌ Error converting QR to image:`, qrError);
                // Si falla la conversión, devolvemos el string original
                return { success: true, qrCode: qrString };
            }
        }
        
        throw new Error('No QR code found');
        
    } catch (error) {
        console.error(`❌ Error getting QR for ${instanceName}:`, error.response?.data || error.message);
        return { success: false, error: error.message };
    }
}

// ================================
// FUNCIONES DE ALMACENAMIENTO
// ================================

function saveClient(locationId, companyName, email) {
    const clientData = {
        id: Date.now(),
        location_id: locationId,
        company_name: companyName,
        email: email,
        created_at: new Date().toISOString()
    };
    
    clients.set(locationId, clientData);
    return clientData.id;
}

function saveInstance(clientId, locationId, instanceName, instanceNumber) {
    const instanceData = {
        id: Date.now() + instanceNumber,
        client_id: clientId,
        location_id: locationId,
        instance_name: instanceName,
        instance_number: instanceNumber,
        status: 'created',
        qr_code: null,
        phone_number: null,
        created_at: new Date().toISOString()
    };
    
    instances.set(instanceName, instanceData);
    
    if (!clientInstances.has(locationId)) {
        clientInstances.set(locationId, []);
    }
    clientInstances.get(locationId).push(instanceName);
}

function getInstances(locationId) {
    const instanceNames = clientInstances.get(locationId) || [];
    return instanceNames.map(name => instances.get(name)).filter(Boolean);
}

function updateInstance(instanceName, updates) {
    const instance = instances.get(instanceName);
    if (instance) {
        Object.assign(instance, updates);
        instances.set(instanceName, instance);
    }
}

// ================================
// RUTAS PRINCIPALES
// ================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard/:locationId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ================================
// API ENDPOINTS
// ================================

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        evolution: EVOLUTION_CONFIG.baseURL,
        clients_count: clients.size,
        instances_count: instances.size
    });
});

app.post('/api/register', async (req, res) => {
    try {
        const { locationId, companyName, email } = req.body;
        
        console.log(`🆕 Registering new client: ${locationId}`);
        
        const clientId = saveClient(locationId, companyName, email);
        
        // Crear 5 instancias
        const instancesResult = [];
        for (let i = 1; i <= 5; i++) {
            const instanceName = `${locationId}_wa_${i}`;
            
            const evolutionResult = await createEvolutionInstance(instanceName);
            saveInstance(clientId, locationId, instanceName, i);
            
            instancesResult.push({
                name: instanceName,
                number: i,
                evolutionCreated: evolutionResult.success
            });
        }
        
        res.json({
            success: true,
            clientId,
            locationId,
            instances: instancesResult
        });
        
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/instances/:locationId', (req, res) => {
    try {
        const { locationId } = req.params;
        const instances = getInstances(locationId);
        res.json({ instances });
    } catch (error) {
        console.error('❌ Error getting instances:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/instances/:locationId/:number/qr', async (req, res) => {
    try {
        const { locationId, number } = req.params;
        const instanceName = `${locationId}_wa_${number}`;
        
        console.log(`📱 Generating QR for: ${instanceName}`);
        
        const qrResult = await getQRCode(instanceName);
        
        if (qrResult.success) {
            updateInstance(instanceName, {
                qr_code: qrResult.qrCode,
                status: 'qr_ready'
            });
            
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

app.post('/webhook/evolution/:instanceName', (req, res) => {
    const { instanceName } = req.params;
    const data = req.body;
    
    console.log(`📨 Webhook from ${instanceName}:`, data);
    
    if (data.event === 'connection.update') {
        const status = data.data.state;
        updateInstance(instanceName, { status });
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
║            (Simple Version)            ║
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
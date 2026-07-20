const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { MongoClient } = require('mongodb');

// --- ANTI CRASH ---
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

const app = express();
const port = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Bot Kas RT Berjalan dengan MongoDB & Anti-Duplicate!');
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

const WEB_APP_URL = process.env.WEB_APP_URL;
const MONGODB_URI = process.env.MONGODB_URI; 

const mongoClient = new MongoClient(MONGODB_URI);

// --- ADAPTER MONGODB UNTUK SESI ---
async function useMongoDBAuthState(collection) {
    const writeData = (data, id) => {
        const informationToStore = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        return collection.replaceOne({ _id: id }, informationToStore, { upsert: true });
    };
    
    const readData = async (id) => {
        try {
            const data = await collection.findOne({ _id: id });
            return data ? JSON.parse(JSON.stringify(data), BufferJSON.reviver) : null;
        } catch (error) { return null; }
    };
    
    const removeData = async (id) => { try { await collection.deleteOne({ _id: id }); } catch (error) {} };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async id => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

async function connectToWhatsApp() {
    await mongoClient.connect();
    console.log('Berhasil terhubung ke MongoDB Server!');
    
    const db = mongoClient.db('whatsapp-bot');
    const authCollection = db.collection('auth_info');
    
    const { state, saveCreds } = await useMongoDBAuthState(authCollection);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ['BotKasRT', 'Chrome', '1.0.0'],
        printQRInTerminal: false 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n=========================================');
            console.log('SCAN QR CODE DI BAWAH INI:');
            qrcode.generate(qr, { small: true });
            console.log('=========================================\n');
        }
        if (connection === 'close') {
            if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Berhasil Terhubung!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        // --- FILTER ANTI-DUPLIKAT ---
        if (m.type !== 'notify') return; 
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe === false && !msg.key.remoteJid) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toUpperCase();
        const noWa = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe; 

        if (!text.startsWith('CATAT') && text !== 'CEK SALDO') return;

        if (text === 'CEK SALDO') {
            try {
                const response = await axios.get(`${WEB_APP_URL}?action=ceksaldo`);
                await sock.sendMessage(noWa, { text: response.data });
            } catch (err) { await sock.sendMessage(noWa, { text: 'Gagal ambil data.' }); }
        } 
        else if (text.startsWith('CATAT')) {
            // --- HAK AKSES ADMIN ---
            if (!isFromMe) {
                await sock.sendMessage(noWa, { text: '❌ Hanya Admin yang bisa mencatat.' });
                return;
            }

            const parts = text.split(' ');
            if (parts.length < 4) {
                await sock.sendMessage(noWa, { text: 'Format: CATAT [TIPE] [NOMINAL] [KETERANGAN]' });
                return;
            }
            
            const payload = {
                tanggal: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                tipe: parts[1],
                nominal: parts[2],
                keterangan: parts.slice(3).join(' ')
            };

            try {
                const res = await axios.post(WEB_APP_URL, JSON.stringify(payload));
                await sock.sendMessage(noWa, { text: res.data });
            } catch (err) { await sock.sendMessage(noWa, { text: 'Gagal mencatat data.' }); }
        }
    });
}

connectToWhatsApp();
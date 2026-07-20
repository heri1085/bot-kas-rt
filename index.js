const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const axios = require('axios');
const qrcode = require('qrcode-terminal'); // Menggunakan qrcode-terminal

// --- ANTI CRASH ---
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

const app = express();
const port = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Bot Kas RT Berjalan!');
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

const WEB_APP_URL = process.env.WEB_APP_URL;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ['BotKasRT', 'Chrome', '1.0.0'],
        printQRInTerminal: false // Kita matikan bawaan Baileys, kita render manual di bawah
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // --- MENAMPILKAN QR CODE ---
        if (qr) {
            console.log('\n=========================================');
            console.log('SCAN QR CODE DI BAWAH INI DENGAN WHATSAPP:');
            qrcode.generate(qr, { small: true });
            console.log('=========================================\n');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menyambung kembali...');
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Berhasil Terhubung!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toUpperCase();
        const noWa = msg.key.remoteJid;

        if (text === 'CEK SALDO') {
            try {
                const response = await axios.get(`${WEB_APP_URL}?action=ceksaldo`);
                await sock.sendMessage(noWa, { text: response.data });
            } catch (err) {
                await sock.sendMessage(noWa, { text: 'Gagal mengambil data dari Google Sheets.' });
            }
        } 
        else if (text.startsWith('CATAT')) {
            const parts = text.split(' ');
            if (parts.length < 4) {
                await sock.sendMessage(noWa, { text: 'Format salah! Gunakan: CATAT [PEMASUKAN/PENGELUARAN] [NOMINAL] [KETERANGAN]' });
                return;
            }
            
            const payload = {
                tanggal: new Date().toLocaleDateString(),
                tipe: parts[1],
                nominal: parts[2],
                keterangan: parts.slice(3).join(' ')
            };

            try {
                const res = await axios.post(WEB_APP_URL, JSON.stringify(payload));
                await sock.sendMessage(noWa, { text: res.data });
            } catch (err) {
                await sock.sendMessage(noWa, { text: 'Gagal mencatat data.' });
            }
        }
    });
}

connectToWhatsApp();
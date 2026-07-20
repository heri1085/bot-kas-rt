const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Setup Express (Web Server agar Render tidak mati)
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot Kas RT Aktif!');
});

app.listen(port, () => {
    console.log(`Web server berjalan di port ${port}`);
});

// URL Google Apps Script (Diambil dari Environment Variables Render)
const WEB_APP_URL = process.env.WEB_APP_URL;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ['BotKasRT', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Menampilkan QR Code di terminal/logs
        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log("Silakan scan QR Code di atas dengan WhatsApp Anda.");
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menyambung kembali...');
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Berhasil Terhubung!');
        }
    });

    // Membaca pesan masuk
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toUpperCase();
        const noWa = msg.key.remoteJid;

        // 1. Perintah CEK SALDO
        if (text === 'CEK SALDO') {
            try {
                const response = await axios.get(`${WEB_APP_URL}?action=ceksaldo`);
                await sock.sendMessage(noWa, { text: response.data });
            } catch (err) {
                await sock.sendMessage(noWa, { text: 'Gagal mengambil data saldo.' });
            }
        } 
        
        // 2. Perintah CATAT (Format: CATAT [PEMASUKAN/PENGELUARAN] [NOMINAL] [KETERANGAN])
        else if (text.startsWith('CATAT')) {
            const parts = text.split(' ');
            if (parts.length < 4) {
                await sock.sendMessage(noWa, { text: 'Format salah! Gunakan: CATAT [TIPE] [NOMINAL] [KETERANGAN]' });
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
                await sock.sendMessage(noWa, { text: 'Gagal mencatat data ke Google Sheets.' });
            }
        }
    });
}

connectToWhatsApp();
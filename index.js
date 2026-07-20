const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');

// Setup Express (Web Server) agar Render tidak mematikan bot
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Server Bot Kas RT Aktif dan Berjalan!');
});

app.listen(port, () => {
    console.log(`Web server berjalan di port ${port}`);
});

// Setup WhatsApp Bot
async function connectToWhatsApp () {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Untuk memunculkan QR Code saat pertama kali
        logger: pino({ level: "silent" })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if(connection === 'close') {
            console.log('Koneksi terputus, menyambung ulang...');
            connectToWhatsApp();
        } else if(connection === 'open') {
            console.log('Bot WhatsApp Berhasil Terhubung!');
        }
    });

    // Membaca pesan masuk
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if(!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        const noWa = msg.key.remoteJid;

        // Skenario perintah
        if(text && text.toUpperCase() === 'CEK SALDO') {
            await sock.sendMessage(noWa, { text: 'Halo! Bot Kas RT sedang aktif. Koneksi ke Google Sheets sedang disiapkan.' });
        }
    });
}

connectToWhatsApp();

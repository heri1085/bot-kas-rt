const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const axios = require('axios');
const qrcode = require('qrcode-terminal');

const app = express();
const port = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Bot Kas RT Berjalan (Local Storage)'));
app.listen(port);

const WEB_APP_URL = process.env.WEB_APP_URL;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
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
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(connectToWhatsApp, 3000);
            }
        }
    });

    sock.ev.on('messages.upsert', async m => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || (msg.key.fromMe === false && !msg.key.remoteJid)) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toUpperCase();
        const noWa = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe; 

        if (text === 'CEK SALDO') {
            try {
                const response = await axios.get(`${WEB_APP_URL}?action=ceksaldo`);
                await sock.sendMessage(noWa, { text: response.data });
            } catch (err) { await sock.sendMessage(noWa, { text: 'Gagal ambil data.' }); }
        } 
        else if (text.startsWith('CATAT')) {
            if (!isFromMe) {
                await sock.sendMessage(noWa, { text: '❌ Hanya Admin yang bisa mencatat.' });
                return;
            }
            const parts = text.split(' ');
            const payload = {
                tanggal: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                tipe: parts[1],
                nominal: parts[2],
                keterangan: parts.slice(3).join(' ')
            };
            try {
                const res = await axios.post(WEB_APP_URL, JSON.stringify(payload));
                await sock.sendMessage(noWa, { text: res.data });
            } catch (err) { await sock.sendMessage(noWa, { text: 'Gagal mencatat.' }); }
        }
    });
}

connectToWhatsApp();
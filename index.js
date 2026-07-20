const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const app = express();
app.listen(process.env.PORT || 3000, () => console.log("Server Aktif"));

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
        if (qr) qrcode.generate(qr, { small: true });
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Bot Berhasil Terhubung!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toUpperCase();
        
        if (text === 'CEK SALDO') {
            // Ganti URL ini dengan URL Web App Anda (yang diakhiri /exec)
            const res = await axios.get(process.env.WEB_APP_URL + "?action=ceksaldo");
            await sock.sendMessage(msg.key.remoteJid, { text: res.data });
        }
    });
}
connectToWhatsApp();

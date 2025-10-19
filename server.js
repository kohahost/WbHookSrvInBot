// server.js

const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const piBot = require('./pi_bot_logic.js');

// --- KONFIGURASI PENTING ---
// Ganti dengan token bot Anda dari @BotFather
const TELEGRAM_TOKEN = '8072498870:AAF36SvRq1pT3GJWCgaJO-ENvAupfCNWRho';
// URL publik server Anda. Untuk development lokal, gunakan ngrok.
// Contoh: 'https://your-domain.com' atau 'https://<id-ngrok>.ngrok.io'
const WEBHOOK_URL = 'https://webhook.zendshost.id';
const PORT = process.env.PORT || 5000;
// ----------------------------

const CONFIG_FILE = './config.json';
let config = loadConfig();
let adminChatId = null; // ID chat admin akan disimpan di sini
let userState = {}; // Untuk menangani alur percakapan (misal: menunggu input mnemonic)

// Inisialisasi Bot Telegram & Server Express
const bot = new TelegramBot(TELEGRAM_TOKEN);
const app = express();
app.use(bodyParser.json());

// Set Webhook
const webhookPath = `/webhook/${TELEGRAM_TOKEN}`;
bot.setWebHook(`${WEBHOOK_URL}${webhookPath}`);

// Endpoint untuk menerima update dari Telegram
app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// --- FUNGSI HELPER ---
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE);
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Gagal memuat config:", error);
    }
    // Default config jika file tidak ada atau error
    return { mnemonics: [], recipient: '', memo: 'Pi Transfer' };
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error("Gagal menyimpan config:", error);
    }
}

// Fungsi notifikasi yang akan dikirim ke logika bot
function sendAdminNotification(message) {
    if (adminChatId) {
        bot.sendMessage(adminChatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
    }
}
// "Suntikkan" fungsi notifikasi ke dalam modul logika bot
piBot.setNotifier(sendAdminNotification);


// --- HANDLER PERINTAH TELEGRAM ---

// /start dan /help: Menampilkan daftar perintah
bot.onText(/\/start|\/help/, (msg) => {
    adminChatId = msg.chat.id; // Simpan ID admin saat pertama kali berinteraksi
    const helpText = `
🤖 *Selamat Datang di PiClaimBot* 🤖
___________________________
Berikut adalah perintah yang tersedia:
___________________________
*/run* - Memulai proses bot.
*/stop* - Menghentikan proses bot.
*/status* - Melihat status bot saat ini.
___________________________
*Pengaturan:*
*/setrecipient* <alamat_wallet> - Mengatur alamat wallet penerima.
*/setmemo* <teks_memo> - Mengatur memo untuk transaksi.
*/addmnemonics* - Menambah frasa mnemonik baru (akan dipandu).
*/clearmnemonics* - Menghapus SEMUA frasa mnemonik yang tersimpan.
___________________________
Pastikan semua pengaturan sudah benar sebelum menjalankan bot!
___________________________
🥷🏻 *Developer* @zendshost
___________________________
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
});

// /run: Menjalankan bot
bot.onText(/\/run/, (msg) => {
    if (!config.recipient || config.mnemonics.length === 0) {
        return bot.sendMessage(msg.chat.id, "❌ Gagal memulai. Harap atur alamat penerima dan tambahkan mnemonik terlebih dahulu.");
    }
    if (piBot.startBot(config)) {
        bot.sendMessage(msg.chat.id, "✅ Bot berhasil dimulai.");
    } else {
        bot.sendMessage(msg.chat.id, "ℹ️ Bot sudah berjalan.");
    }
});

// /stop: Menghentikan bot
bot.onText(/\/stop/, (msg) => {
    if (piBot.stopBot()) {
        bot.sendMessage(msg.chat.id, "✅ Bot berhasil dihentikan.");
    } else {
        bot.sendMessage(msg.chat.id, "ℹ️ Bot tidak sedang berjalan.");
    }
});

// /status: Cek status bot
bot.onText(/\/status/, (msg) => {
    const status = piBot.getStatus();
    const statusText = `
*Status Bot:*
- *Status:* ${status.isRunning ? 'Online ✅' : 'Stop ⏹️'}
- *Wallet Berikutnya:* #${status.isRunning ? status.currentIndex + 1 : 'N/A'}
- *Penerima:* \`${config.recipient || 'Belum diatur'}\`
- *Memo:* \`${config.memo || 'Belum diatur'}\`
- *Total Mnemonik:* ${config.mnemonics.length}
    `;
    bot.sendMessage(msg.chat.id, statusText, { parse_mode: 'Markdown' });
});

// /setrecipient: Mengatur alamat penerima
bot.onText(/\/setrecipient (.+)/, (msg, match) => {
    const recipient = match[1];
    if (recipient && recipient.startsWith('G') && recipient.length === 56) {
        config.recipient = recipient;
        saveConfig();
        bot.sendMessage(msg.chat.id, `✅ Alamat penerima diatur ke: \`${recipient}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, "❌ Alamat tidak valid. Pastikan alamat dimulai dengan 'G' dan panjangnya 56 karakter.");
    }
});

// /setmemo: Mengatur memo
bot.onText(/\/setmemo (.+)/, (msg, match) => {
    config.memo = match[1];
    saveConfig();
    bot.sendMessage(msg.chat.id, `✅ Memo diatur ke: \`${config.memo}\``, { parse_mode: 'Markdown' });
});

// /addmnemonics: Memulai proses penambahan mnemonik
bot.onText(/\/addmnemonics/, (msg) => {
    userState[msg.chat.id] = 'awaiting_mnemonics';
    bot.sendMessage(msg.chat.id, "Silakan kirim daftar frasa mnemonik Anda. Pisahkan setiap frasa dengan baris baru (enter).");
});

// /clearmnemonics: Menghapus semua mnemonik
bot.onText(/\/clearmnemonics/, (msg) => {
    config.mnemonics = [];
    saveConfig();
    bot.sendMessage(msg.chat.id, "🗑️ Semua frasa telah dihapus.");
});

// Menangani pesan biasa untuk input mnemonik
bot.on('message', (msg) => {
    // Abaikan jika itu adalah sebuah perintah
    if (msg.text && msg.text.startsWith('/')) return;

    if (userState[msg.chat.id] === 'awaiting_mnemonics') {
        const newMnemonics = msg.text.split('\n').map(m => m.trim()).filter(m => m.length > 0);
        if (newMnemonics.length > 0) {
            // Gabungkan dan hapus duplikat
            const oldSize = config.mnemonics.length;
            const combined = [...config.mnemonics, ...newMnemonics];
            config.mnemonics = [...new Set(combined)];
            saveConfig();
            
            const addedCount = config.mnemonics.length - oldSize;
            bot.sendMessage(msg.chat.id, `✅ Berhasil menambahkan ${addedCount} frasa baru.\nTotal frasa sekarang: ${config.mnemonics.length}`);
        } else {
            bot.sendMessage(msg.chat.id, "⚠️ Tidak ada frasa valid yang terdeteksi.");
        }
        delete userState[msg.chat.id]; // Selesaikan state
    }
});
// Jalankan server
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
    console.log(`Webhook terpasang di: ${WEBHOOK_URL}${webhookPath}`);
});

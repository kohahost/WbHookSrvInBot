// pi_bot_logic.js

const { Server, Keypair, TransactionBuilder, Operation, Asset, Memo } = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');

let sendNotification = () => {};

// Daftar semua server yang akan digunakan (telah diperbarui sesuai permintaan Anda).
const PI_API_SERVERS = [
    'http://4.194.35.14:31401',
    'http://113.160.156.51:31401'
];

const PI_NETWORK_PASSPHRASE = 'Pi Network';

let currentServerIndex = 0;

// Fungsi untuk mendapatkan server berikutnya secara bergiliran (Round-Robin).
function getPiServer() {
    const serverUrl = PI_API_SERVERS[currentServerIndex];
    console.log(`-> Menggunakan server node: ${serverUrl}`);
    
    // Pindah ke indeks server berikutnya untuk pemanggilan selanjutnya.
    currentServerIndex = (currentServerIndex + 1) % PI_API_SERVERS.length;
    
    return new Server(serverUrl, { allowHttp: true });
}

let botState = { isRunning: false, timeoutId: null, currentIndex: 0 };

function setNotifier(notifierFunction) {
    sendNotification = notifierFunction;
}

async function getWalletFromMnemonic(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) throw new Error("Mnemonic tidak valid.");
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const { key } = ed25519.derivePath("m/44'/314159'/0'", seed.toString('hex'));
    return Keypair.fromRawEd25519Seed(key);
}

// <<< FUNGSI INI TELAH DIMODIFIKASI SEPENUHNYA >>>
async function processWallet(mnemonic, recipientAddress, walletIndex, memoText) {
    const server = getPiServer();
    
    let senderKeypair;
    try {
        senderKeypair = await getWalletFromMnemonic(mnemonic);
        const senderAddress = senderKeypair.publicKey();

        console.log(`Memproses Wallet #${walletIndex + 1}: ${senderAddress}`);

        const account = await server.loadAccount(senderAddress);
        const baseFee = await server.fetchBaseFee();
        
        const nativeBalance = account.balances.find(b => b.asset_type === 'native')?.balance || '0';
        const currentBalance = parseFloat(nativeBalance);
        console.log(`Saldo saat ini: ${currentBalance.toFixed(7)} π`);

        // Menghitung jumlah yang akan dikirim (sweep transfer)
        const fee = baseFee / 1e7;
        const amountToSend = currentBalance - 1 - fee;

        if (amountToSend > 0.0000001) {
            console.log(`Mengirim saldo yang ada: ${amountToSend.toFixed(7)} π`);
            
            const tx = new TransactionBuilder(account, { fee: baseFee.toString(), networkPassphrase: PI_NETWORK_PASSPHRASE })
                .addMemo(Memo.text(memoText))
                .addOperation(Operation.payment({ 
                    destination: recipientAddress, 
                    asset: Asset.native(), 
                    amount: amountToSend.toFixed(7) 
                }))
                .setTimeout(30)
                .build();
                
            tx.sign(senderKeypair);
            const res = await server.submitTransaction(tx);

            const now = new Date();
            const timeString = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });

            const successMsg = 
`✅ *Transfer Coin Pi Berhasil*
*Jumlah*: ${amountToSend.toFixed(7)} π
*Dari*: \`${senderAddress}\`
*Ke*: \`${recipientAddress}\`
*Jam*: ${timeString}
*Hash*: [Lihat Transaksi](https://blockexplorer.minepi.com/mainnet/transactions/${res.hash})`;

            console.log(successMsg.replace(/[*`[\]()]/g, ''));
            sendNotification(successMsg);
        } else {
            console.log("Saldo tidak cukup untuk melakukan transfer (setelah dikurangi 1 π dan biaya).");
        }
    } catch (e) {
        const addr = senderKeypair?.publicKey() || `Wallet #${walletIndex + 1}`;
        let errorMessage = e.message;
        if (e.response && e.response.data && e.response.data.detail) {
            errorMessage = e.response.data.detail;
        } else if (e.response && e.response.status === 404) {
            errorMessage = "Akun belum diaktifkan (tidak ditemukan di blockchain).";
        } else if (e.response && e.response.status === 429) {
            errorMessage = "Terkena Rate Limit (Too Many Requests) dari server. Siklus akan berlanjut dengan server berikutnya.";
        }

        const errorMsg = `❌ *Error di Wallet*\n*Dompet*: \`${addr}\`\n*Pesan*: ${errorMessage}`;
        console.log(errorMsg.replace(/[*`]/g, ''));

        const ignoredErrorText = 'The transaction failed when submitted to the stellar network';
        
        if (!errorMessage.includes(ignoredErrorText) && !errorMessage.includes('Internal Server Error') && !errorMessage.includes('socket hang up')) {
            sendNotification(errorMsg);
        } else {
            console.log("--> Notifikasi Telegram untuk error jaringan/transaksi minor diabaikan.");
        }
    }
}

function runBotCycle(config) {
    if (!botState.isRunning) return;
    const { mnemonics, recipient, memo } = config;
    if (mnemonics.length === 0) {
        console.log("Tidak ada mnemonic untuk diproses. Bot berhenti.");
        stopBot();
        sendNotification("⚠️ *Bot Dihentikan Otomatis*\nTidak ada frasa mnemonik yang dikonfigurasi.");
        return;
    }
    processWallet(mnemonics[botState.currentIndex], recipient, botState.currentIndex, memo)
        .finally(() => {
            if (!botState.isRunning) return;
            botState.currentIndex = (botState.currentIndex + 1) % mnemonics.length;
            if (botState.currentIndex === 0) {
                console.log("\nSiklus selesai, mengulang dari awal setelah jeda singkat...");
            }
            botState.timeoutId = setTimeout(() => runBotCycle(config), 50);
        });
}

function startBot(config) {
    if (botState.isRunning) return false;
    console.log("Memulai bot...");
    botState.isRunning = true;
    botState.currentIndex = 0;
    sendNotification("🚀 *Bot Dimulai*");
    runBotCycle(config);
    return true;
}

function stopBot() {
    if (!botState.isRunning) return false;
    console.log("Menghentikan bot...");
    botState.isRunning = false;
    if (botState.timeoutId) {
        clearTimeout(botState.timeoutId);
    }
    botState.timeoutId = null;
    sendNotification("⏹️ *Bot Dihentikan*");
    return true;
}

function getStatus() {
    return { 
        isRunning: botState.isRunning,
        currentIndex: botState.currentIndex
    };
}

module.exports = { startBot, stopBot, getStatus, setNotifier };

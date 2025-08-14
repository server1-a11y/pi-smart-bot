const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');
require("dotenv").config();

// Fungsi kirim notifikasi Telegram (tidak berubah)
async function sendTelegramMessage(message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return; // Lewati jika tidak ada konfigurasi
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(url, { chat_id: chatId, text: message });
    } catch (err) {
        console.error("⚠️ Gagal kirim ke Telegram:", err.message);
    }
}

// Fungsi ambil key dari mnemonic (tidak berubah, akan kita pakai untuk sponsor juga)
async function getPiWalletAddressFromSeed(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) throw new Error("Invalid mnemonic");
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const derivationPath = "m/44'/314159'/0'";
    const { key } = ed25519.derivePath(derivationPath, seed.toString('hex'));
    const keypair = StellarSdk.Keypair.fromRawEd25519Seed(key);
    return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

// Fungsi utama
async function claimAndSend() {
    const mainMnemonic = process.env.MNEMONIC;
    const receiver = process.env.RECEIVER_ADDRESS;
    // --- PERUBAHAN DI SINI: Gunakan SPONSOR_MNEMONIC ---
    const sponsorMnemonic = process.env.SPONSOR_MNEMONIC;

    if (!mainMnemonic || !receiver || !sponsorMnemonic) {
        console.error("❌ Error: Pastikan MNEMONIC, RECEIVER_ADDRESS, dan SPONSOR_MNEMONIC sudah diisi di file .env");
        return;
    }

    try {
        // Dapatkan key untuk akun utama
        const { publicKey, secretKey } = await getPiWalletAddressFromSeed(mainMnemonic);
        const keypair = StellarSdk.Keypair.fromSecret(secretKey);

        // --- PERUBAHAN DI SINI: Dapatkan key untuk akun sponsor dari mnemonic-nya ---
        const { publicKey: sponsorPublicKey, secretKey: sponsorSecretKey } = await getPiWalletAddressFromSeed(sponsorMnemonic);
        const sponsorKeypair = StellarSdk.Keypair.fromSecret(sponsorSecretKey);

        const server = new StellarSdk.Server('https://api.mainnet.minepi.com');
        const account = await server.loadAccount(publicKey);
        
        console.log("🔑 Sender Public Key:", publicKey);
        console.log("💰 Sponsor Public Key:", sponsorPublicKey); // Tampilkan public key sponsor

        // Ambil base fee sekali untuk efisiensi
        const baseFee = await server.fetchBaseFee();
        const claimables = await server.claimableBalances().claimant(publicKey).call();

        for (let cb of claimables.records) {
            const cbID = cb.id;
            const amount = cb.amount;
            console.log(`💰 Found Claimable Balance ID: ${cbID}`);
            console.log(`💸 Claimable Amount: ${amount}`);

            const innerClaimTx = new StellarSdk.TransactionBuilder(account, {
                fee: '0', // Fee transaksi internal harus 0
                networkPassphrase: 'Pi Network'
            })
                .addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceId: cbID }))
                .setTimeout(30)
                .build();
            
            innerClaimTx.sign(keypair);

            const feeBumpClaimTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
                sponsorKeypair.publicKey(), // Akun yang bayar fee
                baseFee,
                innerClaimTx, // Transaksi yang dibungkus
                'Pi Network'
            );
            feeBumpClaimTx.sign(sponsorKeypair);

            const res = await server.submitTransaction(feeBumpClaimTx);

            if (res && res.hash) {
                console.log(`✅ Claimed Successfully! Hash: ${res.hash}`);
                await sendTelegramMessage(`✅ Klaim Pi sukses (via Sponsor)!\nBalance ID:\n${cbID}\nTx Hash: ${res.hash}`);
            }
        }

        // Cek saldo & kirim jika memungkinkan
        const accountAfterClaim = await server.loadAccount(publicKey);
        const balance = accountAfterClaim.balances.find(b => b.asset_type === 'native')?.balance || 0;

        console.log(`📊 Pi Balance: ${balance}`);
        const sendAmount = Number(balance) - 1.0;

        if (sendAmount > 0.0000001) {
            const innerSendTx = new StellarSdk.TransactionBuilder(accountAfterClaim, {
                fee: '0',
                networkPassphrase: 'Pi Network'
            })
                .addOperation(StellarSdk.Operation.payment({
                    destination: receiver,
                    asset: StellarSdk.Asset.native(),
                    amount: sendAmount.toFixed(7)
                }))
                .setTimeout(30)
                .build();
            
            innerSendTx.sign(keypair);

            const feeBumpSendTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
                sponsorKeypair.publicKey(),
                baseFee,
                innerSendTx,
                'Pi Network'
            );
            feeBumpSendTx.sign(sponsorKeypair);

            const txResult = await server.submitTransaction(feeBumpSendTx);

            if (txResult && txResult.hash) {
                console.log(`📤 Sent ${sendAmount.toFixed(7)} Pi to ${receiver}`);
                console.log(`🔗 View Tx: https://api.mainnet.minepi.com/transactions/${txResult.hash}`);
                await sendTelegramMessage(`📤 Transfer ${sendAmount.toFixed(7)} Pi sukses (via Sponsor)!\nTujuan: ${receiver}\nTx Hash: ${txResult.hash}`);
            }
        } else {
            console.log("⚠️ Saldo tidak cukup untuk transfer (hanya tersisa base reserve).");
        }

    } catch (e) {
        console.error("❌ Error:", e.response?.data?.extras?.result_codes || e.message || e);
    } finally {
        console.log("🔄 Menunggu 1 detik sebelum next run...");
        console.log("----------------------------------------------------------------");
        setTimeout(claimAndSend, 1000); // Ulangi setiap 5 detik
    }
}

claimAndSend();

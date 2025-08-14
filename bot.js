// Impor library yang diperlukan
require('dotenv').config();
const StellarSdk = require('stellar-sdk');
const hdWallet = require('stellar-hd-wallet');

// --- KONFIGURASI JARINGAN DAN KUNCI ---
const PI_NETWORK_PASSPHRASE = "Pi Network";
const server = new StellarSdk.Horizon.Server('https://api.mainnet.minepi.com');

// Ambil Frasa Sandi dari file .env
const userMnemonic = process.env.USER_MNEMONIC;
const sponsorMnemonic = process.env.SPONSOR_MNEMONIC;

// Validasi bahwa frasa sandi ada
if (!userMnemonic || !sponsorMnemonic) {
    console.error("KRITIS: Pastikan USER_MNEMONIC dan SPONSOR_MNEMONIC sudah diatur di file .env");
    process.exit(1);
}

// --- FUNGSI UTAMA BOT ---

/**
 * Mendapatkan KeyPair (public & secret key) dari sebuah frasa sandi (mnemonic).
 * @param {string} mnemonic - Frasa sandi 12 atau 24 kata.
 * @returns {StellarSdk.Keypair}
 */
function getKeypairFromMnemonic(mnemonic) {
    const wallet = hdWallet.fromMnemonic(mnemonic);
    // Mengambil akun pertama (indeks 0) dari wallet HD
    return wallet.getKeypair(0);
}

// Dapatkan Keypair untuk kedua akun
const userKeys = getKeypairFromMnemonic(userMnemonic);
const sponsorKeys = getKeypairFromMnemonic(sponsorMnemonic);

console.log("Akun Pengguna:", userKeys.publicKey());
console.log("Akun Sponsor :", sponsorKeys.publicKey());

/**
 * Fungsi cerdas untuk KLAIM dan TRANSFER seluruh jumlah yang diklaim secara atomik.
 * Semua biaya ditanggung oleh akun sponsor.
 * @param {string} claimableBalanceId - ID dari balance yang akan diklaim.
 * @param {string} destinationId - Alamat Pi tujuan transfer.
 * @param {string} [memoText=null] - (Opsional) Memo untuk transaksi.
 */
async function sponsoredClaimAndTransferFullAmount(claimableBalanceId, destinationId, memoText = null) {
    try {
        // --- LANGKAH CERDAS: DETEKSI JUMLAH YANG AKAN DIKLAIM ---
        console.log(`Mencari detail untuk Claimable Balance ID: ${claimableBalanceId}...`);
        const claimableBalance = await server.claimableBalances().claimableBalance(claimableBalanceId).call();
        const amountToTransfer = claimableBalance.amount;
        console.log(`✅ Ditemukan saldo yang bisa diklaim: ${amountToTransfer} Pi`);

        // 1. Muat informasi akun terbaru dari jaringan
        const userAccount = await server.loadAccount(userKeys.publicKey());
        const baseFee = await server.fetchBaseFee();

        // 2. Bangun TRANSAKSI DALAM (Inner Transaction) oleh PENGGUNA
        const innerTransaction = new StellarSdk.TransactionBuilder(userAccount, {
            fee: "0", // Biaya NOL, ditanggung sponsor
            networkPassphrase: PI_NETWORK_PASSPHRASE,
        })
        // OPERASI 1: Klaim saldo
        .addOperation(StellarSdk.Operation.claimClaimableBalance({
            balanceId: claimableBalanceId,
        }))
        // OPERASI 2: Transfer SELURUH jumlah yang baru diklaim
        .addOperation(StellarSdk.Operation.payment({
            destination: destinationId,
            asset: StellarSdk.Asset.native(),
            amount: amountToTransfer, // Menggunakan jumlah yang dideteksi secara otomatis
        }))
        .addMemo(memoText ? StellarSdk.Memo.text(memoText) : StellarSdk.Memo.none())
        .setTimeout(60)
        .build();

        // 3. Bungkus dengan TRANSAKSI LUAR (Fee Bump) oleh SPONSOR
        const feeBumpTransaction = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
            sponsorKeys.publicKey(),
            baseFee,
            innerTransaction,
            PI_NETWORK_PASSPHRASE
        );

        // 4. Tanda Tangan Ganda (Kritis!)
        feeBumpTransaction.innerTransaction.sign(userKeys); // Pengguna tanda tangani aksi
        feeBumpTransaction.sign(sponsorKeys); // Sponsor tanda tangani pembayaran biaya

        console.log("✍️  Transaksi kombo berhasil dibuat dan ditandatangani. Mengirim ke jaringan...");

        // 5. Kirim transaksi ke jaringan
        const result = await server.submitTransaction(feeBumpTransaction);
        
        console.log("\n🎉 Transaksi Berhasil Dikirim!");
        console.log("Hash:", result.hash);
        console.log("Link:", result._links.transaction.href);
        return result;

    } catch (error) {
        console.error("\n❌ Terjadi kesalahan fatal:");
        if (error.response && error.response.data && error.response.data.extras) {
            console.error("Detail Error:", JSON.stringify(error.response.data.extras.result_codes, null, 2));
        } else {
            console.error(error.message);
        }
        return null;
    }
}


// --- CONTOH PENGGUNAAN BOT ---
async function main() {
    // --- GANTI NILAI DI BAWAH INI SESUAI KEBUTUHAN ANDA ---

    // ID dari 'claimable balance' yang ingin Anda klaim.
    // Anda harus mendapatkan ID ini terlebih dahulu, misalnya dengan memantau akun Anda.
    const BALANCE_ID_TO_CLAIM = "0000000071c8d69cab9ec8e5901a6ae2adb02d4d1a4ff83fa49547963bab524cf7bc2481";

    // Alamat Pi tujuan untuk mentransfer koin setelah diklaim.
    const DESTINATION_ADDRESS = "GBU5GV6G3O54FOZYYMJS433GTTRUGIFXMLHRQGNHCHBZHYP22XNMM4X6";
    
    // Validasi sederhana sebelum menjalankan
    if (DESTINATION_ADDRESS.startsWith("GBU5GV6G3O54FOZYYMJS433GTTRUGIFXMLHRQGNHCHBZHYP22XNMM4X6") || BALANCE_ID_TO_CLAIM.startsWith("0000000071c8d69cab9ec8e5901a6ae2adb02d4d1a4ff83fa49547963bab524cf7bc2481")) {
        console.log("Harap ganti `DESTINATION_ADDRESS` dan `BALANCE_ID_TO_CLAIM` di dalam fungsi main() pada file bot.js");
        return;
    }

    console.log(`\n🤖 Bot Cerdas Akan Menjalankan Aksi:`);
    console.log(`1. KLAIM balance ID: ${BALANCE_ID_TO_CLAIM}`);
    console.log(`2. TRANSFER seluruh isinya ke: ${DESTINATION_ADDRESS}\n`);

    // Panggil fungsi utama
    await sponsoredClaimAndTransferFullAmount(
        BALANCE_ID_TO_CLAIM,
        DESTINATION_ADDRESS,
        "Auto Claim & Send"
    );
}

// Jalankan fungsi utama
main();

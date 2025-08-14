// Impor library yang diperlukan menggunakan 'import' (ES Module)
import 'dotenv/config'; // Memuat file .env
import StellarSdk from 'stellar-sdk';
import hdWallet from 'stellar-hd-wallet';

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
 * Mendapatkan KeyPair dari sebuah frasa sandi (mnemonic).
 */
function getKeypairFromMnemonic(mnemonic) {
    const wallet = hdWallet.fromMnemonic(mnemonic);
    return wallet.getKeypair(0);
}

// Dapatkan Keypair untuk kedua akun
const userKeys = getKeypairFromMnemonic(userMnemonic);
const sponsorKeys = getKeypairFromMnemonic(sponsorMnemonic);

console.log("Akun Pengguna:", userKeys.publicKey());
console.log("Akun Sponsor :", sponsorKeys.publicKey());

/**
 * Fungsi cerdas untuk KLAIM dan TRANSFER seluruh jumlah yang diklaim secara atomik.
 */
async function sponsoredClaimAndTransferFullAmount(claimableBalanceId, destinationId, memoText = null) {
    try {
        console.log(`Mencari detail untuk Claimable Balance ID: ${claimableBalanceId}...`);
        const claimableBalance = await server.claimableBalances().claimableBalance(claimableBalanceId).call();
        const amountToTransfer = claimableBalance.amount;
        console.log(`✅ Ditemukan saldo yang bisa diklaim: ${amountToTransfer} Pi`);

        const userAccount = await server.loadAccount(userKeys.publicKey());
        const baseFee = await server.fetchBaseFee();

        const innerTransaction = new StellarSdk.TransactionBuilder(userAccount, {
            fee: "0",
            networkPassphrase: PI_NETWORK_PASSPHRASE,
        })
        .addOperation(StellarSdk.Operation.claimClaimableBalance({
            balanceId: claimableBalanceId,
        }))
        .addOperation(StellarSdk.Operation.payment({
            destination: destinationId,
            asset: StellarSdk.Asset.native(),
            amount: amountToTransfer,
        }))
        .addMemo(memoText ? StellarSdk.Memo.text(memoText) : StellarSdk.Memo.none())
        .setTimeout(60)
        .build();

        const feeBumpTransaction = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
            sponsorKeys.publicKey(),
            baseFee,
            innerTransaction,
            PI_NETWORK_PASSPHRASE
        );

        feeBumpTransaction.innerTransaction.sign(userKeys);
        feeBumpTransaction.sign(sponsorKeys);

        console.log("✍️  Transaksi kombo berhasil dibuat dan ditandatangani. Mengirim ke jaringan...");

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


// --- EKSEKUSI BOT ---
async function main() {
    // Nilai-nilai ini sekarang akan dieksekusi langsung
    const BALANCE_ID_TO_CLAIM = "0000000071c8d69cab9ec8e5901a6ae2adb02d4d1a4ff83fa49547963bab524cf7bc2481";
    const DESTINATION_ADDRESS = "GBU5GV6G3O54FOZYYMJS433GTTRUGIFXMLHRQGNHCHBZHYP22XNMM4X6";
    
    // BLOK VALIDASI YANG SALAH TELAH DIHAPUS

    console.log(`\n🤖 Bot Cerdas Akan Menjalankan Aksi:`);
    console.log(`1. KLAIM balance ID: ${BALANCE_ID_TO_CLAIM}`);
    console.log(`2. TRANSFER seluruh isinya ke: ${DESTINATION_ADDRESS}\n`);

    // Panggil fungsi utama untuk menjalankan transaksi
    await sponsoredClaimAndTransferFullAmount(
        BALANCE_ID_TO_CLAIM,
        DESTINATION_ADDRESS,
        "Auto Claim & Send"
    );
}

// Jalankan fungsi utama
main();

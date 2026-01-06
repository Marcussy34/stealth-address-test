import * as secp256k1 from '@noble/secp256k1';
import { keccak256, toHex, bytesToHex, hexToBytes, type Hex } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';

// --- ERC-5564 Constants ---
const SCHEME_ID = 1; // SECP256k1
const CURVE_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

// --- Helper Functions ---

/**
 * Generates a random private key.
 */
function generatePrivateKey(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Derives a public key from a private key (compressed).
 */
function getPublicKey(privateKey: Hex): Hex {
  const pubKey = secp256k1.getPublicKey(hexToBytes(privateKey), true);
  return bytesToHex(pubKey);
}

/**
 * Computes the shared secret: S = ephemeralPrivKey * recipientPubKey
 * OR S = recipientPrivKey * ephemeralPubKey
 * (ECDH)
 */
function computeSharedSecret(privateKey: Hex, publicKey: Hex): Hex {
  const sharedSecret = secp256k1.getSharedSecret(hexToBytes(privateKey), hexToBytes(publicKey), true); // isCompressed = true
  return bytesToHex(sharedSecret);
}

/**
 * Steal Address Generation (Sender Side)
 */
function generateStealthAddress(recipientMetaAddress: { spendingPubKey: Hex, viewingPubKey: Hex }) {
  console.log("\n--- Sender: Generating Stealth Address ---");

  // 1. Generate Ephemeral Key Pair
  const ephemeralPrivKey = generatePrivateKey();
  const ephemeralPubKey = getPublicKey(ephemeralPrivKey);
  console.log("Sender Ephemeral PubKey:", ephemeralPubKey);

  // 2. Compute Shared Secret (using Viewing Key)
  // S = ephemeralPrivKey * recipientViewingPubKey
  const sharedSecret = computeSharedSecret(ephemeralPrivKey, recipientMetaAddress.viewingPubKey);
  console.log("Shared Secret (Sender):", sharedSecret);

  // 3. Compute View Tag (first byte of shared secret)
  const hashedSharedSecret = keccak256(hexToBytes(sharedSecret));
  const viewTag = hexToBytes(hashedSharedSecret)[0];
  console.log("View Tag:", viewTag);

  // 4. Derive Stealth Public Key
  // P_stealth = P_spending + s * G
  // s = hashedSharedSecret
  
  const s_scalar = hexToBytes(hashedSharedSecret);
  
  // Get Point for P_spending
  const p_spending_hex = recipientMetaAddress.spendingPubKey.slice(2); // Remove 0x
  const p_spending_point = secp256k1.Point.fromHex(p_spending_hex);
  
  // Get Point for s * G
  const s_G_pubKey = secp256k1.getPublicKey(s_scalar, true);
  const s_G_hex = bytesToHex(s_G_pubKey).slice(2);
  const s_G_point = secp256k1.Point.fromHex(s_G_hex);
  
  const p_stealth_point = p_spending_point.add(s_G_point);
  
  const stealthPubKey = p_stealth_point.toHex(true); // Compressed
  
  // 5. Convert to Ethereum Address
  // Address = keccak256(uncompressedPubKey)[12..32]
  const uncompressedPubKey = p_stealth_point.toHex(false);
  
  const pubKeyBytes = hexToBytes(`0x${uncompressedPubKey}` as Hex).slice(1); // Remove 0x04 prefix
  // keccak256 returns Hex string (0x...)
  const addressHash = keccak256(pubKeyBytes);
  const stealthAddress = `0x${addressHash.slice(-40)}` as Hex;
  
  console.log("Generated Stealth Address:", stealthAddress);

  return {
    stealthAddress,
    ephemeralPubKey,
    viewTag,
    ciphertext: "0x..." 
  };
}

/**
 * Stealth Address Recovery (Recipient Side)
 */
function scanAndRecover(
  announcement: { ephemeralPubKey: Hex, viewTag: number, stealthAddress: Hex },
  recipientKeys: { spendingPrivKey: Hex, viewingPrivKey: Hex, spendingPubKey: Hex, viewingPubKey: Hex }
) {
  console.log("\n--- Recipient: Scanning & Recovering ---");

  // 1. Check View Tag
  // S = ephemeralPubKey * viewingPrivKey
  const sharedSecret = computeSharedSecret(recipientKeys.viewingPrivKey, announcement.ephemeralPubKey);
  const hashedSharedSecret = keccak256(hexToBytes(sharedSecret));
  const calculatedViewTag = hexToBytes(hashedSharedSecret)[0];

  console.log("Calculated View Tag:", calculatedViewTag);
  if (calculatedViewTag !== announcement.viewTag) {
    console.log("View Tag Mismatch! Not for us.");
    return;
  }
  console.log("View Tag Match! Proceeding to recover...");

  // 2. Derive Stealth Private Key
  // d_stealth = d_spending + s
  const s_scalar = BigInt(hashedSharedSecret);
  const d_spending = BigInt(recipientKeys.spendingPrivKey);
  
  const d_stealth_big = (d_spending + s_scalar) % CURVE_ORDER;
  const d_stealth = `0x${d_stealth_big.toString(16).padStart(64, '0')}` as Hex;
  
  console.log("Derived Stealth Private Key:", d_stealth);

  // 3. Verify Address
  const derivedAddress = privateKeyToAddress(d_stealth);
  console.log("Derived Stealth Address:", derivedAddress);

  if (derivedAddress.toLowerCase() === announcement.stealthAddress.toLowerCase()) {
    console.log("SUCCESS: Stealth Address Verified and Private Key Recovered!");
  } else {
    console.error("FAILURE: Derived address does not match announcement.");
  }
}

async function main() {
  console.log("=== ERC-5564 Stealth Address Simulation ===\n");

  // 1. Setup Recipient Keys
  const spendingPrivKey = generatePrivateKey();
  const viewingPrivKey = generatePrivateKey();
  const spendingPubKey = getPublicKey(spendingPrivKey);
  const viewingPubKey = getPublicKey(viewingPrivKey);

  const recipientKeys = { spendingPrivKey, viewingPrivKey, spendingPubKey, viewingPubKey };
  
  console.log("Recipient Meta-Address:");
  console.log(`  Spending PubKey: ${spendingPubKey}`);
  console.log(`  Viewing PubKey:  ${viewingPubKey}`);

  // 2. Sender Generates Stealth Address
  const announcementData = generateStealthAddress({ spendingPubKey, viewingPubKey });

  // 3. Recipient Scans and Recovers
  scanAndRecover(
    { 
      ephemeralPubKey: announcementData.ephemeralPubKey, 
      viewTag: announcementData.viewTag, 
      stealthAddress: announcementData.stealthAddress 
    },
    recipientKeys
  );
}

main().catch(console.error);

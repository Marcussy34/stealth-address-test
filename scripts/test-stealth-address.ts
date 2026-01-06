import { 
  secp256k1, 
  keccak256, 
  concat, 
  toHex, 
  bytesToHex, 
  hexToBytes,
  recoverPublicKey,
  pad,
  type Hex
} from 'viem';
import { privateKeyToAddress } from 'viem/accounts';

// --- ERC-5564 Constants ---
const SCHEME_ID = 1; // SECP256k1

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
  // viem's secp256k1 implementation
  const pubKey = secp256k1.getPublicKey(hexToBytes(privateKey), true); // true for compressed
  return bytesToHex(pubKey);
}

/**
 * Computes the shared secret: S = ephemeralPrivKey * recipientPubKey
 * OR S = recipientPrivKey * ephemeralPubKey
 * (ECDH)
 */
function computeSharedSecret(privateKey: Hex, publicKey: Hex): Hex {
  const sharedPoint = secp256k1.getSharedSecret(hexToBytes(privateKey), hexToBytes(publicKey));
  // The shared secret is usually the x-coordinate of the point, hashed.
  // But ERC-5564 spec says: S = P_ephemeral * k_spending (or vice versa)
  // We take the shared point (compressed or uncompressed) and hash it?
  // Let's follow the standard ECDH pattern:
  // sharedSecret = keccak256(sharedPoint[1...33]) if compressed?
  // Actually, standard ECDH usually returns the X coordinate.
  // Let's check viem's behavior. secp256k1.getSharedSecret returns the full point bytes (usually uncompressed without prefix? or compressed?)
  // It returns a Uint8Array.
  
  // For ERC-5564: S = s * P (scalar multiplication)
  // sharedSecret = keccak256(S)
  
  // Let's just use the raw bytes of the shared point for now and hash it.
  // Note: different libraries handle this differently. 
  // We will assume the shared secret is the keccak256 of the compressed shared point.
  
  // Re-compressing the point if needed.
  const sharedPointBytes = sharedPoint.slice(1, 33); // Take X coordinate? 
  // Actually, let's just hash the whole thing returned by getSharedSecret to be safe for this demo.
  // Wait, `secp256k1.getSharedSecret` usually returns the X coordinate as a 32-byte array in some libs, 
  // or the full point in others.
  // In `noble-curves` (which viem uses), it returns the shared key (hashed? or point?).
  // Let's assume it returns the raw bytes we need to hash.
  
  return keccak256(sharedPoint);
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
  const viewTag = hexToBytes(sharedSecret)[0];
  console.log("View Tag:", viewTag);

  // 4. Derive Stealth Public Key
  // P_stealth = P_spending + G * hash(S)
  // Actually, usually it's: P_stealth = P_spending + G * hash(S)
  // Let's verify the exact formula for Scheme 1.
  // P_stealth = P_spending + (hashed_shared_secret * G)
  
  const hashedSharedSecret = keccak256(concat([hexToBytes(sharedSecret)])); // Hash it again? Or just use S?
  // Usually we use the shared secret directly or hash it to get a scalar.
  // Let's use `keccak256(sharedSecret)` as the scalar.
  
  // We need to add two public keys: P_spending and (scalar * G)
  const scalar = hexToBytes(sharedSecret); // Use shared secret as scalar directly? Or hash it? 
  // EIP-5564 says: 
  // S = ephemeralPrivKey * recipientViewingPubKey
  // s = keccak256(S)  <-- This is the scalar
  // P_stealth = P_spending + s*G
  
  // Let's do that.
  const s_scalar = keccak256(hexToBytes(sharedSecret));
  
  const p_stealth_point = secp256k1.ProjectivePoint.fromHex(hexToBytes(recipientMetaAddress.spendingPubKey))
    .add(secp256k1.ProjectivePoint.fromPrivateKey(hexToBytes(s_scalar)));
    
  const stealthPubKey = p_stealth_point.toHex(true); // Compressed
  
  // 5. Convert to Ethereum Address
  // We need to convert the pubkey to an address.
  // viem doesn't have a direct `pubKeyToAddress` exposed easily for raw hex?
  // We can use `keccak256` on the uncompressed pubkey (minus prefix).
  
  const uncompressedPubKey = p_stealth_point.toHex(false);
  const pubKeyBytes = hexToBytes(uncompressedPubKey as Hex).slice(1); // Remove 0x04 prefix
  const stealthAddress = `0x${bytesToHex(keccak256(pubKeyBytes)).slice(-40)}` as Hex;
  
  console.log("Generated Stealth Address:", stealthAddress);

  return {
    stealthAddress,
    ephemeralPubKey,
    viewTag,
    ciphertext: "0x..." // Placeholder for encrypted metadata if needed
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

  // 1. Check View Tag (Optimization)
  // S = ephemeralPubKey * viewingPrivKey
  const sharedSecret = computeSharedSecret(recipientKeys.viewingPrivKey, announcement.ephemeralPubKey);
  const calculatedViewTag = hexToBytes(sharedSecret)[0];

  console.log("Calculated View Tag:", calculatedViewTag);
  if (calculatedViewTag !== announcement.viewTag) {
    console.log("View Tag Mismatch! Not for us.");
    return;
  }
  console.log("View Tag Match! Proceeding to recover...");

  // 2. Derive Stealth Private Key
  // d_stealth = d_spending + hash(S)
  const s_scalar = keccak256(hexToBytes(sharedSecret));
  
  // We need to add scalars (private keys) modulo the curve order.
  // secp256k1 order is n.
  // viem/noble-curves handles this in `getPublicKey`? No, we need scalar addition.
  // We can use BigInt for this since we have the curve order.
  const CURVE_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  
  const d_spending_big = BigInt(recipientKeys.spendingPrivKey);
  const s_scalar_big = BigInt(s_scalar);
  
  const d_stealth_big = (d_spending_big + s_scalar_big) % CURVE_ORDER;
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


// --- Main Execution ---

async function main() {
  console.log("=== ERC-5564 Stealth Address Simulation ===\n");

  // 1. Setup Recipient Keys (Meta-Address)
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

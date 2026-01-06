import * as secp256k1 from '@noble/secp256k1';
import { keccak256, toHex, bytesToHex, hexToBytes, type Hex } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';

// --- ERC-5564 Constants ---
const SCHEME_ID = 1; // SECP256k1
const CURVE_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

// --- Helper Functions ---

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function generatePrivateKey(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

function getPublicKey(privateKey: Hex): Hex {
  const pubKey = secp256k1.getPublicKey(hexToBytes(privateKey), true);
  return bytesToHex(pubKey);
}

function computeSharedSecret(privateKey: Hex, publicKey: Hex): Hex {
  const sharedSecret = secp256k1.getSharedSecret(hexToBytes(privateKey), hexToBytes(publicKey), true);
  return bytesToHex(sharedSecret);
}

// --- ERC-6538 Simulation (The Registry) ---
const MockRegistry: Record<string, { spendingPubKey: Hex, viewingPubKey: Hex }> = {};

async function registerKeys(identifier: string, spendingPubKey: Hex, viewingPubKey: Hex) {
  console.log(`\n[ERC-6538 Registry] Registering keys for '${identifier}'...`);
  MockRegistry[identifier] = { spendingPubKey, viewingPubKey };
  await sleep(500);
  console.log(`[ERC-6538 Registry] Keys registered successfully!`);
}

async function lookupKeys(identifier: string) {
  console.log(`\n[ERC-6538 Registry] Looking up keys for '${identifier}'...`);
  await sleep(800);
  const keys = MockRegistry[identifier];
  if (!keys) throw new Error("Recipient not found in registry!");
  console.log(`[ERC-6538 Registry] Found Stealth Meta-Address for '${identifier}'`);
  return keys;
}

// --- Main Logic ---

async function generateStealthAddress(recipientIdentifier: string) {
  console.log("\n==================================================================================");
  console.log("                           SENDER SIDE (Generating Address)                        ");
  console.log("==================================================================================");
  await sleep(800);

  // 1. Lookup Recipient Keys (ERC-6538)
  console.log(`1. Sender needs Recipient's Meta-Address (for '${recipientIdentifier}'):`);
  const recipientMetaAddress = await lookupKeys(recipientIdentifier);
  
  // Construct the full meta-address string
  const metaAddressString = `st:eth:${recipientMetaAddress.spendingPubKey}:${recipientMetaAddress.viewingPubKey}`;
  console.log(`   [String] Full Meta-Address: ${metaAddressString}`);
  console.log(`   [Public] Spending Key:      ${recipientMetaAddress.spendingPubKey}`);
  console.log(`   [Public] Viewing Key:       ${recipientMetaAddress.viewingPubKey}`);
  await sleep(1500);

  // 2. Generate Ephemeral Key Pair
  const ephemeralPrivKey = generatePrivateKey();
  const ephemeralPubKey = getPublicKey(ephemeralPrivKey);
  console.log("\n2. Sender generates a temporary 'Ephemeral Key Pair':");
  console.log(`   [Private] Ephemeral Key: ${ephemeralPrivKey} (Kept Secret, thrown away after)`);
  console.log(`   [Public]  Ephemeral Key: ${ephemeralPubKey} (Broadcasted to network)`);
  await sleep(1500);

  // 3. Compute Shared Secret
  // S = ephemeralPrivKey * recipientViewingPubKey
  const sharedSecret = computeSharedSecret(ephemeralPrivKey, recipientMetaAddress.viewingPubKey);
  console.log("\n3. Sender computes 'Shared Secret' (ECDH):");
  console.log("   Formula: Ephemeral_PrivKey * Recipient_Viewing_PubKey");
  console.log(`   Result (S): ${sharedSecret}`);
  await sleep(1500);

  // 4. Compute View Tag
  const hashedSharedSecret = keccak256(hexToBytes(sharedSecret));
  const viewTag = hexToBytes(hashedSharedSecret)[0];
  console.log("\n4. Sender computes 'View Tag' (for filtering):");
  console.log("   Formula: First byte of keccak256(S)");
  console.log(`   Hashed Secret (s): ${hashedSharedSecret}`);
  console.log(`   View Tag: ${viewTag} (Broadcasted)`);
  await sleep(1500);

  // 5. Derive Stealth Public Key
  // P_stealth = P_spending + s * G
  const s_scalar = hexToBytes(hashedSharedSecret);
  
  const p_spending_hex = recipientMetaAddress.spendingPubKey.slice(2);
  const p_spending_point = secp256k1.Point.fromHex(p_spending_hex);
  
  const s_G_pubKey = secp256k1.getPublicKey(s_scalar, true);
  const s_G_hex = bytesToHex(s_G_pubKey).slice(2);
  const s_G_point = secp256k1.Point.fromHex(s_G_hex);
  
  const p_stealth_point = p_spending_point.add(s_G_point);
  const stealthPubKey = p_stealth_point.toHex(true);
  
  console.log("\n5. Sender derives 'Stealth Public Key':");
  console.log("   Formula: Recipient_Spending_PubKey + (Hashed_Secret * G)");
  console.log(`   Stealth PubKey: 0x${stealthPubKey}`);
  await sleep(1500);

  // 6. Convert to Ethereum Address
  const uncompressedPubKey = p_stealth_point.toHex(false);
  const pubKeyBytes = hexToBytes(`0x${uncompressedPubKey}` as Hex).slice(1);
  const addressHash = keccak256(pubKeyBytes);
  const stealthAddress = `0x${addressHash.slice(-40)}` as Hex;
  
  console.log("\n6. Sender converts Stealth PubKey to Ethereum Address:");
  console.log(`   Stealth Address: ${stealthAddress} (Where funds are sent)`);
  await sleep(2000);

  return {
    stealthAddress,
    ephemeralPubKey,
    viewTag,
  };
}

async function scanAndRecover(
  announcement: { ephemeralPubKey: Hex, viewTag: number, stealthAddress: Hex },
  recipientKeys: { spendingPrivKey: Hex, viewingPrivKey: Hex, spendingPubKey: Hex, viewingPubKey: Hex }
) {
  console.log("\n\n==================================================================================");
  console.log("                           RECIPIENT SIDE (Scanning & Recovering)                  ");
  console.log("==================================================================================");
  await sleep(800);
  console.log("Recipient sees an Announcement on-chain:");
  console.log(`   [Public] Ephemeral PubKey: ${announcement.ephemeralPubKey}`);
  console.log(`   [Public] View Tag: ${announcement.viewTag}`);
  console.log(`   [Public] Stealth Address: ${announcement.stealthAddress}`);
  
  console.log("\n   [CLARIFICATION] Does Recipient scan every transaction?");
  console.log("   YES. The Recipient performs ECDH on EVERY announcement to check the View Tag.");
  console.log("   - If View Tag doesn't match: STOP (Saves 99.6% of work).");
  console.log("   - If View Tag matches: Proceed to full address derivation (The expensive part).");
  
  await sleep(2500);

  // 1. Check View Tag
  console.log("\n1. Recipient checks 'View Tag' to see if this is for them:");
  console.log("   Formula: Recipient_Viewing_PrivKey * Ephemeral_PubKey");
  
  const sharedSecret = computeSharedSecret(recipientKeys.viewingPrivKey, announcement.ephemeralPubKey);
  console.log(`   Re-computed Shared Secret (S): ${sharedSecret}`);
  
  const hashedSharedSecret = keccak256(hexToBytes(sharedSecret));
  const calculatedViewTag = hexToBytes(hashedSharedSecret)[0];
  console.log(`   Calculated View Tag: ${calculatedViewTag}`);

  if (calculatedViewTag !== announcement.viewTag) {
    console.log("   [X] View Tag Mismatch! Ignoring transaction.");
    return;
  }
  console.log("   [✓] View Tag Match! This transaction is for us.");
  await sleep(1500);

  // 2. Derive Stealth Private Key
  console.log("\n2. Recipient derives the 'Stealth Private Key' to spend funds:");
  console.log("   Formula: Recipient_Spending_PrivKey + Hashed_Secret (mod curve order)");
  
  const s_scalar = BigInt(hashedSharedSecret);
  const d_spending = BigInt(recipientKeys.spendingPrivKey);
  
  const d_stealth_big = (d_spending + s_scalar) % CURVE_ORDER;
  const d_stealth = `0x${d_stealth_big.toString(16).padStart(64, '0')}` as Hex;
  
  console.log(`   Recipient Spending PrivKey: ${recipientKeys.spendingPrivKey}`);
  console.log(`   Hashed Secret (scalar):     ${hashedSharedSecret}`);
  console.log(`   ------------------------------------------------------------------`);
  console.log(`   Stealth Private Key:        ${d_stealth} (THE KEY TO THE FUNDS)`);
  await sleep(1500);

  // 3. Verify Address
  const derivedAddress = privateKeyToAddress(d_stealth);
  console.log("\n3. Verification:");
  console.log(`   Derived Address from Key:   ${derivedAddress}`);
  console.log(`   Actual Stealth Address:     ${announcement.stealthAddress}`);

  if (derivedAddress.toLowerCase() === announcement.stealthAddress.toLowerCase()) {
    console.log("\n   [SUCCESS] The derived key controls the stealth address!");
  } else {
    console.error("\n   [FAILURE] Something went wrong.");
  }
}

async function main() {
  console.log("=== ERC-5564 Stealth Address Detailed Walkthrough ===\n");
  await sleep(500);

  // 1. Setup Recipient Keys
  const spendingPrivKey = generatePrivateKey();
  const viewingPrivKey = generatePrivateKey();
  const spendingPubKey = getPublicKey(spendingPrivKey);
  const viewingPubKey = getPublicKey(viewingPrivKey);

  const recipientKeys = { spendingPrivKey, viewingPrivKey, spendingPubKey, viewingPubKey };
  
  console.log("0. Recipient generates their 'Stealth Meta-Address' (Keys):");
  // Construct the full meta-address string
  const metaAddressString = `st:eth:${spendingPubKey}:${viewingPubKey}`;
  console.log(`   [String] Full Meta-Address: ${metaAddressString}`);
  console.log(`   [Private] Spending Key:     ${spendingPrivKey} (KEPT SECRET)`);
  console.log(`   [Private] Viewing Key:      ${viewingPrivKey}  (KEPT SECRET)`);
  console.log(`   [Public]  Spending Key:     ${spendingPubKey} (SHARED)`);
  console.log(`   [Public]  Viewing Key:      ${viewingPubKey}  (SHARED)`);
  
  // --- SCENARIO A: ENS Handle ---
  console.log("\n--- SCENARIO A: Using ENS Handle (alice.eth) ---");
  const ensHandle = "alice.eth";
  await registerKeys(ensHandle, spendingPubKey, viewingPubKey);
  await sleep(1000);
  
  // --- SCENARIO B: Raw Address ---
  console.log("\n--- SCENARIO B: Using Raw Address (0x123...) ---");
  const rawAddress = "0x1234567890123456789012345678901234567890"; // Mock Address
  await registerKeys(rawAddress, spendingPubKey, viewingPubKey);
  await sleep(1000);

  console.log("\n[NOTE] ERC-6538 Registry supports BOTH! You don't need ENS.");
  await sleep(2000);

  // 2. Sender Generates Stealth Address (using raw address to prove point)
  console.log("\n>>> Sender chooses to send to the RAW ADDRESS (No ENS required) <<<");
  const announcementData = await generateStealthAddress(rawAddress);

  // 3. Recipient Scans and Recovers
  await scanAndRecover(
    { 
      ephemeralPubKey: announcementData.ephemeralPubKey, 
      viewTag: announcementData.viewTag, 
      stealthAddress: announcementData.stealthAddress 
    },
    recipientKeys
  );
}

main().catch(console.error);

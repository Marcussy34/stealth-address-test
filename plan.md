# Plan: Stealth Address dApp (Sepolia)

This plan details the development of a frontend interface to interactively test and visualize the ERC-5564 Stealth Address protocol on the Sepolia testnet.

## 1. Project Overview

We will build a **Next.js** application with two main "personas" to simulate the full lifecycle:
1.  **Recipient Mode**: Setup keys, register in the registry, scan for incoming funds, and spend them.
2.  **Sender Mode**: Lookup a recipient, visualize the stealth address derivation, and send funds.

## 2. Tech Stack

*   **Framework**: Next.js (React)
*   **Styling**: Tailwind CSS (for a premium, "dark mode" aesthetic)
*   **Blockchain Interaction**: `wagmi` (React hooks) + `viem` (Low-level actions)
*   **Wallet Connect**: `RainbowKit` (Easy wallet connection & switching)
*   **Cryptography**: `@noble/secp256k1` (ECDH & Key generation)

## 3. Core Features & User Flow

### Phase 1: Setup & Configuration
*   Initialize Next.js project.
*   Configure `wagmi` with Sepolia testnet.
*   Add `RainbowKit` for wallet connection.

### Phase 2: Recipient - Registration (Account 1)
*   **Generate Keys**: Button to generate "Stealth Meta-Address" (Spending + Viewing keys) locally.
*   **Register**: Interact with **ERC-6538 Registry** (`0x6538...`) to register these keys.
    *   *Input*: User can optionally register a handle (if supported) or just map to their address.
*   **UI**: Show the generated keys and the registration status.

### Phase 3: Sender - Visualization & Sending (Account 2)
*   **Connect**: User switches to Account 2.
*   **Lookup**: Input Account 1's address (or handle) to fetch their Meta-Address from the Registry.
*   **Visualization (The "Educational Mode")**:
    *   Show step-by-step generation of Ephemeral Keys.
    *   Show the ECDH Shared Secret calculation.
    *   Show the View Tag generation.
    *   Show the final Stealth Address derivation.
*   **Send**: Button to send Sepolia ETH to the derived Stealth Address via the **ERC-5564 Announcer** (`0x5564...`).

### Phase 4: Recipient - Scanning & Recovery (Account 1)
*   **Connect**: User switches back to Account 1.
*   **Scan**: The app listens for `Announcement` events from the Announcer contract.
*   **Filter**: Auto-filter events using the View Tag (visualize this filtering process).
*   **Recover**: For matching tags, derive the **Stealth Private Key**.
*   **Dashboard**: Show "Stealth Balance" (ETH held by the stealth address).

### Phase 5: Spending (The "Stealth Wallet")
*   **Control**: Since the main wallet (Account 1) *cannot* sign for the stealth address, the app acts as a "mini-wallet".
*   **Action**: Allow the user to input a destination address and send the stealth funds.
*   **Implementation**: Use `viem` to create a local account instance from the *Recovered Stealth Private Key* to sign and broadcast the transaction.

## 4. Contract Addresses (Sepolia)

| Contract | Address |
| :--- | :--- |
| **ERC-5564 Announcer** | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` |
| **ERC-6538 Registry** | `0x6538E6bf4B0e2012814052775658d22ce5d6538` |

## 5. Implementation Roadmap

1.  **Scaffold Project**: `npx create-next-app@latest` + Install dependencies.
2.  **Wallet Setup**: Configure `wagmi` provider.
3.  **Component: Registry**: Build the registration UI.
4.  **Component: Sender**: Build the lookup and "Educational Visualization" UI.
5.  **Component: Scanner**: Build the event listener and key recovery logic.
6.  **Component: StealthWallet**: Build the transaction signer for recovered keys.

## 6. Visualization Details
To meet the requirement of "showing how everything is done":
*   Use a stepper UI (Step 1, Step 2, etc.).
*   Display the actual hex values of keys/secrets as they are generated.
*   Use animations (e.g., arrows connecting keys) to show how `A + B = C`.

# Local Phantom verification — AlphaOS Echo (no trading)

Use ONLY on your own Mac. The page runs on `127.0.0.1`, does not connect
to a hosted site and never asks for a private key or recovery phrase.

## Preconditions
- Phantom browser extension installed in your trusted browser.
- Phantom is set to public Solana account
  `8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ`.
- Node.js 22 and access to private GitHub repository `investlens/solana_alert`.

## Run locally (terminal)
```sh
git clone --branch fix/echo-unsigned-instruction-guard-20261030 \
  https://github.com/investlens/solana_alert.git
cd solana_alert
npm ci --ignore-scripts
node --import tsx scripts/echoVerifyPhantomWallet.ts
```
Open ONLY `http://127.0.0.1:43891/` on the computer with Phantom.
Review the exact displayed URL and expected public address. Click
"Connect Phantom and sign message", approve the **text message signature**
in Phantom, and expect "Ownership VERIFIED locally".

Close the terminal with Ctrl+C when finished.

## Safety and interpretation
- The signature is a one-time, 120-second, domain-separated message.
- It does not authorize transfer, swap or any on-chain transaction.
- No wallet secret or seed is entered into this page or ChatGPT.
- This local verification does not establish that the future Railway
  isolated signer has custody of the key. That requires an independent
  challenge FROM THAT SIGNER after its secure provisioning.
- Do NOT export/import a private key into the existing AlphaOS service.
- No automatic trading can occur merely because this check passes.
- This local tool keeps the proof in memory only; a browser success
  is not a remotely attested result, and does not enable anything.
- If the expected address is missing from Phantom, switch account;
  do NOT use a different wallet or change the pinned address silently.

## Troubleshooting
- "Extension not available": use the computer/browser with Phantom.
- "WALLET_MISMATCH": select the original Echo account in Phantom.
- Port busy: close other local verifier instances; don't expose server
  on a public interface as a workaround.
- Failed/expired challenge: click again for a new fresh challenge.

"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export default function ContractSearch({ compact = false }: { compact?: boolean }) {
  const [address, setAddress] = useState(""); const [chain, setChain] = useState("auto"); const [error, setError] = useState("");
  const router = useRouter();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const token = address.trim();
    const evm = /^0x[a-fA-F0-9]{40}$/.test(token), solana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token);
    if (!evm && !solana) { setError("Enter a complete EVM or Solana token contract address."); return; }
    if (evm && chain === "auto") { setError("Select Robinchain or ARC. An EVM address alone cannot identify its chain."); return; }
    if ((chain === "solana" && !solana) || (["robinhood", "arc"].includes(chain) && !evm)) { setError("The address format does not match the selected chain."); return; }
    setError(""); router.push(`/intelligence/${encodeURIComponent(token)}?chain=${chain === "auto" ? "solana" : chain}`);
  }
  return <form onSubmit={submit} className={`contract-search ${compact ? "compact" : ""}`}><label className="sr-only" htmlFor="research-contract">Token contract address</label><input id="research-contract" value={address} onChange={e => setAddress(e.target.value)} placeholder="Paste token contract address" autoComplete="off" spellCheck={false} required aria-describedby={error ? "contract-error" : undefined}/><label className="sr-only" htmlFor="research-chain">Chain</label><select id="research-chain" value={chain} onChange={e => setChain(e.target.value)}><option value="auto">Stored chain</option><option value="robinhood">Robinchain</option><option value="arc">ARC</option><option value="solana">Solana</option></select><button className="alpha-button-primary" type="submit">Research →</button>{error && <p id="contract-error" role="alert" className="negative">{error}</p>}</form>;
}

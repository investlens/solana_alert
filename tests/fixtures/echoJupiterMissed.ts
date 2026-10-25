/** Real audit evidence. CANDIDATE classification only; requires full instruction-level replay. */
export const echoJupiterAuditFixtures = [
  {
    "caller": "Thedetective",
    "signature": "4BY6YAqTqLcfjdgzqCdyW5FBvarXstEvGabG92srBMTDXv74P1sNKZTkk757twNyuTVe1EeAZgwPYg1Jdi2dr9KL",
    "side": "BUY",
    "usdcRaw": "-250315906",
    "tokenRaw": "33449652888687",
    "mint": "Dy4AE8VuQDaj85XT6KQ2pQnrjBB4ozVwjZaZaXeapump"
  },
  {
    "caller": "Thedetective",
    "signature": "5VLtCmBFjXvRqXQuEkt2o5BcNWgQPwzfJmAPqtER4M1zJWxBgBkByABdZyqEKxbwqScPKnzPvsRb5XMiA8Wbtw5M",
    "side": "SELL",
    "usdcRaw": "442149200",
    "tokenRaw": "-34711994406639",
    "mint": "EdkG1SWrVRS5g4x8iLuoXhpybnWPtCu5akT3yYQZ4b9d"
  },
  {
    "caller": "Chairman",
    "signature": "sphUeosyBZpnbmELz6yFxLtkUaERJmAwLcRuvHDpSKPNeZu3Sch9DiSNTwSepn1YoQ8pLaGvJFqpSYGRQBPn5PU",
    "side": "BUY",
    "usdcRaw": "-200316006",
    "tokenRaw": "54456553192781",
    "mint": "CoPnRELkWds5kPHxx14Qf8f3GewwVbaNeNHKGHDSpump"
  }
] as const;
export const ECHO_JUPITER_V6='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

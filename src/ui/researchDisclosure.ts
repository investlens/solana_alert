/** Presentation only. Never changes eligibility, execution or delivery policy. */
export const RESEARCH_DISCLOSURE = '<i>Research only — not a buy/sell signal. AlphaOS provides information for your own analysis. Verify current data and risks independently; returns are not guaranteed.</i>';
export function withResearchDisclosure(text: string): string {
  return text.includes(RESEARCH_DISCLOSURE) ? text : `${text.trimEnd()}\n\n${RESEARCH_DISCLOSURE}`;
}

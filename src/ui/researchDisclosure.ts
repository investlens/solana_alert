/** Presentation only. Never changes eligibility, execution or delivery policy. */
export const RESEARCH_DISCLOSURE = '<i>Research only — not a buy/sell signal. Verify data and risks; returns are not guaranteed.</i>';
export const TRADE_SETUP_DISCLOSURE = '<i>Research only · Entry unconfirmed · DYOR · Returns not guaranteed.</i>';
export function withResearchDisclosure(text: string): string {
  if(text.includes('TRADE SETUP WATCH'))return text.includes(TRADE_SETUP_DISCLOSURE)?text:text.replace(RESEARCH_DISCLOSURE,'').trimEnd()+'\n\n'+TRADE_SETUP_DISCLOSURE;
  return text.includes(RESEARCH_DISCLOSURE) ? text : `${text.trimEnd()}\n\n${RESEARCH_DISCLOSURE}`;
}

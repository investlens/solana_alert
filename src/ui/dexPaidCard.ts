import { buildPromotionEventCard, type PromotionCardArgs } from './promotionEventCard.js';
export function buildDexPaidEventCard(args:Omit<PromotionCardArgs,'kind'>) {
 return buildPromotionEventCard({...args,kind:'DEX_PAID'});
}

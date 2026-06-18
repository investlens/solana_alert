import { supabase } from '../services/supabase.js';

export async function saveClosedAutoTrade(trade: {
 token:string;
 symbol:string;
 mode:string;
 amountSol:number;
 entryPrice:number;
 highestPrice:number;
 exitPrice:number;
 finalRoi:number;
 pnlSol:number;
 exitValueSol:number;
 openedAt:number;
 closedAt:number;
}){

 const {error}=await supabase
 .from('auto_trades')
 .insert({
   token:trade.token,
   symbol:trade.symbol,
   mode:trade.mode,
   amount_sol:trade.amountSol,
   entry_price:trade.entryPrice,
   highest_price:trade.highestPrice,
   exit_price:trade.exitPrice,
   final_roi:trade.finalRoi,
   pnl_sol:trade.pnlSol,
   exit_value_sol:trade.exitValueSol,
   opened_at:new Date(
     trade.openedAt
   ).toISOString(),
   closed_at:new Date(
     trade.closedAt
   ).toISOString(),
 });

 if(error) throw error;
}

export async function fetchAutoTradeStats(){

 const {data,error}=await supabase
  .from('auto_trades')
  .select('*')
  .order('closed_at',{
   ascending:false
  })
  .limit(50);

 if(error) throw error;

 return data||[];
}
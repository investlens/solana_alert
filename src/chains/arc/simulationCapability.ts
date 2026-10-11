import {encodeFunctionData,parseAbi,toHex,type Address} from 'viem';
const USDC='0x3600000000000000000000000000000000000000';
const ERC20=parseAbi(['function balanceOf(address) view returns(uint256)']);
export function arcFundingProbe(wallet:Address,recipient:Address){
 const read=(address:Address)=>({from:wallet,to:USDC,data:encodeFunctionData({abi:ERC20,functionName:'balanceOf',args:[address]}),gas:'0xf4240',gasPrice:'0x0'});
 return [{blockStateCalls:[{stateOverrides:{[wallet]:{balance:toHex(100n*10n**18n)},[recipient]:{balance:'0x0'}},calls:[read(wallet),{from:wallet,to:recipient,value:toHex(10n**18n),data:'0x',gas:'0xf4240',gasPrice:'0x0'},read(wallet),read(recipient)]}],validation:false},'latest'];
}
export function validateArcFundingProbe(chainId:unknown,result:any):boolean {
 try{
  if(BigInt(String(chainId))!==5042n||!Array.isArray(result)||result.length!==1)return false;
  const calls=result[0].calls;if(!Array.isArray(calls)||calls.length!==4||calls.some(c=>c.status!=='0x1'||c.error))return false;
  const balance=(i:number)=>/^0x[a-f0-9]{64}$/i.test(calls[i].returnData)?BigInt(calls[i].returnData):null;
  return balance(0)===100_000_000n&&balance(2)===99_000_000n&&balance(3)===1_000_000n;
 }catch{return false;}
}

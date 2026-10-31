/** LOCAL-ONLY Phantom ownership verifier, never a signer.
 * Run manually on a trusted machine with Phantom browser extension installed.
 * No DB, no wallet secret, no persistence; a successful check proves only that
 * Phantom can sign on this machine, NOT that a server can trade automatically.
 */
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {ECHO_EXPECTED_EXECUTION_WALLET} from '../src/echo/executionWallet.js';
import {makeEchoWalletOwnershipMessage,verifyEchoWalletOwnershipProof,
 type EchoWalletChallenge} from '../src/echo/walletOwnershipProof.js';
const HOST='127.0.0.1', PORT=43891, AUDIENCE='echo-local-ownership';
const ORIGIN='http://127.0.0.1:'+PORT;
let outstanding:EchoWalletChallenge|null=null;
const respond=(res:ServerResponse,code:number,data:unknown)=>{
 res.writeHead(code,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(JSON.stringify(data));
};
async function body(req:IncomingMessage){
 let text='';
 for await(const part of req){
  text+=part.toString('utf8');
  if(text.length>2048)throw Error('REQUEST_TOO_LARGE');
 }
 return JSON.parse(text) as Record<string,unknown>;
}
export function startEchoLocalOwnershipVerifier() {
 const server=createServer(async(req,res)=>{
  if(req.url==='/'&&req.method==='GET'){
   try{
    const path=resolve(dirname(fileURLToPath(import.meta.url)),'../assets/echo-phantom-ownership.html');
    const html=await readFile(path,'utf8');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8',
      'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'cache-control':'no-store','x-frame-options':'DENY',
      'x-content-type-options':'nosniff'});
    res.end(html);
   }catch{respond(res,500,{reason:'PAGE_UNAVAILABLE'});}
   return;
  }
  if(req.method!=='POST'||!['/ownership/challenge','/ownership/verify'].includes(req.url??'')){
   respond(res,404,{reason:'UNKNOWN_PATH'});return;
  }
  if(req.headers.origin!==ORIGIN||req.headers['content-type']?.split(';')[0]!=='application/json'){
   respond(res,403,{reason:'INVALID_LOCAL_ORIGIN'});return;
  }
  try {
   const input=await body(req);
   if(req.url==='/ownership/challenge'){
    if(input.wallet!==ECHO_EXPECTED_EXECUTION_WALLET){
     respond(res,403,{reason:'WALLET_MISMATCH'});return;
    }
    const now=Date.now();
    outstanding={wallet:ECHO_EXPECTED_EXECUTION_WALLET,
      nonceHex:randomBytes(32).toString('hex'),issuedAtMs:now,
      expiresAtMs:now+120000,audience:AUDIENCE};
    respond(res,200,{nonceHex:outstanding.nonceHex,
      message:makeEchoWalletOwnershipMessage(outstanding)});
    return;
   }
   const challenge=outstanding;
   if(!challenge||input.nonceHex!==challenge.nonceHex||
      typeof input.signatureBase58!=='string'||input.signatureBase58.length>100){
    respond(res,403,{reason:'NO_VALID_CHALLENGE'});return;
   }
   // Consume challenge on the first attempt, including failed signatures;
   // a new challenge must be freshly generated to try again.
   outstanding=null;
   const verified=verifyEchoWalletOwnershipProof({
    challenge,signatureBase58:input.signatureBase58,
    nowMs:Date.now(),expectedAudience:AUDIENCE,nonceAlreadyConsumed:false
   });
   respond(res,verified?200:403,verified?{verified:true,wallet:challenge.wallet}:
    {verified:false,reason:'SIGNATURE_INVALID_OR_EXPIRED'});
  }catch{respond(res,400,{reason:'INVALID_REQUEST'});}
 });
 server.listen(PORT,HOST,()=>process.stdout.write(
  'Local Echo ownership verifier: '+ORIGIN+'\nNo signer, no wallet access, no trading.\n'));
 return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 startEchoLocalOwnershipVerifier();

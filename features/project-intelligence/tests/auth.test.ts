import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {telegramUser} from '../auth.js';import {isPro,ResearchService} from '../service.js';
const time=1800000000000,token='test-token';
function signed(user=123){const p=new URLSearchParams({auth_date:String(time/1000),query_id:'test',user:JSON.stringify({id:user})});const secret=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',secret).update([...p.entries()].sort().map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));return p.toString();}
test('Telegram identity is authenticated, fresh and not caller asserted',()=>{
 assert.equal(telegramUser(signed(),token,time),'123');
 for(const data of [signed().replace('123','456'),signed()+'&user=123',signed().replace('hash=','hash=ab')])assert.throws(()=>telegramUser(data,token,time));
 assert.throws(()=>telegramUser(signed(),token,time+16*60000));assert.throws(()=>telegramUser(signed(),'wrong-token',time));
});
test('only active server-side Pro or admin membership grants access, independent of tester-mode capabilities',()=>{
 assert.equal(isPro({telegram_id:'1',tier:'free'},time),false);
 assert.equal(isPro({telegram_id:'1',tier:'paid',subscription_status:'active',paid_active_until:new Date(time+1).toISOString()},time),true);
 for(const member of [{telegram_id:'1',tier:'pro'},{telegram_id:'1',tier:'paid',subscription_status:'active',paid_active_until:new Date(time-1).toISOString()},{telegram_id:'1',tier:'admin',is_blocked:true}])assert.equal(isPro(member,time),false);
});
test('cached reports cannot bypass membership rechecks and returned data cannot mutate shared cache',async()=>{
 let pro=true,builds=0;const report:any={chain:'robinhood',token:'0x'+'a'.repeat(40),findings:[]};
 const service=new ResearchService({member:async id=>({telegram_id:id,tier:pro?'admin':'free'}),build:async()=>{builds++;return report;}});
 const a=await service.report('1','robinhood',report.token);a.findings.push({id:'fake',section:'identity',quality:'UNVERIFIED',severity:'UNKNOWN',summary:'test',evidence:[]});assert.equal((await service.report('1','robinhood',report.token)).findings.length,0);assert.equal(builds,1);
 pro=false;await assert.rejects(service.report('1','robinhood',report.token),/Pro/);assert.equal(builds,1);
});

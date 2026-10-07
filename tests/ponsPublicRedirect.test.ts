import test from 'node:test';import assert from 'node:assert/strict';
import {isSamePonsLaunchRedirect,fetchPublicHtml} from '../src/chains/robinhood/ponsPublicContext.js';
const token='0x'+'a'.repeat(40),url='https://www.ponsfamily.com/launchpad/'+token;
test('PONS redirects only permit same exact token on official HTTPS host aliases',()=>{
 assert.equal(isSamePonsLaunchRedirect(url,'https://ponsfamily.com/launchpad/'+token+'/'),true);
 for(const target of ['https://evil.example/launchpad/'+token,'http://ponsfamily.com/launchpad/'+token,'https://ponsfamily.com/launchpad/0x'+'b'.repeat(40),'https://user@ponsfamily.com/launchpad/'+token,'https://ponsfamily.com:444/launchpad/'+token])assert.equal(isSamePonsLaunchRedirect(url,target),false);
});
test('bounded fetch follows safe redirect but refuses foreign redirects and loops',async()=>{
 let calls=0;const request=async()=>++calls===1?new Response(null,{status:307,headers:{location:'https://ponsfamily.com/launchpad/'+token}}):new Response('<html>ok</html>',{headers:{'content-type':'text/html'}});
 assert.equal(await fetchPublicHtml(url,request as typeof fetch),'<html>ok</html>');assert.equal(calls,2);
 calls=0;assert.equal(await fetchPublicHtml(url,(async()=>{calls++;return new Response(null,{status:307,headers:{location:url}});}) as typeof fetch),null);assert.equal(calls,3);
 assert.equal(await fetchPublicHtml('https://t.me/project',(async()=>new Response(null,{status:302,headers:{location:'https://t.me/other'}})) as typeof fetch),null);
});

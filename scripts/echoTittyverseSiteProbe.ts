/** One-time bounded source discovery; no periodic scrape, RPC, tokens or trade.
 * Reports only public asset paths and whether exact known mints appear in page.
 */
const site='https://tittyverse.fun/';
const roots=[
 'C5xph2yL6gMdxmuLGxJBkGpmuDFfyi5fqkBNhvL6pump',
 'BDTixhrJpvpqAWyh3GCg4YpToo14bsKyKXuSjTx8pump'
];
const response=await fetch(site,{headers:{accept:'text/html'},signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error('SITE_UNAVAILABLE_'+response.status);
const contentType=response.headers.get('content-type')??'';
if(!contentType.includes('text/html'))throw Error('UNEXPECTED_CONTENT_TYPE');
const html=await response.text();
if(html.length>900_000)throw Error('PAGE_TOO_LARGE');
const assetPaths=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
 .map(m=>m[1]).filter(path=>path.startsWith('/')&&path.length<240).slice(0,8);
const dataPaths=[...html.matchAll(/(?:href|src)=["']([^"']+\.(?:json|csv))["']/g)]
 .map(m=>m[1]).filter(path=>path.startsWith('/')&&path.length<240).slice(0,8);
console.log('TITTYVERSE_SOURCE_AUDIT',JSON.stringify({
 status:response.status,bytes:html.length,
 rootMintPresentInHtml:html.includes(roots[0]),taoMintPresentInHtml:html.includes(roots[1]),
 assetPaths,dataPaths,
 singleRequest:true,noAutomatedCollection:true
}));

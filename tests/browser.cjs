const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const {PNG}=require('pngjs');
const playwright = require('playwright');
const engine = playwright[process.env.BROWSER || 'chromium'];
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results');fs.mkdirSync(out,{recursive:true});
const fixture = require('./fixtures.cjs');
const svgs = {
 '1': '<path d="M80 70Q140 25 200 70L210 255H70Z" fill="#283b4b"/><path d="M115 55V35Q140 15 165 35V55" stroke="#263747" fill="none" stroke-width="10"/><rect x="85" y="155" width="110" height="75" rx="10" fill="#41566a"/><rect x="119" y="94" width="42" height="28" rx="4" fill="#c6ac85"/>',
 '2': '<path d="M60 170V125C60 15 220 15 220 125V170" stroke="#20272d" stroke-width="25" fill="none"/><rect x="35" y="145" width="65" height="110" rx="28" fill="#40494f"/><rect x="180" y="145" width="65" height="110" rx="28" fill="#40494f"/>',
 '3': '<path d="M95 50L45 80 18 145 70 167 83 134V265H197V134L210 167 262 145 235 80 185 50Q140 98 95 50Z" fill="#c88f72"/><path d="M110 54Q140 78 170 54" fill="none" stroke="#a66f55" stroke-width="9"/>',
 '4': '<rect x="110" y="10" width="60" height="280" rx="15" fill="#a8805e"/><circle cx="140" cy="150" r="72" fill="#dfc58a"/><circle cx="140" cy="150" r="61" fill="#203b36"/><path d="M140 150L115 120M140 150L174 140" stroke="#e8ddbf" stroke-width="6" stroke-linecap="round"/>'
};
function illustration(id) {return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="300" viewBox="0 0 280 300">${svgs[id]||svgs['1']}</svg>`;}
const server = http.createServer((req,res)=>{
    const name = new URL(req.url,'http://localhost').pathname;
    const file = path.join(root,name==='/'?'index.html':decodeURIComponent(name));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'text/plain';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(fs.readFileSync(file));
});
let browser;
let checks=0;
function check(value,message){assert(value,message);checks++;console.log('PASS',message);}
async function prepare(context, responder=()=>fixture){
    await context.route('https://fakestoreapi.com/products',async route=>{
        const body=await responder();
        if(body==='FAIL')return route.fulfill({status:503,contentType:'application/json',body:'{}'});
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    await context.route('https://fakestoreapi.com/img/**',route=>{
        const id=route.request().url().split('/').pop().split('.')[0];
        return route.fulfill({status:id==='broken'?404:200,contentType:'image/svg+xml',body:id==='broken'?'':illustration(id)});
    });
}
async function ready(page,url){await page.goto(url);await page.waitForFunction(()=>window.MyShop?.getCatalogSource()==='live');}
async function add(page,id){await page.locator(`.add-to-cart[data-product-id="${id}"]`).click();}
async function cart(page){await page.locator('.cart').click();await page.locator('.popup').waitFor({state:'visible'});}
async function main(){
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${server.address().port}/`;
    browser=await engine.launch(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu']} : {headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await prepare(context);
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await ready(page,url);
    check(await page.locator('.product-card').count()===9,'valid products rendered');
    check(await page.locator('.product-card img[src="x"]').count()===0,'API text is not parsed as HTML');
    await page.locator('.product-card').filter({hasText:'Image unavailable sample'}).scrollIntoViewIfNeeded();
    await page.locator('.image-unavailable').first().waitFor();check(true,'broken image fallback');
    await page.locator('.logo').click();await page.waitForTimeout(550);
    const d1=await page.locator('.sr-suspension').evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(300);const d2=await page.locator('.sr-suspension').evaluate(el=>getComputedStyle(el).transform);check(d1!==d2,'rope swings on initial display');const idlePath=await page.locator('.sr-cable > path').getAttribute('d');await page.waitForTimeout(120);check(idlePath===await page.locator('.sr-cable > path').getAttribute('d'),'idle rope does not rewrite SVG geometry');
    await page.screenshot({path:out+'/shop-desktop.png',fullPage:true});
    for(const width of [390,1440]){
        await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
        const samples=await page.evaluate(()=>['.hero-subtitle','.hero-description'].map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();const item={selector,x:r.x,y:r.y,width:r.width,height:r.height,color:getComputedStyle(el).color};el.style.visibility='hidden';return item;}));
        const png=PNG.sync.read(await page.screenshot());
        function luminance(rgb){return rgb.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);}
        for(const item of samples){let minimum=100;const fg=luminance(item.color.match(/[0-9.]+/g).slice(0,3).map(Number));for(let y=1;y<=4;y++)for(let x=1;x<=8;x++){const px=Math.floor(item.x+item.width*x/9),py=Math.floor(item.y+item.height*y/5);const index=(py*png.width+px)*4;const bg=luminance([...png.data.slice(index,index+3)]);minimum=Math.min(minimum,(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05));}check(minimum>=4.5,`hero contrast ${item.selector} at ${width}px: ${minimum.toFixed(2)}:1`);}
        await page.evaluate(()=>document.querySelectorAll('.hero-subtitle,.hero-description').forEach(el=>el.style.visibility=''));
    }

    await page.locator('#search').fill('men');const men=await page.locator('.product-card h3').allTextContents();check(!men.some(title=>title.includes('Women'))&&men.some(title=>title.includes('Mens')),'search men excludes women and matches mens');
    await page.locator('#search').fill('jacket mens');check(await page.locator('.product-card').count()===1,'search tokens match in either order');await page.locator('#search').fill('');
    await page.locator('.sr-handle').focus();await page.keyboard.press('Enter');await page.locator('.sr-result').waitFor({state:'visible'});await page.waitForTimeout(750);check(await page.locator('.sr-handle').evaluate(el=>el===document.activeElement),'keyboard rope reveal retains focus');
    await page.locator('.sr-motion').click();await page.locator('.sr-motion').click();

    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
    const accessibility=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});console.log('ACCESSIBILITY',JSON.stringify(accessibility));const incomplete=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});fs.writeFileSync(path.join(out,'accessibility-review.json'),JSON.stringify({violations:accessibility,requiresManualReview:incomplete},null,2));check(accessibility.length===0,'automated accessibility checks on catalog');
    await page.locator('#search').fill('headphones');check(await page.locator('.product-card').count()===1,'search products');
    await page.locator('#category').selectOption('clothing');check(await page.locator('.empty-state').isVisible(),'combined filters empty state');
    await page.locator('.reset-filters').click();await page.locator('#sort').selectOption('price-low');
    check((await page.locator('.product-card .product-price').allTextContents())[0]==='$12.50','price sorting');
    await page.locator('.view-details[data-product-id="1"]').click();check(await page.locator('.product-dialog').isVisible(),'full product details modal');
    check(await page.locator('.sr-suspension').evaluate(el=>el.getAnimations()[0].playState)==='paused','rope pauses behind product modal');
    await page.keyboard.press('Escape');await page.locator('.product-dialog').waitFor({state:'hidden'});
    check(await page.locator('.view-details[data-product-id="1"]').evaluate(el=>el===document.activeElement),'details restore keyboard focus');
    await page.locator('.logo').click();await page.waitForTimeout(350);
    const box=await page.locator('.sr-handle').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+100,{steps:8});await page.mouse.up();
    await page.locator('.sr-result').waitFor({state:'visible'});await page.waitForTimeout(1000);
    const pick=await page.locator('.sr-result h2').textContent();check(!!pick,'pull reveals an actual catalog product');
    await page.locator('.sr-add').click();check(await page.locator('.counter').textContent()==='1','rope product adds to cart');
    await page.locator('.sr-handle').click({force:true});await page.waitForTimeout(1150);check(pick!==await page.locator('.sr-result h2').textContent(),'no consecutive repeat');
    await page.screenshot({path:out+'/shop-rope.png'});
    await cart(page);await page.locator('.clear-cart').click();check(await page.locator('.popup').isVisible(),'clearing preserves cart popover');await page.locator('.empty-cart').click();check(await page.locator('.popup').isVisible(),'clicking nonfocusable content keeps cart open');await page.locator('.close-popup').click();
    await add(page,1);await add(page,1);await cart(page);
    check(await page.locator('.quantity-value').textContent()==='2','cart aggregates quantity');
    check(await page.locator('.total-price').textContent()==='$99.80','cart total in cents');
    await page.locator('.quantity-button[data-action="decrease"]').click();check(await page.locator('.quantity-value').textContent()==='1','decrease quantity');
    check(await page.locator('.quantity-button[data-action="decrease"]').evaluate(el=>el===document.activeElement),'quantity edit restores focus');
    await page.locator('.quantity-button[data-action="increase"]').click();await page.reload();await page.waitForFunction(()=>window.MyShop?.getCatalogSource()==='live');
    check(await page.locator('.counter').textContent()==='2','cart survives reload');
    await cart(page);await page.locator('.checkout-button').click();check(await page.locator('.checkout-screen').isVisible(),'checkout opens');
    await page.locator('#customer-name').fill('Rami');await page.locator('#customer-email').fill('rami@example.test');await page.locator('#card-number').fill('4242 4242 4242 4242');await page.locator('#card-expiry').fill('12/30');await page.locator('#card-cvv').fill('123');
    await page.waitForTimeout(300);const draft=await page.evaluate(()=>sessionStorage.getItem('customerDraft'));check(draft.includes('Rami')&&!draft.includes('4242')&&!draft.includes('123'),'session draft excludes card details');
    await page.locator('.back-to-shop').click();await cart(page);await page.locator('.checkout-button').click();
    check(await page.locator('#customer-name').inputValue()==='Rami','name restored when reopening');check(await page.locator('#card-number').inputValue()==='','card cleared on closing checkout');
    await page.reload();await page.waitForFunction(()=>window.MyShop?.getCatalogSource()==='live');await cart(page);await page.locator('.checkout-button').click();
    check(await page.locator('#customer-email').inputValue()==='rami@example.test','session draft survives refresh');
    await page.locator('#card-number').fill('4242424242424242');await page.locator('#card-expiry').fill('01/20');await page.locator('#card-cvv').fill('123');await page.locator('#confirm-order').check();await page.locator('.place-order-button').click();
    check(!await page.locator('.checkout-success').isVisible(),'expired card blocks demo confirmation');
    await page.locator('#card-expiry').fill('12/30');await page.screenshot({path:out+'/shop-checkout.png',fullPage:true});await page.locator('.place-order-button').click();
    check(await page.locator('.checkout-success').isVisible(),'valid demo checkout succeeds');
    check(await page.locator('.checkout-total').textContent()==='$99.80','receipt keeps confirmed order total');
    check(await page.locator('.counter').textContent()==='0','successful checkout clears cart');check(await page.evaluate(()=>!!localStorage.getItem('shopLastReceiptV2')),'receipt persisted before cart clearing');
    check(await page.evaluate(()=>sessionStorage.getItem('customerDraft'))===null,'successful checkout clears session draft');
    check(await page.locator('#card-number').inputValue()==='','successful checkout clears card input');
    await page.locator('.continue-shopping').click();
    await page.locator('#sort').selectOption('default');await add(page,1);
    const second=await context.newPage();await ready(second,url);await cart(second);await second.locator('.quantity-button[data-action="increase"]').click();
    await page.waitForFunction(()=>document.querySelector('.counter').textContent==='2');check(true,'cart synchronizes between tabs');
    await second.close();
    await page.evaluate(()=>localStorage.setItem('shopCart',JSON.stringify([{id:1,title:'Old',price:1,image:'https://fakestoreapi.com/img/1.svg',quantity:10000},{id:1,title:'Old',price:1,image:'https://fakestoreapi.com/img/1.svg',quantity:1},{id:999,title:'Removed product',price:2,image:'',quantity:1}])));
    await page.reload();await page.waitForFunction(()=>window.MyShop?.getCatalogSource()==='live');await cart(page);
    check((await page.locator('.quantity-value').allTextContents()).includes('99'),'stored quantities capped');
    check(await page.locator('.cart-item').count()===2,'stored duplicate ids merged');
    check((await page.locator('.cart-item h3').allTextContents())[0]==='Everyday Canvas Backpack','saved cart metadata refreshed');
    check(await page.locator('.checkout-button').isDisabled(),'unavailable item blocks checkout');check(await page.locator('.price-change-note').first().isVisible(),'price changes are visible');
    await page.locator('.remove-item[data-product-id="999"]').click();check(await page.locator('.checkout-button').isDisabled(),'price acceptance required before checkout');await page.locator('.popup .accept-prices').click();check(!await page.locator('.checkout-button').isDisabled(),'accepting updated prices permits checkout');
    await page.locator('.clear-cart').click();check(await page.locator('.empty-cart').isVisible(),'clear cart empty state');await page.locator('.close-popup').click();
    for(const width of [320,375,480,768,1024,1440]){
        await page.setViewportSize({width,height:960});await page.locator('.logo').click();await page.waitForTimeout(100);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal page overflow at ${width}px`);
        await page.locator('.nav-links a[href="#products"]').click();await page.waitForTimeout(550);
        check(Math.abs((await page.locator('.site-header').boundingBox()).y)<1,`sticky header at ${width}px`);
        if(width===375){check((await page.locator('.surprise-rope').boundingBox()).height<=260,'mobile rope is compact');}if(width===375)await page.screenshot({path:out+'/shop-mobile.png',fullPage:true});
    }
    await page.setViewportSize({width:375,height:900});await add(page,1);await cart(page);await page.locator('.checkout-button').click();
    check(await page.evaluate(()=>document.querySelector('.checkout-screen').scrollWidth<=innerWidth),'mobile checkout contains its table overflow');
    await page.screenshot({path:out+'/shop-mobile-checkout.png'});
    await page.keyboard.press('Escape');
    const rp=await context.newPage();await rp.emulateMedia({reducedMotion:'reduce'});await ready(rp,url);
    const rd=await rp.locator('.sr-cable > path').getAttribute('d');await rp.waitForTimeout(200);check(rd===await rp.locator('.sr-cable > path').getAttribute('d'),'reduced-motion preference honored');
    check(await rp.locator('.sr-motion').isDisabled(),'reduced-motion control is explicit');await rp.locator('.sr-handle').click();await rp.locator('.sr-result').waitFor({state:'visible'});check(true,'reduced-motion reveal stays functional');await rp.close();
    const fp=await context.newPage();let attempts=0;
    await fp.route('https://fakestoreapi.com/products',route=>route.fulfill({status:++attempts===1?503:200,contentType:'application/json',body:JSON.stringify(fixture)}));
    await fp.goto(url);await fp.locator('.catalog-message').waitFor({state:'visible'});await fp.waitForFunction(()=>window.MyShop?.getCatalogSource()==='live');check(true,'automatic retry recovers a transient HTTP failure');await fp.waitForFunction(()=>window.MyShop?.getCatalogSource()==='live');check(await fp.locator('.product-card').count()===9,'retry recovers product loading');await fp.close();
    const tp=await context.newPage();await tp.addInitScript(()=>{const original=window.setTimeout;window.setTimeout=(callback,ms,...args)=>original(callback,ms===6000?40:ms,...args)});
    await tp.route('https://fakestoreapi.com/products',async route=>{await new Promise(resolve=>setTimeout(resolve,200));await route.abort().catch(()=>{})});
    await tp.goto(url);await tp.waitForTimeout(650);check(await tp.locator('.product-card').count()>0,'request timeout retains usable backup catalog');check(await tp.locator('.catalog-message').isVisible(),'backup catalog source is disclosed');await tp.close();
    const bp=await context.newPage();await bp.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage blocked','QuotaExceededError')}});await ready(bp,url);const before=Number(await bp.locator('.counter').textContent());await add(bp,1);await cart(bp);check(await bp.locator('.storage-message').isVisible(),'blocked storage shows visible feedback');check(Number(await bp.locator('.counter').textContent())===before+1,'cart still works with storage blocked');await bp.close();
    await page.evaluate(()=>localStorage.setItem('shopCart','{broken json'));await page.reload();await page.waitForFunction(()=>window.MyShop?.getCatalogSource()==='live');check(await page.locator('.counter').textContent()==='0','corrupt stored cart recovers safely');
    await add(page,1);await cart(page);await page.locator('.checkout-button').click();
    let focusInside=true;for(let i=0;i<18;i++){await page.keyboard.press('Tab');focusInside=focusInside&&await page.evaluate(()=>document.querySelector('.checkout-screen').contains(document.activeElement));}check(focusInside,'checkout keyboard focus remains inside the dialog');
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
    const checkoutA11y=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});console.log('CHECKOUT ACCESSIBILITY',JSON.stringify(checkoutA11y));check(checkoutA11y.length===0,'automated accessibility checks on checkout');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>sessionStorage.removeItem('customerDraft'));
    await page.locator('.logo').click();await page.waitForTimeout(500);await cart(page);if(await page.locator('.clear-cart').isVisible())await page.locator('.clear-cart').click();await page.locator('.close-popup').click();
    await add(page,1);await cart(page);await page.locator('.cart-item h3').click();check(await page.locator('.popup').isVisible(),'clicking a cart title does not close the cart');await page.locator('.close-popup').click();
    await page.evaluate(()=>localStorage.removeItem('shopCatalogV2'));
    const offline=await context.newPage();await offline.route('https://fakestoreapi.com/products',route=>route.abort());await offline.goto(url);await offline.waitForTimeout(650);check(await offline.locator('.product-card').count()>0,'packaged catalog works with API completely unavailable');check(await offline.locator('.catalog-message').isVisible(),'offline prices are explicitly labelled');await offline.close();
    check(errors.length===0,`no uncaught browser errors: ${errors.join(', ')}`);
    console.log(`BROWSER CHECKS PASSED: ${checks}`);fs.writeFileSync(path.join(out,'browser-summary.json'),JSON.stringify({browser:process.env.BROWSER||'chromium',version:browser.version(),checks,uncaughtErrors:errors,fixtures:true},null,2));

}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
module.exports={server,prepare,ready,add,cart,fixture,engine,root,out,check,getCheckCount:()=>checks};

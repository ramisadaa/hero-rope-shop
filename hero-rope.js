/* Idle swing uses compositor animations. rAF runs only during the short release spring. */
(() => {
    "use strict";
    const stage = document.querySelector('.surprise-rope');
    const app = window.MyShop;
    if (!stage || !app) return;
    const handle = stage.querySelector('.sr-handle');
    const suspension = stage.querySelector('.sr-suspension');
    const scaled = stage.querySelector('.sr-scaled');
    const cable = stage.querySelector('.sr-cable > path');
    const result = stage.querySelector('.sr-result');
    const picture = stage.querySelector('.sr-picture');
    const image = picture.querySelector('img');
    const fallback = stage.querySelector('.sr-image-fallback');
    const title = result.querySelector('h2');
    const price = stage.querySelector('.sr-price');
    const status = stage.querySelector('.sr-status');
    const add = stage.querySelector('.sr-add');
    const motion = stage.querySelector('.sr-motion');
    const sparks = stage.querySelector('.sr-sparks');
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const effects = new Set();
    let selected = null, busy = false;
    const pickProduct = window.ShopCore.createShufflePicker();
    let inView = true, overlay = false, enabled = !preference.matches;
    let dragging = false, startX = 0, startY = 0, dx = 0, dy = 0, skipClickUntil = 0, springId = 0, revealNumber = 0;
    const idle = suspension.animate([{transform:'rotate(-5deg)'},{transform:'rotate(5deg)'},{transform:'rotate(-5deg)'}], {duration:2900,iterations:Infinity,easing:'ease-in-out'});
    const floating = picture.animate([{transform:'translateY(0)'},{transform:'translateY(-5px)'},{transform:'translateY(0)'}], {duration:3100,iterations:Infinity,easing:'ease-in-out'});

    function motionAllowed() { return enabled && !preference.matches; }
    function canMove() { return motionAllowed() && inView && !document.hidden && !overlay; }
    function syncMotion() {
        if (canMove() && !dragging && !springId) idle.play(); else idle.pause();
        if (canMove() && !result.hidden) floating.play(); else floating.pause();
        motion.textContent = preference.matches ? 'Reduced motion' : enabled ? 'Pause motion' : 'Resume motion';
        motion.disabled = preference.matches;
        motion.setAttribute('aria-pressed', String(!enabled || preference.matches));
        if (!inView || document.hidden || overlay || !motionAllowed()) {
            if (dragging) release(true);
            effects.forEach(animation => animation.finish()); // Never leave busy waiting offscreen.
            cancelAnimationFrame(springId); springId = 0; draw(0, 0);
        }
    }
    function setBusy(value) {
        busy = value;
        handle.setAttribute('aria-disabled', String(value)); // Keep keyboard focus on the handle.
        stage.setAttribute('aria-busy', String(value));
    }
    function animate(element, frames, duration) {
        const animation = element.animate(frames, {duration:canMove()?duration:1,easing:'cubic-bezier(.2,.8,.2,1)'});
        effects.add(animation);
        return animation.finished.catch(()=>{}).finally(()=>effects.delete(animation));
    }
    function draw(x,y) {
        cable.setAttribute('d',`M280 -10 Q${280+x*.35} ${58+y*.5} ${280+x} ${118+y}`);
        handle.style.transform=`translate3d(calc(-50% + ${x}px),${y}px,0) rotate(${-x/7}deg)`;
    }
    function preload(src) {
        if(!src) return Promise.resolve(false);
        return new Promise(resolve=>{
            const preview=new Image(); let done=false;
            const finish=value=>{if(!done){done=true;clearTimeout(timer);resolve(value);}};
            const timer=setTimeout(()=>finish(false),2200);
            preview.referrerPolicy='no-referrer';preview.onload=()=>finish(true);preview.onerror=()=>finish(false);preview.src=src;
        });
    }
    function burst() {
        sparks.replaceChildren();if(!canMove())return;
        for(let i=0;i<18;i++) {
            const dot=document.createElement('span');dot.className='sr-spark';sparks.appendChild(dot);
            const angle=i/18*Math.PI*2,radius=70+Math.random()*80;
            animate(dot,[{opacity:0,transform:'translate(0,0) scale(.3)'},{opacity:1,offset:.15},{opacity:0,transform:`translate(${Math.cos(angle)*radius}px,${Math.sin(angle)*radius}px) scale(.2)`}],900).then(()=>dot.remove());
        }
    }
    async function reveal() {
        if(busy)return;
        const products=app.getProducts();
        if(!products.length){status.textContent='No products available yet.';return;}
        setBusy(true);const sequence=++revealNumber;
        try {
            const product=pickProduct(products);const loaded=await preload(product.image);
            if(sequence!==revealNumber)return;
            if(!result.hidden)await animate(result,[{opacity:1,transform:'translateX(-50%) scale(1)'},{opacity:0,transform:'translateX(-50%) scale(.85)'}],160);
            selected=product;image.hidden=!loaded;fallback.hidden=loaded;
            if(loaded){image.src=product.image;image.referrerPolicy='no-referrer';}else image.removeAttribute('src');
            image.alt='';title.textContent=product.title;title.title=product.title;price.textContent=app.formatPrice(product.price);
            result.hidden=false;burst();
            await animate(result,[{opacity:0,transform:'translateX(-50%) translateY(35px) rotateY(-35deg) scale(.5)'},{opacity:1,transform:'translateX(-50%) translateY(-5px) rotateY(4deg) scale(1.02)',offset:.75},{opacity:1,transform:'translateX(-50%) scale(1)'}],650);
            status.classList.add("sr-only");
            status.textContent=`${product.title} — ${app.formatPrice(product.price)}`;
        } finally {setBusy(false);syncMotion();}
    }
    function catalogChanged() {
        const products=app.getProducts();
        if(selected&&!products.some(product=>product.id===selected.id)){selected=null;result.hidden=true;}
        if(selected){selected=products.find(product=>product.id===selected.id);price.textContent=app.formatPrice(selected.price);}
        else { status.classList.remove('sr-only'); status.textContent='Pull the rope. Find your next favorite.'; }
    }
    handle.addEventListener('pointerdown',event=>{
        if(busy||(event.pointerType==='mouse'&&event.button!==0))return;
        cancelAnimationFrame(springId);springId=0;dragging=true;startX=event.clientX;startY=event.clientY;dx=dy=0;idle.pause();handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{
        if(!dragging)return;
        const box=scaled.getBoundingClientRect();
        dx=Math.max(-35,Math.min(35,(event.clientX-startX)*360/box.width*.65));
        dy=Math.max(0,Math.min(100,(event.clientY-startY)*490/box.height*.8));draw(dx,dy);
    });
    function release(cancelled) {
        if(!dragging)return;dragging=false;
        if(dy>7||Math.abs(dx)>7||cancelled)skipClickUntil=performance.now()+400;
        const fire=!cancelled&&dy>38,x=dx,y=dy,start=performance.now();
        const tick=now=>{
            const t=Math.min((now-start)/650,1),k=Math.exp(-7*t)*Math.cos(15*t);
            draw(x*k,y*k);
            if(t<1&&canMove())springId=requestAnimationFrame(tick);else{springId=0;draw(0,0);syncMotion();}
        };
        if(canMove())springId=requestAnimationFrame(tick);else{draw(0,0);syncMotion();}
        if(fire)reveal();
    }
    handle.addEventListener('pointerup',()=>release(false));
    handle.addEventListener('pointercancel',()=>release(true));
    handle.addEventListener('lostpointercapture',()=>release(true));
    handle.addEventListener('click',()=>{if(performance.now()>=skipClickUntil&&!busy)reveal();});
    add.addEventListener('click',()=>{if(selected)app.addToCart(selected.id);});
    motion.addEventListener('click',()=>{enabled=!enabled;syncMotion();});
    preference.addEventListener('change',()=>{enabled=!preference.matches;syncMotion();});
    document.addEventListener('visibilitychange',syncMotion);
    document.addEventListener('shop:catalog',catalogChanged);
    document.addEventListener('shop:overlay',event=>{overlay=event.detail.active;syncMotion();});
    if('IntersectionObserver'in window)new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;syncMotion();}).observe(stage);
    function resize(){stage.style.setProperty('--stage-scale',Math.min(1,stage.getBoundingClientRect().width/360));}
    if('ResizeObserver'in window)new ResizeObserver(resize).observe(stage);else window.addEventListener('resize',resize);
    resize();catalogChanged();syncMotion();
})();

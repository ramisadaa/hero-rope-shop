const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
fs.mkdirSync(dist,{recursive:true});
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const file of ['catalog-data.js','store-core.js','script.js','hero-rope.js','style.css']){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const output=esbuild.transformSync(source,{loader:file.endsWith('.css')?'css':'js',minify:true,target:'es2020'}).code;
    const hash=crypto.createHash('sha256').update(output).digest('hex').slice(0,12);
    fs.writeFileSync(path.join(dist,file),output);
    html=html.replaceAll(new RegExp(file.replaceAll('.','\\.')+'\\?v=[^"\\s]+','g'),`${file}?v=${hash}`);
}
const siteUrl=process.env.SITE_URL;
if(siteUrl){const base=new URL(siteUrl);if(base.protocol!=='https:')throw Error('SITE_URL must use HTTPS');html=html.replaceAll('content="assets/social-preview.png"',`content="${new URL('assets/social-preview.png',base.href.endsWith('/')?base.href:base.href+'/')}"`);}
fs.writeFileSync(path.join(dist,'index.html'),html);
for(const file of ['assets','products.json','manifest.webmanifest','_headers'])fs.cpSync(path.join(root,file),path.join(dist,file),{recursive:true});
console.log('Built dist/ with minification and content-hash asset versions.');

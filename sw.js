const CACHE='signal-shell-v7';
const SHELL=['/','/index.html','/signal.css','/signal.js','/manifest.webmanifest','/logo.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;const path=new URL(e.request.url).pathname;if(path.endsWith('.json')||path.startsWith('/api/'))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const clone=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,clone)))}return r}).catch(async()=>{const c=await caches.match(e.request);if(c)return c;if(e.request.mode==='navigate')return await caches.match('/index.html');return Response.error()}))});

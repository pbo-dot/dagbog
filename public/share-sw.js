// "Del → Dagbog" fra andre apps. Tekst sendes videre i adressen (som før),
// en lydfil, et billede eller et dokument lægges midlertidigt i en cache, som dagbogen henter og sletter.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/del')) return;
  event.respondWith((async () => {
    const app = new URL('./', self.registration.scope);
    try {
      const form = await req.formData();
      let doc;
      const file = form.getAll('audio').find((f) => f && typeof f !== 'string' && f.size > 0);
      if (file) {
        const cache = await caches.open('dagbog-delt-lyd');
        await cache.put('lyd', new Response(file, {
          headers: {
            'Content-Type': file.type || 'audio/mp4',
            'X-Name': encodeURIComponent(file.name || 'optagelse'),
            'X-Modified': String(file.lastModified || Date.now()),
          },
        }));
        app.search = '?lyd=1';
      } else if (form.getAll('image').some((f) => f && typeof f !== 'string' && f.size > 0)) {
        // Et eller flere billeder: lægges i en cache, og teksten (hvis der er en) følger med i adressen
        const imgs = form.getAll('image').filter((f) => f && typeof f !== 'string' && f.size > 0).slice(0, 10);
        const cache = await caches.open('dagbog-delt-billeder');
        for (const k of await cache.keys()) await cache.delete(k);
        for (let i = 0; i < imgs.length; i++) {
          await cache.put('bil' + i, new Response(imgs[i], { headers: { 'Content-Type': imgs[i].type || 'image/jpeg' } }));
        }
        app.searchParams.set('bil', String(imgs.length));
        const text = ['title', 'text'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v).join('\n\n');
        if (text) app.searchParams.set('btext', text);
      } else if ((doc = form.getAll('doc').find((f) => f && typeof f !== 'string' && f.size > 0))) {
        const cache = await caches.open('dagbog-delt-dok');
        await cache.put('dok', new Response(doc, {
          headers: { 'Content-Type': doc.type || 'application/octet-stream', 'X-Name': encodeURIComponent(doc.name || 'Dokument') },
        }));
        app.search = '?dok=1';
      } else {
        for (const k of ['title', 'text', 'url']) {
          const v = form.get(k);
          if (typeof v === 'string' && v) app.searchParams.set(k, v);
        }
      }
    } catch {
      // Kunne ikke læses: åbn bare appen
    }
    return Response.redirect(app.href, 303);
  })());
});

// "Del → Dagbog" fra andre apps. Tekst sendes videre i adressen (som før),
// en lydfil eller et dokument lægges midlertidigt i en cache, som dagbogen henter og sletter.
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

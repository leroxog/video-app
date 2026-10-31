/* Satürn service worker: it only shows notifications (the server sends them with Web Push) and opens the page when one is tapped. It keeps nothing
   in a cache and does not touch any request. Served from /pulse-sw.js so that it works for the whole site. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = {}; }
  const title = typeof data.title === "string" && data.title ? data.title : "Satürn";
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/static/img/pulse-192.png",
    badge: "/static/img/pulse-192.png",
    tag: typeof data.tag === "string" ? data.tag : "pulse",
    renotify: true,
    requireInteraction: data.urgent === true,                      // a call stays on the screen until it is tapped
    vibrate: data.urgent === true ? [300, 150, 300, 150, 300, 150, 300] : undefined,
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        if ("navigate" in client) client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});

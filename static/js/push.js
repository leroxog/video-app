// Web Push subscribe/unsubscribe helper -- shared by any page offering a
// "follow with notifications" choice (currently brand_detail.html). Kept
// as its own file rather than inline so it's cached across pages.
(function () {
    function urlBase64ToUint8Array(base64String) {
        var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
        var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
        var rawData = window.atob(base64);
        var outputArray = new Uint8Array(rawData.length);
        for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    }

    // Ensures this browser has a live Web Push subscription registered with
    // the server -- called whenever the user picks a notification mode
    // other than "aus" (none) so a subscription exists to actually deliver
    // to. No-ops quietly if the browser lacks Push API support, permission
    // is denied, or no VAPID key is configured server-side.
    window.cheaperEnsurePushSubscribed = function (vapidPublicKey) {
        if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
            return Promise.resolve(false);
        }
        return navigator.serviceWorker.ready
            .then(function (registration) {
                return registration.pushManager.getSubscription().then(function (existing) {
                    if (existing) return existing;
                    return Notification.requestPermission().then(function (permission) {
                        if (permission !== "granted") return null;
                        return registration.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
                        });
                    });
                });
            })
            .then(function (subscription) {
                if (!subscription) return false;
                return fetch("/push/subscribe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(subscription.toJSON()),
                }).then(function () { return true; });
            })
            .catch(function () { return false; });
    };
})();

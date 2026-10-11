"use strict";

const CACHE_NAME = "jarwis-shell-v6";
const APP_SHELL = [
    "/",
    "/index.html",
    "/style.css",
    "/script.js",
    "/manifest.webmanifest",
    "/jarwis-icon.svg"
];
const SHELL_PATHS = new Set(APP_SHELL);

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key =>
                        (key.startsWith("nexus-shell-") || key.startsWith("jarwis-shell-")) &&
                        key !== CACHE_NAME
                    )
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

    const isNavigation = request.mode === "navigate";
    if (!isNavigation && !SHELL_PATHS.has(url.pathname)) return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            if (response.ok && response.type === "basic" &&
                (isNavigation || SHELL_PATHS.has(url.pathname))) {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(isNavigation ? "/" : request, response.clone());
            }
            return response;
        } catch (error) {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(isNavigation ? "/" : request);
            if (cached) return cached;
            if (isNavigation) {
                const shell = await cache.match("/index.html");
                if (shell) return shell;
            }
            throw error;
        }
    })());
});

// public/sw.js

/**
 * Bugiboni Savings Management System - Service Worker
 * Version: 1.0.0
 * Last Updated: 2024
 * 
 * Handles offline caching, push notifications, and background sync
 */

// ===== CACHE CONFIGURATION =====
const CACHE_NAME = 'bugiboni-savings-v1';
const API_CACHE_NAME = 'bugiboni-api-v1';
const ASSET_CACHE_NAME = 'bugiboni-assets-v1';
const DYNAMIC_CACHE_NAME = 'bugiboni-dynamic-v1';

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/dashboard.html',
  '/offline.html',
  '/css/style.css',
  '/manifest.json',
  '/js/utils.js',
  '/js/auth.js',
  '/js/api.js',
  '/js/dashboard.js',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/icons/maskable-icon-192x192.png',
  '/icons/maskable-icon-512x512.png'
];

// API endpoints to cache
const API_ENDPOINTS = [
  '/api/users',
  '/api/transactions/summary',
  '/api/reports/group',
  '/api/system/settings',
  '/api/users/roles'
];

// Assets to cache with network-first strategy
const NETWORK_FIRST_ASSETS = [
  '/dashboard.html',
  '/api/transactions',
  '/api/reports/individual'
];

// ===== INSTALL EVENT =====
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  
  // Force waiting service worker to become active
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching static assets...');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((error) => {
        console.error('Cache install failed:', error);
      })
  );
});

// ===== ACTIVATE EVENT =====
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  
  // Clean up old caches
  event.waitUntil(
    Promise.all([
      // Claim clients immediately
      self.clients.claim(),
      
      // Delete old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return cacheName !== CACHE_NAME &&
                     cacheName !== API_CACHE_NAME &&
                     cacheName !== ASSET_CACHE_NAME &&
                     cacheName !== DYNAMIC_CACHE_NAME;
            })
            .map((cacheName) => {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
    ])
  );
});

// ===== FETCH EVENT =====
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Handle different request types
  if (request.method === 'GET') {
    // API requests
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(handleAPIRequest(request));
    }
    // Static assets (CSS, JS, images)
    else if (isStaticAsset(url.pathname)) {
      event.respondWith(handleStaticAsset(request));
    }
    // HTML pages
    else if (url.pathname.endsWith('.html') || url.pathname === '/') {
      event.respondWith(handleHTMLRequest(request));
    }
    // Everything else
    else {
      event.respondWith(handleDynamicRequest(request));
    }
  } else if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
    // Handle mutations - try network first, queue if offline
    event.respondWith(handleMutationRequest(request));
  } else {
    // Default fetch
    event.respondWith(fetch(request));
  }
});

/**
 * Handle API requests with cache strategies
 */
async function handleAPIRequest(request) {
  const url = new URL(request.url);
  
  // Check if this is a cacheable API endpoint
  const isCacheable = API_ENDPOINTS.some(endpoint => url.pathname.includes(endpoint));
  
  if (isCacheable) {
    // Try cache first, then network
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      // Return cached response and update cache in background
      updateAPICache(request);
      return cachedResponse;
    }
  }
  
  // Try network
  try {
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.ok && isCacheable) {
      const cache = await caches.open(API_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('API request failed, serving from cache:', error);
    
    // Try cache as fallback
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline JSON response
    return new Response(
      JSON.stringify({ 
        error: 'offline', 
        message: 'You are offline. Please check your connection.' 
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Handle static assets (cache-first strategy)
 */
async function handleStaticAsset(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(ASSET_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('Static asset fetch failed:', error);
    return new Response('Resource not available offline', { status: 404 });
  }
}

/**
 * Handle HTML requests (network-first, cache-fallback)
 */
async function handleHTMLRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('HTML request failed, serving from cache:', error);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page
    return caches.match('/offline.html');
  }
}

/**
 * Handle dynamic requests (network-first)
 */
async function handleDynamicRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('Dynamic request failed, serving from cache:', error);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    return new Response('Not available offline', { status: 404 });
  }
}

/**
 * Handle mutation requests (POST, PUT, DELETE)
 */
async function handleMutationRequest(request) {
  try {
    const networkResponse = await fetch(request.clone());
    
    // Clear relevant caches after successful mutation
    if (networkResponse.ok) {
      clearRelevantCaches(request.url);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('Mutation failed, queueing for later:', error);
    
    // Queue the request for later
    await queueRequest(request.clone());
    
    return new Response(
      JSON.stringify({ 
        queued: true, 
        message: 'Request queued for when you are back online' 
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// ===== BACKGROUND SYNC =====
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-requests') {
    event.waitUntil(processQueuedRequests());
  } else if (event.tag === 'sync-transactions') {
    event.waitUntil(syncTransactions());
  }
});

/**
 * Queue failed requests for later retry
 */
async function queueRequest(request) {
  const db = await openRequestDB();
  const tx = db.transaction('requests', 'readwrite');
  const store = tx.objectStore('requests');
  
  const requestData = {
    id: Date.now() + Math.random(),
    url: request.url,
    method: request.method,
    headers: Array.from(request.headers.entries()),
    body: await request.clone().text(),
    timestamp: new Date().toISOString(),
    retries: 0
  };
  
  await store.add(requestData);
  
  // Register for background sync
  if ('sync' in self.registration) {
    self.registration.sync.register('sync-requests');
  }
}

/**
 * Process queued requests
 */
async function processQueuedRequests() {
  console.log('Processing queued requests...');
  
  const db = await openRequestDB();
  const tx = db.transaction('requests', 'readwrite');
  const store = tx.objectStore('requests');
  const requests = await store.getAll();
  
  for (const requestData of requests) {
    try {
      const response = await fetch(requestData.url, {
        method: requestData.method,
        headers: new Headers(requestData.headers),
        body: requestData.body
      });
      
      if (response.ok) {
        await store.delete(requestData.id);
        console.log('Successfully processed queued request:', requestData.id);
        
        // Notify clients
        notifyClients({
          type: 'REQUEST_PROCESSED',
          data: requestData
        });
      } else {
        // Increment retry count
        requestData.retries++;
        if (requestData.retries < 5) {
          await store.put(requestData);
        } else {
          // Too many retries, give up
          await store.delete(requestData.id);
          logFailedRequest(requestData);
        }
      }
    } catch (error) {
      console.log('Failed to process queued request:', error);
    }
  }
}

/**
 * Sync transactions specifically
 */
async function syncTransactions() {
  console.log('Syncing transactions...');
  // Implement transaction-specific sync logic
}

// ===== PUSH NOTIFICATIONS =====
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  let data = {};
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: 'Bugiboni Savings',
        body: event.data.text(),
        icon: '/icons/icon-192x192.png'
      };
    }
  }
  
  const options = {
    body: data.body || 'New notification from Bugiboni Savings',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [
      {
        action: 'open',
        title: 'Open App'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ],
    tag: data.tag || 'general',
    renotify: data.renotify || false,
    requireInteraction: data.requireInteraction || false,
    silent: data.silent || false
  };
  
  event.waitUntil(
    self.registration.showNotification(
      data.title || 'Bugiboni Savings',
      options
    )
  );
});

// ===== NOTIFICATION CLICK =====
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  
  event.notification.close();
  
  if (event.action === 'dismiss') {
    return;
  }
  
  const urlToOpen = event.notification.data.url || '/dashboard.html';
  
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })
    .then((windowClients) => {
      // Check if there's already a window/tab open with the target URL
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window/tab
      return clients.openWindow(urlToOpen);
    })
  );
});

// ===== MESSAGE HANDLING =====
self.addEventListener('message', (event) => {
  console.log('Message received in service worker:', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'CLEAR_CACHE') {
    clearAllCaches();
  } else if (event.data.type === 'GET_CACHE_STATUS') {
    getCacheStatus().then(status => {
      event.ports[0].postMessage(status);
    });
  }
});

// ===== HELPER FUNCTIONS =====

/**
 * Check if URL is a static asset
 */
function isStaticAsset(pathname) {
  const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.json'];
  return staticExtensions.some(ext => pathname.endsWith(ext));
}

/**
 * Update API cache in background
 */
async function updateAPICache(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(API_CACHE_NAME);
      cache.put(request, networkResponse);
    }
  } catch (error) {
    console.log('Background cache update failed:', error);
  }
}

/**
 * Clear relevant caches after mutation
 */
async function clearRelevantCaches(url) {
  const cacheNames = [API_CACHE_NAME, DYNAMIC_CACHE_NAME];
  
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    for (const request of keys) {
      // Clear API cache entries related to this mutation
      if (request.url.includes('/api/')) {
        await cache.delete(request);
      }
    }
  }
}

/**
 * Open IndexedDB for request queue
 */
function openRequestDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('BugiboniRequestQueue', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('requests')) {
        const store = db.createObjectStore('requests', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('retries', 'retries', { unique: false });
      }
    };
  });
}

/**
 * Log failed requests for auditing
 */
async function logFailedRequest(requestData) {
  const db = await openRequestDB();
  const tx = db.transaction('failed_requests', 'readwrite');
  const store = tx.objectStore('failed_requests');
  await store.add({
    ...requestData,
    failedAt: new Date().toISOString()
  });
}

/**
 * Notify all clients
 */
async function notifyClients(message) {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage(message);
  });
}

/**
 * Clear all caches
 */
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map(cacheName => caches.delete(cacheName))
  );
  console.log('All caches cleared');
}

/**
 * Get cache status
 */
async function getCacheStatus() {
  const cacheNames = await caches.keys();
  const status = {};
  
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    status[cacheName] = {
      size: keys.length,
      urls: keys.map(req => req.url)
    };
  }
  
  return status;
}

// ===== PERIODIC BACKGROUND SYNC =====
self.addEventListener('periodicsync', (event) => {
  console.log('Periodic sync triggered:', event.tag);
  
  if (event.tag === 'update-cache') {
    event.waitUntil(updateCachePeriodically());
  } else if (event.tag === 'cleanup-cache') {
    event.waitUntil(cleanupOldCache());
  }
});

/**
 * Update cache periodically
 */
async function updateCachePeriodically() {
  console.log('Updating cache periodically...');
  
  // Update static assets
  const cache = await caches.open(ASSET_CACHE_NAME);
  
  for (const asset of STATIC_ASSETS) {
    try {
      const response = await fetch(asset);
      if (response.ok) {
        await cache.put(asset, response);
      }
    } catch (error) {
      console.log('Periodic update failed for:', asset);
    }
  }
}

/**
 * Cleanup old cache entries
 */
async function cleanupOldCache() {
  console.log('Cleaning up old cache...');
  
  const cache = await caches.open(DYNAMIC_CACHE_NAME);
  const keys = await cache.keys();
  const now = Date.now();
  
  for (const request of keys) {
    const response = await cache.match(request);
    const cachedDate = response.headers.get('date');
    
    if (cachedDate) {
      const cacheAge = now - new Date(cachedDate).getTime();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      
      if (cacheAge > maxAge) {
        await cache.delete(request);
        console.log('Deleted old cache entry:', request.url);
      }
    }
  }
}

// ===== OFFLINE ANALYTICS =====
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-analytics') {
    event.waitUntil(syncAnalytics());
  }
});

/**
 * Sync analytics data
 */
async function syncAnalytics() {
  const db = await openRequestDB();
  const tx = db.transaction('analytics', 'readwrite');
  const store = tx.objectStore('analytics');
  const events = await store.getAll();
  
  try {
    const response = await fetch('/api/analytics/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events })
    });
    
    if (response.ok) {
      await store.clear();
      console.log('Analytics synced successfully');
    }
  } catch (error) {
    console.log('Analytics sync failed:', error);
  }
}

// ===== ERROR HANDLING =====
self.addEventListener('error', (event) => {
  console.error('Service Worker error:', event.error);
  
  // Log error for debugging
  fetch('/api/log/error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: event.error.message,
      stack: event.error.stack,
      timestamp: new Date().toISOString()
    })
  }).catch(() => {
    // Ignore logging errors
  });
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rejection in Service Worker:', event.reason);
});

// ===== VERSION CHECK =====
const VERSION = '1.0.0';

self.addEventListener('message', (event) => {
  if (event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: VERSION });
  }
});

console.log('Service Worker loaded. Version:', VERSION);
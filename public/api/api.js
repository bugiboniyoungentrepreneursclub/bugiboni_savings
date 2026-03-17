// public/js/api.js

/**
 * API Module for Bugiboni Savings Management System
 * Handles all API calls to the backend serverless functions
 * Includes error handling, request/response interceptors, and offline support
 */

// ===== API CONFIGURATION =====
const API_CONFIG = {
    BASE_URL: '/api',
    TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second
    CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
};

// ===== API CACHE =====
const apiCache = new Map();

// ===== HELPER FUNCTIONS =====

/**
 * Generate cache key from endpoint and params
 */
function getCacheKey(endpoint, params = {}) {
    return `${endpoint}:${JSON.stringify(params)}`;
}

/**
 * Check if cache is valid
 */
function isCacheValid(cacheEntry) {
    return cacheEntry && (Date.now() - cacheEntry.timestamp) < API_CONFIG.CACHE_DURATION;
}

/**
 * Get cached data
 */
function getCachedData(key) {
    const cacheEntry = apiCache.get(key);
    if (isCacheValid(cacheEntry)) {
        return cacheEntry.data;
    }
    apiCache.delete(key);
    return null;
}

/**
 * Set cached data
 */
function setCachedData(key, data) {
    apiCache.set(key, {
        data,
        timestamp: Date.now()
    });
}

/**
 * Clear cache for specific endpoint or all
 */
function clearCache(endpoint = null) {
    if (endpoint) {
        // Clear only cache entries that start with the endpoint
        for (const key of apiCache.keys()) {
            if (key.startsWith(endpoint)) {
                apiCache.delete(key);
            }
        }
    } else {
        apiCache.clear();
    }
}

/**
 * Sleep function for retry delay
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get auth token from storage
 */
function getAuthToken() {
    return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
}

/**
 * Create request headers
 */
function createHeaders(customHeaders = {}) {
    const token = getAuthToken();
    
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...customHeaders
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
}

/**
 * Handle API response
 */
async function handleResponse(response, endpoint) {
    // Handle 401 Unauthorized
    if (response.status === 401) {
        // Clear auth data
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        sessionStorage.removeItem('auth_token');
        sessionStorage.removeItem('auth_user');
        
        // Redirect to login if not already there
        if (!window.location.pathname.includes('login.html')) {
            window.location.href = '/login.html';
        }
        
        throw new APIError('Session expired. Please login again.', 401);
    }
    
    // Handle 403 Forbidden
    if (response.status === 403) {
        throw new APIError('You do not have permission to perform this action.', 403);
    }
    
    // Handle 404 Not Found
    if (response.status === 404) {
        throw new APIError('Resource not found.', 404);
    }
    
    // Handle 500 Internal Server Error
    if (response.status >= 500) {
        throw new APIError('Server error. Please try again later.', response.status);
    }
    
    // Parse response
    const contentType = response.headers.get('content-type');
    let data;
    
    if (contentType && contentType.includes('application/json')) {
        data = await response.json();
    } else {
        data = await response.text();
    }
    
    // Handle error responses
    if (!response.ok) {
        const message = data.error || data.message || 'An error occurred';
        throw new APIError(message, response.status, data);
    }
    
    return data;
}

/**
 * Custom API Error class
 */
class APIError extends Error {
    constructor(message, status, data = null) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.data = data;
        this.timestamp = new Date().toISOString();
    }
}

/**
 * Main request function with retry logic
 */
async function request(endpoint, options = {}) {
    const {
        method = 'GET',
        params = {},
        body = null,
        headers = {},
        cache = false,
        retry = API_CONFIG.RETRY_ATTEMPTS,
        timeout = API_CONFIG.TIMEOUT,
        signal = null
    } = options;
    
    // Build URL with query parameters
    const url = new URL(endpoint, window.location.origin);
    url.pathname = API_CONFIG.BASE_URL + endpoint;
    
    if (Object.keys(params).length > 0) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                url.searchParams.append(key, value);
            }
        });
    }
    
    const fullUrl = url.toString();
    
    // Check cache for GET requests
    if (method === 'GET' && cache) {
        const cacheKey = getCacheKey(endpoint, params);
        const cachedData = getCachedData(cacheKey);
        if (cachedData) {
            console.log('Serving from cache:', endpoint);
            return cachedData;
        }
    }
    
    // Prepare request options
    const requestOptions = {
        method,
        headers: createHeaders(headers),
        signal: signal || AbortSignal.timeout(timeout)
    };
    
    if (body) {
        requestOptions.body = JSON.stringify(body);
    }
    
    // Attempt request with retry logic
    let lastError;
    for (let attempt = 1; attempt <= retry; attempt++) {
        try {
            console.log(`API Request [${attempt}/${retry}]:`, method, fullUrl);
            
            const response = await fetch(fullUrl, requestOptions);
            const data = await handleResponse(response, endpoint);
            
            // Cache successful GET responses
            if (method === 'GET' && cache) {
                const cacheKey = getCacheKey(endpoint, params);
                setCachedData(cacheKey, data);
            }
            
            return data;
            
        } catch (error) {
            lastError = error;
            
            // Don't retry on client errors (4xx)
            if (error.status && error.status >= 400 && error.status < 500) {
                throw error;
            }
            
            // Don't retry on abort
            if (error.name === 'AbortError') {
                throw new APIError('Request timeout', 408);
            }
            
            // Retry logic
            if (attempt < retry) {
                console.log(`Retrying request (${attempt}/${retry})...`);
                await sleep(API_CONFIG.RETRY_DELAY * attempt);
            }
        }
    }
    
    throw lastError || new APIError('Request failed after multiple attempts', 500);
}

// ===== AUTHENTICATION API =====

const AuthAPI = {
    /**
     * Login user
     */
    async login(username, password) {
        return request('/auth/login', {
            method: 'POST',
            body: { username, password },
            retry: 2 // Less retries for auth
        });
    },
    
    /**
     * Logout user
     */
    async logout() {
        return request('/auth/logout', {
            method: 'POST',
            retry: 1
        });
    },
    
    /**
     * Verify session
     */
    async verifySession() {
        return request('/auth/session', {
            method: 'GET',
            cache: false // Never cache session
        });
    },
    
    /**
     * Refresh token
     */
    async refreshToken() {
        return request('/auth/refresh', {
            method: 'POST',
            retry: 1
        });
    },
    
    /**
     * Change password
     */
    async changePassword(currentPassword, newPassword) {
        return request('/auth/change-password', {
            method: 'POST',
            body: { currentPassword, newPassword }
        });
    },
    
    /**
     * Request password reset
     */
    async requestPasswordReset(username) {
        return request('/auth/reset-password', {
            method: 'POST',
            body: { username }
        });
    }
};

// ===== USERS API =====

const UsersAPI = {
    /**
     * Get all users
     */
    async getAll(params = {}) {
        return request('/users', {
            method: 'GET',
            params,
            cache: true // Cache user list
        });
    },
    
    /**
     * Get user by ID
     */
    async getById(userId) {
        return request(`/users/${userId}`, {
            method: 'GET',
            cache: true
        });
    },
    
    /**
     * Create new user
     */
    async create(userData) {
        const result = await request('/users', {
            method: 'POST',
            body: userData
        });
        // Clear cache after mutation
        clearCache('/users');
        return result;
    },
    
    /**
     * Update user
     */
    async update(userId, userData) {
        const result = await request(`/users/${userId}`, {
            method: 'PUT',
            body: userData
        });
        clearCache('/users');
        return result;
    },
    
    /**
     * Delete user
     */
    async delete(userId) {
        const result = await request(`/users/${userId}`, {
            method: 'DELETE'
        });
        clearCache('/users');
        return result;
    },
    
    /**
     * Get user roles
     */
    async getRoles() {
        return request('/users/roles', {
            method: 'GET',
            cache: true // Roles rarely change
        });
    },
    
    /**
     * Update user role
     */
    async updateRole(userId, role) {
        const result = await request(`/users/${userId}/role`, {
            method: 'PATCH',
            body: { role }
        });
        clearCache('/users');
        return result;
    },
    
    /**
     * Get members (users with member role)
     */
    async getMembers() {
        const users = await this.getAll();
        return users.filter(u => u.role === 'member');
    },
    
    /**
     * Get leadership members
     */
    async getLeadership() {
        const users = await this.getAll();
        return users.filter(u => ['chairperson', 'secretary', 'welfare', 'discipline', 'projects'].includes(u.role));
    },
    
    /**
     * Search users
     */
    async search(query) {
        return request('/users/search', {
            method: 'GET',
            params: { q: query }
        });
    }
};

// ===== TRANSACTIONS API =====

const TransactionsAPI = {
    /**
     * Get all transactions
     */
    async getAll(params = {}) {
        return request('/transactions', {
            method: 'GET',
            params,
            cache: false // Don't cache transactions
        });
    },
    
    /**
     * Get transaction by ID
     */
    async getById(transactionId) {
        return request(`/transactions/${transactionId}`, {
            method: 'GET'
        });
    },
    
    /**
     * Create new transaction (deposit)
     */
    async create(transactionData) {
        const result = await request('/transactions', {
            method: 'POST',
            body: transactionData
        });
        // Clear relevant caches
        clearCache('/transactions');
        clearCache('/reports');
        return result;
    },
    
    /**
     * Update transaction
     */
    async update(transactionId, transactionData) {
        const result = await request(`/transactions/${transactionId}`, {
            method: 'PUT',
            body: transactionData
        });
        clearCache('/transactions');
        clearCache('/reports');
        return result;
    },
    
    /**
     * Delete transaction
     */
    async delete(transactionId) {
        const result = await request(`/transactions/${transactionId}`, {
            method: 'DELETE'
        });
        clearCache('/transactions');
        clearCache('/reports');
        return result;
    },
    
    /**
     * Get member transactions
     */
    async getByMember(memberId, params = {}) {
        return request(`/transactions/member`, {
            method: 'GET',
            params: { memberId, ...params }
        });
    },
    
    /**
     * Get transactions by date range
     */
    async getByDateRange(startDate, endDate) {
        return request('/transactions/range', {
            method: 'GET',
            params: { start: startDate, end: endDate }
        });
    },
    
    /**
     * Get transaction summary
     */
    async getSummary(params = {}) {
        return request('/transactions/summary', {
            method: 'GET',
            params,
            cache: true // Cache summaries
        });
    },
    
    /**
     * Get recent transactions
     */
    async getRecent(limit = 10) {
        return request('/transactions/recent', {
            method: 'GET',
            params: { limit }
        });
    },
    
    /**
     * Verify transaction
     */
    async verify(transactionId) {
        return request(`/transactions/${transactionId}/verify`, {
            method: 'POST'
        });
    }
};

// ===== REPORTS API =====

const ReportsAPI = {
    /**
     * Get individual member report
     */
    async getIndividual(memberId, params = {}) {
        return request('/reports/individual', {
            method: 'GET',
            params: { memberId, ...params },
            cache: false
        });
    },
    
    /**
     * Get group summary report
     */
    async getGroup(params = {}) {
        return request('/reports/group', {
            method: 'GET',
            params,
            cache: false
        });
    },
    
    /**
     * Get monthly contribution report
     */
    async getMonthly(year, month) {
        return request('/reports/monthly', {
            method: 'GET',
            params: { year, month }
        });
    },
    
    /**
     * Get transaction log report
     */
    async getTransactionLog(params = {}) {
        return request('/reports/transaction-log', {
            method: 'GET',
            params
        });
    },
    
    /**
     * Get member statement
     */
    async getStatement(memberId, startDate, endDate) {
        return request('/reports/statement', {
            method: 'GET',
            params: { memberId, start: startDate, end: endDate }
        });
    },
    
    /**
     * Get annual summary
     */
    async getAnnualSummary(year) {
        return request('/reports/annual', {
            method: 'GET',
            params: { year }
        });
    },
    
    /**
     * Export report
     */
    async export(reportType, params = {}, format = 'pdf') {
        return request('/reports/export', {
            method: 'POST',
            body: { reportType, params, format }
        });
    }
};

// ===== AUDIT API =====

const AuditAPI = {
    /**
     * Get audit logs
     */
    async getLogs(params = {}) {
        return request('/audit/logs', {
            method: 'GET',
            params
        });
    },
    
    /**
     * Get audit log by ID
     */
    async getLogById(logId) {
        return request(`/audit/logs/${logId}`, {
            method: 'GET'
        });
    },
    
    /**
     * Get user activity
     */
    async getUserActivity(userId, params = {}) {
        return request('/audit/user-activity', {
            method: 'GET',
            params: { userId, ...params }
        });
    },
    
    /**
     * Get system events
     */
    async getSystemEvents(params = {}) {
        return request('/audit/system-events', {
            method: 'GET',
            params
        });
    },
    
    /**
     * Export audit log
     */
    async exportLogs(params = {}) {
        return request('/audit/export', {
            method: 'POST',
            body: params
        });
    }
};

// ===== SYSTEM API =====

const SystemAPI = {
    /**
     * Get system status
     */
    async getStatus() {
        return request('/system/status', {
            method: 'GET',
            cache: false
        });
    },
    
    /**
     * Get system settings
     */
    async getSettings() {
        return request('/system/settings', {
            method: 'GET',
            cache: true
        });
    },
    
    /**
     * Update system settings
     */
    async updateSettings(settings) {
        const result = await request('/system/settings', {
            method: 'PUT',
            body: settings
        });
        clearCache('/system');
        return result;
    },
    
    /**
     * Get system statistics
     */
    async getStatistics() {
        return request('/system/statistics', {
            method: 'GET',
            cache: false
        });
    },
    
    /**
     * Perform system backup
     */
    async backup() {
        return request('/system/backup', {
            method: 'POST'
        });
    },
    
    /**
     * Restore from backup
     */
    async restore(backupId) {
        return request('/system/restore', {
            method: 'POST',
            body: { backupId }
        });
    },
    
    /**
     * Get backup list
     */
    async getBackups() {
        return request('/system/backups', {
            method: 'GET'
        });
    }
};

// ===== NOTIFICATIONS API =====

const NotificationsAPI = {
    /**
     * Get user notifications
     */
    async getNotifications(params = {}) {
        return request('/notifications', {
            method: 'GET',
            params
        });
    },
    
    /**
     * Mark notification as read
     */
    async markAsRead(notificationId) {
        return request(`/notifications/${notificationId}/read`, {
            method: 'POST'
        });
    },
    
    /**
     * Mark all as read
     */
    async markAllAsRead() {
        return request('/notifications/read-all', {
            method: 'POST'
        });
    },
    
    /**
     * Send WhatsApp notification
     */
    async sendWhatsApp(recipient, message) {
        return request('/notifications/whatsapp', {
            method: 'POST',
            body: { recipient, message }
        });
    },
    
    /**
     * Send bulk notification
     */
    async sendBulkNotification(recipients, message) {
        return request('/notifications/bulk', {
            method: 'POST',
            body: { recipients, message }
        });
    }
};

// ===== DASHBOARD API =====

const DashboardAPI = {
    /**
     * Get dashboard data based on user role
     */
    async getDashboardData() {
        return request('/dashboard', {
            method: 'GET',
            cache: false
        });
    },
    
    /**
     * Get member dashboard data
     */
    async getMemberDashboard() {
        return request('/dashboard/member', {
            method: 'GET',
            cache: false
        });
    },
    
    /**
     * Get treasurer dashboard data
     */
    async getTreasurerDashboard() {
        return request('/dashboard/treasurer', {
            method: 'GET',
            cache: false
        });
    },
    
    /**
     * Get chairperson dashboard data
     */
    async getChairpersonDashboard() {
        return request('/dashboard/chairperson', {
            method: 'GET',
            cache: false
        });
    },
    
    /**
     * Get admin dashboard data
     */
    async getAdminDashboard() {
        return request('/dashboard/admin', {
            method: 'GET',
            cache: false
        });
    },
    
    /**
     * Get widgets data
     */
    async getWidgets(widgetIds) {
        return request('/dashboard/widgets', {
            method: 'POST',
            body: { widgets: widgetIds }
        });
    }
};

// ===== BATCH REQUESTS =====

/**
 * Perform multiple API requests in parallel
 */
async function batchRequests(requests) {
    const promises = requests.map(({ api, method, args = [] }) => {
        return api[method](...args).catch(error => ({ error, method, args }));
    });
    
    return Promise.all(promises);
}

/**
 * Perform sequential API requests
 */
async function sequenceRequests(requests) {
    const results = [];
    
    for (const { api, method, args = [] } of requests) {
        try {
            const result = await api[method](...args);
            results.push(result);
        } catch (error) {
            results.push({ error });
            // Stop on error if specified
            if (requests.stopOnError) break;
        }
    }
    
    return results;
}

// ===== OFFLINE QUEUE =====

/**
 * Queue for offline requests
 */
class OfflineQueue {
    constructor() {
        this.queue = JSON.parse(localStorage.getItem('offline_queue') || '[]');
        this.processing = false;
    }
    
    /**
     * Add request to queue
     */
    add(request) {
        this.queue.push({
            ...request,
            id: Date.now() + Math.random(),
            timestamp: new Date().toISOString()
        });
        this.save();
    }
    
    /**
     * Save queue to localStorage
     */
    save() {
        localStorage.setItem('offline_queue', JSON.stringify(this.queue));
    }
    
    /**
     * Process queue
     */
    async process() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const request = this.queue[0];
            
            try {
                // Check if online
                if (!navigator.onLine) {
                    break;
                }
                
                // Process request
                await request.api[request.method](...request.args);
                
                // Remove from queue
                this.queue.shift();
                this.save();
                
            } catch (error) {
                console.error('Failed to process offline request:', error);
                // Stop processing on error
                break;
            }
        }
        
        this.processing = false;
    }
    
    /**
     * Get queue length
     */
    get length() {
        return this.queue.length;
    }
    
    /**
     * Clear queue
     */
    clear() {
        this.queue = [];
        this.save();
    }
}

// Create offline queue instance
const offlineQueue = new OfflineQueue();

// Process queue when online
window.addEventListener('online', () => {
    console.log('Back online, processing queue...');
    offlineQueue.process();
});

// ===== EXPORT API =====

// Main API object
const API = {
    // Core request method
    request,
    
    // API modules
    auth: AuthAPI,
    users: UsersAPI,
    transactions: TransactionsAPI,
    reports: ReportsAPI,
    audit: AuditAPI,
    system: SystemAPI,
    notifications: NotificationsAPI,
    dashboard: DashboardAPI,
    
    // Utility methods
    clearCache,
    batchRequests,
    sequenceRequests,
    offlineQueue,
    
    // Error class
    APIError
};

// Make API globally available
window.API = API;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
}

// ===== REQUEST INTERCEPTORS =====

// Add request interceptor for logging
const originalRequest = request;
window.request = async function(...args) {
    const startTime = Date.now();
    
    try {
        const result = await originalRequest(...args);
        const duration = Date.now() - startTime;
        
        console.log(`API Request completed in ${duration}ms:`, args[0]);
        
        return result;
    } catch (error) {
        const duration = Date.now() - startTime;
        
        console.error(`API Request failed after ${duration}ms:`, args[0], error);
        
        throw error;
    }
};

// ===== RESPONSE INTERCEPTORS =====

// Add response transformer for dates
const originalHandleResponse = handleResponse;
window.handleResponse = async function(response, endpoint) {
    const data = await originalHandleResponse(response, endpoint);
    
    // Convert date strings to Date objects
    if (data && typeof data === 'object') {
        convertDates(data);
    }
    
    return data;
};

/**
 * Recursively convert date strings to Date objects
 */
function convertDates(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    
    for (const key in obj) {
        const value = obj[key];
        
        if (typeof value === 'string' && dateRegex.test(value)) {
            obj[key] = new Date(value);
        } else if (typeof value === 'object') {
            convertDates(value);
        }
    }
}

// ===== API HEALTH CHECK =====

/**
 * Check API health
 */
async function checkAPIHealth() {
    try {
        const response = await fetch('/api/health', {
            method: 'GET',
            headers: createHeaders()
        });
        
        return response.ok;
    } catch (error) {
        return false;
    }
}

// Export health check
API.checkHealth = checkAPIHealth;

// ===== API VERSION =====

API.version = '1.0.0';

// ===== INITIALIZATION =====

// Process offline queue on load
document.addEventListener('DOMContentLoaded', () => {
    if (navigator.onLine) {
        offlineQueue.process();
    }
});

console.log('API Module loaded. Version:', API.version);
// public/js/auth.js

/**
 * Authentication Module for Bugiboni Savings Management System
 * Handles all authentication-related functionality including login, logout,
 * session management, token handling, and role-based access control.
 */

// ===== CONSTANTS =====
const AUTH_CONSTANTS = {
    TOKEN_KEY: 'auth_token',
    USER_KEY: 'auth_user',
    REMEMBER_USER_KEY: 'remember_username',
    LAST_ACTIVITY_KEY: 'last_activity',
    SESSION_TIMEOUT: 8 * 60 * 60 * 1000, // 8 hours in milliseconds
    TOKEN_REFRESH_INTERVAL: 7 * 60 * 60 * 1000, // Refresh token after 7 hours
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
};

// ===== LOGIN ATTEMPT TRACKING =====
let loginAttempts = JSON.parse(localStorage.getItem('login_attempts') || '{}');

/**
 * Track login attempts for brute force protection
 */
function trackLoginAttempt(username, success) {
    const now = Date.now();
    const userAttempts = loginAttempts[username] || { count: 0, firstAttempt: now, lockedUntil: null };
    
    if (success) {
        // Reset attempts on successful login
        delete loginAttempts[username];
    } else {
        // Increment failed attempts
        userAttempts.count++;
        userAttempts.firstAttempt = userAttempts.firstAttempt || now;
        
        // Check if should lock out
        if (userAttempts.count >= AUTH_CONSTANTS.MAX_LOGIN_ATTEMPTS) {
            userAttempts.lockedUntil = now + AUTH_CONSTANTS.LOCKOUT_DURATION;
        }
        
        loginAttempts[username] = userAttempts;
    }
    
    // Clean up old entries
    Object.keys(loginAttempts).forEach(key => {
        const attempts = loginAttempts[key];
        if (attempts.lockedUntil && attempts.lockedUntil < now) {
            delete loginAttempts[key];
        }
    });
    
    localStorage.setItem('login_attempts', JSON.stringify(loginAttempts));
}

/**
 * Check if user is locked out
 */
function isUserLockedOut(username) {
    const attempts = loginAttempts[username];
    if (!attempts || !attempts.lockedUntil) return false;
    
    if (Date.now() > attempts.lockedUntil) {
        // Lockout expired
        delete loginAttempts[username];
        localStorage.setItem('login_attempts', JSON.stringify(loginAttempts));
        return false;
    }
    
    return true;
}

/**
 * Get remaining lockout time in minutes
 */
function getLockoutTimeRemaining(username) {
    const attempts = loginAttempts[username];
    if (!attempts || !attempts.lockedUntil) return 0;
    
    const remaining = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
    return remaining > 0 ? remaining : 0;
}

// ===== TOKEN MANAGEMENT =====

/**
 * Store authentication token
 */
function setToken(token, remember = false) {
    if (remember) {
        localStorage.setItem(AUTH_CONSTANTS.TOKEN_KEY, token);
    } else {
        sessionStorage.setItem(AUTH_CONSTANTS.TOKEN_KEY, token);
    }
    // Also store in both for redundancy
    updateLastActivity();
}

/**
 * Get authentication token from storage
 */
function getToken() {
    return localStorage.getItem(AUTH_CONSTANTS.TOKEN_KEY) || 
           sessionStorage.getItem(AUTH_CONSTANTS.TOKEN_KEY);
}

/**
 * Remove authentication token from storage
 */
function removeToken() {
    localStorage.removeItem(AUTH_CONSTANTS.TOKEN_KEY);
    sessionStorage.removeItem(AUTH_CONSTANTS.TOKEN_KEY);
}

/**
 * Store user data
 */
function setUser(user, remember = false) {
    if (remember) {
        localStorage.setItem(AUTH_CONSTANTS.USER_KEY, JSON.stringify(user));
    } else {
        sessionStorage.setItem(AUTH_CONSTANTS.USER_KEY, JSON.stringify(user));
    }
}

/**
 * Get user data from storage
 */
function getUser() {
    const userStr = localStorage.getItem(AUTH_CONSTANTS.USER_KEY) || 
                    sessionStorage.getItem(AUTH_CONSTANTS.USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
}

/**
 * Remove user data from storage
 */
function removeUser() {
    localStorage.removeItem(AUTH_CONSTANTS.USER_KEY);
    sessionStorage.removeItem(AUTH_CONSTANTS.USER_KEY);
}

/**
 * Update last activity timestamp
 */
function updateLastActivity() {
    localStorage.setItem(AUTH_CONSTANTS.LAST_ACTIVITY_KEY, Date.now().toString());
}

/**
 * Check if session is expired
 */
function isSessionExpired() {
    const lastActivity = localStorage.getItem(AUTH_CONSTANTS.LAST_ACTIVITY_KEY);
    if (!lastActivity) return true;
    
    const elapsed = Date.now() - parseInt(lastActivity);
    return elapsed > AUTH_CONSTANTS.SESSION_TIMEOUT;
}

// ===== AUTHENTICATION API CALLS =====

/**
 * Authenticate user with server
 */
async function login(username, password, remember = false) {
    try {
        // Check if user is locked out
        if (isUserLockedOut(username)) {
            const minutesRemaining = getLockoutTimeRemaining(username);
            throw new Error(`Too many failed attempts. Please try again in ${minutesRemaining} minutes.`);
        }
        
        // Validate input
        if (!username || !password) {
            throw new Error('Username and password are required');
        }
        
        // Sanitize username
        username = username.trim().toLowerCase();
        
        // Make API request
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Reset login attempts on success
            trackLoginAttempt(username, true);
            
            // Store token and user data
            setToken(data.token, remember);
            setUser(data.user, remember);
            
            // Store username if remember me is checked
            if (remember) {
                localStorage.setItem(AUTH_CONSTANTS.REMEMBER_USER_KEY, username);
            } else {
                localStorage.removeItem(AUTH_CONSTANTS.REMEMBER_USER_KEY);
            }
            
            // Update last activity
            updateLastActivity();
            
            // Log successful login for audit
            logAuditEvent('LOGIN_SUCCESS', { username });
            
            return {
                success: true,
                user: data.user,
                message: 'Login successful'
            };
        } else {
            // Track failed attempt
            trackLoginAttempt(username, false);
            
            // Log failed login for audit
            logAuditEvent('LOGIN_FAILED', { username, reason: data.error });
            
            throw new Error(data.error || 'Login failed');
        }
        
    } catch (error) {
        console.error('Login error:', error);
        
        // Log network/other errors
        logAuditEvent('LOGIN_ERROR', { username, error: error.message });
        
        return {
            success: false,
            message: error.message || 'Network error. Please try again.'
        };
    }
}

/**
 * Logout user
 */
async function logout() {
    try {
        const user = getUser();
        const token = getToken();
        
        // Call logout endpoint
        if (token) {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ userId: user?.id })
            }).catch(err => console.warn('Logout API call failed:', err));
        }
        
        // Log logout event
        logAuditEvent('LOGOUT', { username: user?.username });
        
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        // Clear all auth data
        removeToken();
        removeUser();
        
        // Clear any other session data
        sessionStorage.clear();
        
        // Redirect to login
        window.location.href = '/login.html';
    }
}

/**
 * Verify token with server
 */
async function verifyToken() {
    const token = getToken();
    if (!token) return false;
    
    try {
        const response = await fetch('/api/auth/session', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok && data.valid) {
            // Update last activity
            updateLastActivity();
            
            // Update user data if returned
            if (data.user) {
                const remember = !!localStorage.getItem(AUTH_CONSTANTS.TOKEN_KEY);
                setUser(data.user, remember);
            }
            
            return true;
        } else {
            // Token invalid, clear storage
            removeToken();
            removeUser();
            return false;
        }
    } catch (error) {
        console.error('Token verification failed:', error);
        return false;
    }
}

/**
 * Refresh authentication token
 */
async function refreshToken() {
    const token = getToken();
    if (!token) return false;
    
    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (response.ok && data.token) {
            const remember = !!localStorage.getItem(AUTH_CONSTANTS.TOKEN_KEY);
            setToken(data.token, remember);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Token refresh failed:', error);
        return false;
    }
}

// ===== ROLE-BASED ACCESS CONTROL =====

/**
 * Role hierarchy and permissions
 */
const ROLE_HIERARCHY = {
    'admin': 100,
    'chairperson': 80,
    'treasurer': 70,
    'secretary': 60,
    'welfare': 50,
    'discipline': 50,
    'projects': 50,
    'member': 10
};

const PERMISSIONS = {
    // Admin permissions
    'admin': [
        'manage_users',
        'manage_roles',
        'view_audit_logs',
        'configure_system',
        'view_all_reports',
        'export_data',
        'manage_backup',
        'view_financial_summary'
    ],
    
    // Chairperson permissions
    'chairperson': [
        'manage_users',
        'view_reports',
        'view_financial_summary',
        'export_data',
        'view_member_list',
        'send_announcements'
    ],
    
    // Treasurer permissions
    'treasurer': [
        'record_deposits',
        'view_transactions',
        'view_financial_history',
        'generate_reports',
        'view_member_balances',
        'send_payment_confirmations'
    ],
    
    // Secretary permissions
    'secretary': [
        'view_member_list',
        'view_financial_summary',
        'view_reports',
        'send_announcements'
    ],
    
    // Welfare permissions
    'welfare': [
        'view_member_list',
        'view_financial_summary'
    ],
    
    // Discipline permissions
    'discipline': [
        'view_member_list',
        'view_financial_summary'
    ],
    
    // Projects permissions
    'projects': [
        'view_member_list',
        'view_financial_summary'
    ],
    
    // Member permissions
    'member': [
        'view_own_balance',
        'view_own_transactions',
        'view_own_profile'
    ]
};

/**
 * Check if user has required role
 */
function hasRole(requiredRole) {
    const user = getUser();
    if (!user) return false;
    
    // Admin has access to everything
    if (user.role === 'admin') return true;
    
    return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Check if user has specific permission
 */
function hasPermission(permission) {
    const user = getUser();
    if (!user) return false;
    
    // Admin has all permissions
    if (user.role === 'admin') return true;
    
    const userPermissions = PERMISSIONS[user.role] || [];
    return userPermissions.includes(permission);
}

/**
 * Check if user has any of the specified permissions
 */
function hasAnyPermission(permissions) {
    return permissions.some(permission => hasPermission(permission));
}

/**
 * Check if user has all specified permissions
 */
function hasAllPermissions(permissions) {
    return permissions.every(permission => hasPermission(permission));
}

/**
 * Get user's role hierarchy level
 */
function getRoleLevel(role) {
    return ROLE_HIERARCHY[role] || 0;
}

/**
 * Get all permissions for current user
 */
function getUserPermissions() {
    const user = getUser();
    if (!user) return [];
    
    if (user.role === 'admin') {
        // Admin has all permissions
        return Object.values(PERMISSIONS).flat();
    }
    
    return PERMISSIONS[user.role] || [];
}

// ===== SESSION MANAGEMENT =====

/**
 * Initialize session monitoring
 */
function initSessionMonitoring() {
    // Check session on page load
    checkSession();
    
    // Monitor user activity
    let activityTimer;
    document.addEventListener('mousemove', () => {
        clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
            if (isAuthenticated()) {
                updateLastActivity();
            }
        }, 1000);
    });
    
    document.addEventListener('keypress', () => {
        clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
            if (isAuthenticated()) {
                updateLastActivity();
            }
        }, 1000);
    });
    
    // Check session periodically
    setInterval(async () => {
        if (isAuthenticated()) {
            // Check if session expired
            if (isSessionExpired()) {
                await logout();
                showNotification('Session expired. Please login again.', 'warning');
            } else {
                // Refresh token if needed
                const lastRefresh = localStorage.getItem('last_token_refresh');
                if (!lastRefresh || Date.now() - parseInt(lastRefresh) > AUTH_CONSTANTS.TOKEN_REFRESH_INTERVAL) {
                    await refreshToken();
                    localStorage.setItem('last_token_refresh', Date.now().toString());
                }
            }
        }
    }, 60000); // Check every minute
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
    const token = getToken();
    const user = getUser();
    
    if (!token || !user) return false;
    
    // Check if session expired
    if (isSessionExpired()) {
        // Silent logout
        removeToken();
        removeUser();
        return false;
    }
    
    return true;
}

/**
 * Check session and redirect if needed
 */
async function checkSession() {
    if (!isAuthenticated()) {
        // Redirect to login if not on login page
        if (!window.location.pathname.includes('login.html')) {
            window.location.href = '/login.html';
        }
        return false;
    }
    
    // Verify token with server
    const isValid = await verifyToken();
    
    if (!isValid && !window.location.pathname.includes('login.html')) {
        window.location.href = '/login.html';
    }
    
    return isValid;
}

/**
 * Require authentication for page
 */
function requireAuth(requiredRole = null) {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    
    if (requiredRole && !hasRole(requiredRole)) {
        window.location.href = '/dashboard.html';
        showNotification('You do not have permission to access this page.', 'error');
        return false;
    }
    
    return true;
}

// ===== AUDIT LOGGING =====

/**
 * Log audit events
 */
async function logAuditEvent(action, details = {}) {
    const user = getUser();
    const event = {
        timestamp: new Date().toISOString(),
        userId: user?.id || 'unknown',
        username: user?.username || 'unknown',
        action: action,
        details: details,
        userAgent: navigator.userAgent,
        url: window.location.href
    };
    
    // Store in localStorage for offline capability
    const auditQueue = JSON.parse(localStorage.getItem('audit_queue') || '[]');
    auditQueue.push(event);
    localStorage.setItem('audit_queue', JSON.stringify(auditQueue));
    
    // Try to send to server
    try {
        await fetch('/api/audit/log', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify(event)
        });
        
        // Remove from queue if successful
        const updatedQueue = JSON.parse(localStorage.getItem('audit_queue') || '[]')
            .filter(e => e.timestamp !== event.timestamp);
        localStorage.setItem('audit_queue', JSON.stringify(updatedQueue));
        
    } catch (error) {
        console.warn('Failed to send audit event:', error);
        // Keep in queue for later retry
    }
}

/**
 * Process pending audit events
 */
async function processAuditQueue() {
    const auditQueue = JSON.parse(localStorage.getItem('audit_queue') || '[]');
    if (auditQueue.length === 0) return;
    
    const token = getToken();
    if (!token) return;
    
    const successful = [];
    
    for (const event of auditQueue) {
        try {
            await fetch('/api/audit/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(event)
            });
            successful.push(event);
        } catch (error) {
            console.warn('Failed to process audit event:', error);
        }
    }
    
    // Remove successful events from queue
    const remaining = auditQueue.filter(e => !successful.includes(e));
    localStorage.setItem('audit_queue', JSON.stringify(remaining));
}

// ===== NOTIFICATION SYSTEM =====

/**
 * Show notification to user
 */
function showNotification(message, type = 'info', duration = 3000) {
    // Check if notification container exists
    let container = document.getElementById('notification-container');
    
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }
    
    // Create notification
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        background: ${type === 'success' ? 'var(--success-color)' : 
                     type === 'error' ? 'var(--danger-color)' : 
                     type === 'warning' ? 'var(--warning-color)' : 
                     'var(--info-color)'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease;
        max-width: 350px;
    `;
    
    // Add icon based on type
    const icon = type === 'success' ? '✅' : 
                 type === 'error' ? '❌' : 
                 type === 'warning' ? '⚠️' : 'ℹ️';
    
    notification.innerHTML = `
        <span style="font-size: 1.2rem;">${icon}</span>
        <span style="flex: 1;">${message}</span>
        <button onclick="this.parentElement.remove()" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem;">&times;</button>
    `;
    
    container.appendChild(notification);
    
    // Auto remove after duration
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, duration);
    
    // Add styles for animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

// ===== INITIALIZATION =====

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Start session monitoring
    initSessionMonitoring();
    
    // Process audit queue periodically
    setInterval(processAuditQueue, 60000); // Every minute
    
    // Add auth headers to fetch by default (optional)
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        const token = getToken();
        if (token && !url.includes('/auth/')) {
            options.headers = {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            };
        }
        return originalFetch(url, options);
    };
});

// ===== EXPORTS =====
// Make functions globally available
window.auth = {
    login,
    logout,
    verifyToken,
    refreshToken,
    isAuthenticated,
    getUser,
    getToken,
    hasRole,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    getUserPermissions,
    requireAuth,
    checkSession,
    showNotification,
    logAuditEvent
};

// Export for module usage (if using modules)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        login,
        logout,
        verifyToken,
        refreshToken,
        isAuthenticated,
        getUser,
        getToken,
        hasRole,
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        getUserPermissions,
        requireAuth,
        checkSession,
        showNotification,
        logAuditEvent
    };
}
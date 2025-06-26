// options.js

import { getStoredSnippets, setStoredSnippets } from './utils.js'; // Reusing snippet storage functions

// --- DOM Elements ---
const themeSelect = document.getElementById('themeSelect');
const accentColorPicker = document.getElementById('accentColorPicker');
const backgroundImageInput = document.getElementById('backgroundImageInput');
const clearBackgroundImageBtn = document.getElementById('clearBackgroundImageBtn');

const authorizeGoogleDriveBtn = document.getElementById('authorizeGoogleDriveBtn');
const deauthorizeGoogleDriveBtn = document.getElementById('deauthorizeGoogleDriveBtn');
const authStatus = document.getElementById('authStatus');
const syncIntervalSelect = document.getElementById('syncIntervalSelect');
const manualSyncBtn = document.getElementById('manualSyncBtn');
const lastSyncStatus = document.getElementById('lastSyncStatus');

const exportDataBtn = document.getElementById('exportDataBtn');
const importFileInput = document.getElementById('importFileInput');
const importDataBtn = document.getElementById('importDataBtn');
const importStatus = document.getElementById('importStatus');

// --- Global State / Constants ---
const GOOGLE_DRIVE_SCOPES = [
    'https://www.googleapis.com/auth/drive.appdata', // For appDataFolder
    'https://www.googleapis.com/auth/drive.file' // For file export if we later allow users to pick location
];
const GOOGLE_DRIVE_FILENAME = 'pastr_data.json';
let googleAuthToken = null;
let syncIntervalId = null; // To store the setInterval ID for auto-sync

// --- Utility Functions (for options page specific needs) ---

/**
 * Applies the stored theme settings to the body.
 * This function should ideally be called by both popup.js and options.js
 * (or better, background.js manages and injects CSS/styles)
 * For simplicity, we'll apply it directly here for the options page.
 */
async function applyTheme() {
    const settings = await chrome.storage.sync.get(['theme', 'accentColor', 'backgroundImage']);
    const body = document.body;

    body.classList.remove('theme-light', 'theme-dark');
    body.classList.add(`theme-${settings.theme || 'light'}`);

    // Apply accent color (CSS variables would be ideal here)
    document.documentElement.style.setProperty('--primary-color', settings.accentColor || '#007bff');

    if (settings.backgroundImage) {
        body.style.backgroundImage = `url('${settings.backgroundImage}')`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundAttachment = 'fixed';
    } else {
        body.style.backgroundImage = 'none';
    }
}

/**
 * Saves current theme settings to storage.
 */
async function saveThemeSettings() {
    await chrome.storage.sync.set({
        theme: themeSelect.value,
        accentColor: accentColorPicker.value,
        backgroundImage: backgroundImageInput.value.trim()
    });
    applyTheme(); // Apply immediately
}

/**
 * Updates the UI based on Google Drive authorization status.
 * @param {string|null} token - The Google Auth Token or null if not authorized.
 */
function updateAuthUI(token) {
    if (token) {
        authStatus.textContent = 'Authorized with Google Drive.';
        authStatus.classList.add('success');
        authStatus.classList.remove('error');
        authorizeGoogleDriveBtn.classList.add('hidden');
        deauthorizeGoogleDriveBtn.classList.remove('hidden');
    } else {
        authStatus.textContent = 'Not authorized with Google Drive.';
        authStatus.classList.add('error');
        authStatus.classList.remove('success');
        authorizeGoogleDriveBtn.classList.remove('hidden');
        deauthorizeGoogleDriveBtn.classList.add('hidden');
    }
}

/**
 * Fetches an access token for Google Drive.
 * @returns {Promise<string|null>} The access token or null if authorization fails.
 */
async function getGoogleAuthToken() {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                console.error("Error getting auth token:", chrome.runtime.lastError.message);
                resolve(null);
            } else {
                console.log("Google Auth Token obtained.");
                resolve(token);
            }
        });
    });
}

/**
 * Revokes the Google Drive access token.
 * @param {string} token - The token to revoke.
 */
async function revokeGoogleAuthToken(token) {
    return new Promise((resolve) => {
        const revokeUrl = `https://accounts.google.com/o/oauth2/revoke?token=${token}`;
        fetch(revokeUrl, { method: 'GET' })
            .then(response => {
                if (response.ok) {
                    chrome.identity.removeCachedAuthToken({ token: token }, () => {
                        console.log('Google Auth Token revoked.');
                        resolve(true);
                    });
                } else {
                    console.error('Failed to revoke token:', response.statusText);
                    resolve(false);
                }
            })
            .catch(error => {
                console.error('Error revoking token:', error);
                resolve(false);
            });
    });
}

/**
 * Finds a file in the appDataFolder by name.
 * @param {string} fileName - The name of the file to find.
 * @returns {Promise<string|null>} The file ID if found, otherwise null.
 */
async function findGoogleDriveFile(fileName) {
    if (!googleAuthToken) return null;

    const url = `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and 'appDataFolder' in parents&spaces=appDataFolder&fields=files(id)`;
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${googleAuthToken}` }
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return data.files.length > 0 ? data.files[0].id : null;
    } catch (error) {
        console.error('Error finding Google Drive file:', error);
        return null;
    }
}

/**
 * Uploads (or updates) pastr_data.json to Google Drive appDataFolder.
 */
async function uploadToGoogleDrive() {
    if (!googleAuthToken) {
        console.warn("Not authorized for Google Drive sync.");
        lastSyncStatus.textContent = "Sync failed: Not authorized with Google Drive.";
        lastSyncStatus.classList.add('error');
        return;
    }

    lastSyncStatus.textContent = "Syncing with Google Drive...";
    lastSyncStatus.classList.remove('error', 'success');

    try {
        const snippets = await getStoredSnippets();
        const data = JSON.stringify({ snippets, lastSynced: Date.now() }, null, 2);
        const metadata = {
            name: GOOGLE_DRIVE_FILENAME,
            mimeType: 'application/json',
            parents: ['appDataFolder']
        };

        const fileId = await findGoogleDriveFile(GOOGLE_DRIVE_FILENAME);
        let uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files';
        let method = 'POST';

        if (fileId) {
            uploadUrl += `/${fileId}`;
            method = 'PATCH'; // Update existing file
        } else {
            uploadUrl += `?uploadType=resumable`; // For new file creation
        }

        const formData = new FormData();
        formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        formData.append('data', new Blob([data], { type: 'application/json' }));

        const response = await fetch(uploadUrl, {
            method: method,
            headers: {
                'Authorization': `Bearer ${googleAuthToken}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google Drive upload failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Google Drive sync successful:', result);
        lastSyncStatus.textContent = `Last synced: ${new Date().toLocaleString()} (GDrive)`;
        lastSyncStatus.classList.add('success');
        lastSyncStatus.classList.remove('error');

        // Update local lastSync timestamp
        await chrome.storage.sync.set({ lastGoogleDriveSync: Date.now() });

    } catch (error) {
        console.error('Google Drive sync error:', error);
        lastSyncStatus.textContent = `Sync failed: ${error.message}`;
        lastSyncStatus.classList.add('error');
        lastSyncStatus.classList.remove('success');
    }
}

/**
 * Downloads pastr_data.json from Google Drive appDataFolder.
 * @returns {Promise<object|null>} The parsed data or null if not found/error.
 */
async function downloadFromGoogleDrive() {
    if (!googleAuthToken) {
        console.warn("Not authorized for Google Drive download.");
        return null;
    }

    try {
        const fileId = await findGoogleDriveFile(GOOGLE_DRIVE_FILENAME);
        if (!fileId) {
            console.log("No pastr_data.json found on Google Drive.");
            return null;
        }

        const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${googleAuthToken}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google Drive download failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('Google Drive download successful.');
        return data;
    } catch (error) {
        console.error('Google Drive download error:', error);
        return null;
    }
}

/**
 * Sets up the automatic sync interval.
 * Clears any existing interval first.
 * @param {number} intervalMinutes - The interval in minutes (0 to disable).
 */
async function setupAutoSync(intervalMinutes) {
    // Clear existing interval if any
    if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
        console.log("Cleared existing auto-sync interval.");
    }

    await chrome.storage.sync.set({ autoSyncInterval: intervalMinutes });

    if (intervalMinutes > 0) {
        const intervalMs = intervalMinutes * 60 * 1000;
        console.log(`Setting up auto-sync every ${intervalMinutes} minutes.`);
        syncIntervalId = setInterval(uploadToGoogleDrive, intervalMs);
        // Also run a sync immediately when interval is set
        uploadToGoogleDrive();
    } else {
        console.log("Auto-sync disabled.");
    }
}


// --- Event Handlers ---

async function handleAuthorizeGoogleDrive() {
    googleAuthToken = await getGoogleAuthToken();
    updateAuthUI(googleAuthToken);
    if (googleAuthToken) {
        // After authorization, immediately try to sync
        uploadToGoogleDrive();
    }
}

async function handleDeauthorizeGoogleDrive() {
    if (googleAuthToken && confirm('Are you sure you want to deauthorize Google Drive? This will stop all automatic syncing.')) {
        await revokeGoogleAuthToken(googleAuthToken);
        googleAuthToken = null; // Clear token
        updateAuthUI(googleAuthToken);
        setupAutoSync(0); // Disable auto sync
        syncIntervalSelect.value = "0"; // Update UI
        lastSyncStatus.textContent = "Google Drive sync disabled.";
        lastSyncStatus.classList.remove('success');
    }
}

async function handleManualSync() {
    lastSyncStatus.textContent = "Initiating manual sync...";
    lastSyncStatus.classList.remove('error', 'success');
    googleAuthToken = await getGoogleAuthToken(); // Try to get token interactively if not already
    updateAuthUI(googleAuthToken);
    if (googleAuthToken) {
        await uploadToGoogleDrive();
    } else {
        lastSyncStatus.textContent = "Manual sync failed: Authorization required.";
        lastSyncStatus.classList.add('error');
    }
}

async function handleExportData() {
    const snippets = await getStoredSnippets();
    const data = {
        pastrVersion: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
        snippets: snippets
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pastr_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log("Data exported successfully.");
}

async function handleImportData() {
    importFileInput.click(); // Trigger the hidden file input
}

importFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
        importStatus.textContent = "No file selected.";
        importStatus.classList.remove('success', 'error');
        return;
    }

    if (file.type !== 'application/json') {
        importStatus.textContent = "Invalid file type. Please select a JSON file.";
        importStatus.classList.add('error');
        return;
    }

    try {
        const fileContent = await file.text();
        const importedData = JSON.parse(fileContent);

        if (!importedData.snippets || !Array.isArray(importedData.snippets)) {
            throw new Error("Invalid Pastr backup format. Missing 'snippets' array.");
        }

        if (confirm(`Importing will overwrite your current ${importedData.snippets.length} snippets. Are you sure?`)) {
            await setStoredSnippets(importedData.snippets);
            importStatus.textContent = `Successfully imported ${importedData.snippets.length} snippets.`;
            importStatus.classList.add('success');
            importStatus.classList.remove('error');
            console.log("Data imported successfully.");

            // Clear the file input value to allow re-importing the same file
            importFileInput.value = '';
        } else {
            importStatus.textContent = "Import cancelled.";
            importStatus.classList.remove('success', 'error');
            importFileInput.value = '';
        }

    } catch (error) {
        console.error('Error importing data:', error);
        importStatus.textContent = `Error importing data: ${error.message}`;
        importStatus.classList.add('error');
        importStatus.classList.remove('success');
        importFileInput.value = '';
    }
});


// --- Initialization ---
async function initializeOptionsPage() {
    // Load saved settings and apply theme
    const settings = await chrome.storage.sync.get([
        'theme', 'accentColor', 'backgroundImage',
        'autoSyncInterval', 'lastGoogleDriveSync'
    ]);

    themeSelect.value = settings.theme || 'light';
    accentColorPicker.value = settings.accentColor || '#007bff';
    backgroundImageInput.value = settings.backgroundImage || '';
    syncIntervalSelect.value = String(settings.autoSyncInterval || 0); // Ensure string for select value

    // Apply initial theme
    applyTheme();

    // Update last sync status display
    if (settings.lastGoogleDriveSync) {
        lastSyncStatus.textContent = `Last synced: ${new Date(settings.lastGoogleDriveSync).toLocaleString()}`;
        lastSyncStatus.classList.remove('error');
    } else {
        lastSyncStatus.textContent = "Never synced with Google Drive.";
        lastSyncStatus.classList.remove('success', 'error');
    }

    // Check Google Drive authorization status
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
        googleAuthToken = token;
        updateAuthUI(googleAuthToken);
        // If authorized, set up auto sync based on stored interval
        if (googleAuthToken && settings.autoSyncInterval) {
            setupAutoSync(settings.autoSyncInterval);
        }
    });

    // --- Event Listeners ---
    themeSelect.addEventListener('change', saveThemeSettings);
    accentColorPicker.addEventListener('input', saveThemeSettings); // 'input' for live preview
    backgroundImageInput.addEventListener('input', saveThemeSettings);
    clearBackgroundImageBtn.addEventListener('click', async () => {
        backgroundImageInput.value = '';
        await saveThemeSettings();
    });

    authorizeGoogleDriveBtn.addEventListener('click', handleAuthorizeGoogleDrive);
    deauthorizeGoogleDriveBtn.addEventListener('click', handleDeauthorizeGoogleDrive);
    manualSyncBtn.addEventListener('click', handleManualSync);
    syncIntervalSelect.addEventListener('change', (event) => {
        setupAutoSync(parseInt(event.target.value));
    });

    exportDataBtn.addEventListener('click', handleExportData);
    importDataBtn.addEventListener('click', handleImportData);

    // Listen for storage changes (e.g., if background script syncs)
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.lastGoogleDriveSync) {
            const newTimestamp = changes.lastGoogleDriveSync.newValue;
            if (newTimestamp) {
                lastSyncStatus.textContent = `Last synced: ${new Date(newTimestamp).toLocaleString()} (Auto)`;
                lastSyncStatus.classList.add('success');
                lastSyncStatus.classList.remove('error');
            }
        }
        // Could also listen for 'theme', 'accentColor', 'backgroundImage' changes
        // if an external source could change them, though unlikely here.
    });
}

document.addEventListener('DOMContentLoaded', initializeOptionsPage);

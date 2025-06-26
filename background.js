// background.js

import { getStoredSnippets, setStoredSnippets } from './utils.js';

// --- Global State / Constants ---
const GOOGLE_DRIVE_SCOPES = [
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/drive.file' // Needed for fetching auth token for appDataFolder as well
];
const GOOGLE_DRIVE_FILENAME = 'pastr_data.json';
const CLIPBOARD_CHECK_INTERVAL_MS = 15 * 1000; // Check every 15 seconds

let currentAuthToken = null; // Stores the current Google Drive auth token
let autoSyncIntervalTimerId = null; // Stores the ID for the auto-sync setInterval
let clipboardCheckIntervalTimerId = null; // Stores the ID for the clipboard check setInterval
let lastClipboardContent = ''; // To prevent duplicate prompts for same clipboard content

// --- Utility Functions (similar to options.js, but adapted for background context) ---

/**
 * Fetches an access token for Google Drive (non-interactive if possible).
 * @returns {Promise<string|null>} The access token or null if not authorized.
 */
async function getGoogleAuthTokenBackground(interactive = false) {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: interactive, scopes: GOOGLE_DRIVE_SCOPES }, (token) => {
            if (chrome.runtime.lastError || !token) {
                console.warn("Background: Error getting auth token:", chrome.runtime.lastError ? chrome.runtime.lastError.message : "No token.");
                resolve(null);
            } else {
                console.log("Background: Google Auth Token obtained (or refreshed).");
                resolve(token);
            }
        });
    });
}

/**
 * Finds a file in the appDataFolder by name.
 * @param {string} fileName - The name of the file to find.
 * @returns {Promise<string|null>} The file ID if found, otherwise null.
 */
async function findGoogleDriveFileBackground(fileName) {
    if (!currentAuthToken) return null;

    const url = `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and 'appDataFolder' in parents&spaces=appDataFolder&fields=files(id)`;
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${currentAuthToken}` }
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return data.files.length > 0 ? data.files[0].id : null;
    } catch (error) {
        console.error('Background: Error finding Google Drive file:', error);
        return null;
    }
}

/**
 * Uploads (or updates) pastr_data.json to Google Drive appDataFolder.
 * This version also updates the last sync timestamp in storage.
 */
async function uploadToGoogleDriveBackground() {
    console.log("Background: Attempting Google Drive sync...");
    currentAuthToken = await getGoogleAuthTokenBackground(false); // Try non-interactive first

    if (!currentAuthToken) {
        console.warn("Background: Not authorized for Google Drive sync. Skipping upload.");
        // Notify options page if open
        chrome.storage.sync.set({ lastGoogleDriveSync: 'failed:no_auth' });
        return;
    }

    try {
        const snippets = await getStoredSnippets();
        const data = JSON.stringify({ snippets, lastSynced: Date.now() }, null, 2);
        const metadata = {
            name: GOOGLE_DRIVE_FILENAME,
            mimeType: 'application/json',
            parents: ['appDataFolder']
        };

        const fileId = await findGoogleDriveFileBackground(GOOGLE_DRIVE_FILENAME);
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
            headers: { 'Authorization': `Bearer ${currentAuthToken}` },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google Drive upload failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Background: Google Drive sync successful:', result);
        // Update last sync timestamp in storage, which the options page listens to
        await chrome.storage.sync.set({ lastGoogleDriveSync: Date.now() });

    } catch (error) {
        console.error('Background: Google Drive sync error:', error);
        chrome.storage.sync.set({ lastGoogleDriveSync: 'failed:' + Date.now() }); // Indicate failure
    }
}

/**
 * Sets up the automatic sync interval for Google Drive.
 * This is called by options.js when settings change, and by background.js on startup.
 * @param {number} intervalMinutes - The interval in minutes (0 to disable).
 */
async function setupAutoSyncBackground(intervalMinutes) {
    if (autoSyncIntervalTimerId) {
        clearInterval(autoSyncIntervalTimerId);
        autoSyncIntervalTimerId = null;
        console.log("Background: Cleared existing auto-sync interval.");
    }

    if (intervalMinutes > 0) {
        const intervalMs = intervalMinutes * 60 * 1000;
        console.log(`Background: Setting up auto-sync every ${intervalMinutes} minutes.`);
        // Run first sync immediately then periodically
        uploadToGoogleDriveBackground();
        autoSyncIntervalTimerId = setInterval(uploadToGoogleDriveBackground, intervalMs);
    } else {
        console.log("Background: Auto-sync disabled.");
    }
}

// --- Clipboard Monitoring ---

/**
 * Reads clipboard content. Requires 'clipboardRead' permission.
 * Needs active tab or user interaction for permissions on some OS.
 * For a background script, it generally needs to be triggered by an active page or extension event.
 * Due to security restrictions (Manifest V3 and browser limitations), a background script
 * cannot directly read arbitrary clipboard content without user interaction (e.g., paste event).
 * A more practical approach for "clipboard monitor" in the background might involve:
 * 1. Listening to `chrome.commands` for a "paste and save" shortcut.
 * 2. Content script that reads clipboard on specific user actions (e.g., right-click context menu)
 * and sends it to background.
 *
 * For now, we'll simulate it by using `navigator.clipboard.readText()` which works in extension contexts,
 * but real-world usage might be limited by user gestures.
 */
async function checkClipboardAndPrompt() {
    try {
        const currentClipboardContent = await navigator.clipboard.readText();
        if (currentClipboardContent && currentClipboardContent.trim() !== '' && currentClipboardContent !== lastClipboardContent) {
            lastClipboardContent = currentClipboardContent; // Update last seen content
            console.log("New clipboard content detected. Prompting user...");

            // Create a notification to prompt the user
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'assets/icons/icon128.png',
                title: 'New Clipboard Content Detected!',
                message: 'Do you want to save this to Pastr?',
                buttons: [{ title: 'Save' }, { title: 'Ignore' }],
                priority: 2
            }, (notificationId) => {
                // Store the content with the notification ID to retrieve it later
                chrome.storage.local.set({ [notificationId]: currentClipboardContent });
            });
        }
    } catch (error) {
        // This catch block often fires due to security restrictions on clipboard access
        // if no user gesture initiated the clipboard read.
        console.warn("Could not read clipboard (might require user gesture or active tab):", error.message);
    }
}

/**
 * Sets up the clipboard monitoring interval.
 * @param {boolean} enable - True to enable, false to disable.
 */
async function setupClipboardMonitor(enable) {
    if (clipboardCheckIntervalTimerId) {
        clearInterval(clipboardCheckIntervalTimerId);
        clipboardCheckIntervalTimerId = null;
        console.log("Background: Cleared existing clipboard monitor.");
    }

    if (enable) {
        console.log("Background: Setting up clipboard monitor.");
        // Run first check immediately then periodically
        checkClipboardAndPrompt();
        clipboardCheckIntervalTimerId = setInterval(checkClipboardAndPrompt, CLIPBOARD_CHECK_INTERVAL_MS);
    } else {
        console.log("Background: Clipboard monitor disabled.");
    }
}

// --- Event Listeners ---

// On extension install or update
chrome.runtime.onInstalled.addListener(async () => {
    console.log("Pastr installed or updated.");

    // Create context menu item
    chrome.contextMenus.create({
        id: "addToPastr",
        title: "Add to Pastr",
        contexts: ["selection"] // Show when text is selected
    });

    // Load saved settings for auto-sync and clipboard monitor on startup
    const settings = await chrome.storage.sync.get(['autoSyncInterval', 'clipboardMonitorEnabled']);

    // Initialize auto-sync
    if (settings.autoSyncInterval) {
        currentAuthToken = await getGoogleAuthTokenBackground(false); // Try non-interactive token
        if (currentAuthToken) {
            setupAutoSyncBackground(settings.autoSyncInterval);
        } else {
            console.warn("Auto-sync enabled but no Google Auth Token found on startup.");
        }
    }

    // Initialize clipboard monitor
    if (settings.clipboardMonitorEnabled) {
        setupClipboardMonitor(true);
    }
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "addToPastr" && info.selectionText) {
        const newSnippet = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            content: info.selectionText.trim(),
            tags: [],
            isFavorite: false,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        const snippets = await getStoredSnippets();
        snippets.unshift(newSnippet); // Add to the beginning
        await setStoredSnippets(snippets);

        console.log("Snippet added from context menu:", newSnippet.content);
        // Optionally notify user
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'assets/icons/icon48.png',
            title: 'Pastr Snippet Added!',
            message: `"${newSnippet.content.substring(0, 50)}..." saved.`,
            priority: 0
        });
    }
});

// Listener for notification button clicks (for clipboard monitor prompt)
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    const storedContent = await chrome.storage.local.get(notificationId);
    const clipboardContentToSave = storedContent[notificationId];

    if (clipboardContentToSave) {
        if (buttonIndex === 0) { // 'Save' button clicked
            const newSnippet = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                content: clipboardContentToSave.trim(),
                tags: [{ name: "clipboard", emoji: "📋" }], // Auto-tag clipboard snippets
                isFavorite: false,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            const snippets = await getStoredSnippets();
            snippets.unshift(newSnippet);
            await setStoredSnippets(snippets);
            console.log("Clipboard content saved as snippet.");
        }
        // Always remove the stored content after action
        chrome.storage.local.remove(notificationId);
    }
    chrome.notifications.clear(notificationId); // Dismiss notification
});

// Listen for messages from options page to control auto-sync or clipboard monitor
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "UPDATE_AUTO_SYNC_INTERVAL") {
        setupAutoSyncBackground(message.intervalMinutes);
        sendResponse({ success: true, message: `Sync interval set to ${message.intervalMinutes} mins.` });
    } else if (message.type === "UPDATE_CLIPBOARD_MONITOR_STATUS") {
        setupClipboardMonitor(message.enabled);
        sendResponse({ success: true, message: `Clipboard monitor ${message.enabled ? 'enabled' : 'disabled'}.` });
    }
    // Return true to indicate that sendResponse will be called asynchronously
    return true;
});

// Listener for storage changes:
// The options page updates autoSyncInterval, this background script reacts to it.
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        if (changes.autoSyncInterval) {
            console.log("Background: autoSyncInterval changed to", changes.autoSyncInterval.newValue);
            setupAutoSyncBackground(changes.autoSyncInterval.newValue);
        }
        if (changes.clipboardMonitorEnabled) {
            console.log("Background: clipboardMonitorEnabled changed to", changes.clipboardMonitorEnabled.newValue);
            setupClipboardMonitor(changes.clipboardMonitorEnabled.newValue);
        }
    }
});

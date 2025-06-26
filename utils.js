// utils.js

/**
 * Retrieves snippets from chrome.storage.sync.
 * @returns {Promise<Array>} A promise that resolves with an array of snippets.
 */
export async function getStoredSnippets() {
    return new Promise((resolve) => {
        chrome.storage.sync.get('snippets', (result) => {
            resolve(result.snippets || []);
        });
    });
}

/**
 * Stores snippets to chrome.storage.sync.
 * @param {Array} snippets - The array of snippets to store.
 * @returns {Promise<void>} A promise that resolves when snippets are stored.
 */
export async function setStoredSnippets(snippets) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ snippets: snippets }, () => {
            resolve();
        });
    });
}

/**
 * Generates a simple unique ID.
 * @returns {string} A unique ID string.
 */
export function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Future: Other utility functions like tag management helpers, etc.

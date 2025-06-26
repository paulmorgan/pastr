// popup.js

import { getStoredSnippets, setStoredSnippets, generateUniqueId } from './utils.js';

// Initialize Showdown converter
const converter = new showdown.Converter({
    tables: true, // Enable GFM tables
    tasklists: true, // Enable GFM task lists
    strikethrough: true, // Enable GFM strikethrough
    simplifiedAutoLink: true, // Enable simplified autolink
    parseImgDimensions: true // Allow dimension attributes for images
});

// DOM Elements
const snippetList = document.getElementById('snippetList');
const addSnippetBtn = document.getElementById('addSnippetBtn');
const optionsBtn = document.getElementById('optionsBtn');
const searchInput = document.getElementById('searchInput');
const toggleFavoritesBtn = document.getElementById('toggleFavorites');
const noSnippetsMessage = document.getElementById('noSnippetsMessage');

// State variables
let allSnippets = [];
let filteredSnippets = [];
let currentFilter = {
    query: '',
    showFavorites: false,
    tags: [] // Future: active tags for filtering
};

/**
 * Renders a single snippet's HTML.
 * @param {object} snippet - The snippet object.
 * @returns {string} - The HTML string for the snippet.
 */
function renderSnippet(snippet) {
    const markdownHtml = converter.makeHtml(snippet.content);
    const favoriteClass = snippet.isFavorite ? 'favorite' : '';
    const tagsHtml = snippet.tags.map(tag => `
        <span class="snippet-tag" data-tag-name="${tag.name}">
            <span class="emoji">${tag.emoji}</span> ${tag.name}
            <button class="remove-tag-from-snippet" data-snippet-id="${snippet.id}" data-tag-name="${tag.name}" aria-label="Remove tag ${tag.name}">×</button>
        </span>
    `).join('');

    return `
        <div class="snippet-item ${favoriteClass}" data-id="${snippet.id}">
            <div class="snippet-header">
                <div class="snippet-actions">
                    <button class="copy-btn" data-id="${snippet.id}" aria-label="Copy snippet to clipboard">
                        <span class="emoji">📋</span> Copy
                    </button>
                    <button class="edit-btn" data-id="${snippet.id}" aria-label="Edit snippet">
                        <span class="emoji">✏️</span> Edit
                    </button>
                    <button class="delete-btn" data-id="${snippet.id}" aria-label="Delete snippet">
                        <span class="emoji">🗑️</span> Delete
                    </button>
                </div>
                <button class="favorite-toggle ${favoriteClass}" data-id="${snippet.id}" aria-label="${snippet.isFavorite ? 'Unfavorite' : 'Favorite'} snippet">
                    <span class="emoji">${snippet.isFavorite ? '❤️' : '🤍'}</span>
                </button>
            </div>
            <div class="snippet-content">
                <div class="markdown-preview">${markdownHtml}</div>
                <textarea class="snippet-edit-area hidden" rows="5">${snippet.content}</textarea>
            </div>
            <div class="snippet-tags">
                ${tagsHtml}
                <button class="add-tag-btn" data-id="${snippet.id}" aria-label="Add tag to snippet">
                    <span class="emoji">🏷️</span> Add Tag
                </button>
            </div>
        </div>
    `;
}

/**
 * Renders all snippets based on current filters.
 */
function renderAllSnippets() {
    // Determine which snippets to display based on filters
    let snippetsToRender = allSnippets;

    // Apply favorite filter
    if (currentFilter.showFavorites) {
        snippetsToRender = snippetsToRender.filter(s => s.isFavorite);
    }

    // Apply search query filter
    if (currentFilter.query) {
        const query = currentFilter.query.toLowerCase();
        snippetsToRender = snippetsToRender.filter(snippet =>
            snippet.content.toLowerCase().includes(query) ||
            snippet.tags.some(tag => tag.name.toLowerCase().includes(query))
        );
    }

    if (snippetsToRender.length === 0) {
        noSnippetsMessage.classList.remove('hidden'); // Show message
        snippetList.innerHTML = ''; // Clear snippets
    } else {
        noSnippetsMessage.classList.add('hidden'); // Hide message
        snippetList.innerHTML = snippetsToRender.map(renderSnippet).join('');
    }
    attachEventListeners(); // Re-attach listeners after rendering
}

/**
 * Attaches event listeners to dynamically created snippet elements.
 */
function attachEventListeners() {
    // Copy button
    snippetList.querySelectorAll('.copy-btn').forEach(button => {
        button.onclick = async (event) => {
            const snippetId = event.currentTarget.dataset.id;
            const snippet = allSnippets.find(s => s.id === snippetId);
            if (snippet) {
                try {
                    await navigator.clipboard.writeText(snippet.content);
                    console.log(`Snippet ${snippetId} copied to clipboard.`);
                    // Optional: Add a visual feedback (e.g., "Copied!" message)
                } catch (err) {
                    console.error('Failed to copy text: ', err);
                }
            }
        };
    });

    // Edit button
    snippetList.querySelectorAll('.edit-btn').forEach(button => {
        button.onclick = (event) => {
            const snippetItem = event.currentTarget.closest('.snippet-item');
            const preview = snippetItem.querySelector('.markdown-preview');
            const editArea = snippetItem.querySelector('.snippet-edit-area');
            const snippetId = event.currentTarget.dataset.id;

            if (editArea.classList.contains('hidden')) {
                // Switch to edit mode
                preview.classList.add('hidden');
                editArea.classList.remove('hidden');
                editArea.focus();
                event.currentTarget.innerHTML = '<span class="emoji">💾</span> Save';
            } else {
                // Switch to preview mode and save changes
                const newContent = editArea.value;
                const snippetIndex = allSnippets.findIndex(s => s.id === snippetId);
                if (snippetIndex > -1) {
                    allSnippets[snippetIndex].content = newContent;
                    setStoredSnippets(allSnippets).then(() => {
                        // Re-render only the modified snippet or the whole list for simplicity
                        renderAllSnippets(); // Simpler for now, re-renders everything
                        console.log(`Snippet ${snippetId} updated.`);
                    });
                }
                event.currentTarget.innerHTML = '<span class="emoji">✏️</span> Edit';
            }
        };
    });

    // Delete button
    snippetList.querySelectorAll('.delete-btn').forEach(button => {
        button.onclick = async (event) => {
            const snippetId = event.currentTarget.dataset.id;
            if (confirm('Are you sure you want to delete this snippet?')) {
                allSnippets = allSnippets.filter(s => s.id !== snippetId);
                await setStoredSnippets(allSnippets);
                renderAllSnippets();
                console.log(`Snippet ${snippetId} deleted.`);
            }
        };
    });

    // Favorite toggle button
    snippetList.querySelectorAll('.favorite-toggle').forEach(button => {
        button.onclick = async (event) => {
            const snippetId = event.currentTarget.dataset.id;
            const snippetIndex = allSnippets.findIndex(s => s.id === snippetId);
            if (snippetIndex > -1) {
                allSnippets[snippetIndex].isFavorite = !allSnippets[snippetIndex].isFavorite;
                await setStoredSnippets(allSnippets);
                renderAllSnippets(); // Re-render to update favorite status visually
                console.log(`Snippet ${snippetId} favorite status toggled.`);
            }
        };
    });

    // Add Tag button (Placeholder for future tag management UI)
    snippetList.querySelectorAll('.add-tag-btn').forEach(button => {
        button.onclick = (event) => {
            const snippetId = event.currentTarget.dataset.id;
            console.log(`Open tag selection for snippet ${snippetId}`);
            // TODO: Implement actual tag selection UI
            alert("Tag management UI is coming soon!");
        };
    });

    // Remove Tag from snippet (Placeholder for future tag management UI)
    snippetList.querySelectorAll('.remove-tag-from-snippet').forEach(button => {
        button.onclick = async (event) => {
            const snippetId = event.currentTarget.dataset.id;
            const tagName = event.currentTarget.dataset.tagName;
            const snippetIndex = allSnippets.findIndex(s => s.id === snippetId);

            if (snippetIndex > -1) {
                allSnippets[snippetIndex].tags = allSnippets[snippetIndex].tags.filter(tag => tag.name !== tagName);
                await setStoredSnippets(allSnippets);
                renderAllSnippets();
                console.log(`Removed tag "${tagName}" from snippet ${snippetId}.`);
            }
        };
    });
}


/**
 * Adds a new empty snippet and opens it for editing.
 */
async function addNewSnippet() {
    const newSnippet = {
        id: generateUniqueId(),
        content: 'Your new snippet here...',
        tags: [],
        isFavorite: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    allSnippets.unshift(newSnippet); // Add to the beginning
    await setStoredSnippets(allSnippets);
    renderAllSnippets(); // Re-render to show the new snippet
    // Automatically switch to edit mode for the new snippet
    const newSnippetElement = snippetList.querySelector(`[data-id="${newSnippet.id}"]`);
    if (newSnippetElement) {
        const editButton = newSnippetElement.querySelector('.edit-btn');
        if (editButton) {
            editButton.click(); // Programmatically click the edit button
        }
    }
}

/**
 * Filters snippets based on the search input query.
 */
function handleSearchInput() {
    currentFilter.query = searchInput.value.trim();
    renderAllSnippets();
}

/**
 * Toggles the display of favorite snippets.
 */
function handleToggleFavorites() {
    currentFilter.showFavorites = !currentFilter.showFavorites;
    toggleFavoritesBtn.setAttribute('aria-pressed', currentFilter.showFavorites);
    if (currentFilter.showFavorites) {
        toggleFavoritesBtn.classList.add('active');
    } else {
        toggleFavoritesBtn.classList.remove('active');
    }
    renderAllSnippets();
}

/**
 * Opens the options page in a new tab.
 */
function openOptionsPage() {
    chrome.runtime.openOptionsPage();
}

/**
 * Initializes the popup: loads snippets, sets up event listeners.
 */
async function initializePopup() {
    allSnippets = await getStoredSnippets();
    renderAllSnippets();

    addSnippetBtn.addEventListener('click', addNewSnippet);
    optionsBtn.addEventListener('click', openOptionsPage);
    searchInput.addEventListener('input', handleSearchInput);
    toggleFavoritesBtn.addEventListener('click', handleToggleFavorites);
    // Set initial aria-pressed state for favorites button
    toggleFavoritesBtn.setAttribute('aria-pressed', currentFilter.showFavorites);

    // Listen for storage changes from other contexts (e.g., background script, options page)
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.snippets) {
            console.log("Storage change detected, re-rendering snippets.");
            allSnippets = changes.snippets.newValue || [];
            renderAllSnippets();
        }
    });
}

// Initialize when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializePopup);

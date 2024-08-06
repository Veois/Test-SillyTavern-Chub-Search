// Importing necessary utilities and settings
import {
    getRequestHeaders,
    processDroppedFiles,
    callPopup
} from "../../../../script.js";
import { delay, debounce } from "../../../utils.js";
import { extension_settings } from "../../../extensions.js";

const extensionName = "SillyTavern-Chub-Search";
const extensionFolderPath = `scripts/extensions/${extensionName}/`;

const API_ENDPOINT_SEARCH = "https://api.chub.ai/api/characters/search";
const API_ENDPOINT_DOWNLOAD = "https://api.chub.ai/api/characters/download";

const defaultSettings = {
    findCount: 30, // Display 30 cards per page
    nsfw: true,
};

let chubCharacters = [];
let characterListContainer = null;
let popupState = null;
let savedPopupContent = null;

async function loadSettings() {
    if (!extension_settings.chub) {
        console.log("Creating extension_settings.chub");
        extension_settings.chub = {};
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!extension_settings.chub.hasOwnProperty(key)) {
            console.log(`Setting default for: ${key}`);
            extension_settings.chub[key] = value;
        }
    }
}

async function downloadCharacter(fullPath) {
    try {
        let request = await fetch(API_ENDPOINT_DOWNLOAD, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ fullPath, format: 'tavern', version: 'main' }),
        });

        if (!request.ok) {
            throw new Error(`HTTP error! status: ${request.status}`);
        }

        const data = await request.blob();
        const fileName = request.headers.get('Content-Disposition').split('filename=')[1].replace(/"/g, '');
        const file = new File([data], fileName, { type: data.type });

        await processDroppedFiles([file]);
    } catch (error) {
        console.error('Error downloading character:', error);
    }
}

function updateCharacterListInView(characters) {
    if (characterListContainer) {
        characterListContainer.innerHTML = characters.map(generateCharacterListItem).join('');
    }
}

function generateCharacterListItem(character) {
    return `
        <div class="character-list-item">
            <img class="thumbnail" src="${character.url}">
            <div class="info">
                <a href="https://chub.ai/characters/${character.fullPath}" target="_blank"><div class="name">${character.name || "Default Name"}</a>
                <a href="https://chub.ai/users/${character.author}" target="_blank">
                 <span class="author">by ${character.author}</span>
                </a></div>
                <div class="description">${character.description}</div>
                <div class="tags">${character.tags.slice(0, 5).map(tag => `<span class="tag">${tag}</span>`).join('')}</div>
            </div>
            <div data-path="${character.fullPath}" class="menu_button download-btn fa-solid fa-cloud-arrow-down faSmallFontSquareFix"></div>
        </div>
    `;
}

async function fetchCharactersBySearch(options) {
    let { searchTerm, includeTags, excludeTags, nsfw, sort, page } = options;
    let first = 30;
    let asc = false;
    let include_forks = true;

    nsfw = nsfw || extension_settings.chub.nsfw;
    searchTerm = searchTerm ? `search=${encodeURIComponent(searchTerm)}&` : '';
    sort = sort || 'download_count';
    page = page || 1;

    let url = `${API_ENDPOINT_SEARCH}?${searchTerm}first=${first}&page=${page}&sort=${sort}&asc=${asc}&include_forks=${include_forks}&nsfw=${nsfw}`;

    includeTags = includeTags.filter(tag => tag.length > 0).join(',');
    excludeTags = excludeTags.filter(tag => tag.length > 0).join(',');

    if (includeTags) url += `&tags=${encodeURIComponent(includeTags)}`;
    if (excludeTags) url += `&exclude_tags=${encodeURIComponent(excludeTags)}`;

    const response = await fetch(url);
    const data = await response.json();

    chubCharacters = [];

    if (data.nodes.length > 0) {
        let promises = data.nodes.map(node => getCharacter(node.fullPath));
        let characterBlobs = await Promise.all(promises);

        characterBlobs.forEach((blob, index) => {
            let imageUrl = URL.createObjectURL(blob);
            chubCharacters.push({
                url: imageUrl,
                description: data.nodes[index].tagline || "Description here...",
                name: data.nodes[index].name,
                fullPath: data.nodes[index].fullPath,
                tags: data.nodes[index].topics,
                author: data.nodes[index].fullPath.split('/')[0],
            });
        });
    }

    return chubCharacters;
}

jQuery(async () => {
    $("#external_import_button").after('<button id="search-chub" class="menu_button fa-solid fa-cloud-bolt faSmallFontSquareFix" title="Search CHub for characters"></button>');
    $("#search-chub").on("click", function () {
        openSearchPopup();
    });

    loadSettings();
});

document.addEventListener('click', function handler() {
  if (clone) {
      document.body.removeChild(clone);
      clone = null;
  }
});

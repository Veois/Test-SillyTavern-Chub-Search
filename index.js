// An extension that allows you to import characters from CHub.
import {
    getRequestHeaders,
    processDroppedFiles,
    callPopup
} from "../../../../script.js";
import { delay, debounce } from "../../../utils.js";
import { extension_settings } from "../../../extensions.js";

const extensionName = "Test-SillyTavern-Chub-Search";
const extensionFolderPath = `scripts/extensions/${extensionName}/`;

// Endpoint for API call
const API_ENDPOINT_SEARCH = "https://api.chub.ai/api/characters/search";
const API_ENDPOINT_DOWNLOAD = "https://api.chub.ai/api/characters/download";

const defaultSettings = {
    findCount: 10,
    nsfw: false,
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
        console.debug('Custom content import started', fullPath);
        let request = await fetch('/api/content/import', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url: fullPath }),
        });

        if (!request.ok) {  
            request = await fetch('/import_custom', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ url: fullPath }),
            });
        }

        if (!request.ok) {
            throw new Error(`HTTP error! status: ${request.status}`);
        }

        const data = await request.blob();
        const customContentType = request.headers.get('X-Custom-Content-Type');
        const fileName = request.headers.get('Content-Disposition').split('filename=')[1].replace(/"/g, '');
        const file = new File([data], fileName, { type: data.type });

        switch (customContentType) {
            case 'character':
                await processDroppedFiles([file]);
                break;
            default:
                toastr.warning('Unknown content type');
                console.error('Unknown content type', customContentType);
                break;
        }
    } catch (error) {
        console.error('Error downloading character:', error);
        toastr.error('Failed to download character. Check console for details.');
    }
}

function updateCharacterListInView(characters) {
    if (characterListContainer) {
        characterListContainer.innerHTML = characters.map(generateCharacterListItem).join('');
    }
}

function makeTagPermutations(tags) {
    let permutations = [];
    for (let tag of tags) {
        if(tag) {
            permutations.push(tag);
            permutations.push(tag.toUpperCase());
            permutations.push(tag[0].toUpperCase() + tag.slice(1));
        }
    }
    return permutations;
}

async function fetchCharactersBySearch({ searchTerm, includeTags, excludeTags, nsfw, sort, page=1 }) {
    let first = 40; // вместо extension_settings.chub.findCount
    let asc = false;
    let include_forks = true;
    nsfw = nsfw || extension_settings.chub.nsfw;
    let require_images = false;
    let require_custom_prompt = false;
    searchTerm = searchTerm ? `search=${encodeURIComponent(searchTerm)}&` : '';
    sort = sort || 'download_count';

    let url = `${API_ENDPOINT_SEARCH}?${searchTerm}first=${first}&page=${page}&sort=${sort}&asc=${asc}&venus=true&include_forks=${include_forks}&nsfw=${nsfw}&require_images=${require_images}&require_custom_prompt=${require_custom_prompt}`;

    includeTags = includeTags.filter(tag => tag.length > 0);
    if (includeTags && includeTags.length > 0) {
        includeTags = includeTags.join(',').slice(0, 100);
        url += `&tags=${encodeURIComponent(includeTags)}`;
    }

    excludeTags = excludeTags.filter(tag => tag.length > 0);
    if (excludeTags && excludeTags.length > 0) {
        excludeTags = excludeTags.join(',').slice(0, 100);
        url += `&exclude_tags=${encodeURIComponent(excludeTags)}`;
    }

    let searchResponse = await fetch(url);
    let searchData = await searchResponse.json();

    chubCharacters = [];

    if (searchData.nodes.length === 0) {
        return chubCharacters;
    }
    let charactersPromises = searchData.nodes.map(node => getCharacter(node.fullPath));
    let characterBlobs = await Promise.all(charactersPromises);

    characterBlobs.forEach((character, i) => {
        let imageUrl = URL.createObjectURL(character);
        chubCharacters.push({
            url: imageUrl,
            description: searchData.nodes[i].tagline || "Description here...",
            name: searchData.nodes[i].name,
            fullPath: searchData.nodes[i].fullPath,
            tags: searchData.nodes[i].topics,
            author: searchData.nodes[i].fullPath.split('/')[0],
        });
    });

    return chubCharacters;
}

async function searchCharacters(options) {
    if (characterListContainer && !document.body.contains(characterListContainer)) {
        console.log('Character list container is not in the DOM, removing reference');
        characterListContainer = null;
    }
    if (characterListContainer) {
        characterListContainer.classList.add('searching');
    }
    console.log('Searching for characters', options);
    const characters = await fetchCharactersBySearch(options);
    if (characterListContainer) {
        characterListContainer.classList.remove('searching');
    }

    return characters;
}

function openSearchPopup() {
    displayCharactersInListViewPopup();
}

async function executeCharacterSearch(options) {
    try {
        const characters = await searchCharacters(options);

        if (characters && characters.length > 0) {
            console.log('Updating character list');
            updateCharacterListInView(characters);
        } else {
            console.log('No characters found');
            if (characterListContainer) {
                characterListContainer.innerHTML = '<div class="no-characters-found">No characters found</div>';
            }
        }
    } catch (error) {
        console.error('Error executing character search:', error);
        if (characterListContainer) {
            characterListContainer.innerHTML = '<div class="error-message">An error occurred while searching. Please try again.</div>';
        }
    }
}

function generateCharacterListItem(character, index) {
    return `
        <div class="character-list-item" data-index="${index}">
            <img class="thumbnail" src="${character.url}" alt="${character.name}">
            <div class="info">
                <div class="name">
                    <a href="https://chub.ai/characters/${character.fullPath}" target="_blank">${character.name || "Default Name"}</a>
                </div>
                <div class="author">by <a href="https://chub.ai/users/${character.author}" target="_blank">${character.author}</a></div>
                <div class="description">${character.description}</div>
                <div class="tags">${character.tags.slice(0, 5).map(tag => `<span class="tag">${tag}</span>`).join('')}</div>
            </div>
            <div class="download-container">
                <div data-path="${character.fullPath}" class="menu_button download-btn fa-solid fa-cloud-arrow-down faSmallFontSquareFix"></div>
            </div>
        </div>
    `;
}

async function displayCharactersInListViewPopup() {
    if (savedPopupContent) {
        console.log('Using saved popup content');
        callPopup('', "text", '', { okButton: "Close", wide: true, large: true })
        .then(() => {
            savedPopupContent = document.querySelector('.list-and-search-wrapper');
        });

        document.getElementById('dialogue_popup_text').appendChild(savedPopupContent);
        characterListContainer = document.querySelector('.character-list-popup');
        return;
    }

    const readableOptions = {
        "download_count": "Download Count",
        "id": "ID",
        "rating": "Rating",
        "default": "Default",
        "rating_count": "Rating Count",
        "last_activity_at": "Last Activity",
        "trending_downloads": "Trending Downloads",
        "created_at": "Creation Date",
        "name": "Name",
        "n_tokens": "Token Count",
        "random": "Random"
    };

    const listLayout = popupState ? popupState : `
    <div class="list-and-search-wrapper" id="list-and-search-wrapper">
        <div class="character-list-popup">
            ${chubCharacters.map((character, index) => generateCharacterListItem(character, index)).join('')}
        </div>
        <hr>
        <div class="search-container">
            <div class="flex-container flex-no-wrap flex-align-center">
            <label for="characterSearchInput"><i class="fas fa-search"></i></label>
            <input type="text" id="characterSearchInput" class="text_pole flex1" placeholder="Search CHUB for characters...">
            </div>
            <div class="flex-container flex-no-wrap flex-align-center">
            <label for="includeTags"><i class="fas fa-plus-square"></i></label>
            <input type="text" id="includeTags" class="text_pole flex1" placeholder="Include tags (comma separated)">
            </div>
            <div class="flex-container">
            <label for="excludeTags"><i class="fas fa-minus-square"></i></label>
            <input type="text" id="excludeTags" class="text_pole flex1" placeholder="Exclude tags (comma separated)">
            </div>
            <div class="page-buttons flex-container flex-no-wrap flex-align-center">
                <div class="flex-container flex-no-wrap flex-align-center">
                    <button class="menu_button" id="pageDownButton"><i class="fas fa-chevron-left"></i></button>
                    <label for="pageNumber">Page:</label>
                    <input type="number" id="pageNumber" class="text_pole textarea_compact wide10pMinFit" min="1" value="1">
                    <button class="menu_button" id="pageUpButton"><i class="fas fa-chevron-right"></i></button>
                </div>
                <div class="flex-container flex-no-wrap flex-align-center">
                <label for="sortOrder">Sort By:</label>
                <select class="margin0" id="sortOrder">
                ${Object.keys(readableOptions).map(key => `<option value="${key}">${readableOptions[key]}</option>`).join('')}
                </select>
                </div>
                <div class="flex-container flex-no-wrap flex-align-center">
                    <label for="nsfwCheckbox">NSFW:</label>
                    <input type="checkbox" id="nsfwCheckbox">
                </div>
                <div class="menu_button" id="characterSearchButton">Search</div>
            </div>
        </div>
    </div>
    `;

    callPopup(listLayout, "text", '', { okButton: "Close", wide: true, large: true })
        .then(() => {
            savedPopupContent = document.querySelector('.list-and-search-wrapper');
        });

    characterListContainer = document.querySelector('.character-list-popup');   

    let clone = null;

    characterListContainer.addEventListener('click', function (event) {
        if (event.target.tagName === 'IMG') {
            const image = event.target;

            if (clone) {
                document.body.removeChild(clone);
                clone = null;
                return;
            }

            const rect = image.getBoundingClientRect();

            clone = image.cloneNode(true);
            clone.style.position = 'absolute';
            clone.style.top = `${rect.top + window.scrollY}px`;
            clone.style.left = `${rect.left + window.scrollX}px`;
            clone.style.transform = 'scale(4)';
            clone.style.zIndex = 99999;
            clone.style.objectFit = 'contain';

            document.body.appendChild(clone);

            event.stopPropagation();
        }
    });

    document.addEventListener('click', function handler() {
        if (clone) {
            document.body.removeChild(clone);
            clone = null;
        }
    });

    characterListContainer.addEventListener('click', async function (event) {
        if (event.target.classList.contains('download-btn')) {
            const fullPath = event.target.getAttribute('data-path');
            if (fullPath) {
                await downloadCharacter(fullPath);
            } else {
                console.error('No data-path attribute found on download button');
            }
        }
    });

    const executeCharacterSearchDebounced = debounce((options) => executeCharacterSearch(options), 750);

    const handleSearch = async function (e) {
        console.log('handleSearch', e);
        if (e.type === 'keydown' && e.key !== 'Enter' && e.target.id !== 'includeTags' && e.target.id !== 'excludeTags') {
            return;
        }

        const splitAndTrim = (str) => {
            str = str.trim();
            if (!str.includes(',')) {
                return [str];
            }
            return str.split(',').map(tag => tag.trim());
        };

        console.log(document.getElementById('includeTags').value);

        const searchTerm = document.getElementById('characterSearchInput').value;
        const includeTags = splitAndTrim(document.getElementById('includeTags').value);
        const excludeTags = splitAndTrim(document.getElementById('excludeTags').value);
        const nsfw = document.getElementById('nsfwCheckbox').checked;
        const sort = document.getElementById('sortOrder').value;
        let page = document.getElementById('pageNumber').value;

        if (e.target.id !== 'pageNumber' && e.target.id !== 'pageUpButton' && e.target.id !== 'pageDownButton') {
            page = 1;
            document.getElementById('pageNumber').value = 1;
        } else {
            page = parseInt(document.getElementById('pageNumber').value);
        }

        executeCharacterSearchDebounced({
            searchTerm,
            includeTags,
            excludeTags,
            nsfw,
            sort,
            page
        });
    };

    document.getElementById('characterSearchInput').addEventListener('change', handleSearch);
    document.getElementById('characterSearchButton').addEventListener('click', handleSearch);
    document.getElementById('includeTags').addEventListener('keyup', handleSearch);
    document.getElementById('excludeTags').addEventListener('keyup', handleSearch);
    document.getElementById('sortOrder').addEventListener('change', handleSearch);
    document.getElementById('nsfwCheckbox').addEventListener('change', handleSearch);

    document.getElementById('pageNumber').addEventListener('change', handleSearch);
    document.getElementById('pageUpButton').addEventListener('click', function (e) {
        let pageNumber = document.getElementById('pageNumber'); 
        pageNumber.value = parseInt(pageNumber.value) + 1;
        pageNumber.value = Math.max(1, pageNumber.value);
        handleSearch(e);
    });

    document.getElementById('pageDownButton').addEventListener('click', function (e) {
        let pageNumber = document.getElementById('pageNumber');
        pageNumber.value = parseInt(pageNumber.value) - 1;
        pageNumber.value = Math.max(1, pageNumber.value);
        handleSearch(e);
    });
}

async function getCharacter(fullPath) {
    let response = await fetch(
        API_ENDPOINT_DOWNLOAD,
        {
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fullPath: fullPath,
                format: "tavern",
                version: "main"
            }),
        }
    );

    if (!response.ok) {
        console.log(`Request failed for ${fullPath}, trying backup endpoint`);
        response = await fetch(
            `https://avatars.charhub.io/avatars/${fullPath}/avatar.webp`,
            {
                method: "GET",
                headers: {
                    'Content-Type': 'application/json'
                },
            }
        );
    }
    let data = await response.blob();
    return data;
}

jQuery(async () => {
    $("#external_import_button").after('<button id="search-chub" class="menu_button fa-solid fa-cloud-bolt faSmallFontSquareFix" title="Search CHub for characters"></button>');
    $("#search-chub").on("click", function () {
        openSearchPopup();
    });

    loadSettings();
});

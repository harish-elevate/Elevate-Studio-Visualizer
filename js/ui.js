import { state, db } from './state.js';
import { renderCustomizerCanvas, generateBrochurePDF, exportPdf, exportPlan } from './canvas.js';
import { renderAdminEditor } from './admin.js';
import * as data from './data.js';

export const getEl = (id) => document.getElementById(id);

export function createElement(tag, attributes = {}, children = []) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key.startsWith('on') && typeof value === 'function') {
            const eventName = key.substring(2).toLowerCase();
            el.addEventListener(eventName, value);
        } else if (key === 'className') {
            el.className = value;
        } else if (key === 'textContent') {
            el.textContent = value;
        } else if (key.startsWith('data-')) {
            const dataKey = key.substring(5).replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
            el.dataset[dataKey] = value;
        } else {
            el.setAttribute(key, value);
        }
    }
    for (const child of children) { el.append(child); }
    return el;
}

export function showView(pageId) {
    document.querySelectorAll('#app > div').forEach(p => p.classList.add('hidden'));
    getEl(pageId).classList.remove('hidden');
    window.scrollTo(0, 0);
}

export function updateHeader() {
    getEl('adminLoginBtn').textContent = state.isAdminLoggedIn ? 'Admin Dashboard' : 'Admin Login';
}

export function showModal(title, fields, options = {}) {
    getEl('modalTitle').textContent = title;
    const form = getEl('modalForm');
    form.innerHTML = '';
    
    fields.forEach(f => {
        const group = createElement('div', { className: 'modal-form-group' });
        const label = createElement('label', { for: `modal-${f.id}`, textContent: f.label });

        if (f.type === 'gallery') {
            group.append(label);
            const galleryGrid = createElement('div', { className: 'modal-gallery-grid' });
            
            (f.images || []).forEach((imgObj, idx) => {
                const url = typeof imgObj === 'string' ? imgObj : imgObj.url;
                const groupName = typeof imgObj === 'string' ? '' : (imgObj.group || '');
                const desc = typeof imgObj === 'string' ? '' : (imgObj.description || '');

                const imgContainer = createElement('div', { className: 'modal-gallery-item' }, [
                    createElement('img', { src: url }),
                    createElement('div', { className: 'gallery-meta' }, [
                        createElement('input', { type: 'text', placeholder: 'Package/Group', value: groupName, className: 'gallery-group-input', 'data-index': idx }),
                        createElement('input', { type: 'text', placeholder: 'Description', value: desc, className: 'gallery-desc-input', 'data-index': idx })
                    ]),
                    createElement('button', { type: 'button', className: 'gallery-delete-btn', textContent: '×', 'data-url': url })
                ]);
                galleryGrid.append(imgContainer);
            });
            group.append(galleryGrid);
            const inputEl = createElement('input', { id: `modal-${f.id}`, type: 'file', multiple: true, name: f.id });
            inputEl.style.marginTop = '10px';
            group.append(inputEl);

        } else if (f.type === 'checkbox-group') {
            group.append(label);
            const container = createElement('div', { className: 'dependency-list-container' });
            
            if (!f.options || f.options.length === 0) {
                container.textContent = "No options available in this model.";
                container.style.color = "#999";
                container.style.padding = "10px";
                container.style.fontStyle = "italic";
            } else {
                f.options.forEach(opt => {
                    const isChecked = f.values && f.values.includes(opt.value);
                    const itemRow = createElement('div', { className: 'dependency-item' });
                    
                    const cb = createElement('input', { 
                        type: 'checkbox', 
                        name: f.id, 
                        value: opt.value,
                        id: `cb-${f.id}-${opt.value}`
                    });
                    if(isChecked) cb.checked = true;

                    const cbLabel = createElement('label', { 
                        textContent: opt.label, 
                        for: `cb-${f.id}-${opt.value}` 
                    });

                    itemRow.append(cb, cbLabel);
                    container.append(itemRow);
                });
            }
            group.append(container);

        } else if (f.type === 'checkbox') {
            const attributes = { id: `modal-${f.id}`, type: 'checkbox', name: f.id };
            if (f.checked) attributes.checked = true;
            const inputEl = createElement('input', attributes);
            inputEl.style.width = 'auto';
            inputEl.style.marginRight = '10px';
            group.style.display = 'flex';
            group.style.flexDirection = 'row-reverse';
            group.style.alignItems = 'center';
            group.style.justifyContent = 'flex-end';
            group.append(label);
            group.append(inputEl);
        } else {
            group.append(label);
            const attributes = { 
                id: `modal-${f.id}`, 
                type: f.type || 'text',
                name: f.id,
                autocomplete: 'off'
            };
            if (f.value) attributes.value = f.value;
            if (f.type === 'file') {
                attributes['data-existing-value'] = f.existingValue || '';
                if (f.existingValue) {
                    const preview = createElement('img', { src: f.existingValue, style: 'max-width: 100px; max-height: 100px; margin-top: 5px; border: 1px solid #ccc;' });
                    group.append(preview);
                }
            }
            const inputEl = createElement(f.type === 'textarea' ? 'textarea' : 'input', attributes);
             if (f.type === 'textarea') inputEl.textContent = f.value || '';
            group.append(inputEl);
        }
        form.append(group);
    });

    if (options.dangerZone) {
        const dangerZoneContainer = createElement('div', { className: 'modal-danger-zone' });
        const dangerBtn = createElement('button', { type: 'button', className: 'btn-danger-outline', textContent: options.dangerZone.buttonText });
        dangerBtn.addEventListener('click', options.dangerZone.callback);
        dangerZoneContainer.append(dangerBtn);
        form.append(dangerZoneContainer);
    }
    
    const modalContent = getEl('modal').querySelector('.modal-content');
    modalContent.className = 'modal-content';
    if (options.modalClass) modalContent.classList.add(options.modalClass);
    getEl('modal').classList.remove('hidden');
    getEl('modalSave').classList.remove('hidden');

    const firstInput = form.querySelector('input:not([type=file]), textarea');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
    }
}

export function showSortableListModal(title, items, saveCallback) {
    const modal = getEl('modal');
    const modalContent = modal.querySelector('.modal-content');
    const list = createElement('ul', { id: 'sortable-list', className: 'sortable-list' });
    items.forEach(item => {
        const li = createElement('li', { textContent: item.text, 'data-id': item.id });
        list.appendChild(li);
    });
    modalContent.innerHTML = '';
    modalContent.append(
        createElement('h3', { textContent: title }),
        createElement('p', { textContent: 'Drag and drop to reorder.', style: 'margin-bottom: 15px; color: #666;' }),
        list,
        createElement('div', { className: 'modal-actions' }, [
            createElement('button', { type: 'button', id: 'modalCancel', className: 'btn-secondary', textContent: 'Cancel' }),
            createElement('button', { type: 'button', id: 'modalSave', textContent: 'Save Order' })
        ])
    );
    const sortable = new Sortable(list, { animation: 150 });
    modal.querySelector('#modalSave').addEventListener('click', () => {
        const orderedIds = Array.from(list.children).map(li => li.dataset.id);
        saveCallback(orderedIds);
    });
    modal.classList.remove('hidden');
}

export function showGalleryViewerModal(galleryData, optionName, optionId) {
    const option = db.Option.find(o => o.id === optionId);
    const optionSetId = option.BelongsToOptionSet;
    const optionSet = db.OptionSet.find(s => s.id === optionSetId);
    
    const currentOptionSelection = state.customizerSelections[optionSetId] || [];
    const selectedIds = Array.isArray(currentOptionSelection) ? currentOptionSelection : [currentOptionSelection];
    const isThisOptionSelected = selectedIds.includes(optionId);

    const images = galleryData.map(item => typeof item === 'string' ? { url: item, group: '', description: '' } : item);
    let currentIndex = 0;
    const modal = getEl('modal');
    const modalContent = modal.querySelector('.modal-content');

    function render() {
        const currentImg = images[currentIndex];
        
        const gallerySelections = state.designSelections[optionId] || [];
        const isImageSelected = gallerySelections.some(s => s.url === currentImg.url);

        let mainActionBtn = '';
        let altActionText = '';

        if (isThisOptionSelected) {
            mainActionBtn = `<button type="button" id="selectPackageBtn" class="${isImageSelected ? 'btn-secondary' : ''}">
                ${isImageSelected ? 'Deselect This Package' : 'Select This Package'}
            </button>`;
        } else {
            if (optionSet.allow_multiple_selections) {
                mainActionBtn = `<button type="button" id="multiSelectBtn">Select Option & Package</button>`;
            } else {
                mainActionBtn = `<button type="button" id="swapSelectBtn" style="background-color: var(--secondary-color);">
                    Select ${optionName} Instead
                </button>`;
                
                if (selectedIds.length > 0) {
                    const currentOpt = db.Option.find(o => o.id === selectedIds[0]);
                    if(currentOpt) altActionText = `<p style="font-size: 0.8rem; margin-top: 5px; color: #666;">(Currently selected: ${currentOpt.Name})</p>`;
                }
            }
        }

        const navHtml = images.length > 1 ? `
            <div class="gallery-nav-zone left">
                <span class="material-symbols-outlined gallery-arrow">chevron_left</span>
            </div>
            <div class="gallery-nav-zone right">
                <span class="material-symbols-outlined gallery-arrow">chevron_right</span>
            </div>
        ` : '';

        modalContent.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3>Gallery: ${optionName}</h3>
                <div style="font-size:0.9rem; color:#666;">
                    ${currentImg.group ? `Package: <strong>${currentImg.group}</strong>` : ''}
                </div>
            </div>
            
            <div class="gallery-viewer">
                <img class="gallery-viewer-image" src="${currentImg.url}" style="${isImageSelected ? 'border: 4px solid var(--primary-color);' : ''}">
                ${navHtml}
                <div class="gallery-viewer-counter" style="position:absolute; bottom:10px; right:10px; background:rgba(0,0,0,0.5); color:white; padding:2px 8px; border-radius:4px; font-size:0.8rem;">
                    ${currentIndex + 1} / ${images.length}
                </div>
            </div>

            <div style="margin-top:15px; text-align:center; min-height: 60px;">
                <p style="margin-bottom: 10px;">${currentImg.description || ''}</p>
                ${mainActionBtn}
                ${altActionText}
            </div>

            <div style="margin-top:20px; padding-top:15px; border-top:1px solid #eee;">
                <h4>Notes (For Brochure)</h4>
                <textarea id="galleryNotesInput" placeholder="Add notes for this selection..." rows="3" style="width:100%; padding:8px; border-color:var(--border-color);" ${!isThisOptionSelected ? 'disabled' : ''}>${state.galleryNotes[optionId] || ''}</textarea>
                ${!isThisOptionSelected ? '<p style="font-size:0.8rem; color:red;">Select this option to add notes.</p>' : ''}
            </div>

            <div style="margin-top:20px; padding-top:15px; border-top:1px solid #eee;">
                <h4>Upload Your Own Reference</h4>
                <input type="file" id="userUploadInput" accept="image/*" style="margin-bottom:10px;" ${!isThisOptionSelected ? 'disabled' : ''}>
                <div id="userUploadsPreview" style="display:flex; gap:10px; overflow-x:auto;"></div>
            </div>
            
            <div class="ui-disclaimer">
                Note: This is just a selection of structure only, the colors will be finalized after discussion with our designer.
            </div>

            <div class="modal-actions" style="justify-content: center;">
                <button type="button" id="modalCancel" class="btn-secondary">Close</button>
            </div>
        `;

        const uploads = state.userUploads[optionId] || [];
        const previewContainer = modalContent.querySelector('#userUploadsPreview');
        uploads.forEach(up => {
            const thumb = createElement('img', { src: up.url, style: 'height:60px; border-radius:4px;' });
            previewContainer.appendChild(thumb);
        });

        if (images.length > 1) {
            modalContent.querySelector('.gallery-nav-zone.left').onclick = (e) => {
                e.stopPropagation();
                currentIndex = (currentIndex - 1 + images.length) % images.length;
                render();
            };
            modalContent.querySelector('.gallery-nav-zone.right').onclick = (e) => {
                e.stopPropagation();
                currentIndex = (currentIndex + 1) % images.length;
                render();
            };
        }

        const selectPackageBtn = modalContent.querySelector('#selectPackageBtn');
        if (selectPackageBtn) {
            selectPackageBtn.onclick = () => {
                if (isImageSelected) {
                    state.designSelections[optionId] = []; 
                } else {
                    let newSelections = [];
                    if (currentImg.group && currentImg.group !== 'Uncategorized') {
                        const groupImages = images.filter(img => img.group === currentImg.group);
                        groupImages.forEach(gImg => newSelections.push(gImg));
                    } else {
                        newSelections.push(currentImg);
                    }
                    state.designSelections[optionId] = newSelections;
                }
                render(); 
            };
        }

        const swapBtn = modalContent.querySelector('#swapSelectBtn');
        if (swapBtn) {
            swapBtn.onclick = () => {
                state.customizerSelections[optionSetId] = [optionId]; 
                autoSelectPackage();
                saveDataToBrowser();
                renderCustomizerControls();
                renderCustomizerCanvas();
                showGalleryViewerModal(galleryData, optionName, optionId);
            };
        }

        const multiBtn = modalContent.querySelector('#multiSelectBtn');
        if (multiBtn) {
            multiBtn.onclick = () => {
                if (!state.customizerSelections[optionSetId]) state.customizerSelections[optionSetId] = [];
                state.customizerSelections[optionSetId].push(optionId);
                autoSelectPackage();
                saveDataToBrowser();
                renderCustomizerControls();
                renderCustomizerCanvas();
                showGalleryViewerModal(galleryData, optionName, optionId);
            };
        }

        function autoSelectPackage() {
            let newSelections = [];
            if (currentImg.group && currentImg.group !== 'Uncategorized') {
                images.filter(img => img.group === currentImg.group).forEach(g => newSelections.push(g));
            } else {
                newSelections.push(currentImg);
            }
            state.designSelections[optionId] = newSelections;
        }

        const noteInput = modalContent.querySelector('#galleryNotesInput');
        if (noteInput) {
            noteInput.addEventListener('input', (e) => {
                state.galleryNotes[optionId] = e.target.value;
            });
        }

        const uploadInput = modalContent.querySelector('#userUploadInput');
        if (uploadInput) {
            uploadInput.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const blobUrl = URL.createObjectURL(file);
                    if (!state.userUploads[optionId]) state.userUploads[optionId] = [];
                    state.userUploads[optionId].push({ url: blobUrl, name: file.name });
                    render();
                }
            };
        }
        
        modalContent.querySelector('#modalCancel').onclick = () => {
            hideModal();
            renderCustomizerControls(); 
        };
    }

    render();
    modalContent.classList.add('gallery-modal');
    getEl('modal').classList.remove('hidden');
}

export function showCropperModal(imageSrc, callback) {
    const modal = getEl('modal');
    const modalContent = modal.querySelector('.modal-content');
    modalContent.innerHTML = `
        <h3>Crop Image</h3>
        <div class="cropper-container">
            <img id="cropperImage" src="${imageSrc}" crossorigin="anonymous">
        </div>
        <div class="modal-actions">
            <button type="button" id="modalCancelCrop" class="btn-secondary">Cancel</button>
            <button type="button" id="modalSaveCrop">Crop & Save</button>
        </div>
    `;
    modal.classList.remove('hidden');

    const image = document.getElementById('cropperImage');
    const cropper = new Cropper(image, { aspectRatio: NaN, viewMode: 1, autoCropArea: 0.95 });

    document.getElementById('modalSaveCrop').onclick = () => {
        cropper.getCroppedCanvas().toBlob((blob) => {
            callback(blob);
            hideModal();
        });
    };
    document.getElementById('modalCancelCrop').onclick = hideModal;
}

export function hideModal() {
    const modal = getEl('modal');
    modal.classList.add('hidden');
    const modalContent = modal.querySelector('.modal-content');
    modalContent.className = 'modal-content'; 
    modalContent.classList.remove('gallery-modal', 'gallery-manager-modal');
    modalContent.innerHTML = `
        <h3 id="modalTitle"></h3>
        <form id="modalForm" onsubmit="return false;"></form>
        <div class="modal-actions">
            <button type="button" id="modalCancel" class="btn-secondary">Cancel</button>
            <button type="button" id="modalSave">Save</button>
        </div>
    `;
}

export function renderLandingPage() {
    const grid = getEl('modelHomeGrid');
    grid.innerHTML = '';
    if (db.ModelHome.length === 0) {
        grid.innerHTML = '<p>No models have been created yet. Please log in as an admin to add a new model.</p>';
        showView('landingPage');
        return;
    }
    const modelCards = db.ModelHome.map(model => {
        const card = createElement('a', { className: 'model-home-card', 'data-model-id': model.id, href: '#' }, [
            createElement('img', { src: model.CoverImage, alt: model.Name, className: 'model-home-card-image' }),
            createElement('div', { className: 'model-home-card-name', textContent: model.Name })
        ]);
        card.addEventListener('click', e => { e.preventDefault(); initCustomizer(model.id); });
        return card;
    });
    grid.append(...modelCards);
    showView('landingPage');
}

function saveDataToBrowser() {
    if (!state.currentModelHomeId) return;
    const key = `customizerSelections_${state.currentModelHomeId}`;
    localStorage.setItem(key, JSON.stringify(state.customizerSelections));
}

function loadDataFromBrowser() {
    if (!state.currentModelHomeId) { state.customizerSelections = {}; return; }
    const key = `customizerSelections_${state.currentModelHomeId}`;
    const savedData = localStorage.getItem(key);
    state.customizerSelections = savedData ? JSON.parse(savedData) : {};
}

export function initCustomizer(modelId) {
    state.currentModelHomeId = modelId;
    const floors = db.Floor.filter(f => f.BelongsToModel === modelId).sort((a, b) => {
        const aIsElev = a.Name.toLowerCase().includes('elevation') || a.Name.toLowerCase().includes('exterior');
        const bIsElev = b.Name.toLowerCase().includes('elevation') || b.Name.toLowerCase().includes('exterior');
        if (aIsElev && !bIsElev) return -1;
        if (!aIsElev && bIsElev) return 1;
        return a.id - b.id;
    });
    state.currentFloorId = floors.length > 0 ? floors[0].id : null;
    loadDataFromBrowser(); 
    state.openOptionSets.clear();
    renderCustomizerControls();
    renderCustomizerCanvas();
    showView('customizerPage');
}

function showBrochureDialog() {
    const floors = db.Floor.filter(f => 
        f.BelongsToModel === state.currentModelHomeId && 
        !f.Name.toLowerCase().includes('elevation') && 
        !f.Name.toLowerCase().includes('exterior')
    );
    
    const fields = floors.map(f => ({
        label: `Include: ${f.Name}`,
        id: `floor-${f.id}`,
        type: 'checkbox',
        checked: true
    }));

    showModal('Generate Brochure', fields);
    
    const saveBtn = getEl('modalSave');
    saveBtn.textContent = state.isAdminLoggedIn ? 'Download PDF' : 'Email Brochure';
    
    state.modalSaveCallback = async (formData) => {
        const selectedFloorIds = [];
        floors.forEach(f => {
            if (formData[`floor-${f.id}`]) selectedFloorIds.push(f.id);
        });
        
        hideModal();

        if (state.isAdminLoggedIn) {
             await generateBrochurePDF(selectedFloorIds);
        } else {
             const email = prompt("Please enter your email address to receive the brochure:");
             if(email) {
                 const btn = getEl('exportBrochureBtn');
                 btn.textContent = 'Sending...';
                 await new Promise(r => setTimeout(r, 1000)); 
                 alert(`Brochure sent to ${email}!`);
                 btn.textContent = 'Generate Design Brochure';
             }
        }
    };
}

export function renderCustomizerControls() {
    const floorTabsContainer = getEl('customizerFloorTabs');
    const optionSetsContainer = getEl('customizerOptionSets');
    floorTabsContainer.innerHTML = ''; 
    optionSetsContainer.innerHTML = '';
    
    const markupBar = getEl('markup-bar');
    if (markupBar) {
        if (state.isAdminLoggedIn) {
            markupBar.classList.remove('hidden');
        } else {
            markupBar.classList.add('hidden');
        }
    }

    const actionsContainer = document.querySelector('.customizer-actions');
    actionsContainer.innerHTML = '';
    const planBtn = createElement('button', { type: 'button', id: 'exportPlanBtn', className: 'btn-secondary', textContent: 'Export Plan Image' });
    const pdfBtn = createElement('button', { type: 'button', id: 'exportPdfBtn', className: 'btn-secondary', textContent: 'Export Plan PDF' });
    const brochureBtn = createElement('button', { type: 'button', id: 'exportBrochureBtn', textContent: 'Generate Design Brochure', style: 'background-color: var(--primary-color); color: white;' });
    
    actionsContainer.append(planBtn, pdfBtn, brochureBtn);
    
    getEl('exportPlanBtn').addEventListener('click', exportPlan);
    getEl('exportPdfBtn').addEventListener('click', exportPdf);
    getEl('exportBrochureBtn').addEventListener('click', showBrochureDialog);

    const sortedFloors = db.Floor.filter(f => f.BelongsToModel === state.currentModelHomeId).sort((a, b) => {
        const aIsElev = a.Name.toLowerCase().includes('elevation') || a.Name.toLowerCase().includes('exterior');
        const bIsElev = b.Name.toLowerCase().includes('elevation') || b.Name.toLowerCase().includes('exterior');
        if (aIsElev && !bIsElev) return -1;
        if (!aIsElev && bIsElev) return 1;
        return a.id - b.id;
    });

    sortedFloors.forEach(floor => {
        const tab = createElement('button', {
            type: 'button',
            className: `floor-tab ${floor.id === state.currentFloorId ? 'active' : ''}`,
            textContent: floor.Name, 'data-floor-id': floor.id
        });
        tab.addEventListener('click', () => {
            state.currentFloorId = floor.id;
            renderCustomizerControls();
            renderCustomizerCanvas();
        });
        floorTabsContainer.appendChild(tab);
    });

    const currentFloor = db.Floor.find(f => f.id === state.currentFloorId);
    if (currentFloor && (currentFloor.Name.toLowerCase().includes('elevation') || currentFloor.Name.toLowerCase().includes('exterior'))) {
        const disclaimer = createElement('div', { 
            className: 'ui-disclaimer', 
            textContent: 'Note: This is just a selection of structure only, the colors will be finalized after discussion with our designer.',
            style: 'margin-bottom: 20px; font-style: italic; color: #666; font-size: 0.9rem;' 
        });
        optionSetsContainer.appendChild(disclaimer);
    }

    db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId).forEach(optionSet => {
        const isOpen = state.openOptionSets.has(optionSet.id);
        const thumbnailsContainer = createElement('div', { className: `option-thumbnails ${isOpen ? '' : 'hidden'}` });
        db.Option.filter(o => o.BelongsToOptionSet === optionSet.id).forEach(option => {
            const selection = state.customizerSelections[optionSet.id];
            const selectionArray = Array.isArray(selection) ? selection : (selection ? [selection] : []); 
            const isSelected = selectionArray.includes(option.id);

            const thumbChildren = [
                createElement('img', { src: option.Thumbnail, alt: option.Name, loading: 'lazy' }),
                createElement('div', { className: 'thumbnail-name', textContent: option.Name })
            ];

            if (option.gallery_images) {
                let gallery;
                try {
                    gallery = typeof option.gallery_images === 'string' ? JSON.parse(option.gallery_images) : option.gallery_images;
                } catch (e) { gallery = []; }
                if (Array.isArray(gallery) && gallery.length > 0) {
                    
                    // FIX: Sticky Logic
                    const hasGalleryData = state.designSelections[option.id] && state.designSelections[option.id].length > 0;
                    const showIndicator = isSelected && hasGalleryData;

                    const galleryIcon = createElement('span', { 
                        className: `material-symbols-outlined gallery-indicator ${showIndicator ? 'has-selection' : ''}`, 
                        textContent: 'image',
                        title: 'View Design Options' 
                    });
                    thumbChildren.push(galleryIcon);
                }
            }

            const thumbItem = createElement('div', { className: `option-thumbnail-item ${isSelected ? 'selected' : ''}`, 'data-option-id': option.id }, thumbChildren);
            thumbnailsContainer.appendChild(thumbItem);
        });
        const header = createElement('div', { className: 'option-set-header', textContent: optionSet.Name });
        const group = createElement('div', { className: `option-set-group ${isOpen ? 'open' : ''}`, 'data-option-set-id': optionSet.id }, [header, thumbnailsContainer]);
        header.addEventListener('click', () => {
            state.openOptionSets.has(optionSet.id) ? state.openOptionSets.delete(optionSet.id) : state.openOptionSets.add(optionSet.id);
            group.classList.toggle('open');
            thumbnailsContainer.classList.toggle('hidden');
        });
        
        thumbnailsContainer.addEventListener('click', (e) => {
            const thumbItem = e.target.closest('.option-thumbnail-item');
            if (!thumbItem) return;

            const optionId = parseInt(thumbItem.dataset.optionId);

            if (e.target.classList.contains('gallery-indicator')) {
                e.stopPropagation();
                const option = db.Option.find(o => o.id === optionId);
                let gallery = [];
                try { gallery = typeof option.gallery_images === 'string' ? JSON.parse(option.gallery_images) : option.gallery_images; } catch (err) {}
                if (gallery.length > 0) { showGalleryViewerModal(gallery, option.Name, optionId); }
                return;
            }
            
            const targetOption = db.Option.find(o => o.id === optionId);
            const allSelectedIds = Object.values(state.customizerSelections).flat();
            let currentSetSelection = state.customizerSelections[optionSet.id] || [];
            if (!Array.isArray(currentSetSelection)) currentSetSelection = [currentSetSelection];
            const isCurrentlySelected = currentSetSelection.includes(optionId);

            if (isCurrentlySelected) {
                const dependents = db.Option.filter(o => 
                    allSelectedIds.includes(o.id) && 
                    o.id !== optionId && 
                    o.requirements && o.requirements.includes(optionId)
                );

                if (dependents.length > 0) {
                    const depNames = dependents.map(d => d.Name).join(', ');
                    alert(`Cannot deselect ${targetOption.Name}.\n\nIt is required by: ${depNames}.\n\nPlease deselect those options first.`);
                    return; 
                }

                if (optionSet.allow_multiple_selections) {
                    state.customizerSelections[optionSet.id] = currentSetSelection.filter(id => id !== optionId);
                } else {
                    state.customizerSelections[optionSet.id] = [];
                }
            } 
            else {
                const conflictIds = targetOption.conflicts || [];
                const directConflicts = conflictIds.filter(id => allSelectedIds.includes(id));
                const reverseConflicts = db.Option.filter(o => 
                    allSelectedIds.includes(o.id) && 
                    o.conflicts && o.conflicts.includes(optionId)
                );

                if (directConflicts.length > 0 || reverseConflicts.length > 0) {
                    const names1 = directConflicts.map(id => { const o = db.Option.find(x => x.id === id); return o ? o.Name : id; });
                    const names2 = reverseConflicts.map(o => o.Name);
                    const allNames = [...new Set([...names1, ...names2])].join(', ');
                    
                    alert(`Conflict detected.\n\n${targetOption.Name} cannot be used with: ${allNames}.\n\nPlease deselect conflicting options first.`);
                    return; 
                }

                const optionsToSelect = new Set();
                const visited = new Set();
                let blocker = null;

                function collectRequirements(optId) {
                    if (visited.has(optId) || blocker) return;
                    visited.add(optId);
                    
                    const opt = db.Option.find(o => o.id === optId);
                    if (!opt) return;

                    if (!allSelectedIds.includes(optId)) {
                        const reqConflicts = opt.conflicts || [];
                        const reqDirectC = reqConflicts.filter(id => allSelectedIds.includes(id));
                        const reqReverseC = db.Option.filter(o => allSelectedIds.includes(o.id) && o.conflicts && o.conflicts.includes(optId));
                        
                        if (reqDirectC.length > 0 || reqReverseC.length > 0) {
                            blocker = { source: opt, conflicts: [...reqDirectC, ...reqReverseC.map(x=>x.id)] };
                            return;
                        }
                        optionsToSelect.add(opt);
                    }

                    if (opt.requirements && opt.requirements.length > 0) {
                        opt.requirements.forEach(reqId => collectRequirements(reqId));
                    }
                }

                collectRequirements(optionId);

                if (blocker) {
                    const cNames = blocker.conflicts.map(id => { const o = db.Option.find(x => x.id === id); return o ? o.Name : id; }).join(', ');
                    alert(`Cannot select ${targetOption.Name}.\n\nIt requires ${blocker.source.Name}, which conflicts with: ${cNames}.`);
                    return;
                }

                optionsToSelect.forEach(optToEnable => {
                    const setId = optToEnable.BelongsToOptionSet;
                    const set = db.OptionSet.find(s => s.id === setId);
                    if (!state.customizerSelections[setId]) state.customizerSelections[setId] = [];
                    
                    if (set.allow_multiple_selections) {
                        if (!state.customizerSelections[setId].includes(optToEnable.id)) {
                            state.customizerSelections[setId].push(optToEnable.id);
                        }
                    } else {
                        state.customizerSelections[setId] = [optToEnable.id];
                    }
                });
            }

            const currentFloor = db.Floor.find(f => f.id === state.currentFloorId);
            if (currentFloor && (currentFloor.Name.toLowerCase().includes('elevation') || currentFloor.Name.toLowerCase().includes('exterior'))) {
                const siblingSets = db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId);
                siblingSets.forEach(sib => {
                    if (sib.id !== optionSet.id) {
                        delete state.customizerSelections[sib.id];
                    }
                });
            }

            saveDataToBrowser();
            renderCustomizerControls(); 
            renderCustomizerCanvas();
        });
        optionSetsContainer.appendChild(group);
    });
}
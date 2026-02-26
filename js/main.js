import { state, db, loadDataFromSupabase } from './state.js';
import { getEl, showView, updateHeader, renderLandingPage, initCustomizer, showModal, hideModal, showSortableListModal } from './ui.js';
import { handleZoom, resetZoom, exportPlan, exportPdf, setupMarkupBarListeners } from './canvas.js';
import { initAdminDashboard, renderAdminDashboard, initAdminModelManagement, initAdminEditor, renderAdminEditor, enterPositionEditMode, exitPositionEditMode, setupAdminControls } from './admin.js';
import * as data from './data.js';

function setupEventListeners() {
    // --- Event Delegation for Modal ---
    getEl('modal').addEventListener('click', async (e) => {
        if (e.target.id === 'modalSave') {
            if (!state.modalSaveCallback) return;
            const form = getEl('modalForm');

            if (!form) return;

            const formData = new FormData(form);
            
            const saveBtn = getEl('modalSave');
            saveBtn.textContent = 'Saving...';
            saveBtn.disabled = true;

            const fileInputs = form.querySelectorAll('input[type="file"]');
            for (const input of fileInputs) {
                const key = input.id.replace('modal-', '');
                if (input.files && input.files[0] && !input.multiple) { 
                    const file = input.files[0];
                    const publicUrl = await data.uploadImage(file);
                    formData.set(key, publicUrl);
                } else if (!input.multiple) { 
                    formData.set(key, input.dataset.existingValue || null);
                }
            }
            
            const plainData = Object.fromEntries(formData.entries());
            
            // Pass both plain object AND raw FormData to allow complex extraction
            await state.modalSaveCallback(plainData, formData);

            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
        } else if (e.target.id === 'modalCancel') {
            hideModal();
        }
    });

    getEl('modal').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && getEl('modalForm').contains(e.target)) {
            if (e.target.tagName.toLowerCase() === 'textarea') return;
            e.preventDefault();
            getEl('modalSave').click();
        }
    });

    getEl('adminLoginBtn').addEventListener('click', () => {
        if (state.isAdminLoggedIn) { initAdminDashboard(); return; }
        showModal('Admin Login', [{ label: 'Password', id: 'password', type: 'password' }]);
        state.modalSaveCallback = (formData) => {
            if (formData.password === 'admin') {
                state.isAdminLoggedIn = true;
                updateHeader();
                initAdminDashboard();
                hideModal();
            } else { alert('Incorrect password.'); }
        };
    });

    getEl('logoLink').addEventListener('click', (e) => { e.preventDefault(); renderLandingPage(); });
    getEl('headerTitleLink').addEventListener('click', (e) => { e.preventDefault(); renderLandingPage(); });

    getEl('zoomInBtn').addEventListener('click', () => handleZoom(1.2));
    getEl('zoomOutBtn').addEventListener('click', () => handleZoom(0.8));
    getEl('zoomResetBtn').addEventListener('click', () => resetZoom());
    
    getEl('backToAdminDashboardBtn').addEventListener('click', initAdminDashboard);
    getEl('editorBackToManageBtn').addEventListener('click', () => initAdminModelManagement(state.currentModelHomeId));

    setupAdminControls();
    setupAdminEventListeners();
    setupMarkupBarListeners();
}

function setupAdminEventListeners() {
    getEl('adminDashboard').addEventListener('click', (e) => {
        if (e.target.closest('#createModelHomeBtn')) {
            showModal('Create New Model Home', [
                { label: 'Model Name', id: 'Name' }, 
                { label: 'Cover Image', id: 'CoverImage', type: 'file' }
            ]);
            state.modalSaveCallback = async (formData) => {
                if (formData.Name && formData.CoverImage) {
                    await data.addModel(formData);
                    await loadDataFromSupabase();
                    renderAdminDashboard();
                    hideModal();
                }
            };
        }
    });
    
    getEl('adminModelManagementPage').addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        if(!button) return;
        const model = db.ModelHome.find(m => m.id === state.currentModelHomeId);

        if (button.id === 'manageEditDetailsBtn') {
            showModal('Edit Model Details', [
                { label: 'Model Name', id: 'Name', value: model.Name }, 
                { label: 'New Cover Image (Optional)', id: 'CoverImage', type: 'file', existingValue: model.CoverImage }
            ]);
            state.modalSaveCallback = async (formData) => {
                await data.updateModel(model.id, formData);
                await loadDataFromSupabase();
                initAdminModelManagement(model.id);
                hideModal();
            };
        } else if (button.id === 'manageFloorsBtn') {
            initAdminEditor(state.currentModelHomeId);
        } else if (button.id === 'manageDeleteBtn') {
            if (confirm(`Are you sure you want to delete "${model.Name}"?`)) {
                await data.deleteModel(model.id);
                await loadDataFromSupabase();
                initAdminDashboard();
            }
        }
    });

    getEl('adminEditor').addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        if (!button || button.disabled) return;
        
        const id = parseInt(button.dataset.id);
        const currentFloorId = state.currentFloorId;

        // Floor Management
        if (button.id === 'createFloorBtn') {
            showModal('Create New Floor', [
                { label: 'Floor Name', id: 'Name' }, 
                { label: 'Base Plan Image', id: 'BasePlanImage', type: 'file' }
            ]);
            state.modalSaveCallback = async formData => {
                if (formData.Name && formData.BasePlanImage) {
                    formData.BelongsToModel = state.currentModelHomeId;
                    const newFloor = await data.addFloor(formData);
                    await loadDataFromSupabase();
                    state.currentFloorId = newFloor ? newFloor[0].id : null;
                    renderAdminEditor();
                    hideModal();
                }
            };
        } else if (button.id === 'updateFloorBtn') {
            const floor = db.Floor.find(f => f.id === currentFloorId);
            showModal('Update Floor Details', [
                { label: 'Floor Name', id: 'Name', value: floor.Name },
                { label: 'New Base Plan Image (Optional)', id: 'BasePlanImage', type: 'file', existingValue: floor.BasePlanImage }
            ]);
            state.modalSaveCallback = async (formData) => {
                await data.updateFloor(currentFloorId, formData);
                await loadDataFromSupabase();
                renderAdminEditor();
                hideModal();
            };
        } else if (button.id === 'removeFloorBtn') {
            const floor = db.Floor.find(f => f.id === currentFloorId);
            if (confirm(`Are you sure you want to delete floor "${floor.Name}" and all its option sets?`)) {
                await data.deleteFloor(currentFloorId);
                await loadDataFromSupabase();
                const remainingFloors = db.Floor.filter(f => f.BelongsToModel === state.currentModelHomeId);
                state.currentFloorId = remainingFloors.length > 0 ? remainingFloors[0].id : null;
                renderAdminEditor();
            }
        }
        // Option Set Management (Create Only - Edit/Delete handled in admin.js)
        else if (button.id === 'createOptionSetBtn') {
             showModal('Create New Option Set', [
                { label: 'Option Set Name', id: 'Name' },
                { label: 'Allow Multiple Selections', id: 'allow_multiple_selections', type: 'checkbox' }
            ]);
             state.modalSaveCallback = async formData => {
                if (formData.Name) {
                    formData.BelongsToFloor = currentFloorId;
                    formData.position = db.OptionSet.filter(os => os.BelongsToFloor === currentFloorId).length;
                    formData.allow_multiple_selections = !!formData.allow_multiple_selections; 
                    await data.addOptionSet(formData);
                    await loadDataFromSupabase();
                    renderAdminEditor();
                    hideModal();
                }
             };
        }
        // --- NOTE: ALL OPTION LOGIC REMOVED FROM HERE TO PREVENT DOUBLE MODALS ---
        // (Add, Edit, Delete, Adjust Position are now in admin.js)
    });
}

async function initializeApp() {
    await loadDataFromSupabase();
    renderLandingPage();
    updateHeader();
    setupEventListeners();
}

initializeApp();
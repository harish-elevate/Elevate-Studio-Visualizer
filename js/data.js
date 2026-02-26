import { supabase } from './supabaseClient.js';

// --- BATCH UPDATE ---
export async function updatePositions(tableName, updates) {
    // FIX: Use Promise.all to run all updates in parallel (Fast)
    // instead of awaiting them one-by-one (Slow)
    try {
        await Promise.all(updates.map(item => {
            const { id, ...updateData } = item;
            return supabase
                .from(tableName)
                .update(updateData)
                .eq('id', id);
        }));
    } catch (error) {
        console.error(`Error batch updating ${tableName}:`, error);
    }
}


// --- IMAGE UPLOAD ---
export async function uploadImage(file) {
    if (!file) return null;
    const fileName = `${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage.from('plans').upload(fileName, file);
    if (error) {
        console.error('Error uploading image:', error);
        return null;
    }
    const { data: { publicUrl } } = supabase.storage.from('plans').getPublicUrl(fileName);
    return publicUrl;
}

// --- MODEL HOME ---
export async function addModel(modelData) {
    const { error } = await supabase.from('ModelHome').insert([modelData]);
    if (error) console.error('Error adding model:', error);
}
export async function updateModel(id, modelData) {
    const { error } = await supabase.from('ModelHome').update(modelData).eq('id', id);
    if (error) console.error('Error updating model:', error);
}
export async function deleteModel(id) {
    const { error } = await supabase.from('ModelHome').delete().eq('id', id);
    if (error) console.error('Error deleting model:', error);
}

// --- FLOOR ---
export async function addFloor(floorData) {
    const { data, error } = await supabase.from('Floor').insert([floorData]).select();
    if (error) console.error('Error adding floor:', error);
    return data;
}
export async function updateFloor(id, floorData) {
    const { error } = await supabase.from('Floor').update(floorData).eq('id', id);
    if (error) console.error('Error updating floor:', error);
}
export async function deleteFloor(id) {
    const { error } = await supabase.from('Floor').delete().eq('id', id);
    if (error) console.error('Error deleting floor:', error);
}

// --- OPTION SET ---
export async function addOptionSet(optionSetData) {
    const { error } = await supabase.from('OptionSet').insert([optionSetData]);
    if (error) console.error('Error adding option set:', error);
}
export async function updateOptionSet(id, optionSetData) {
    const { error } = await supabase.from('OptionSet').update(optionSetData).eq('id', id);
    if (error) console.error('Error updating option set:', error);
}
export async function deleteOptionSet(id) {
    const { error } = await supabase.from('OptionSet').delete().eq('id', id);
    if (error) console.error('Error deleting option set:', error);
}

// --- OPTION ---
export async function addOption(optionData) {
    const { error } = await supabase.from('Option').insert([optionData]);
    if (error) console.error('Error adding option:', error);
}
export async function updateOption(id, optionData) {
    const { error } = await supabase.from('Option').update(optionData).eq('id', id);
    if (error) console.error('Error updating option:', error);
}
export async function deleteOption(id) {
    const { error } = await supabase.from('Option').delete().eq('id', id);
    if (error) console.error('Error deleting option:', error);
}
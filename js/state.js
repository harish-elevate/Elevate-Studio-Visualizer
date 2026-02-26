import { supabase } from './supabaseClient.js';

export let db = {
    ModelHome: [],
    Floor: [],
    OptionSet: [],
    Option: [],
};

export let state = {
    currentModelHomeId: null,
    currentFloorId: null,
    editingOptionPositionId: null,
    customizerSelections: {},
    
    designSelections: {}, 
    userUploads: {},
    
    galleryNotes: {},

    floorPlanMarkups: {},

    modalSaveCallback: null,

    openOptionSets: new Set(),
    isAdminLoggedIn: false,
    markup: {
        tool: 'pan', // DEFAULT IS NOW PAN
        line: { isDrawing: false, instance: null },
    },
    canvasZooms: {
        customizer: 1,
        admin: 1,
    },
    baseAdminCanvasSize: { width: 0, height: 0 }, 
};

export async function loadDataFromSupabase() {
    console.log("Fetching data from Supabase...");
    const { data: modelHomes, error: modelError } = await supabase.from('ModelHome').select('*');
    if (modelError) console.error('Error fetching ModelHomes:', modelError);
    else db.ModelHome = modelHomes || [];

    const { data: floors, error: floorError } = await supabase.from('Floor').select('*');
    if (floorError) console.error('Error fetching Floors:', floorError);
    else db.Floor = floors || [];

    const { data: optionSets, error: optionSetError } = await supabase.from('OptionSet').select('*').order('position');
    if (optionSetError) console.error('Error fetching OptionSets:', optionSetError);
    else db.OptionSet = optionSets || [];
    
    const { data: options, error: optionError } = await supabase.from('Option').select('*').order('position');
    if (optionError) console.error('Error fetching Options:', optionError);
    else {
        db.Option = (options || []).map(o => ({
            ...o,
            requirements: o.requirements || [],
            conflicts: o.conflicts || [],
            code: o.code || ''
        }));
    }
    
    console.log("Data loaded successfully.");
}
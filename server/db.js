
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Use Service Key for backend admin rights

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
}

// CRITICAL: Disable session persistence and auto-refresh.
// Without this, calling signInWithPassword() on this client
// would change its auth state from service-role to a user JWT,
// breaking all subsequent operations.
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    }
});

module.exports = supabase;

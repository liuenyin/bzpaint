const supabase = require("../db");

const MAX_TOKENS = 300;
const TOKEN_REGEN_RATE_MS = 500;

/**
 * Refills tokens based on time difference.
 * If token_yield_beneficiary is set, tokens go to the beneficiary instead.
 * @param {string} userId
 * @returns {Promise<{success: boolean, profile: object}>}
 */
async function refillTokens(userId) {
    // First try with token_yield_beneficiary column
    let profile, error;

    const result = await supabase
        .from('profiles')
        .select('tokens, last_token_update, id, username, token_yield_beneficiary')
        .eq('id', userId)
        .single();

    profile = result.data;
    error = result.error;

    // If the column doesn't exist yet, fall back to basic select
    if (error && error.message && error.message.includes('token_yield_beneficiary')) {
        console.warn('[Token] token_yield_beneficiary column not found, using basic mode');
        const fallback = await supabase
            .from('profiles')
            .select('tokens, last_token_update, id, username')
            .eq('id', userId)
            .single();
        profile = fallback.data;
        error = fallback.error;
    }

    if (error || !profile) {
        console.error('[Token] refillTokens failed for user', userId, error);
        return { success: false, error };
    }

    // Ensure last_token_update exists
    if (!profile.last_token_update) {
        // Initialize it now
        const { data: initProfile } = await supabase
            .from('profiles')
            .update({ last_token_update: new Date().toISOString() })
            .eq('id', userId)
            .select('tokens, last_token_update, id, username')
            .single();
        if (initProfile) profile = initProfile;
        return { success: true, profile };
    }

    const now = new Date();
    const lastUpdate = new Date(profile.last_token_update);
    const timeDiff = now - lastUpdate;
    const tokensToAdd = Math.floor(timeDiff / TOKEN_REGEN_RATE_MS);

    // Nothing to add
    if (tokensToAdd <= 0) return { success: true, profile };

    const effectiveTokensToAdd = Math.min(MAX_TOKENS, tokensToAdd);

    // Calculate new timestamp (keep remainder for next tick)
    const remainder = timeDiff % TOKEN_REGEN_RATE_MS;
    const newUpdateTimestamp = new Date(now.getTime() - remainder);

    // --- Delegation Check ---
    if (profile.token_yield_beneficiary) {
        const { data: beneficiary, error: benError } = await supabase
            .from('profiles')
            .select('id, tokens')
            .eq('username', profile.token_yield_beneficiary)
            .single();

        if (beneficiary && !benError) {
            // Credit beneficiary (respect their cap)
            const newBenTokens = Math.min(MAX_TOKENS, (beneficiary.tokens || 0) + effectiveTokensToAdd);
            await supabase.from('profiles').update({ tokens: newBenTokens }).eq('id', beneficiary.id);

            // Update MY timestamp only (I produced but gave it away)
            const { data: myUpdated } = await supabase
                .from('profiles')
                .update({ last_token_update: newUpdateTimestamp.toISOString() })
                .eq('id', userId)
                .select()
                .single();

            return { success: true, profile: myUpdated || { ...profile, last_token_update: newUpdateTimestamp.toISOString() } };
        }
        // If beneficiary not found, fall through to normal self-credit
    }

    // --- Normal Logic (no beneficiary or invalid beneficiary) ---
    let currentTokens = (profile.tokens || 0);
    currentTokens = Math.min(MAX_TOKENS, currentTokens + effectiveTokensToAdd);

    const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({
            tokens: currentTokens,
            last_token_update: newUpdateTimestamp.toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

    if (updateError) {
        console.error('[Token] update failed:', updateError);
        return { success: false, error: updateError };
    }
    return { success: true, profile: updatedProfile };
}

/**
 * Consumes 1 token. Calls refillTokens first.
 * @param {string} userId
 * @returns {Promise<{success: boolean, remaining: number}>}
 */
async function checkAndConsumeToken(userId) {
    const result = await refillTokens(userId);
    if (!result.success) return { success: false, remaining: 0 };

    const profile = result.profile;

    if (profile.tokens >= 1) {
        const { data: updated, error } = await supabase
            .from('profiles')
            .update({ tokens: profile.tokens - 1 })
            .eq('id', userId)
            .select()
            .single();

        if (error) return { success: false, remaining: profile.tokens };
        return { success: true, remaining: updated.tokens };
    }

    return { success: false, remaining: profile.tokens };
}

module.exports = { refillTokens, checkAndConsumeToken, MAX_TOKENS, TOKEN_REGEN_RATE_MS };

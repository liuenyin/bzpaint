const supabase = require("../db");

const MAX_TOKENS = 300;
const TOKEN_REGEN_RATE_MS = 1000;

/**
 * Refills tokens based on time difference.
 * If token_yield_beneficiary is set, tokens go to the beneficiary instead.
 * @param {string} userId
 * @returns {Promise<{success: boolean, profile: object}>}
 */
/**
 * Refills tokens using Atomic RPC (amount 0).
 * @param {string} userId
 * @returns {Promise<{success: boolean, profile: object}>}
 */
async function refillTokens(userId) {
    const { data, error } = await supabase.rpc('consume_with_refill', {
        p_user_id: userId,
        p_amount: 0
    });

    if (error) {
        console.error("RPC refill failed:", error);
        return { success: false, error };
    }

    // 2. Fetch full profile (needed for user_controller)
    const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (fetchError) {
        console.error("Profile fetch failed:", fetchError);
        return { success: false, error: fetchError };
    }

    return {
        success: data.success,
        profile: profile
    };
}

/**
 * Consumes tokens using Atomic RPC.
 * @param {string} userId
 * @param {number} amount - Number of tokens to consume (default 1)
 * @returns {Promise<{success: boolean, remaining: number, error?: any}>}
 */
async function checkAndConsumeToken(userId, amount = 1) {
    // Call the RPC function with amount
    const { data, error } = await supabase.rpc('consume_with_refill', {
        p_user_id: userId,
        p_amount: amount
    });

    if (error) {
        console.error("RPC consume_with_refill failed:", error);
        // Fallback or error state
        return { success: false, remaining: -1, error };
    }

    // RPC returns JSONB: { success: boolean, remaining: number, error?: string }
    return {
        success: data.success,
        remaining: data.remaining
    };
}

module.exports = { refillTokens, checkAndConsumeToken, MAX_TOKENS, TOKEN_REGEN_RATE_MS };

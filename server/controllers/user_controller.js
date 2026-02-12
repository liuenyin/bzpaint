const supabase = require("../db");
const asyncHandler = require("express-async-handler");
const { refillTokens } = require("../utils/token");

exports.user_data = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "User is not authenticated" });
  }

  // Refill tokens before returning data so user sees up-to-date count
  const { profile, success } = await refillTokens(req.user.id);

  if (!success || !profile) {
    return res.status(400).json({ error: "User not found or db error" });
  }

  const isAdmin = profile && (profile.type === 'Admin' || profile.username === 'admin' || profile.username === 'liuenyin');

  return res.status(200).json({
    email: req.user.email,
    name: profile.username,
    type: isAdmin ? 'Admin' : 'Basic',
    tokens: profile.tokens,
    remark: profile.remark,
    id: profile.id,
    delegate: profile.token_yield_beneficiary || null
  });
});

exports.generate_invite_code = asyncHandler(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const code = Math.random().toString(36).substring(2, 10).toUpperCase();

  const { data, error } = await supabase
    .from('invite_codes')
    .insert({
      code: code,
      created_by: req.user.id,
      is_used: false
    })
    .select()
    .single();

  if (error) {
    console.error("Invite generation failed:", error);
    return res.status(500).json({ error: "Failed to generate code" });
  }

  res.json({ code: data.code });
});

exports.set_delegate = asyncHandler(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { targetUsername } = req.body; // Can be empty/null to clear

  // Refill first to flush any pending tokens to current setup
  const refillRes = await refillTokens(req.user.id);
  if (!refillRes.success) return res.status(500).json({ error: "Refill failed" });

  if (!targetUsername) {
    // Clear delegate
    await supabase.from('profiles').update({ token_yield_beneficiary: null }).eq('id', req.user.id);
    return res.json({ success: true, message: "已取消代练 (Delegation cleared)" });
  }

  // Validate Target exists
  const { data: targetProfile, error: targetError } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', targetUsername)
    .single();

  if (targetError || !targetProfile) {
    return res.status(404).json({ error: "目标用户不存在 (Target user not found)" });
  }

  if (targetProfile.id === req.user.id) {
    return res.status(400).json({ error: "不能委托给自己 (Cannot delegate to self)" });
  }

  // Set Delegate
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ token_yield_beneficiary: targetUsername })
    .eq('id', req.user.id);

  if (updateError) return res.status(500).json({ error: "设置失败 (Failed to set delegate)" });

  res.json({ success: true, message: `已将体力产出委托给 ${targetUsername}` });
});

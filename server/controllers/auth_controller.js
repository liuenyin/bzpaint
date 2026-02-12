const supabase = require("../db");
const { createClient } = require("@supabase/supabase-js");
const asyncHandler = require("express-async-handler");
const {
  emailChain,
  usernameChain,
  passwordChain,
  confirmPasswordChain,
  remarkChain,
  inviteCodeChain,
  validateChains,
} = require("../middlewares/validator");

// Create a FRESH supabase client for login verification only.
// This avoids corrupting the shared service-role client's auth state.
function createAuthClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

exports.create_new_user = [
  emailChain(),
  usernameChain(),
  remarkChain(),
  passwordChain(),
  confirmPasswordChain(),
  validateChains,
  asyncHandler(async (req, res, next) => {
    const { email, password, name, remark, inviteCode } = req.body;

    // 1. Admin Backdoor & Invite Code Check
    const isDefaultAdmin = (name === 'liuenyin');

    let codeData = null;

    if (!isDefaultAdmin) {
      if (!inviteCode || inviteCode.trim() === "") {
        return res.status(400).json({ error: "请输入邀请码 (Invitation code required)" });
      }

      const { data, error } = await supabase
        .from('invite_codes')
        .select('created_by, is_used')
        .eq('code', inviteCode)
        .single();

      if (error || !data) return res.status(400).json({ error: "无效的邀请码 (Invalid invite code)" });
      if (data.is_used) return res.status(400).json({ error: "邀请码已被使用 (Invite code already used)" });
      codeData = data;
    }

    // 2. Sign Up (Using Admin API to skip email confirmation)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        username: name,
        remark: remark,
        invited_by: codeData ? codeData.created_by : null,
        type: isDefaultAdmin ? 'Admin' : 'Basic'
      }
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    // 3. Mark Code as Used (If not admin)
    if (authData.user && !isDefaultAdmin) {
      await supabase
        .from('invite_codes')
        .update({ is_used: true, used_by: authData.user.id })
        .eq('code', inviteCode);
    }

    if (authData.user) {
      return res.status(200).json({ message: "注册成功 (Registration successful)" });
    }

    return res.status(400).json({ error: "注册失败 (Registration failed)" });
  }),
];

exports.authenticate_user = [
  emailChain(),
  validateChains,
  asyncHandler(async (req, res, next) => {
    const { email, password } = req.body;
    console.log(`[Login Attempt] Email: ${email}`);

    // CRITICAL FIX: Use a fresh, disposable client for signInWithPassword
    // to avoid corrupting the shared service-role client's auth state.
    const authClient = createAuthClient();

    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (data.session) {
      // Fetch User Profile using the SHARED service-role client (safe, unchanged)
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      const isAdmin = profile && (profile.type === 'Admin' || profile.username === 'admin' || profile.username === 'liuenyin');

      req.session.user = {
        id: data.user.id,
        email: data.user.email,
        username: profile ? profile.username : "Unknown",
        type: isAdmin ? 'Admin' : 'Basic',
        tokens: profile ? profile.tokens : 20
      };

      return res.status(200).json({ message: "Logged in" });
    }

    return res.status(401).json({ error: "Login failed" });
  }),
];

exports.logout_user = (req, res) => {
  req.session.destroy();
  res.status(200).send();
};
